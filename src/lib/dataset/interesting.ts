/**
 * Review picks — which of a task's trials deserve human eyes first.
 *
 * Distilled from the task-quality-judge prompt's trajectory-sampling rule: read a subset
 * chosen to MAXIMIZE diversity across config (model+agent), reward/error, turn count,
 * which tests failed (different failing tests ⇒ genuinely different runs), and always
 * inspect timeout-but-passed trials (either the model over-verified, or the verifier let
 * a partial solution through).
 *
 * Deterministic and pure — a greedy max-marginal-diversity selection over those axes, no
 * model call. Reasons are emitted per pick so the panel can say WHY each one is worth
 * reviewing.
 */

import type { TrialWithTurns } from "./trial-types";
import { modelLabel } from "./trial-types";

export interface ReviewCandidate extends TrialWithTurns {
  /** Failing test names parsed from verifier/test-stdout.txt (empty when passed or unknown). */
  failedTests: string[];
}

export interface ReviewPick {
  trial: ReviewCandidate;
  reasons: string[];
}

function configKey(t: TrialWithTurns): string {
  return `${t.agent}|${t.model ?? ""}`;
}

function signatureKey(c: ReviewCandidate): string {
  return c.failedTests.length > 0 ? [...c.failedTests].sort().join(",") : "";
}

/** How rare a value is among candidates: 1 = unique, →0 = ubiquitous. */
function rarity<T>(value: T, values: readonly T[]): number {
  const n = values.filter((v) => v === value).length;
  return n === 0 ? 0 : 1 / n;
}

interface Scored {
  cand: ReviewCandidate;
  score: number;
  reasons: string[];
}

function baseInterest(c: ReviewCandidate, all: readonly ReviewCandidate[]): Scored {
  const reasons: string[] = [];
  let score = 0;

  // Timeout-but-passed (or any error-but-passed) is the judge prompt's explicit red flag.
  if (c.passed && c.error) {
    score += 100;
    reasons.push(
      `passed despite ${c.error.type} — either over-verification or the verifier let a partial solution through`,
    );
  }

  // Rare outcomes are informative: the lone pass among failures (or vice versa).
  const passes = all.filter((t) => t.passed).length;
  if (c.passed && passes > 0 && passes <= Math.max(1, Math.floor(all.length / 5))) {
    score += 30;
    reasons.push(passes === 1 ? "the only passing trial" : "one of few passing trials");
  }

  // Unusual failing-test signature ⇒ a genuinely different run.
  const sig = signatureKey(c);
  if (sig) {
    const sigRarity = rarity(
      sig,
      all.map((t) => signatureKey(t)),
    );
    if (sigRarity === 1) {
      score += 40;
      reasons.push(`unique failure signature: ${c.failedTests.slice(0, 3).join(", ")}`);
    } else {
      score += 10 * sigRarity;
    }
  }

  // Errored-and-failed runs show what infra/agent breakage looks like here.
  if (!c.passed && c.error) {
    score += 15;
    reasons.push(`errored run (${c.error.type})`);
  }

  // Turn-count extremes: long runs ramble/over-verify/attempt hacks; very short failures
  // are early give-ups.
  const turns = all.map((t) => t.turns).filter((n): n is number => n != null);
  if (c.turns != null && turns.length > 1) {
    const max = Math.max(...turns);
    const min = Math.min(...turns);
    if (c.turns === max && max > min) {
      score += 25;
      reasons.push(`longest run (${c.turns} turns)`);
    }
    if (c.turns === min && max > min && !c.passed) {
      score += 20;
      reasons.push(`shortest failing run (${c.turns} turns) — early give-up?`);
    }
  }

  return { cand: c, score, reasons };
}

