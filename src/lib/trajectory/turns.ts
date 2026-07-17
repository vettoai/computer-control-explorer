/**
 * Turn-level view of an ATIF trajectory for the cinema (turn-by-turn) viewer.
 *
 * Where atif.ts flattens a trajectory into a scrollable list of log entries, this module
 * keeps the agent's native unit — the TURN (one agent-source step): what it thought, then
 * every tool call it made with each call's own output. It also classifies each turn into a
 * coarse work phase (explore / plan / implement / verify / debug / conclude) with cheap,
 * deterministic heuristics so the viewer can label turns and jump between sections without
 * any model call. An LLM-written sidecar (see lib/dataset/analysis.ts) can override these
 * labels when present.
 *
 * Pure — no DB, no network, safe on client and server.
 */

import {
  type AtifObservationResult,
  type AtifStep,
  type AtifToolCall,
  type AtifTrajectory,
  cleanMessage,
  deriveExitStatus,
  extractCommand,
  isNonCommandTool,
  parseStructuredAgentMessage,
  parseToolCalls,
} from "./atif";

export type TurnPhase =
  | "plan" // thinking through the problem, no (or pre-) action
  | "explore" // reading the environment: ls, cat, grep, find …
  | "implement" // writing/patching files
  | "verify" // running tests / the verifier surface
  | "debug" // reacting to a failure (previous or current command failed)
  | "conclude"; // wrapping up: final message / mark_task_complete

export interface TurnTool {
  id: string;
  /** Human-readable command (cmd / keystrokes / tool name). */
  command: string;
  /** Tool function name, e.g. bash_command, write_file, mark_task_complete. */
  functionName: string;
  /** The tool's captured output, when the trajectory recorded one. */
  output: string | null;
  status: "completed" | "failed";
}

export interface TrajectoryTurn {
  /** 0-based turn index (agent steps only). */
  index: number;
  stepId: string;
  /** What the agent wrote this turn (analysis/plan prose), or null for act-only turns. */
  thought: string | null;
  tools: TurnTool[];
  /** Epoch ms of the step, when the trajectory carries timestamps. */
  timestamp: number | null;
  phase: TurnPhase;
}

export interface ParsedTurns {
  turns: TrajectoryTurn[];
  agent: { name: string; model?: string } | null;
}

/** Map each observation result to its source call so multi-tool turns keep the right
 * output next to the right command (atif.ts only surfaces the first result). */
function observationByCall(step: AtifStep): Map<string, string> {
  const raw = step.observation;
  const out = new Map<string, string>();
  const obs =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw.replace(/'/g, '"')) as { results?: AtifObservationResult[] };
          } catch {
            return null;
          }
        })()
      : raw;
  for (const r of obs?.results ?? []) {
    if (typeof r?.content === "string") out.set(r.source_call_id, r.content);
  }
  return out;
}

function toTool(tc: AtifToolCall, output: string | null, id: string): TurnTool {
  return {
    id,
    command: extractCommand(tc),
    functionName: tc.function_name,
    output,
    status: deriveExitStatus(output, tc.function_name),
  };
}

const EXPLORE_CMD =
  /^\s*(ls|ll|cat|head|tail|less|find|grep|rg|egrep|fgrep|tree|wc|file|stat|pwd|which|du|df|env|printenv|git\s+(status|log|diff|show|branch)|sed\s+-n|awk\s)/;
const VERIFY_CMD =
  /\b(pytest|py\.test|unittest|npm\s+(test|run\s+test)|yarn\s+test|go\s+test|cargo\s+test|make\s+(test|check)|tox|rspec|phpunit|mvn\s+test|gradle\s+test|test\.sh|run_tests|python[0-9.]*\s+-m\s+pytest)\b/;
const IMPLEMENT_CMD =
  /\b(apply_patch|patch\b|sed\s+-i|tee\s|>\s*[^&|;]+\.(py|ts|tsx|js|go|rs|c|cc|cpp|h|java|rb|sh|toml|ya?ml|json|txt|md|cfg|ini)|cat\s*>|mkdir|touch|mv\s|cp\s|chmod|pip[0-9.]*\s+install|npm\s+install|apt(-get)?\s+install|cargo\s+add)\b/;

function commandPhase(tool: TurnTool): TurnPhase | null {
  const cmd = tool.command;
  if (tool.functionName === "mark_task_complete") return "conclude";
  if (tool.functionName === "write_file" || isNonCommandTool(tool.functionName)) {
    return tool.functionName === "write_stdin" ? null : "implement";
  }
  if (VERIFY_CMD.test(cmd)) return "verify";
  if (IMPLEMENT_CMD.test(cmd)) return "implement";
  if (EXPLORE_CMD.test(cmd)) return "explore";
  return null;
}

