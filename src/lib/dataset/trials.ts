import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { countAgentTurns, type ParsedAtifResult, parseAtifTrajectory } from "@/lib/trajectory/atif";

import { type ReviewCandidate, parseFailedTests } from "./interesting";
import { datasetDir } from "./loader";
import {
  type GlobalRunStat,
  type ModelStat,
  modelLabel,
  type Trial,
  type TrialDetail,
  type TrialError,
  type TrialWithTurns,
} from "./trial-types";

export { modelLabel };
export type { GlobalRunStat, ModelStat, Trial, TrialDetail, TrialError, TrialWithTurns };

/**
 * Disk-only loader for eval trials under `<DATASET_DIR>/out/jobs/`. The source of truth
 * is each trial's `result.json` (task identity, checksum, model, reward) plus
 * `agent/trajectory.json` (ATIF) and `verifier/test-stdout.txt`. No DB, no API.
 *
 * Layout is heterogeneous — some jobs nest `<provider>/<model-run>/<trial>/`, others put
 * `<trial>/` directly under the job — so we walk recursively and identify a *trial* dir by
 * a `result.json` that carries both `trial_name` and `task_checksum` (an aggregate
 * model-run result.json has `n_total_trials` instead). We prune once a trial is found.
 */

const MAX_RAW_BYTES = 4 * 1024 * 1024;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function slugFromResult(result: Record<string, unknown>): string | null {
  const taskId = asRecord(result.task_id);
  const fromPath = typeof taskId?.path === "string" ? taskId.path : null;
  if (fromPath) return fromPath.replace(/^dataset\//, "");
  const name = typeof result.task_name === "string" ? result.task_name : null;
  return name ? name.replace(/^[^/]+\//, "") : null;
}

function rewardFromResult(result: Record<string, unknown>): number | null {
  const vr = asRecord(result.verifier_result);
  const rewards = asRecord(vr?.rewards);
  const r = rewards?.reward;
  return typeof r === "number" ? r : null;
}

/** Structured infra/agent error from `result.json` → `exception_info`, or null. The harness
 * writes the field as null on a clean run; when present we surface its type + message. */
function errorFromResult(result: Record<string, unknown>): TrialError | null {
  const exc = asRecord(result.exception_info);
  if (!exc) return null;
  const type = typeof exc.exception_type === "string" ? exc.exception_type : null;
  const message = typeof exc.exception_message === "string" ? exc.exception_message : "";
  if (!type && !message) return null;
  return { type: type ?? "Error", message };
}

/** Full crash text for the trajectory pane — type + message + traceback — from
 * `exception_info`, falling back to a bundled `exception.txt`. Returns null if neither exists. */
async function errorDetail(
  result: Record<string, unknown> | null,
  exceptionTxtPath: string,
): Promise<string | null> {
  const exc = asRecord(result?.exception_info);
  if (exc) {
    const type = typeof exc.exception_type === "string" ? exc.exception_type : null;
    const message = typeof exc.exception_message === "string" ? exc.exception_message : "";
    const tb = typeof exc.exception_traceback === "string" ? exc.exception_traceback : "";
    const head = [type, message].filter(Boolean).join(": ");
    const detail = [head, tb].filter(Boolean).join("\n\n");
    if (detail) return detail;
  }
  return readText(exceptionTxtPath);
}

function durationSec(startedAt: string | null, finishedAt: string | null): number | null {
  if (!startedAt || !finishedAt) return null;
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
}

/** Build a Trial from a trial-level result.json, or null if it isn't one. */
function toTrial(
  result: Record<string, unknown>,
  relPath: string,
  jobLabel: string,
): Trial | null {
  const trialName = result.trial_name;
  const checksum = result.task_checksum;
  if (typeof trialName !== "string" || typeof checksum !== "string") return null;

  const slug = slugFromResult(result);
  if (!slug) return null;

  const config = asRecord(result.config);
  const agentCfg = asRecord(config?.agent);
  const agent = typeof agentCfg?.name === "string" ? agentCfg.name : "unknown";
  const model = typeof agentCfg?.model_name === "string" ? agentCfg.model_name : null;
  const reward = rewardFromResult(result);
  const startedAt = typeof result.started_at === "string" ? result.started_at : null;
  const finishedAt = typeof result.finished_at === "string" ? result.finished_at : null;

  return {
    id: createHash("sha1").update(relPath).digest("hex").slice(0, 12),
    slug,
    taskName: typeof result.task_name === "string" ? result.task_name : slug,
    taskChecksum: checksum,
    agent,
    model,
    isOracle: agent === "oracle",
    reward,
    passed: reward != null && reward >= 1,
    error: errorFromResult(result),
    startedAt,
    finishedAt,
    durationSec: durationSec(startedAt, finishedAt),
    jobLabel,
    relPath,
  };
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function walkTrials(
  absDir: string,
  root: string,
  jobLabel: string,
  out: Trial[],
): Promise<void> {
  const result = await readJson(path.join(absDir, "result.json"));
  if (result) {
    const trial = toTrial(result, path.relative(root, absDir), jobLabel);
    if (trial) {
      out.push(trial); // a trial dir has no nested trials — prune here
      return;
    }
  }
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      await walkTrials(path.join(absDir, entry.name), root, jobLabel, out);
    }
  }
}

/**
 * Production-only memo for the out/jobs walk. A large bundle (e.g. a 100-task board × 20+
 * configs × k=5) holds >10k result.json files; walking them on every request makes each
 * page load take seconds in the Docker server. The bundle is immutable in practice
 * (mounted read-only), so a short TTL is safe. Dev and tests always re-walk.
 */
const WALK_CACHE_TTL_MS = 120_000;
const walkCache = new Map<string, { at: number; trials: Promise<Trial[]> }>();

/** All trials in the bundle, across every job. Sorted by slug, then model, then start. */
export async function listTrials(dir: string | null = datasetDir()): Promise<Trial[]> {
  if (!dir) return [];
  if (process.env.NODE_ENV === "production") {
    const hit = walkCache.get(dir);
    if (hit && Date.now() - hit.at < WALK_CACHE_TTL_MS) return hit.trials;
    const trials = walkAllTrials(dir);
    walkCache.set(dir, { at: Date.now(), trials });
    return trials;
  }
  return walkAllTrials(dir);
}

async function walkAllTrials(dir: string): Promise<Trial[]> {
  const jobsRoot = path.join(dir, "out", "jobs");
  let jobs: import("node:fs").Dirent[];
  try {
    jobs = await fs.readdir(jobsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Trial[] = [];
  for (const job of jobs) {
    if (job.isDirectory()) {
      await walkTrials(path.join(jobsRoot, job.name), dir, job.name, out);
    }
  }
  out.sort(
    (a, b) =>
      a.slug.localeCompare(b.slug) ||
      modelLabel(a.model).localeCompare(modelLabel(b.model)) ||
      (a.startedAt ?? "").localeCompare(b.startedAt ?? ""),
  );
  return out;
}

/** Trials for one task slug. */
export async function getTaskTrials(
  slug: string,
  dir: string | null = datasetDir(),
): Promise<Trial[]> {
  return (await listTrials(dir)).filter((t) => t.slug === slug);
}

/** Agent-turn count for one trial, or null if it has no parseable trajectory. */
async function trialTurns(trial: Trial, dir: string): Promise<number | null> {
  const raw = await readText(path.join(dir, trial.relPath, "agent", "trajectory.json"));
  return raw ? countAgentTurns(raw) : null;
}

/**
 * Trials for one task, each with its agent-turn count. Reads (and lightly parses) every
 * trajectory.json for the task — bounded to one task's trials, unlike listTrials — so the
 * home page stays trajectory-free while task pages can show turn counts and aggregates.
 */
export async function getTaskTrialsWithTurns(
  slug: string,
  dir: string | null = datasetDir(),
): Promise<TrialWithTurns[]> {
  const trials = await getTaskTrials(slug, dir);
  if (!dir) return trials.map((t) => ({ ...t, turns: null }));
  return Promise.all(trials.map(async (t) => ({ ...t, turns: await trialTurns(t, dir) })));
}

/**
 * Review candidates for one task: trials with turn counts AND failing-test signatures
 * (parsed from each trial's verifier stdout). Feeds the deterministic review-picks panel
 * (lib/dataset/interesting.ts). I/O is bounded to one task's trials.
 */
export async function getTaskReviewCandidates(
  slug: string,
  dir: string | null = datasetDir(),
): Promise<ReviewCandidate[]> {
  const trials = await getTaskTrialsWithTurns(slug, dir);
  if (!dir) return trials.map((t) => ({ ...t, failedTests: [] }));
  return Promise.all(
    trials.map(async (t) => {
      const testOutput = t.passed
        ? null
        : await readText(path.join(dir, t.relPath, "verifier", "test-stdout.txt"));
      return { ...t, failedTests: parseFailedTests(testOutput) };
    }),
  );
}

/** Per (model × checksum) pass stats for a task's non-oracle trials, grouped by
 * (model x task_checksum x job folder). Normally one job maps to one checksum, so this is
 * usually one row per (model, run); re-tested tasks surface as extra rows. */
export function taskTrialStats(
  trials: readonly (Trial & { turns?: number | null })[],
): ModelStat[] {
  const groups = new Map<string, (Trial & { turns?: number | null })[]>();
  for (const t of trials) {
    if (t.isOracle) continue;
    const key = `${t.model ?? ""} ${t.taskChecksum} ${t.jobLabel}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  const stats: ModelStat[] = [];
  for (const group of groups.values()) {
    const rewards = group.map((t) => t.reward).filter((r): r is number => r != null);
    const turns = group.map((t) => t.turns).filter((n): n is number => typeof n === "number");
    const passes = group.filter((t) => t.passed).length;
    const errors = group.filter((t) => t.error != null).length;
    stats.push({
      model: group[0].model ?? "unknown",
      modelLabel: modelLabel(group[0].model),
      checksum: group[0].taskChecksum,
      jobLabel: group[0].jobLabel,
      trials: group.length,
      passes,
      passRate: group.length > 0 ? passes / group.length : 0,
      meanReward:
        rewards.length > 0 ? rewards.reduce((a, b) => a + b, 0) / rewards.length : null,
      avgTurns: turns.length > 0 ? turns.reduce((a, b) => a + b, 0) / turns.length : null,
      maxTurns: turns.length > 0 ? Math.max(...turns) : null,
      errors,
    });
  }
  stats.sort(
    (a, b) =>
      a.jobLabel.localeCompare(b.jobLabel) ||
      a.modelLabel.localeCompare(b.modelLabel) ||
      a.checksum.localeCompare(b.checksum),
  );
  return stats;
}

/** Whole-dataset pass stats per run, aggregated across every task. Grouped by
 * (agent × model × job folder) so each run — e.g. a model with/without hints, or oracle — is
 * one row; unlike taskTrialStats this spans all tasks and INCLUDES oracle. */
export function globalRunStats(trials: Trial[]): GlobalRunStat[] {
  const groups = new Map<string, Trial[]>();
  for (const t of trials) {
    const key = `${t.agent} ${t.model ?? ""} ${t.jobLabel}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
  }
  const stats: GlobalRunStat[] = [];
  for (const group of groups.values()) {
    const rewards = group.map((t) => t.reward).filter((r): r is number => r != null);
    const passes = group.filter((t) => t.passed).length;
    const tasks = new Set(group.map((t) => t.slug));
    const solved = new Set(group.filter((t) => t.passed).map((t) => t.slug));
    const first = group[0];
    stats.push({
      jobLabel: first.jobLabel,
      agent: first.agent,
      model: first.model,
      modelLabel: modelLabel(first.model),
      isOracle: first.isOracle,
      tasks: tasks.size,
      trials: group.length,
      passes,
      passRate: group.length > 0 ? passes / group.length : 0,
      tasksSolved: solved.size,
      meanReward:
        rewards.length > 0 ? rewards.reduce((a, b) => a + b, 0) / rewards.length : null,
    });
  }
  // Best first by mean reward; oracle (the reference ceiling) sinks to the bottom.
  stats.sort(
    (a, b) =>
      Number(a.isOracle) - Number(b.isOracle) ||
      (b.meanReward ?? -1) - (a.meanReward ?? -1) ||
      a.jobLabel.localeCompare(b.jobLabel),
  );
  return stats;
}

async function readText(file: string): Promise<string | null> {
  try {
    const { size } = await fs.stat(file);
    if (size > MAX_RAW_BYTES) return null;
    return await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
}

/** Full detail for one trial: parsed + raw trajectory, test output, error. */
export async function getTrial(
  slug: string,
  id: string,
  dir: string | null = datasetDir(),
): Promise<TrialDetail | null> {
  const trial = (await getTaskTrials(slug, dir)).find((t) => t.id === id);
  if (!trial || !dir) return null;

  const trialDir = path.join(dir, trial.relPath);
  const rawTrajectory = await readText(path.join(trialDir, "agent", "trajectory.json"));
  let trajectory: ParsedAtifResult | null = null;
  if (rawTrajectory) {
    try {
      trajectory = parseAtifTrajectory(rawTrajectory);
    } catch {
      trajectory = null;
    }
  }
  const testOutput = await readText(path.join(trialDir, "verifier", "test-stdout.txt"));
  // Oracle solve stdout — present for oracle runs, absent for agent trials.
  const solveOutput = await readText(path.join(trialDir, "agent", "oracle.txt"));
  const result = await readJson(path.join(trialDir, "result.json"));
  const detail = await errorDetail(result, path.join(trialDir, "exception.txt"));

  const turns = rawTrajectory ? countAgentTurns(rawTrajectory) : null;
  return {
    ...trial,
    trajectory,
    turns,
    rawTrajectory,
    testOutput,
    solveOutput,
    errorDetail: detail,
  };
}