/** Marginal diversity of adding `c` given already-picked trials. */
function marginalDiversity(c: ReviewCandidate, picked: readonly ReviewCandidate[]): {
  score: number;
  reasons: string[];
} {
  if (picked.length === 0) return { score: 0, reasons: [] };
  const reasons: string[] = [];
  let score = 0;

  if (!picked.some((p) => configKey(p) === configKey(c))) {
    score += 25;
    reasons.push(`different config (${c.agent} · ${modelLabel(c.model)})`);
  } else if (!picked.some((p) => p.model === c.model)) {
    score += 15;
    reasons.push(`different model (${modelLabel(c.model)})`);
  }

  if (!picked.some((p) => p.passed === c.passed)) {
    score += 25;
    reasons.push(c.passed ? "adds a passing run" : "adds a failing run");
  }

  const sig = signatureKey(c);
  if (sig && !picked.some((p) => signatureKey(p) === sig)) {
    score += 20;
    if (c.failedTests.length > 0)
      reasons.push(`fails different tests (${c.failedTests.slice(0, 2).join(", ")})`);
  }

  if (c.turns != null) {
    const pickedTurns = picked.map((p) => p.turns).filter((n): n is number => n != null);
    if (pickedTurns.length > 0) {
      const dist = Math.min(...pickedTurns.map((n) => Math.abs(n - c.turns!)));
      score += Math.min(15, dist); // up to +15 for being far from every picked turn count
    }
  }

  return { score, reasons };
}

/**
 * Pick up to `count` trials to review, greedy on interest + marginal diversity. Oracle
 * trials are excluded (they're the reference, not agent behavior). Guarantees at least one
 * passing trial in the picks when any pass exists (the judge prompt's floor), and always
 * includes every timeout-but-passed trial (capped at `count`).
 */
export function pickReviewTrials(
  candidates: readonly ReviewCandidate[],
  count = 5,
): ReviewPick[] {
  const pool = candidates.filter((c) => !c.isOracle);
  if (pool.length === 0) return [];

  const scored = pool.map((c) => baseInterest(c, pool));
  const picks: ReviewPick[] = [];
  const picked: ReviewCandidate[] = [];

  const take = (s: Scored, extraReasons: string[] = []) => {
    picks.push({ trial: s.cand, reasons: [...s.reasons, ...extraReasons] });
    picked.push(s.cand);
  };

  // 1. Every passed-with-error trial, most suspicious first.
  for (const s of scored
    .filter((s) => s.cand.passed && s.cand.error)
    .sort((a, b) => b.score - a.score)) {
    if (picks.length >= count) break;
    take(s);
  }

  // 2. Greedy fill by interest + marginal diversity.
  while (picks.length < count && picked.length < pool.length) {
    let best: { s: Scored; total: number; divReasons: string[] } | null = null;
    for (const s of scored) {
      if (picked.includes(s.cand)) continue;
      const div = marginalDiversity(s.cand, picked);
      const total = s.score + div.score;
      if (!best || total > best.total) best = { s, total, divReasons: div.reasons };
    }
    if (!best) break;
    take(best.s, best.divReasons);
  }

  // 3. Floor: at least one passing trial when one exists.
  if (!picked.some((c) => c.passed)) {
    const pass = scored
      .filter((s) => s.cand.passed && !picked.includes(s.cand))
      .sort((a, b) => b.score - a.score)[0];
    if (pass) {
      if (picks.length >= count) {
        // Drop the least interesting non-mandatory pick to make room.
        let worst = -1;
        for (let i = picks.length - 1; i >= 0; i--) {
          const p = picks[i];
          if (!(p.trial.passed && p.trial.error)) {
            worst = i;
            break;
          }
        }
        if (worst >= 0) {
          picked.splice(picked.indexOf(picks[worst].trial), 1);
          picks.splice(worst, 1);
        }
      }
      if (picks.length < count)
        take(pass, ["a legitimate pass proves the task is solvable — verify it's not gamed"]);
    }
  }

  for (const p of picks) {
    if (p.reasons.length === 0) p.reasons.push("diverse baseline pick");
  }
  return picks;
}

/** Failing test names from a pytest-style verifier stdout. Deduplicated, in order. */
export function parseFailedTests(testOutput: string | null): string[] {
  if (!testOutput) return [];
  const found = new Set<string>();
  // Summary lines: "FAILED tests/test_outputs.py::test_foo[param] - AssertionError…"
  for (const m of testOutput.matchAll(/(?:FAILED|ERROR)\s+\S*::(\w+(?:\[[^\]]*\])?)/g)) {
    found.add(m[1]);
  }
  // Progress lines: "tests/test_outputs.py::test_foo FAILED"
  for (const m of testOutput.matchAll(/::(\w+(?:\[[^\]]*\])?)\s+(?:FAILED|ERROR)/g)) {
    found.add(m[1]);
  }
  return [...found];
}