/**
 * Deterministic phase for one turn, given whether the *previous* turn ended in failure
 * (a failed command → the agent is reacting, i.e. debugging, unless it clearly moved on
 * to concluding). Priority: conclude > verify > debug > implement > explore > plan.
 */
export function classifyTurnPhase(
  turn: Pick<TrajectoryTurn, "thought" | "tools" | "index">,
  opts: { prevFailed: boolean; isLast: boolean },
): TurnPhase {
  const phases = turn.tools.map(commandPhase).filter((p): p is TurnPhase => p !== null);
  if (phases.includes("conclude")) return "conclude";
  if (turn.tools.length === 0) {
    // Thought-only turn: the final one is a wrap-up, an early one is planning.
    return opts.isLast ? "conclude" : "plan";
  }
  if (phases.includes("verify")) return "verify";
  if (opts.prevFailed || turn.tools.some((t) => t.status === "failed")) return "debug";
  if (phases.includes("implement")) return "implement";
  if (phases.includes("explore")) return "explore";
  return turn.thought && turn.index === 0 ? "plan" : "explore";
}

/** Parse a raw ATIF trajectory.json into turns. Throws on unparseable JSON (callers show
 * the raw file instead); returns zero turns for a trajectory with no agent steps. */
export function parseAtifTurns(content: string): ParsedTurns {
  const data: AtifTrajectory = JSON.parse(content);
  const steps = Array.isArray(data.steps) ? data.steps : [];
  const agentSteps = steps.filter((s) => s?.source === "agent");

  const turns: TrajectoryTurn[] = [];
  for (let i = 0; i < agentSteps.length; i++) {
    const step = agentSteps[i];
    const stepId = step.step_id ?? `turn-${i}`;
    const toolCalls = parseToolCalls(step.tool_calls);
    const outputs = observationByCall(step);

    const msg = step.message;
    const thought =
      msg && !msg.startsWith("Executed ")
        ? (parseStructuredAgentMessage(msg) ?? cleanMessage(msg))
        : null;

    const tools = toolCalls.map((tc, j) =>
      toTool(tc, outputs.get(tc.tool_call_id) ?? (j === 0 ? fallbackOutput(step) : null), `${stepId}-t${j}`),
    );

    const ts = step.timestamp ? Date.parse(step.timestamp) : NaN;
    turns.push({
      index: i,
      stepId,
      thought: thought?.trim() ? thought : null,
      tools,
      timestamp: Number.isFinite(ts) ? ts : null,
      phase: "plan", // assigned below once prev-failure context exists
    });
  }

  for (let i = 0; i < turns.length; i++) {
    const prevFailed = i > 0 && turns[i - 1].tools.some((t) => t.status === "failed");
    turns[i].phase = classifyTurnPhase(turns[i], {
      prevFailed,
      isLast: i === turns.length - 1,
    });
  }

  return {
    turns,
    agent: data.agent ? { name: data.agent.name, model: data.agent.model_name } : null,
  };
}

/** Some trajectories put a single observation with no source_call_id match — give it to
 * the first tool call rather than dropping it (mirrors atif.ts's results[0] behavior). */
function fallbackOutput(step: AtifStep): string | null {
  const raw = step.observation;
  const obs =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw.replace(/'/g, '"')) as { results?: AtifObservationResult[] };
          } catch {
            return null;
          }
        })()
      : raw;
  const first = obs?.results?.[0];
  return typeof first?.content === "string" ? first.content : null;
}

/** Contiguous same-phase turn ranges — the cinema viewer's section-jump chips. */
export interface PhaseSection {
  phase: TurnPhase;
  start: number; // first turn index
  end: number; // last turn index (inclusive)
}

export function phaseSections(turns: readonly TrajectoryTurn[]): PhaseSection[] {
  const sections: PhaseSection[] = [];
  for (const t of turns) {
    const last = sections[sections.length - 1];
    if (last && last.phase === t.phase) last.end = t.index;
    else sections.push({ phase: t.phase, start: t.index, end: t.index });
  }
  return sections;
}

export const PHASE_LABEL: Record<TurnPhase, string> = {
  plan: "Planning",
  explore: "Exploring",
  implement: "Implementing",
  verify: "Verifying",
  debug: "Debugging",
  conclude: "Concluding",
};
