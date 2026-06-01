"use client";

import Link from "next/link";
import { useState } from "react";

import { TaskFiles } from "@/components/task-files";
import { TaskTrials } from "@/components/task-trials";
import type { ModelStat, TrialWithTurns } from "@/lib/dataset/trial-types";
import type { TaskDetail } from "@/lib/dataset/types";
import { cn } from "@/lib/utils";

type Tab = "files" | "trials";

export function TaskDetailView({
  task,
  trials,
  stats,
}: {
  task: TaskDetail;
  trials: TrialWithTurns[];
  stats: ModelStat[];
}) {
  const [tab, setTab] = useState<Tab>("files");

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <Link href="/" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
        ← All tasks
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{task.title}</h1>
      <p className="font-mono text-sm text-zinc-500 dark:text-zinc-400">{task.name}</p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {task.category}
        </span>
        {task.difficulty && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            {task.difficulty}
          </span>
        )}
        {task.tags.map((tag) => (
          <span key={tag} className="text-xs text-zinc-500 dark:text-zinc-400">
            #{tag}
          </span>
        ))}
      </div>

      <div className="mt-6 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        <TabBtn active={tab === "files"} onClick={() => setTab("files")}>
          Files
        </TabBtn>
        <TabBtn active={tab === "trials"} onClick={() => setTab("trials")}>
          Trials <span className="text-xs text-zinc-400">({trials.length})</span>
        </TabBtn>
      </div>

      <div className="mt-6">
        {tab === "files" ? (
          <TaskFiles task={task} />
        ) : (
          <TaskTrials slug={task.slug} trials={trials} stats={stats} />
        )}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
          : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
      )}
    >
      {children}
    </button>
  );
}
