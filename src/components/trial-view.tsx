"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { TrajectoryViewer } from "@/components/trajectory/trajectory-viewer";
import { modelLabel, type TrialDetail } from "@/lib/dataset/trial-types";
import { parseAtifTrajectory } from "@/lib/trajectory/atif";
import { cn } from "@/lib/utils";

/** Parsed entries are derived from rawTrajectory on the client, so we never embed them. */
type TrialViewModel = Omit<TrialDetail, "trajectory">;

type TabKey = "trajectory" | "test" | "solve";
const TAB_LABELS: Record<TabKey, string> = {
  trajectory: "Trajectory",
  test: "Test output",
  solve: "Solve output",
};

function Outcome({ trial }: { trial: TrialViewModel }) {
  if (trial.reward === null) {
    return (
      <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
        No result
      </span>
    );
  }
  return trial.passed ? (
    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
      Passed · reward {trial.reward}
    </span>
  ) : (
    <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-300">
      Failed · reward {trial.reward}
    </span>
  );
}

function Field({
  label,
  value,
  mono,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div title={title}>
      <dt className="text-xs text-zinc-400">{label}</dt>
      <dd className={mono ? "font-mono text-xs" : "text-sm"}>{value}</dd>
    </div>
  );
}

export function TrialView({ taskTitle, trial }: { taskTitle: string; trial: TrialViewModel }) {
  const title = trial.isOracle ? "Oracle solve" : modelLabel(trial.model);
  const entries = useMemo(
    () => (trial.rawTrajectory ? parseAtifTrajectory(trial.rawTrajectory).entries : []),
    [trial.rawTrajectory],
  );
  // Oracle solves have no trajectory — show their solve output instead.
  const tabs: TabKey[] = trial.isOracle ? ["solve", "test"] : ["trajectory", "test"];
  const [tab, setTab] = useState<TabKey>(tabs[0]);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <nav className="text-sm text-zinc-500 dark:text-zinc-400">
        <Link href="/" className="hover:underline">
          All tasks
        </Link>
        {" / "}
        <Link href={`/task/${trial.slug}`} className="hover:underline">
          {taskTitle}
        </Link>
        {" / trial"}
      </nav>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <Outcome trial={trial} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Field label="Agent" value={trial.agent} />
        {!trial.isOracle && <Field label="Model" value={trial.model ?? "—"} mono />}
        <Field label="Task version" value={trial.taskChecksum.slice(0, 12)} mono title={trial.taskChecksum} />
        {trial.durationSec != null && <Field label="Duration" value={`${trial.durationSec}s`} />}
        <Field label="Job" value={trial.jobLabel} mono />
        {trial.startedAt && (
          <Field label="Started" value={new Date(trial.startedAt).toLocaleString()} />
        )}
      </dl>

      <div className="mt-8 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {tabs.map((t) => (
          <TabBtn key={t} active={tab === t} onClick={() => setTab(t)}>
            {TAB_LABELS[t]}
          </TabBtn>
        ))}
      </div>

      <div className="mt-4 h-[70vh]">
        {tab === "trajectory" && (
          <div className="flex h-full flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
            <TrajectoryViewer
              entries={entries}
              rawContent={trial.rawTrajectory}
              // A crashed run has no steps — surface its error inside the tab, like Arena.
              error={entries.length === 0 ? trial.error : null}
            />
          </div>
        )}
        {tab === "test" && (
          <OutputPane content={trial.testOutput} empty="No verifier output captured for this trial." />
        )}
        {tab === "solve" && (
          <OutputPane content={trial.solveOutput} empty="No solve output captured for this trial." />
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

function OutputPane({ content, empty }: { content: string | null; empty: string }) {
  if (!content?.trim()) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-zinc-300 text-sm text-zinc-500 dark:border-zinc-700">
        {empty}
      </div>
    );
  }
  return (
    <pre className="h-full overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs leading-relaxed dark:border-zinc-800 dark:bg-zinc-900">
      {content}
    </pre>
  );
}
