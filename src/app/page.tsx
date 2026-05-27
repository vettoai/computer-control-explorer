import { TaskList } from "@/components/task-list";
import { listTasks } from "@/lib/dataset/loader";

export default async function Home() {
  const tasks = await listTasks();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Computer Control Explorer</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {tasks.length} {tasks.length === 1 ? "task" : "tasks"} · browse task files,
          trajectories, and test results
        </p>
      </header>

      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
          <p className="text-sm font-medium">No dataset mounted</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Set <code className="font-mono">DATASET_DIR</code> to a bundle root containing{" "}
            <code className="font-mono">dataset/</code>.
          </p>
        </div>
      ) : (
        <TaskList tasks={tasks} />
      )}
    </div>
  );
}
