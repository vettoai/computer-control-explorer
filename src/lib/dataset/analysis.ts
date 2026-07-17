/**
 * Optional LLM-written trajectory analysis, read from DISK like everything else.
 *
 * `scripts/analyze-trajectories.mjs` (run offline, against the LiteLLM proxy) writes one
 * sidecar per trial at `<DATASET_DIR>/out/analysis/<trialId>.json`. The explorer reads it
 * when present and renders richer labels (per-turn phase + note, a trial summary, and a
 * why-review-this hint); when absent, the UI falls back to the deterministic heuristics in
 * lib/trajectory/turns.ts. No API routes, no runtime model calls — the static export and
 * the read-only Docker mount keep working either way.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import type { TurnPhase } from "@/lib/trajectory/turns";

import { datasetDir } from "./loader";

export interface TurnAnalysis {
  /** 0-based agent-turn index this entry annotates. */
  index: number;
  phase?: TurnPhase;
  /** One short sentence on what the agent is doing/deciding this turn. */
  note?: string;
}

export interface TrialAnalysis {
  version: 1;
  trialId: string;
  /** Model that wrote the analysis (provenance, shown in the UI). */
  analyzedBy?: string;
  /** 2–3 sentence narrative of the whole run. */
  summary?: string;
  /** Why a human should (or needn't) review this run. */
  reviewHint?: string;
  turns?: TurnAnalysis[];
}

const PHASES: readonly string[] = ["plan", "explore", "implement", "verify", "debug", "conclude"];

function sanitize(raw: unknown, trialId: string): TrialAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const turns = Array.isArray(r.turns)
    ? r.turns
        .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
        .map((t) => ({
          index: typeof t.index === "number" ? t.index : -1,
          phase: PHASES.includes(t.phase as string) ? (t.phase as TurnPhase) : undefined,
          note: typeof t.note === "string" ? t.note : undefined,
        }))
        .filter((t) => t.index >= 0)
    : undefined;
  return {
    version: 1,
    trialId,
    analyzedBy: typeof r.analyzedBy === "string" ? r.analyzedBy : undefined,
    summary: typeof r.summary === "string" ? r.summary : undefined,
    reviewHint: typeof r.reviewHint === "string" ? r.reviewHint : undefined,
    turns,
  };
}

/** The sidecar for one trial, or null when none was precomputed. */
export async function getTrialAnalysis(
  trialId: string,
  dir: string | null = datasetDir(),
): Promise<TrialAnalysis | null> {
  if (!dir || !/^[a-f0-9]{12}$/.test(trialId)) return null;
  try {
    const raw = await fs.readFile(
      path.join(dir, "out", "analysis", `${trialId}.json`),
      "utf8",
    );
    return sanitize(JSON.parse(raw), trialId);
  } catch {
    return null;
  }
}
