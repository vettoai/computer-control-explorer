"use client";

import Link from "next/link";

import { type ModelStat, modelLabel, type Trial } from "@/lib/dataset/trial-types";

function shortChecksum(c: string): string {
  return c.length > 10 ? c.slice(0, 10) : c;
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function PassDot({ passed, reward }: { passed: boolean; reward: number | null }) {
  const color = passed ? "bg-emerald-500" : reward === null ? "bg-zinc-400" : "bg-red-500";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function StatsTable({ stats }: { stats: ModelStat[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-400 dark:bg-zinc-900">
          <tr>
            <th className="px-3 py-2 font-medium">Model</th>
            <th className="px-3 py-2 font-medium">Version</th>
            <th className="px-3 py-2 text-right font-medium">Trials</th>
            <th className="px-3 py-2 text-right font-medium">Pass rate</th>
            <th className="px-3 py-2 text-right font-medium">Mean reward</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {stats.map((s) => (
            <tr key={`${s.model}-${s.checksum}`}>
              <td className="px-3 py-2 font-medium">{s.modelLabel}</td>
              <td className="px-3 py-2" title={s.checksum}>
                {s.versionLabel ? (
                  <>
                    <div>{s.versionLabel}</div>
                    <div className="font-mono text-xs text-zinc-400">{shortChecksum(s.checksum)}</div>
                  </>
                ) : (
                  <span className="font-mono text-xs text-zinc-500">{shortChecksum(s.checksum)}</span>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{s.trials}</td>
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
  );
}

function TrialRow({ slug, trial }: { slug: string; trial: Trial }) {
  const started = trial.startedAt ? new Date(trial.startedAt).toLocaleString() : "—";
  return (
    <Link
      href={`/task/${slug}/t/${trial.id}`}
      className="flex items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
    >
      <PassDot passed={trial.passed} reward={trial.reward} />
      <span className="w-16 shrink-0 font-mono text-xs">
        {trial.reward === null ? "no result" : `reward ${trial.reward}`}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-500" title={trial.jobLabel}>
        {trial.jobLabel}
      </span>
      <span className="shrink-0 text-xs text-zinc-400">{started}</span>
      {trial.durationSec != null && (
        <span className="w-12 shrink-0 text-right text-xs text-zinc-400 tabular-nums">
          {trial.durationSec}s
        </span>
      )}
    </Link>
  );
}

export function TaskTrials({
  slug,
  trials,
  stats,
}: {
  slug: string;
  trials: Trial[];
  stats: ModelStat[];
}) {
  if (trials.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 px-6 py-12 text-center text-sm text-zinc-500 dark:border-zinc-700">
        No eval trials for this task in the mounted bundle.
      </p>
    );
  }

  const oracle = trials.filter((t) => t.isOracle);
  const agentTrials = trials.filter((t) => !t.isOracle);

  // Group agent trials by model label for display.
  const byModel = new Map<string, Trial[]>();
  for (const t of agentTrials) {
    const key = modelLabel(t.model);
    (byModel.get(key) ?? byModel.set(key, []).get(key)!).push(t);
  }

  return (
    <div className="space-y-8">
      {stats.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Pass rate by model and task version</h2>
          <p className="mb-3 text-xs text-zinc-500">
            Grouped by <span className="font-mono">task_checksum</span> — the immutable task
            version. Pass = full reward (1.0). Oracle solves are excluded.
          </p>
          <StatsTable stats={stats} />
        </section>
      )}

      {oracle.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Oracle solve</h2>
          <div className="space-y-1.5">
            {oracle.map((t) => (
              <TrialRow key={t.id} slug={slug} trial={t} />
            ))}
          </div>
        </section>
      )}

      {[...byModel.entries()].map(([label, group]) => (
        <section key={label}>
          <h2 className="mb-2 text-sm font-semibold">
            {label} <span className="text-xs font-normal text-zinc-400">({group.length})</span>
          </h2>
          <div className="space-y-1.5">
            {group.map((t) => (
              <TrialRow key={t.id} slug={slug} trial={t} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
