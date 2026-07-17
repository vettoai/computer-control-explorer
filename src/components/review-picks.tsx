"use client";

/**
 * "Worth human eyes" panel — the deterministic review picks for a task's trials
 * (lib/dataset/interesting.ts), each linking straight into cinema mode with the reasons
 * it was picked. Presentational; picks are computed server-side and passed down.
 */

import Link from "next/link";

import type { ReviewPick } from "@/lib/dataset/interesting";
import { modelLabel, trialOutcome } from "@/lib/dataset/trial-types";

const OUTCOME_STYLE = {
  passed: "bg-emerald-500",
  failed: "bg-red-500",
  none: "bg-zinc-400",
} as const;

export function ReviewPicks({ slug, picks }: { slug: string; picks: ReviewPick[] }) {
  if (picks.length === 0) return null;
  return (
    <section className="rounded-lg border border-violet-300/50 bg-violet-50/50 p-4 dark:border-violet-800/50 dark:bg-violet-950/20">
      <h2 className="text-sm font-semibold">
        🧑‍⚖️ Review picks{" "}
        <span className="font-normal text-zinc-500">
          — {picks.length} trajectories worth human eyes, chosen for diversity (config ×
          outcome × turns × failure signature) and suspicion (passed-despite-error)
        </span>
      </h2>
      <div className="mt-3 space-y-2">
        {picks.map(({ trial, reasons }) => (
          <div
            key={trial.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <span
              className={`inline-block h-2 w-2 shrink-0 rounded-full ${OUTCOME_STYLE[trialOutcome(trial)]}`}
            />
            <span className="shrink-0 font-mono text-xs font-medium">
              {trial.agent} · {modelLabel(trial.model)}
            </span>
            {trial.turns != null && (
              <span className="shrink-0 text-xs text-zinc-400">{trial.turns} turns</span>
            )}
            <span className="min-w-0 flex-1 text-xs text-zinc-600 dark:text-zinc-400">
              {reasons.join(" · ")}
            </span>
            <span className="ml-auto flex shrink-0 gap-2">
              <Link
                href={`/task/${slug}/t/${trial.id}/cinema`}
                className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              >
                ▶ Watch
              </Link>
              <Link
                href={`/task/${slug}/t/${trial.id}`}
                className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                details
              </Link>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
