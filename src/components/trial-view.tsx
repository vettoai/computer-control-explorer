"use client";

import Link from "next/link";
import { useMemo } from "react";

import { TrajectoryViewer } from "@/components/trajectory/trajectory-viewer";
import { modelLabel, type TrialDetail } from "@/lib/dataset/trial-types";
import { parseAtifTrajectory } from "@/lib/trajectory/atif";

/** Parsed entries are derived from rawTrajectory on the client, so we never embed them. */
type TrialViewModel = Omit<TrialDetail, "trajectory">;

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

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
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
        <Field label="Task version" value={trial.taskChecksum.slice(0, 12)} mono />
        {trial.durationSec != null && <Field label="Duration" value={`${trial.durationSec}s`} />}
        <Field label="Job" value={trial.jobLabel} mono />
        {trial.startedAt && (
          <Field label="Started" value={new Date(trial.startedAt).toLocaleString()} />
        )}
      </dl>

      {trial.error && (
        <div className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <span className="font-medium">Error:</span> {trial.error}
        </div>
      )}

      <h2 className="mt-8 mb-2 text-sm font-semibold">Trajectory</h2>
      <div className="flex h-[70vh] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
        <TrajectoryViewer entries={entries} rawContent={trial.rawTrajectory} />
      </div>

      <h2 className="mt-8 mb-2 text-sm font-semibold">Test output</h2>
      {trial.testOutput ? (
        <pre className="max-h-[50vh] overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs leading-relaxed dark:border-zinc-800 dark:bg-zinc-900">
          {trial.testOutput}
        </pre>
      ) : (
        <p className="text-sm text-zinc-500">No verifier output captured for this trial.</p>
      )}
    </div>
  );
}
