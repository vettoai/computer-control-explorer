"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { HintPassRate, TaskHintStats } from "@/lib/dataset/trial-types";
import type { TaskMeta } from "@/lib/dataset/types";
import { cn } from "@/lib/utils";

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// A discreet tint that flags how interesting the rate is, not good/bad: 0% (never solved,
// even with hints) gets a yellow nudge; partly-solvable tasks (≤60%) a muted green; mostly-
// solved tasks fade to whitish since there's little left to dig into.
function rateColor(rate: number): string {
  if (rate === 0) return "text-yellow-700 dark:text-yellow-500/90";
  if (rate <= 0.6) return "text-green-800 dark:text-green-500/90";
  return "text-zinc-400 dark:text-zinc-400";
}

function HintRate({ label, rate }: { label: string; rate: HintPassRate }) {
  return (
    <span
      title={`${rate.passes} of ${rate.trials} ${label} trials passed`}
      className="inline-flex items-baseline gap-1 rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800/70"
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </span>
      <span className={cn("text-xs font-semibold tabular-nums", rateColor(rate.passRate))}>
        {pct(rate.passRate)}
      </span>
    </span>
  );
}

/** Per-task pass rate split by hint variant; renders nothing when the task has no
 * hint-labelled trials. */
function HintRates({ stats }: { stats: TaskHintStats | undefined }) {
  if (!stats || (!stats.withHints && !stats.withoutHints)) return null;
  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
      {stats.withHints && <HintRate label="hints" rate={stats.withHints} />}
      {stats.withoutHints && <HintRate label="no hints" rate={stats.withoutHints} />}
    </div>
  );
}

export function TaskList({
  tasks,
  hintStats,
}: {
  tasks: TaskMeta[];
  hintStats: Record<string, TaskHintStats>;
}) {
  const categories = useMemo(
    () => [
      "All",
      ...[...new Set(tasks.map((t) => t.category))].sort((a, b) => a.localeCompare(b)),
    ],
    [tasks],
  );
  const [active, setActive] = useState("All");
  const filtered = active === "All" ? tasks : tasks.filter((t) => t.category === active);

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2">
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setActive(category)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              active === category
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300",
            )}
          >
            {category}
          </button>
        ))}
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {filtered.map((task) => (
          <li key={task.slug}>
            <Link
              href={`/task/${task.slug}`}
              className="block h-full rounded-lg border border-zinc-200 p-4 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium leading-tight">{task.title}</span>
                {task.difficulty && (
                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                    {task.difficulty}
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <p className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">
                  {task.slug}
                </p>
                <HintRates stats={hintStats[task.slug]} />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {task.category}
                </span>
                {task.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded px-1.5 py-0.5 text-xs text-zinc-500 dark:text-zinc-400"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
