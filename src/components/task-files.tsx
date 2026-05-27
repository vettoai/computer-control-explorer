"use client";

import { useState } from "react";

import type { TaskDetail } from "@/lib/dataset/types";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DEFAULT_FILES = ["instruction.md", "README.md", "task.toml"];

export function TaskFiles({ task }: { task: TaskDetail }) {
  const defaultPath =
    DEFAULT_FILES.map((p) => task.files.find((f) => f.path === p)?.path).find(Boolean) ??
    task.files[0]?.path ??
    null;
  const [selected, setSelected] = useState<string | null>(defaultPath);
  const file = task.files.find((f) => f.path === selected) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside>
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
      </aside>

      <section className="min-w-0">
        {file ? (
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
              <span className="font-mono text-xs text-zinc-600 dark:text-zinc-300">{file.path}</span>
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
  );
}
