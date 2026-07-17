import { notFound } from "next/navigation";

import { CinemaPlayer } from "@/components/cinema/cinema-player";
import { getTrialAnalysis } from "@/lib/dataset/analysis";
import { getTask, listTasks } from "@/lib/dataset/loader";
import { getTrial, listTrials } from "@/lib/dataset/trials";

/** Cinema mode for every trial page — same param space as the classic trial view. */
export async function generateStaticParams() {
  const taskSlugs = new Set((await listTasks()).map((t) => t.slug));
  const trials = await listTrials();
  return trials
    .filter((t) => taskSlugs.has(t.slug))
    .map((t) => ({ slug: t.slug, trialId: t.id }));
}

export default async function CinemaPage({
  params,
}: {
  params: Promise<{ slug: string; trialId: string }>;
}) {
  const { slug, trialId } = await params;
  const [task, trial, analysis] = await Promise.all([
    getTask(slug),
    getTrial(slug, trialId),
    getTrialAnalysis(trialId),
  ]);
  if (!task || !trial) notFound();

  return (
    <CinemaPlayer
      slug={slug}
      trialId={trialId}
      taskTitle={task.title}
      agent={trial.agent}
      model={trial.model}
      reward={trial.reward}
      passed={trial.passed}
      errorType={trial.error?.type ?? null}
      rawTrajectory={trial.rawTrajectory}
      testOutput={trial.testOutput}
      analysis={analysis}
    />
  );
}
