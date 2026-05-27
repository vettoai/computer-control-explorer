import Image from "next/image";
import { connection } from "next/server";

import { TaskList } from "@/components/task-list";
import { getDatasetInfo, listTasks } from "@/lib/dataset/loader";

export default async function Home() {
  // Server (Docker / local-dir): opt into per-request rendering so the list reflects the
  // dataset mounted at runtime, which isn't present at build time. Export: skip, so the
  // page is prerendered statically against the build-time dataset. (Task and trial pages
  // already render on demand via generateStaticParams + dynamicParams.)
  if (process.env.EXPLORER_MODE !== "export") {
    await connection();
  }
  const [tasks, info] = await Promise.all([listTasks(), getDatasetInfo()]);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="mb-8">
        <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
          <Image
            src="/vetto-logo-light-mode.svg"
            alt="Vetto"
            width={20}
            height={20}
            className="dark:hidden"
            priority
          />
          <Image
            src="/vetto-logo-dark-mode.svg"
            alt=""
            width={20}
            height={20}
            className="hidden dark:block"
            priority
          />
          <span>Computer Control Dataset Explorer</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {info?.name ?? "Computer Control Dataset Explorer"}
        </h1>
        {info?.description && (
          <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-300">
            {info.description}
          </p>
        )}
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
