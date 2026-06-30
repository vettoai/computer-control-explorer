"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { HintPassRate, TaskHintStats } from "@/lib/dataset/trial-types";
import type { TaskMeta } from "@/lib/dataset/types";
import { cn } from "@/lib/utils";

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function HintRate({ label, rate }: { label: string; rate: HintPassRate }) {
  return (
    <span
      title={`${rate.passes} of ${rate.trials} ${label} trials passed`}
      className="text-zinc-400 dark:text-zinc-500"
    >
      {label}{" "}
      <span className="font-medium tabular-nums text-zinc-600 dark:text-zinc-300">
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
    <div className="flex shrink-0 items-center gap-2 text-xs">
      {stats.withHints && <HintRate label="hints" rate={stats.withHints} />}
      {stats.withHints && stats.withoutHints && (
        <span className="text-zinc-300 dark:text-zinc-600">·</span>
      )}
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
