/**
 * Client-safe trial types + pure helpers. Kept separate from trials.ts (which imports
 * node:fs/crypto) so client components can import these without pulling Node built-ins
 * into the browser bundle.
 */

import type { ParsedAtifResult } from "@/lib/trajectory/atif";

export interface Trial {
  id: string; // stable short hash of relPath — URL-safe, unique per trial dir
  slug: string; // dataset task slug (from task_id.path)
  taskName: string; // e.g. vettoai/duckdb-schema-collision
  taskChecksum: string;
  agent: string; // terminus-2 | codex | oracle | …
  model: string | null; // raw config.agent.model_name
  isOracle: boolean;
  reward: number | null; // verifier_result.rewards.reward
  passed: boolean; // reward != null && reward >= 1
  startedAt: string | null;
  finishedAt: string | null;
  durationSec: number | null;
  jobLabel: string; // top-level out/jobs/<jobLabel>
  relPath: string; // trial dir, relative to the bundle root
}

export interface TrialDetail extends Trial {
  trajectory: ParsedAtifResult | null;
  rawTrajectory: string | null;
  testOutput: string | null;
  solveOutput: string | null; // oracle solve stdout (agent/oracle.txt); null for agent trials
  error: string | null;
}

/** Per (model × task version) pass statistics for one task. Oracle excluded. */
export interface ModelStat {
  model: string;
  modelLabel: string;
  checksum: string;
  jobLabel: string; // job folder name (out/jobs/<jobLabel>) — the run identifier
  trials: number;
  passes: number;
  passRate: number;
  meanReward: number | null;
}

/** Whole-dataset pass statistics for one run, aggregated across all tasks. Grouped by
 * (agent × model × job folder); oracle is included as a run (the reference ceiling). */
export interface GlobalRunStat {
  jobLabel: string; // run identifier (out/jobs/<jobLabel>)
  agent: string;
  model: string | null;
  modelLabel: string;
  isOracle: boolean;
  tasks: number; // distinct task slugs covered by this run
  trials: number; // total trials across all tasks
  passes: number; // trials with full reward
  passRate: number; // passes / trials (micro pass@1)
  tasksSolved: number; // distinct tasks solved at least once
  meanReward: number | null; // mean reward across all trials
}

/** Strip litellm proxy / provider prefixes for display: keep the final path segment. */
export function modelLabel(model: string | null): string {
  if (!model) return "unknown";
  return model.split("/").pop() ?? model;
}

export type HintVariant = "with" | "without";

/** Pass stats for one task under a single hint variant. */
export interface HintPassRate {
  trials: number;
  passes: number;
  passRate: number; // passes / trials
}

/** Per-task pass rate split by hint variant — what the task-list cards show. A variant is
 * null when the dataset has no trials of that kind for the task. */
export interface TaskHintStats {
  withHints: HintPassRate | null;
  withoutHints: HintPassRate | null;
}

/**
 * Classify a run by its job-folder name as a hint variant, or null when the name carries
 * no hint marker. Hints live in the folder name by convention (PLAN §6.5), e.g.
 * `gemini-with-hints` vs `gemini-no-hints`. Case-insensitive; a negation ("no"/"without"/
 * "hint-free") wins over the bare "hint" so `no-hints` reads as `without`.
 */
export function hintVariant(jobLabel: string): HintVariant | null {
  const s = jobLabel.toLowerCase();
  if (!s.includes("hint")) return null;
  const negated =
    /no[-_ ]?hint/.test(s) || /without[-_ ]?hint/.test(s) || /hint[-_ ]?free/.test(s);
  return negated ? "without" : "with";
}

function hintPassRate(trials: Trial[]): HintPassRate | null {
  if (trials.length === 0) return null;
  const passes = trials.filter((t) => t.passed).length;
  return { trials: trials.length, passes, passRate: passes / trials.length };
}

/**
 * Per-task pass rate split by hint variant, keyed by slug — the summary the task-list cards
 * show so a task can be picked by how solvable it is. The variant comes from the job-folder
 * name (via {@link hintVariant}); runs whose folder carries no hint marker, and oracle
 * trials, are skipped. Aggregated across models/runs of the same variant — a coarse
 * card-level number; the task page keeps the per-model breakdown. A task absent from the map
 * (or with both variants null) simply has no hint-labelled trials.
 */
export function taskHintStats(trials: Trial[]): Record<string, TaskHintStats> {
  const groups = new Map<string, { with: Trial[]; without: Trial[] }>();
  for (const t of trials) {
    if (t.isOracle) continue;
    const variant = hintVariant(t.jobLabel);
    if (!variant) continue;
    const g = groups.get(t.slug) ?? { with: [], without: [] };
    (variant === "with" ? g.with : g.without).push(t);
    groups.set(t.slug, g);
  }
  const out: Record<string, TaskHintStats> = {};
  for (const [slug, g] of groups) {
    out[slug] = { withHints: hintPassRate(g.with), withoutHints: hintPassRate(g.without) };
  }
  return out;
}
