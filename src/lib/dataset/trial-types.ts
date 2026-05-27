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
  versionLabel: string | null; // human label for taskChecksum, from out/version-labels.json
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
  versionLabel: string | null;
  trials: number;
  passes: number;
  passRate: number;
  meanReward: number | null;
}

/** Strip litellm proxy / provider prefixes for display: keep the final path segment. */
export function modelLabel(model: string | null): string {
  if (!model) return "unknown";
  return model.split("/").pop() ?? model;
}
