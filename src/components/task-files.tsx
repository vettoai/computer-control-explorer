"use client";

import { useMemo, useState } from "react";

import { CodeBlock } from "@/components/code-block";
import { FileTree } from "@/components/file-tree";
import { ancestorDirs, buildFileTree } from "@/lib/dataset/file-tree";
import type { TaskDetail } from "@/lib/dataset/types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DEFAULT_FILES = ["instruction.md", "README.md", "task.toml"];

export function TaskFiles({ task }: { task: TaskDetail }) {
  const tree = useMemo(() => buildFileTree(task.files), [task.files]);
  const defaultPath =
    DEFAULT_FILES.map((p) => task.files.find((f) => f.path === p)?.path).find(Boolean) ??
    task.files[0]?.path ??
    null;

  const [selected, setSelected] = useState<string | null>(defaultPath);
  // Open the folders leading to the initially-selected file; everything else collapsed.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(defaultPath ? ancestorDirs(defaultPath) : []),
  );

  const file = task.files.find((f) => f.path === selected) ?? null;

  function toggleDir(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Files</h2>
        <FileTree
          nodes={tree}
          selected={selected}
          expanded={expanded}
          onToggleDir={toggleDir}
          onSelectFile={setSelected}
        />
      </aside>

      <section className="min-w-0">
        {file ? (
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
              <span className="font-mono text-xs text-zinc-600 dark:text-zinc-300">{file.path}</span>
              <span className="text-xs text-zinc-400">{formatBytes(file.size)}</span>
            </div>
            {file.content !== null ? (
              <CodeBlock content={file.content} filename={file.path} />
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
