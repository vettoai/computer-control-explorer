"use client";

import type { GlobalRunStat } from "@/lib/dataset/trial-types";

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/**
 * Whole-dataset results, one row per run (job folder × model × agent), aggregated across
 * every task — so you can compare e.g. "gemini with hints" vs "without" vs oracle at a
 * glance, before drilling into any single task. Oracle is included as the reference ceiling.
 */
export function GlobalStats({ stats }: { stats: GlobalRunStat[] }) {
  if (stats.length === 0) return null;
  return (
    <section className="mb-10">
      <h2 className="mb-2 text-sm font-semibold">Overall results by run</h2>
      <p className="mb-3 max-w-3xl text-xs text-zinc-500 dark:text-zinc-400">
        Aggregated across all tasks, grouped by run (job folder × model × agent). Pass = full
        reward (1.0); pass rate is over all trials, &ldquo;solved&rdquo; counts distinct tasks
        passed at least once.
      </p>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-400 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2 font-medium">Run</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Agent</th>
              <th className="px-3 py-2 text-right font-medium">Tasks</th>
              <th className="px-3 py-2 text-right font-medium">Trials</th>
              <th className="px-3 py-2 text-right font-medium">Solved</th>
              <th className="px-3 py-2 text-right font-medium">Pass rate</th>
              <th className="px-3 py-2 text-right font-medium">Mean reward</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {stats.map((s) => (
              <tr
                key={`${s.jobLabel}-${s.agent}-${s.model}`}
                className={s.isOracle ? "bg-zinc-50/60 dark:bg-zinc-900/40" : undefined}
              >
                <td className="px-3 py-2 font-mono text-xs">{s.jobLabel}</td>
                <td className="px-3 py-2 font-medium">{s.isOracle ? "—" : s.modelLabel}</td>
                <td className="px-3 py-2 text-xs text-zinc-500">{s.agent}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{s.tasks}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.trials}</td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                  {s.tasksSolved}/{s.tasks}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {pct(s.passRate)}{" "}
                  <span className="text-xs text-zinc-400">
                    ({s.passes}/{s.trials})
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-500">
                  {s.meanReward === null ? "—" : s.meanReward.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
