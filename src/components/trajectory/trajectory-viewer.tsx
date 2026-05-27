"use client";

/**
 * Parsed/raw trajectory viewer with grouped command runs and a Copy-raw button.
 * Ported from Vetto Arena (terminal-task/components/user-facing/phases/trajectory-viewer.tsx);
 * imports repointed to our @/lib/trajectory/atif + @/components/trajectory/log-entry.
 * Presentational — both projects are MIT.
 */

import { Check, ChevronRight, Copy, Loader2, Terminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { LogEntryRow } from "@/components/trajectory/log-entry";
import { type AgentLogEntry, stripNoisyLogLines } from "@/lib/trajectory/atif";

interface TrajectoryViewerProps {
  entries: AgentLogEntry[];
  rawContent: string | null;
  loading?: boolean;
  error?: string | null;
  folderPath?: string | null;
  footer?: React.ReactNode;
  /** Called when user clicks Raw and rawContent is null. Should return the raw text. */
  onFetchRaw?: () => Promise<string | null>;
}

function TrajectoryLoading() {
  return (
    <div className="flex items-center justify-center gap-2 py-20 text-zinc-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading trajectory...
    </div>
  );
}

function TrajectoryError({ error, folderPath }: { error: string; folderPath?: string | null }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <p className="mb-2 shrink-0 text-sm font-medium text-red-400">
        Trial failed before producing a trajectory
      </p>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded bg-red-950/30 p-3 text-xs text-red-300">
        {error}
      </pre>
      {folderPath && (
        <p className="mt-2 shrink-0 text-xs text-zinc-400">
          Check <code className="rounded bg-zinc-800 px-1 py-0.5">{folderPath}</code> for details.
        </p>
      )}
    </div>
  );
}

type DisplayItem =
  | { kind: "entry"; entry: AgentLogEntry }
  | { kind: "group"; entries: AgentLogEntry[] };

function groupConsecutiveCommands(entries: AgentLogEntry[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let cmdBuffer: AgentLogEntry[] = [];

  function flushBuffer() {
    if (cmdBuffer.length === 0) return;
    items.push({ kind: "group", entries: [...cmdBuffer] });
    cmdBuffer = [];
  }

  for (const entry of entries) {
    if (entry.type === "command") {
      cmdBuffer.push(entry);
    } else {
      flushBuffer();
      items.push({ kind: "entry", entry });
    }
  }
  flushBuffer();
  return items;
}

function CommandGroup({
  entries,
  baseTimestamp,
}: {
  entries: AgentLogEntry[];
  baseTimestamp: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasFailed = entries.some((e) => e.status === "failed");

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left transition-colors hover:bg-zinc-900/50"
      >
        <Terminal className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        <span className={`text-xs font-medium ${hasFailed ? "text-red-400" : "text-zinc-200"}`}>
          Ran commands
        </span>
        <span className="text-[10px] text-zinc-500">{entries.length}</span>
        <ChevronRight
          className={`ml-auto h-3 w-3 shrink-0 text-zinc-500 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      </button>
      {expanded && (
        <div className="ml-6 border-l-2 border-zinc-800">
          {entries.map((entry) => (
            <LogEntryRow key={entry.id} entry={entry} baseTimestamp={baseTimestamp} />
          ))}
        </div>
      )}
    </div>
  );
}

function TrajectoryContent({
  entries,
  rawContent,
  mode,
}: {
  entries: AgentLogEntry[];
  rawContent: string | null;
  mode: "parsed" | "raw";
}) {
  if (mode === "parsed") {
    if (entries.length > 0) {
      const base = entries[0]?.timestamp ?? 0;
      const items = groupConsecutiveCommands(entries);
      return (
        <div className="divide-y divide-zinc-800 bg-zinc-950">
          {items.map((item, i) =>
            item.kind === "entry" ? (
              <LogEntryRow key={item.entry.id} entry={item.entry} baseTimestamp={base} />
            ) : (
              <CommandGroup key={`grp-${i}`} entries={item.entries} baseTimestamp={base} />
            ),
          )}
        </div>
      );
    }
    // Failed/empty run: no agent steps to parse. Don't dump the raw file here.
    return (
      <div className="px-5 py-16 text-center text-sm text-zinc-500">
        No agent steps were recorded for this trial.
        {rawContent && (
          <>
            {" "}
            Switch to <span className="font-medium text-zinc-300">Raw</span> to view the
            trajectory file.
          </>
        )}
      </div>
    );
  }
  if (!rawContent) return null;
  return (
    <pre className="whitespace-pre-wrap p-4 text-xs text-zinc-400">
      {stripNoisyLogLines(rawContent)}
    </pre>
  );
}

export function TrajectoryViewer({
  entries,
  rawContent,
  loading,
  error,
  folderPath,
  footer,
  onFetchRaw,
}: TrajectoryViewerProps) {
  const [mode, setMode] = useState<"parsed" | "raw">("parsed");
  const [fetchedRaw, setFetchedRaw] = useState<string | null>(null);
  const [fetchingRaw, setFetchingRaw] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasAtBottom = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !wasAtBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [entries.length, footer]);

  const effectiveRaw = rawContent ?? fetchedRaw;

  const switchToRaw = useCallback(async () => {
    if (!effectiveRaw && onFetchRaw && !fetchingRaw) {
      setFetchingRaw(true);
      const raw = await onFetchRaw().catch(() => null);
      setFetchedRaw(raw);
      setFetchingRaw(false);
    }
    setMode("raw");
  }, [effectiveRaw, onFetchRaw, fetchingRaw]);

  if (loading) return <TrajectoryLoading />;
  if (error) return <TrajectoryError error={error} folderPath={folderPath} />;
  if (entries.length === 0 && !rawContent && !footer) {
    return (
      <div className="px-5 py-20 text-center text-sm text-zinc-400">
        No trajectory data available.
      </div>
    );
  }

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    wasAtBottom.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
  }

  const canToggle = !!effectiveRaw || !!onFetchRaw;
  const showCopy = mode === "raw" && !!effectiveRaw;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-auto bg-zinc-950"
        data-scroll-target
      >
        {(canToggle || showCopy) && (
          <div className="pointer-events-auto sticky top-2 z-10 float-right mr-3 flex gap-1.5">
            {showCopy && <CopyRawBtn content={stripNoisyLogLines(effectiveRaw!)} />}
            {canToggle && (
              <div className="pointer-events-auto flex rounded-md border border-zinc-700 bg-black/60 shadow-sm backdrop-blur-sm">
                <ToggleBtn active={mode === "parsed"} onClick={() => setMode("parsed")}>
                  Parsed
                </ToggleBtn>
                <ToggleBtn active={mode === "raw"} onClick={switchToRaw}>
                  {fetchingRaw ? "Loading..." : "Raw"}
                </ToggleBtn>
              </div>
            )}
          </div>
        )}
        <TrajectoryContent entries={entries} rawContent={effectiveRaw} mode={mode} />
        {footer}
      </div>
    </div>
  );
}

function CopyRawBtn({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = content;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : "Copy raw trajectory"}
      className="flex items-center gap-1 rounded-md border border-zinc-700 bg-black/60 px-2 py-1 text-[11px] font-medium text-zinc-200 shadow-sm backdrop-blur-sm transition-colors hover:bg-zinc-800/80"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-emerald-400" />
          <span className="text-emerald-400">Copied</span>
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          <span>Copy</span>
        </>
      )}
    </button>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active ? "bg-white text-black shadow-sm" : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}
