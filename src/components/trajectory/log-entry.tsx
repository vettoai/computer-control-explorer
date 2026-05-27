"use client";

/**
 * Shared log-entry row for the trajectory viewer (thinking / command / output / error),
 * plus parseRawLog for codex JSONL. Ported verbatim from Vetto Arena
 * (terminal-task/components/user-facing/phases/log-entry.tsx); imports repointed to
 * our @/lib/trajectory/atif module. Presentational/pure — both projects are MIT.
 */

import { AlertTriangle, Brain, ChevronRight, Loader2, Terminal, XCircle } from "lucide-react";
import React, { useState } from "react";

import type { AgentLogEntry } from "@/lib/trajectory/atif";

function formatElapsed(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 1) return "0s";
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

/** Shared log entry row — used in both live agent panel and run history. */
export const LogEntryRow = React.memo(function LogEntryRow({
  entry,
  baseTimestamp,
}: {
  entry: AgentLogEntry;
  baseTimestamp?: number;
}) {
  const relTime =
    entry.timestamp && baseTimestamp ? formatElapsed(entry.timestamp - baseTimestamp) : null;

  if (entry.type === "thinking") return <ThinkingEntry entry={entry} relTime={relTime} />;
  if (entry.type === "command") return <CommandEntry entry={entry} relTime={relTime} />;
  if (entry.type === "error")
    return (
      <div className="flex items-start gap-2 px-4 py-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
        <p className="text-xs text-red-400">{entry.summary}</p>
      </div>
    );
  return (
    <div className="whitespace-pre-wrap px-4 py-2 text-xs text-zinc-400">{entry.summary}</div>
  );
});

function ThinkingEntry({ entry, relTime }: { entry: AgentLogEntry; relTime: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const firstLine = entry.summary.slice(0, 120);
  const hasMore = entry.summary.length > 120;

  return (
    <div className="px-4 py-2">
      <button onClick={() => setExpanded(!expanded)} className="flex w-full items-start gap-2 text-left">
        <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-zinc-200">
            {expanded ? entry.summary : firstLine}
            {!expanded && hasMore ? "..." : ""}
          </p>
        </div>
        {relTime && <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">{relTime}</span>}
        {hasMore && (
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-zinc-400 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        )}
      </button>
    </div>
  );
}

function CommandEntry({ entry, relTime }: { entry: AgentLogEntry; relTime: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetail = !!entry.detail?.trim();
  return (
    <div className="px-4 py-2">
      <button
        onClick={() => hasDetail && setExpanded(!expanded)}
        className="flex w-full items-start gap-2 text-left"
      >
        <CommandStatusIcon status={entry.status} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs text-zinc-200">{entry.summary}</p>
        </div>
        {relTime && <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">{relTime}</span>}
        {hasDetail && (
          <ChevronRight
            className={`h-3 w-3 shrink-0 text-zinc-400 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        )}
      </button>
      {expanded && hasDetail && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-zinc-900 p-2 text-[11px] text-zinc-400">
          {entry.detail}
        </pre>
      )}
    </div>
  );
}

function CommandStatusIcon({ status }: { status?: string }) {
  if (status === "running")
    return <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-amber-400" />;
  if (status === "failed") return <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />;
  return <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" />;
}

function parseCodexItem(item: Record<string, unknown>, id: string): AgentLogEntry | null {
  const itemType = item.type as string;
  if (itemType === "agent_message" && item.text) {
    return { id, type: "thinking", summary: item.text as string };
  }
  if (itemType === "command_execution") {
    const cmd = (item.command as string) ?? "";
    return {
      id,
      type: "command",
      summary: cmd
        .replace(/^\/bin\/bash -lc ['"]?/, "")
        .replace(/['"]?$/, "")
        .slice(0, 120),
      detail: (item.aggregated_output as string) || undefined,
      status: (item.exit_code as number) === 0 ? "completed" : "failed",
    };
  }
  if (itemType === "file_change") {
    const changes = item.changes as { path: string; kind: string }[] | undefined;
    if (changes?.length) {
      const summary = changes.map((c) => `${c.kind}: ${c.path.split("/").pop()}`).join(", ");
      return { id, type: "output", summary: `Files: ${summary}` };
    }
  }
  if (itemType === "todo_list") {
    const items = item.items as { text: string; completed: boolean }[] | undefined;
    if (items?.length) {
      const summary = items.map((t) => `${t.completed ? "✓" : "○"} ${t.text}`).join("\n");
      return { id, type: "output", summary };
    }
  }
  return null;
}

/** Parse raw JSONL log (codex stream) into AgentLogEntry array. */
export function parseRawLog(raw: string): AgentLogEntry[] {
  const entries: AgentLogEntry[] = [];
  let counter = 0;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const eventType = parsed.type as string;
      if (
        eventType !== "item.completed" &&
        eventType !== "item.started" &&
        eventType !== "item.updated"
      )
        continue;
      const item = parsed.item as Record<string, unknown> | undefined;
      if (!item) continue;
      const id = (item.id as string) ?? `raw-${++counter}`;
      const isTodo = (item.type as string) === "todo_list";
      const displayId = isTodo ? `${id}-${eventType}` : id;
      const entry = parseCodexItem(item, displayId);
      if (!entry) continue;
      const existingIdx = entries.findIndex((e) => e.id === displayId);
      if (existingIdx >= 0) {
        entries[existingIdx] = entry;
        continue;
      }
      entries.push(entry);
    } catch {
      /* skip */
    }
  }
  return entries;
}
