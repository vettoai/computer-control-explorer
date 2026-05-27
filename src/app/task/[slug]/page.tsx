import { notFound } from "next/navigation";

import { TaskDetailView } from "@/components/task-detail-view";
import { getTask, listTasks } from "@/lib/dataset/loader";
import { getTaskTrials, taskTrialStats } from "@/lib/dataset/trials";

/**
 * Enumerate task pages at build time. For a static export this is the complete set of
 * pages emitted; for the standalone server it pre-renders the known tasks.
 */
export async function generateStaticParams() {
  return (await listTasks()).map((task) => ({ slug: task.slug }));
}

export default async function TaskPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const task = await getTask(slug);
  if (!task) notFound();

  const trials = await getTaskTrials(slug);
  const stats = taskTrialStats(trials);

  return <TaskDetailView task={task} trials={trials} stats={stats} />;
}
