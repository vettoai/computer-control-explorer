"use client";

import { ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";

import type { TreeNode } from "@/lib/dataset/file-tree";
import { cn } from "@/lib/utils";

const INDENT = 12;
// Files have no chevron; nudge them right so the file icon lines up under the folder
// icon of the directory they sit in (chevron width + gap).
const FILE_ICON_OFFSET = 20;

function depthOf(path: string): number {
  return path.split("/").length - 1;
}

function indentStyle(level: number, isFile = false): React.CSSProperties {
  return { paddingLeft: `${level * INDENT + 8 + (isFile ? FILE_ICON_OFFSET : 0)}px` };
}

export function FileTree({
  nodes,
  selected,
  expanded,
  onToggleDir,
  onSelectFile,
}: {
  nodes: TreeNode[];
  selected: string | null;
  expanded: Set<string>;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
}) {
  return (
    <ul>
      {nodes.map((node) =>
        node.type === "dir" ? (
          <li key={node.path}>
            <button
              type="button"
              onClick={() => onToggleDir(node.path)}
              className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
              style={indentStyle(depthOf(node.path))}
            >
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform",
                  expanded.has(node.path) && "rotate-90",
                )}
              />
              {expanded.has(node.path) ? (
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
              )}
              <span className="truncate">{node.name}</span>
            </button>
            {expanded.has(node.path) && (
              <FileTree
                nodes={node.children}
                selected={selected}
                expanded={expanded}
                onToggleDir={onToggleDir}
                onSelectFile={onSelectFile}
              />
            )}
          </li>
        ) : (
          <li key={node.path}>
            <button
              type="button"
              onClick={() => onSelectFile(node.path)}
              title={node.path}
              aria-current={selected === node.path ? "true" : undefined}
              className={cn(
                "flex w-full items-center gap-1.5 rounded px-1 py-1 text-left font-mono text-xs transition-colors",
                selected === node.path
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
              )}
              style={indentStyle(depthOf(node.path), true)}
            >
              <FileText
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  selected === node.path ? "" : "text-zinc-400",
                )}
              />
              <span className="truncate">{node.name}</span>
            </button>
          </li>
        ),
      )}
    </ul>
  );
}
