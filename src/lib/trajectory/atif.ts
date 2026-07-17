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

export interface AtifToolCall {
  tool_call_id: string;
  function_name: string;
  arguments: Record<string, unknown>;
}

export interface AtifObservationResult {
  source_call_id: string;
  content: string;
}

export interface AtifStep {
  step_id?: string;
  timestamp?: string;
  source: string;
  message: string;
  tool_calls?: AtifToolCall[] | string;
  observation?: { results: AtifObservationResult[] } | string;
}

export interface AtifTrajectory {
  schema_version: string;
  agent?: { name: string; model_name?: string };
  steps: AtifStep[];
  final_metrics?: Record<string, unknown>;
}

export function parseToolCalls(raw: AtifToolCall[] | string | undefined): AtifToolCall[] {
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

export function parseObservation(
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

export function extractCommand(tc: AtifToolCall): string {
  // Codex: arguments.cmd
  if (tc.arguments.cmd) return String(tc.arguments.cmd);
  // Terminus-2: arguments.keystrokes (bash_command)
  if (tc.arguments.keystrokes) return String(tc.arguments.keystrokes).trim();
  // Claude-code: Bash {command}, Read/Write/Edit {file_path}, Grep/Glob {pattern}
  if (tc.arguments.command) return String(tc.arguments.command);
  if (tc.arguments.file_path) return `${tc.function_name} ${tc.arguments.file_path}`;
  if (tc.arguments.pattern) return `${tc.function_name} ${tc.arguments.pattern}`;
  // Codex apply_patch {input}: surface the patched file from the header.
  if (tc.function_name === "apply_patch" && typeof tc.arguments.input === "string") {
    const m = /\*\*\*\s*(?:Update|Add|Delete) File:\s*(.+)/.exec(tc.arguments.input);
    return m ? `apply_patch ${m[1].trim()}` : "apply_patch";
  }
  if (tc.arguments.content) return `write ${tc.function_name}`;
  // mark_task_complete, etc.
  return tc.function_name;
}

/** The tool call's write payload (file content, patch body, edit pair) for display —
 * distinct from its OUTPUT (the observation). Null for plain commands. */
export function extractToolInput(tc: AtifToolCall): string | null {
  const a = tc.arguments;
  if (typeof a.content === "string" && a.content) return a.content;
  if (typeof a.input === "string" && a.input) return a.input;
  if (typeof a.old_string === "string" && typeof a.new_string === "string") {
    return `--- old\n${a.old_string}\n+++ new\n${a.new_string}`;
  }
  return null;
}

export function isNonCommandTool(fnName: string): boolean {
  return (
    fnName === "write_stdin" || fnName === "write_file" || fnName === "mark_task_complete"
  );
}

export function deriveExitStatus(output: string | null, fnName: string): "completed" | "failed" {
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

export function cleanMessage(msg: string): string {
  // Strip "Analysis: " prefix from terminus-2 messages.
  return msg.replace(/^Analysis:\s*/i, "");
}

/** Decode JSON string escapes, leaving *invalid* escapes intact (e.g. LaTeX `\alpha`,
 * which is exactly what breaks JSON.parse on these messages — we want to keep it readable,
 * not drop the backslash). */
function decodeJsonEscapes(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|[\s\S])(?=([\s\S]?))/g, (whole, esc: string, next: string) => {
    // A valid control escape followed by a lowercase letter is almost always a LaTeX/command
    // token the model wrote (\nu, \beta, \theta, \frac) rather than a real \n/\t — keep it
    // verbatim. Standalone \n\n, \n + capital/space, etc. still decode to the real character.
    const latexish = /[a-z]/.test(next ?? "");
    switch (esc[0]) {
      case '"': return '"';
      case "\\": return "\\";
      case "/": return "/";
      case "u": return String.fromCharCode(parseInt(esc.slice(1), 16));
      case "b": return latexish ? whole : "\b";
      case "f": return latexish ? whole : "\f";
      case "n": return latexish ? whole : "\n";
      case "r": return latexish ? whole : "\r";
      case "t": return latexish ? whole : "\t";
      default: return whole; // invalid escape (\alpha, \gamma, …) — keep verbatim
    }
  });
}

/** Best-effort read of one string field from *malformed* JSON: find `"key": "`, take up to
 * the next top-level key (`", "<nextKey>":`) or the object's end, then decode escapes. The
 * model wrote the field boundaries correctly; only the inner escaping is broken, so keying
 * off the next field is reliable in practice. */
function grabJsonStringField(raw: string, key: string, nextKeys: string[]): string | undefined {
  const open = new RegExp(`"${key}"\\s*:\\s*"`).exec(raw);
  if (!open) return undefined;
  const start = open.index + open[0].length;
  const rest = raw.slice(start);
  const boundary = new RegExp(`"\\s*,\\s*"(?:${nextKeys.join("|")})"\\s*:|"\\s*\\}\\s*$`).exec(rest);
  return decodeJsonEscapes(boundary ? rest.slice(0, boundary.index) : rest);
}

function joinAnalysisPlan(analysis?: string, plan?: string): string {
  const parts: string[] = [];
  if (analysis?.trim()) parts.push(analysis.trim());
  if (plan?.trim()) parts.push(`Plan: ${plan.trim()}`);
  return parts.join("\n\n");
}

/**
 * Some agents emit a turn as a JSON-object string in `message`, e.g.
 *   {"analysis": "…", "plan": "…", "commands": [...], "task_complete": false}
 * When the model's escaping is off (literal newlines, LaTeX `\alpha`) it fails to parse and
 * the raw blob would otherwise render verbatim. Pull out the human-readable analysis (and
 * plan) — strictly if the JSON is valid, tolerantly otherwise. Returns null when `message`
 * isn't this structured format, so callers can fall back to plain text.
 */
export function parseStructuredAgentMessage(message: string): string | null {
  const trimmed = message.trimStart();
  if (!trimmed.startsWith("{") || !/"analysis"\s*:/.test(trimmed)) return null;

  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === "object") {
      const text = joinAnalysisPlan(
        typeof obj.analysis === "string" ? obj.analysis : undefined,
        typeof obj.plan === "string" ? obj.plan : undefined,
      );
      if (text) return text;
    }
  } catch {
    // Malformed (the common case) — fall through to tolerant field extraction.
  }

  const analysis = grabJsonStringField(trimmed, "analysis", ["plan", "commands", "task_complete"]);
  const plan = grabJsonStringField(trimmed, "plan", ["commands", "task_complete"]);
  return joinAnalysisPlan(analysis, plan) || null;
}

function parseAgentStep(step: AtifStep, index: number): AgentLogEntry[] {
  const id = step.step_id ?? `atif-${index}`;
  const toolCalls = parseToolCalls(step.tool_calls);
  const entries: AgentLogEntry[] = [];

  const msg = step.message;
  if (msg && !msg.startsWith("Executed ")) {
    // A structured JSON message (often the model's un-parseable raw output) renders as its
    // readable analysis/plan; a plain prose message just loses its "Analysis: " prefix.
    const summary = parseStructuredAgentMessage(msg) ?? cleanMessage(msg);
    entries.push({ id: toolCalls.length > 0 ? `${id}-think` : id, type: "thinking", summary });
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

/**
 * Count agent turns in a raw ATIF trajectory — one per agent-source step, i.e. the units
 * {@link parseAtifTrajectory} renders as thinking/command blocks. Returns null when the
 * content can't be parsed or carries no `steps` array. Pure; safe on client and server.
 */
export function countAgentTurns(content: string): number | null {
  try {
    const data: AtifTrajectory = JSON.parse(content);
    if (!Array.isArray(data.steps)) return null;
    return data.steps.filter((s) => s?.source === "agent").length;
  } catch {
    return null;
  }
}
