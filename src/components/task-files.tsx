"use client";

import { Check, Copy, Download } from "lucide-react";
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

/** Copy-to-clipboard and download controls for the currently viewed text file. */
function FileActions({ content, path }: { content: string; path: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. non-secure context) — nothing to do.
    }
  }

  function download() {
    const name = path.split("/").pop() || path;
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const btn =
    "rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200";

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={copy}
        title={copied ? "Copied!" : "Copy file contents"}
        aria-label="Copy file contents"
        className={btn}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
      <button type="button" onClick={download} title="Download file" aria-label="Download file" className={btn}>
        <Download className="h-3.5 w-3.5" />
      </button>
    </div>
  );
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
            <div className="flex items-center justify-between gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
              <span className="truncate font-mono text-xs text-zinc-600 dark:text-zinc-300">{file.path}</span>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-zinc-400">{formatBytes(file.size)}</span>
                {file.content !== null && <FileActions content={file.content} path={file.path} />}
              </div>
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
