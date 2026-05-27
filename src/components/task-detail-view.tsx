"use client";

import Link from "next/link";
import { useState } from "react";

import type { TaskDetail } from "@/lib/dataset/types";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DEFAULT_FILES = ["instruction.md", "README.md", "task.toml"];

export function TaskDetailView({ task }: { task: TaskDetail }) {
  const defaultPath =
    DEFAULT_FILES.map((p) => task.files.find((f) => f.path === p)?.path).find(Boolean) ??
    task.files[0]?.path ??
    null;
  const [selected, setSelected] = useState<string | null>(defaultPath);
  const file = task.files.find((f) => f.path === selected) ?? null;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <Link
        href="/"
        className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
      >
        ← All tasks
      </Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{task.title}</h1>
      <p className="font-mono text-sm text-zinc-500 dark:text-zinc-400">{task.name}</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-6">
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Metadata
            </h2>
            <dl className="space-y-2 text-sm">
              <Row label="Category" value={task.category} />
              {task.difficulty && <Row label="Difficulty" value={task.difficulty} />}
              {task.tags.length > 0 && (
                <div>
                  <dt className="text-zinc-400">Tags</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {task.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      >
                        #{tag}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Files
            </h2>
            <ul className="space-y-0.5">
              {task.files.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    onClick={() => setSelected(f.path)}
                    className={cn(
                      "w-full truncate rounded px-2 py-1 text-left font-mono text-xs transition-colors",
                      selected === f.path
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                    )}
                    title={f.path}
                  >
                    {f.path}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <section className="min-w-0">
          {file ? (
            <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
                <span className="font-mono text-xs text-zinc-600 dark:text-zinc-300">
                  {file.path}
                </span>
                <span className="text-xs text-zinc-400">{formatBytes(file.size)}</span>
              </div>
              {file.content !== null ? (
                <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-xs leading-relaxed">
                  {file.content}
                </pre>
              ) : (
                <p className="p-4 text-sm text-zinc-500 dark:text-zinc-400">
                  Binary or oversized file — not shown ({formatBytes(file.size)}).
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No files.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-400">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
