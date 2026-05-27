/**
 * Parse an ATIF (Agent Trajectory Interchange Format) trajectory.json into
 * AgentLogEntry[] for display. Harbor emits ATIF for both terminus-2 and codex.
 *
 * ATIF step structure:
 *   { source, message, tool_calls?, observation?, extra?, timestamp? }
 * Agent steps with tool_calls have the command in tool_calls[0].arguments.cmd
 * (codex) or .keystrokes (terminus-2), and output in observation.results[0].content.
 * Thinking steps have the text in `message`.
 *
 * Ported from Vetto Arena (terminal-task/components/user-facing/lib/parse-atif-trajectory.ts
 * + the AgentLogEntry type and stdout-noise helpers from hooks/use-agent-stream.ts).
 * Pure — no DB, no network. Both projects are MIT.
 */

export interface AgentLogEntry {
  id: string;
  type: "thinking" | "command" | "output" | "error";
  summary: string;
  detail?: string;
  status?: "running" | "completed" | "failed";
  timestamp?: number; // epoch ms
  /** Codex item.id — used to deduplicate on raw-log parse. */
  sourceId?: string;
}

const STDERR_NOISE_PATTERN =
  /Failed to retrieve model info for|Using fallback context limit/i;

export function isNoisyLogLine(line: string): boolean {
  return process.env.NODE_ENV !== "development" && STDERR_NOISE_PATTERN.test(line);
}

export function stripNoisyLogLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !isNoisyLogLine(line))
    .join("\n");
}

interface AtifToolCall {
  tool_call_id: string;
  function_name: string;
  arguments: Record<string, unknown>;
}

interface AtifObservationResult {
  source_call_id: string;
  content: string;
}

interface AtifStep {
  step_id?: string;
  timestamp?: string;
  source: string;
  message: string;
  tool_calls?: AtifToolCall[] | string;
  observation?: { results: AtifObservationResult[] } | string;
}

interface AtifTrajectory {
  schema_version: string;
  agent?: { name: string; model_name?: string };
  steps: AtifStep[];
  final_metrics?: Record<string, unknown>;
}

function parseToolCalls(raw: AtifToolCall[] | string | undefined): AtifToolCall[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw.replace(/'/g, '"'));
    } catch {
      return [];
    }
  }
  return raw;
}

function parseObservation(
  raw: { results: AtifObservationResult[] } | string | undefined,
): string | null {
  if (!raw) return null;
  const obs =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw.replace(/'/g, '"'));
          } catch {
            return null;
          }
        })()
      : raw;
  if (!obs?.results?.[0]?.content) return null;
  return obs.results[0].content;
}

function extractCommand(tc: AtifToolCall): string {
  // Codex: arguments.cmd
  if (tc.arguments.cmd) return String(tc.arguments.cmd);
  // Terminus-2: arguments.keystrokes (bash_command)
  if (tc.arguments.keystrokes) return String(tc.arguments.keystrokes).trim();
  if (tc.arguments.content) return `write ${tc.function_name}`;
  // mark_task_complete, etc.
  return tc.function_name;
}

function isNonCommandTool(fnName: string): boolean {
  return (
    fnName === "write_stdin" || fnName === "write_file" || fnName === "mark_task_complete"
  );
}

function deriveExitStatus(output: string | null, fnName: string): "completed" | "failed" {
  if (isNonCommandTool(fnName)) return "completed";
  if (!output) return "completed";
  if (output.includes("exit code: 0") || output.includes("Process exited with code 0"))
    return "completed";
  if (output.includes("exit code:") || output.includes("Process exited with code"))
    return "failed";
  return "completed";
}

function parseToolStep(
  step: AtifStep,
  id: string,
  toolCalls: AtifToolCall[],
): AgentLogEntry {
  const tc = toolCalls[0];
  const output = parseObservation(step.observation);
  return {
    id,
    type: "command",
    summary: extractCommand(tc).slice(0, 200),
    detail: output ?? undefined,
    status: deriveExitStatus(output, tc.function_name),
  };
}

function cleanMessage(msg: string): string {
  // Strip "Analysis: " prefix from terminus-2 messages.
  return msg.replace(/^Analysis:\s*/i, "");
}

function parseAgentStep(step: AtifStep, index: number): AgentLogEntry[] {
  const id = step.step_id ?? `atif-${index}`;
  const toolCalls = parseToolCalls(step.tool_calls);
  const entries: AgentLogEntry[] = [];

  const msg = step.message;
  if (msg && !msg.startsWith("Executed ") && toolCalls.length > 0) {
    entries.push({ id: `${id}-think`, type: "thinking", summary: cleanMessage(msg) });
  } else if (msg && !msg.startsWith("Executed ") && toolCalls.length === 0) {
    entries.push({ id, type: "thinking", summary: cleanMessage(msg) });
  }

  if (toolCalls.length > 0) {
    entries.push(parseToolStep(step, id, toolCalls));
  }

  return entries;
}

export interface ParsedAtifResult {
  entries: AgentLogEntry[];
  agent?: { name: string; model?: string };
  metrics?: Record<string, unknown>;
}

export function parseAtifTrajectory(content: string): ParsedAtifResult {
  const data: AtifTrajectory = JSON.parse(content);
  const entries: AgentLogEntry[] = [];

  for (let i = 0; i < data.steps.length; i++) {
    if (data.steps[i].source !== "agent") continue;
    entries.push(...parseAgentStep(data.steps[i], i));
  }

  return {
    entries,
    agent: data.agent
      ? { name: data.agent.name, model: data.agent.model_name }
      : undefined,
    metrics: data.final_metrics ?? undefined,
  };
}
