import { notFound } from "next/navigation";

import { TrialView } from "@/components/trial-view";
import { getTask, listTasks } from "@/lib/dataset/loader";
import { getTrial, listTrials } from "@/lib/dataset/trials";

/** One page per trial that belongs to a task in the mounted dataset. */
export async function generateStaticParams() {
  const taskSlugs = new Set((await listTasks()).map((t) => t.slug));
  const trials = await listTrials();
  return trials
    .filter((t) => taskSlugs.has(t.slug))
    .map((t) => ({ slug: t.slug, trialId: t.id }));
}

export default async function TrialPage({
  params,
}: {
  params: Promise<{ slug: string; trialId: string }>;
}) {
  const { slug, trialId } = await params;
  const [task, trial] = await Promise.all([getTask(slug), getTrial(slug, trialId)]);
  if (!task || !trial) notFound();

  // Drop the server-parsed trajectory; TrialView re-parses rawTrajectory client-side so
  // we embed the trajectory once (raw) instead of twice (raw + entries).
  const { trajectory: _parsed, ...viewModel } = trial;
  void _parsed;
  return <TrialView taskTitle={task.title} trial={viewModel} />;
}
