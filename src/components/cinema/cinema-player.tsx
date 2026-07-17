"use client";

/**
 * Cinema mode — a full-screen, one-turn-at-a-time trajectory player.
 *
 * Instead of a giant scrollable log, each agent turn gets the whole screen: the thought
 * streams in progressively (fast typewriter, word-granular), then each command "executes"
 * into a terminal block with its output revealed beneath (collapsed when long). Prev/Next
 * (buttons, ←/→, Space, j/k) step through turns; phase chips jump between sections
 * (planning → exploring → implementing → verifying …). A click or Space mid-animation
 * completes the current animation instantly.
 *
 * Purely presentational: turns are parsed client-side from the raw ATIF; optional
 * LLM-precomputed labels arrive via the `analysis` prop (disk sidecar) and override the
 * heuristic phase labels.
 *
 * State model: the player owns (pos, stage, skip). `pos` is the turn position (-1 title
 * card, n outcome card); `stage` is the within-turn animation step (0 = thought,
 * 1..tools = tool blocks, tools+1 = turn fully shown). Everything else — avatar mood,
 * "turn done", progress — is derived at render. Animations advance `stage` only from
 * interval/timeout callbacks, never synchronously in effects.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { TrialAnalysis } from "@/lib/dataset/analysis";
import { parseFailedTests } from "@/lib/dataset/interesting";
import { modelLabel } from "@/lib/dataset/trial-types";
import {
  PHASE_LABEL,
  type PhaseSection,
  parseAtifTurns,
  phaseSections,
  type TrajectoryTurn,
  type TurnPhase,
} from "@/lib/trajectory/turns";

/* ------------------------------------------------------------------------------------ */
/* Animation primitives                                                                  */
/* ------------------------------------------------------------------------------------ */

/** Always-current callback ref (written in an effect, read in timers). */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Progressive reveal of `len` units. Ticks only while `active`; `skip` completes on the
 * next tick. Calls `onDone` (from an effect, guarded to fire once per activation) when
 * all units are shown. Components using it remount per turn/tool (via key), so the count
 * never needs an in-place reset.
 */
function useReveal(
  len: number,
  active: boolean,
  skip: boolean,
  onDone: () => void,
  tickMs: number,
  maxMs: number,
) {
  const [count, setCount] = useState(0);
  const onDoneRef = useLatest(onDone);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!active || len === 0) return;
    const perTick = skip ? Number.POSITIVE_INFINITY : Math.max(1, Math.ceil(len / (maxMs / tickMs)));
    const id = setInterval(() => {
      setCount((c) => (c >= len ? c : Math.min(len, c + perTick)));
    }, tickMs);
    return () => clearInterval(id);
  }, [active, skip, len, tickMs, maxMs]);

  const done = active && count >= len;
  useEffect(() => {
    if (done && !firedRef.current) {
      firedRef.current = true;
      onDoneRef.current();
    }
  }, [done, onDoneRef]);

  return { count, done };
}

/* ------------------------------------------------------------------------------------ */
/* Avatar                                                                                */
/* ------------------------------------------------------------------------------------ */

type AvatarMood = "idle" | "thinking" | "working" | "happy" | "sad";

const MOOD_PROP: Record<AvatarMood, string | null> = {
  idle: null,
  thinking: "💭",
  working: "⛏️",
  happy: "🎉",
  sad: "💥",
};

/** Tiny CSS-animated agent: bobs while thinking, swings a pickaxe while running tools. */
function AgentAvatar({ mood, name }: { mood: AvatarMood; name: string }) {
  return (
    <div className="flex select-none flex-col items-center" aria-hidden>
      <div className="relative">
        <span
          className={
            "inline-block text-3xl " +
            (mood === "thinking"
              ? "animate-[cinema-bob_1.2s_ease-in-out_infinite]"
              : mood === "working"
                ? "animate-[cinema-work_0.5s_ease-in-out_infinite]"
                : mood === "sad"
                  ? "animate-[cinema-shake_0.4s_ease-in-out_2]"
                  : "")
          }
        >
          🤖
        </span>
        {MOOD_PROP[mood] && (
          <span
            className={
              "absolute -right-4 -top-2 text-lg " +
              (mood === "working"
                ? "animate-[cinema-swing_0.5s_ease-in-out_infinite]"
                : mood === "thinking"
                  ? "animate-pulse"
                  : "")
            }
          >
            {MOOD_PROP[mood]}
          </span>
        )}
      </div>
      <span className="mt-1 max-w-36 truncate font-mono text-[10px] text-zinc-500">{name}</span>
    </div>
  );
}

/* ------------------------------------------------------------------------------------ */
/* Turn stage: thought → tools (command types, output reveals) → done                    */
/* ------------------------------------------------------------------------------------ */

const PHASE_STYLE: Record<TurnPhase, string> = {
  plan: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  explore: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  implement: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  verify: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  debug: "bg-red-500/15 text-red-300 border-red-500/30",
  conclude: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

function PhaseChip({ phase }: { phase: TurnPhase }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${PHASE_STYLE[phase]}`}>
      {PHASE_LABEL[phase]}
    </span>
  );
}

function ThoughtBlock({
  text,
  active,
  skip,
  onDone,
}: {
  text: string;
  active: boolean;
  skip: boolean;
  onDone: () => void;
}) {
  const words = useMemo(() => text.split(/(?<=\s)/), [text]);
  const { count, done } = useReveal(words.length, active, skip, onDone, 28, 3500);
  return (
    <div className="flex gap-3">
      <span className="mt-1 shrink-0 text-violet-400">💭</span>
      <p className="min-w-0 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-zinc-200">
        {words.slice(0, count).join("")}
        {active && !done && <span className="animate-pulse text-violet-400">▌</span>}
      </p>
    </div>
  );
}

const COLLAPSED_OUTPUT_LINES = 8;
const RUN_PAUSE_MS = 220;

function ToolBlock({
  tool,
  active,
  skip,
  onDone,
}: {
  tool: TrajectoryTurn["tools"][number];
  active: boolean;
  skip: boolean;
  onDone: () => void;
}) {
  const { count, done: cmdDone } = useReveal(
    tool.command.length,
    active,
    skip,
    () => {},
    12,
    700,
  );
  const [outputShown, setOutputShown] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const onDoneRef = useLatest(onDone);
  const hasOutput = !!tool.output?.trim();

  // After the command finishes typing, "run" it briefly, then start revealing the output.
  // With no output to reveal, the tool is done here; otherwise done fires when the output
  // reveal completes (see CollapsiblePre onRevealed below).
  useEffect(() => {
    if (!cmdDone || outputShown) return;
    const id = setTimeout(
      () => {
        setOutputShown(true);
        if (!hasOutput) onDoneRef.current();
      },
      skip ? 0 : RUN_PAUSE_MS,
    );
    return () => clearTimeout(id);
  }, [cmdDone, outputShown, skip, hasOutput, onDoneRef]);

  if (!active && !cmdDone) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-black/60 animate-[cinema-fadein_0.2s_ease-out]">
      <div className="flex items-start gap-2 px-3 py-2">
        <span className="mt-px shrink-0 font-mono text-xs text-emerald-400">$</span>
        <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-zinc-100">
          {tool.command.slice(0, count)}
          {!cmdDone && <span className="animate-pulse text-emerald-400">▌</span>}
        </pre>
        {cmdDone && !outputShown && (
          <span className="shrink-0 animate-pulse text-[10px] text-amber-400">running…</span>
        )}
        {outputShown && (
          <span
            className={`shrink-0 text-[10px] font-medium ${tool.status === "failed" ? "text-red-400" : "text-emerald-500"}`}
          >
            {tool.status === "failed" ? "✗ non-zero exit" : "✓"}
          </span>
        )}
      </div>
      {outputShown && tool.input?.trim() && (
        <CollapsiblePre
          text={tool.input}
          label="input"
          className="text-sky-200/80"
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
        />
      )}
      {outputShown && hasOutput && (
        <CollapsiblePre
          text={tool.output!}
          label="output"
          className="text-zinc-400"
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
          reveal={{ skip, onRevealed: () => onDoneRef.current() }}
        />
      )}
    </div>
  );
}

/**
 * Collapsed-to-8-lines pre block used for a tool's input payload and output. With
 * `reveal` set, the (visible) lines slide in top-to-bottom instead of appearing at once,
 * and `onRevealed` fires when the reveal completes.
 */
function CollapsiblePre({
  text,
  label,
  className,
  expanded,
  onToggle,
  reveal,
}: {
  text: string;
  label: string;
  className: string;
  expanded: boolean;
  onToggle: () => void;
  reveal?: { skip: boolean; onRevealed: () => void };
}) {
  const lines = useMemo(() => text.split("\n"), [text]);
  const isLong = lines.length > COLLAPSED_OUTPUT_LINES;
  const cappedCount = expanded || !isLong ? lines.length : COLLAPSED_OUTPUT_LINES;

  // Line-by-line downward reveal of the visible lines (whole block instantly when not
  // animating). The target is frozen at mount (the collapsed view); expanding afterwards
  // shows the rest directly.
  const [revealTarget] = useState(cappedCount);
  const { count: revealed, done: revealDone } = useReveal(
    reveal ? revealTarget : 0,
    !!reveal,
    reveal?.skip ?? false,
    () => reveal?.onRevealed(),
    30,
    1100,
  );
  const showAll = !reveal || revealDone;
  const visible = showAll
    ? lines.slice(0, cappedCount).join("\n")
    : lines.slice(0, revealed).join("\n");

  return (
    <div className="border-t border-zinc-800/80 bg-zinc-950/80">
      <pre
        className={`max-h-[45vh] overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed ${className}`}
      >
        {visible}
        {isLong && !expanded && showAll && "\n…"}
      </pre>
      {isLong && showAll && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="w-full border-t border-zinc-800/60 px-3 py-1 text-left text-[10px] font-medium text-zinc-500 transition-colors hover:text-zinc-300"
        >
          {expanded ? `Collapse ${label}` : `Show all ${lines.length} ${label} lines`}
        </button>
      )}
    </div>
  );
}

function TurnStage({
  turn,
  note,
  stage,
  skip,
  onAdvance,
}: {
  turn: TrajectoryTurn;
  note: string | undefined;
  /** 0 = thought animating, 1..tools = tool i animating, tools+1 = fully shown. */
  stage: number;
  skip: boolean;
  onAdvance: () => void;
}) {
  const doneStage = turn.tools.length + 1;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      {turn.thought && (
        <ThoughtBlock text={turn.thought} active={stage >= 0} skip={skip || stage > 0} onDone={onAdvance} />
      )}
      {turn.tools.map((tool, i) => (
        <ToolBlock
          key={tool.id}
          tool={tool}
          active={stage >= i + 1}
          skip={skip || stage > i + 1}
          onDone={onAdvance}
        />
      ))}
      {turn.tools.length === 0 && !turn.thought && (
        <p className="text-center text-sm text-zinc-500">(empty turn)</p>
      )}
      {note && stage >= doneStage && (
        <p className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs italic text-zinc-400 animate-[cinema-fadein_0.3s_ease-out]">
          <span className="not-italic">🏷️</span> {note}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------------------ */
/* Title & outcome cards                                                                 */
/* ------------------------------------------------------------------------------------ */

function TitleCard({
  taskTitle,
  agentName,
  model,
  turnCount,
  summary,
  analyzedBy,
}: {
  taskTitle: string;
  agentName: string;
  model: string | null;
  turnCount: number;
  summary?: string;
  analyzedBy?: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 text-center">
      <span className="text-5xl">🎬</span>
      <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">{taskTitle}</h2>
      <p className="font-mono text-sm text-zinc-400">
        {agentName} · {modelLabel(model)} · {turnCount} turns
      </p>
      {summary && (
        <p className="max-w-xl text-sm leading-relaxed text-zinc-300">
          {summary}
          {analyzedBy && (
            <span className="mt-1 block text-[10px] text-zinc-500">
              summary by {modelLabel(analyzedBy)}
            </span>
          )}
        </p>
      )}
      <p className="mt-2 text-xs text-zinc-500">
        The outcome stays hidden until the final turn — judge the run as it unfolds.
      </p>
      <p className="animate-pulse text-sm text-zinc-400">
        Press <Kbd>→</Kbd> or <Kbd>Space</Kbd> to begin
      </p>
    </div>
  );
}

function OutcomeCard({
  passed,
  reward,
  errorType,
  failedTests,
  reviewHint,
  backHref,
}: {
  passed: boolean;
  reward: number | null;
  errorType: string | null;
  failedTests: string[];
  reviewHint?: string;
  backHref: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 text-center">
      <span className={`text-6xl ${passed ? "" : "grayscale"}`}>{passed ? "🏆" : "💥"}</span>
      <h2 className="text-3xl font-semibold tracking-tight text-zinc-100">
        {reward === null ? "No verdict" : passed ? "Passed" : "Failed"}
      </h2>
      <p className="font-mono text-sm text-zinc-400">
        reward {reward ?? "—"}
        {errorType && <span className="text-amber-400"> · {errorType}</span>}
      </p>
      {errorType && passed && (
        <p className="max-w-lg rounded-md border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          ⚠ This run passed <em>despite</em> a recorded {errorType} — worth a close look: either
          the agent over-verified an already-correct solution, or the verifier accepted a
          partial one.
        </p>
      )}
      {failedTests.length > 0 && (
        <div className="max-w-lg text-left">
          <p className="mb-1 text-xs font-medium text-zinc-400">Failing tests:</p>
          <ul className="space-y-0.5">
            {failedTests.slice(0, 8).map((t) => (
              <li key={t} className="font-mono text-xs text-red-400">
                ✗ {t}
              </li>
            ))}
            {failedTests.length > 8 && (
              <li className="text-xs text-zinc-500">… and {failedTests.length - 8} more</li>
            )}
          </ul>
        </div>
      )}
      {reviewHint && (
        <p className="max-w-lg rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs italic text-zinc-300">
          🧑‍⚖️ {reviewHint}
        </p>
      )}
      <Link
        href={backHref}
        className="mt-2 rounded-md border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
      >
        Open classic trial view
      </Link>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
      {children}
    </kbd>
  );
}

/* ------------------------------------------------------------------------------------ */
/* The player                                                                            */
/* ------------------------------------------------------------------------------------ */

export interface CinemaTrialProps {
  slug: string;
  trialId: string;
  taskTitle: string;
  agent: string;
  model: string | null;
  reward: number | null;
  passed: boolean;
  errorType: string | null;
  rawTrajectory: string | null;
  testOutput: string | null;
  analysis: TrialAnalysis | null;
}

/** Position: -1 = title card, 0..n-1 = turns, n = outcome card. */
export function CinemaPlayer(props: CinemaTrialProps) {
  const { turns, agent } = useMemo(() => {
    if (!props.rawTrajectory) return { turns: [] as TrajectoryTurn[], agent: null };
    try {
      return parseAtifTurns(props.rawTrajectory);
    } catch {
      return { turns: [] as TrajectoryTurn[], agent: null };
    }
  }, [props.rawTrajectory]);

  // Sidecar phases/notes override the heuristics, keyed by turn index.
  const analysisByTurn = useMemo(() => {
    const map = new Map<number, { phase?: TurnPhase; note?: string }>();
    for (const t of props.analysis?.turns ?? []) map.set(t.index, t);
    return map;
  }, [props.analysis]);

  const effectiveTurns = useMemo(
    () =>
      turns.map((t) => ({
        ...t,
        phase: analysisByTurn.get(t.index)?.phase ?? t.phase,
      })),
    [turns, analysisByTurn],
  );

  const sections = useMemo(() => phaseSections(effectiveTurns), [effectiveTurns]);
  const failedTests = useMemo(() => parseFailedTests(props.testOutput), [props.testOutput]);

  const [pos, setPos] = useState(-1);
  const [stage, setStage] = useState(0); // within-turn animation step
  const [skip, setSkip] = useState(false);
  const [autoplay, setAutoplay] = useState(false);

  const n = effectiveTurns.length;
  const atTitle = pos === -1;
  const atOutcome = pos >= n && n > 0;
  const turn = !atTitle && !atOutcome && pos < n ? effectiveTurns[pos] : null;

  // Derived: is the current turn fully shown? (thought = stage 0, tools 1..k, done = k+1;
  // a thoughtless turn starts at stage 1 via goto below.)
  const doneStage = turn ? turn.tools.length + 1 : 0;
  const turnDone = turn ? stage >= doneStage : false;

  const mood: AvatarMood = atTitle
    ? "idle"
    : atOutcome
      ? props.passed
        ? "happy"
        : "sad"
      : !turn || turnDone
        ? "idle"
        : stage === 0
          ? "thinking"
          : "working";

  const goto = useCallback(
    (next: number) => {
      const clamped = Math.max(-1, Math.min(n, next));
      setPos(clamped);
      const t = clamped >= 0 && clamped < n ? effectiveTurns[clamped] : null;
      setStage(t && !t.thought ? 1 : 0);
      setSkip(false);
    },
    [n, effectiveTurns],
  );

  const advanceStage = useCallback(() => setStage((s) => s + 1), []);

  const next = useCallback(() => {
    // First press completes the animation; second advances.
    if (turn && !turnDone && !skip) {
      setSkip(true);
      return;
    }
    goto(pos + 1);
  }, [turn, turnDone, skip, goto, pos]);

  const prev = useCallback(() => goto(pos - 1), [goto, pos]);

  // Autoscroll: while a turn is animating, keep the pane pinned to the newest content so
  // streaming text / appearing tool blocks never run below the fold. The pin follows only
  // while the user is at (or near) the bottom — scrolling up detaches it, scrolling back
  // down re-attaches. Each turn starts scrolled to the top.
  const mainRef = useRef<HTMLElement>(null);
  const followRef = useRef(true);

  useEffect(() => {
    const el = mainRef.current;
    if (el) el.scrollTop = 0;
    followRef.current = true;
  }, [pos]);

  useEffect(() => {
    if (!turn || turnDone) return;
    const id = setInterval(() => {
      const el = mainRef.current;
      if (!el || !followRef.current) return;
      if (el.scrollHeight > el.scrollTop + el.clientHeight) el.scrollTop = el.scrollHeight;
    }, 80);
    return () => clearInterval(id);
  }, [turn, turnDone]);

  // One final pin when the turn finishes (the phase note lands after the last tool).
  useEffect(() => {
    if (!turnDone) return;
    const id = setTimeout(() => {
      const el = mainRef.current;
      if (el && followRef.current) el.scrollTop = el.scrollHeight;
    }, 80);
    return () => clearTimeout(id);
  }, [turnDone]);

  const onMainScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    followRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 48;
  }, []);

  // Skipping fast-forwards the stage to "fully shown" (children also honor `skip`).
  useEffect(() => {
    if (skip && turn) {
      const id = setTimeout(() => setStage(turn.tools.length + 1), 60);
      return () => clearTimeout(id);
    }
  }, [skip, turn]);

  // Autoplay: advance shortly after the current turn finishes animating.
  useEffect(() => {
    if (!autoplay || atOutcome) return;
    if (atTitle || turnDone) {
      const id = setTimeout(() => goto(pos + 1), atTitle ? 600 : 1400);
      return () => clearTimeout(id);
    }
  }, [autoplay, atTitle, atOutcome, turnDone, pos, goto]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "ArrowRight":
        case " ":
        case "j":
          e.preventDefault();
          next();
          break;
        case "ArrowLeft":
        case "k":
          e.preventDefault();
          prev();
          break;
        case "Home":
          e.preventDefault();
          goto(-1);
          break;
        case "End":
          e.preventDefault();
          goto(n);
          break;
        case "a":
          setAutoplay((v) => !v);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, goto, n]);

  const backHref = `/task/${props.slug}/t/${props.trialId}`;
  const agentName = agent?.name ?? props.agent;

  if (!props.rawTrajectory || n === 0) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-zinc-950 text-zinc-400">
        <p className="text-sm">No parseable trajectory for this trial.</p>
        <Link href={backHref} className="text-sm text-zinc-300 underline">
          Back to trial view
        </Link>
      </div>
    );
  }

  const turnNote = turn ? analysisByTurn.get(turn.index)?.note : undefined;

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden bg-zinc-950 text-zinc-100"
      onClick={() => {
        if (turn && !turnDone && !skip) setSkip(true);
      }}
    >
      {/* Top bar: breadcrumb, progress, controls */}
      <header className="flex items-center gap-3 border-b border-zinc-900 px-4 py-2">
        <Link
          href={backHref}
          className="shrink-0 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          title="Back to the classic trial view"
        >
          ← exit cinema
        </Link>
        <div className="min-w-0 flex-1 truncate text-center text-xs text-zinc-500">
          <span className="font-medium text-zinc-300">{props.taskTitle}</span>
          {" · "}
          {agentName} · {modelLabel(agent?.model ?? props.model)}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setAutoplay(!autoplay);
          }}
          className={`shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
            autoplay
              ? "border-emerald-600 bg-emerald-950/50 text-emerald-300"
              : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
          }`}
          title="Toggle autoplay (a)"
        >
          {autoplay ? "▶ auto" : "▶ auto off"}
        </button>
        <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-400">
          {atTitle ? "start" : atOutcome ? "verdict" : `turn ${pos + 1} / ${n}`}
        </span>
      </header>

      {/* Progress bar + phase sections */}
      <div className="border-b border-zinc-900 px-4 py-2">
        <ProgressStrip sections={sections} turns={effectiveTurns} pos={pos} total={n} onJump={goto} />
      </div>

      {/* Stage */}
      <main
        ref={mainRef}
        onScroll={onMainScroll}
        className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto px-6 py-10"
      >
        {atTitle && (
          <TitleCard
            taskTitle={props.taskTitle}
            agentName={agentName}
            model={agent?.model ?? props.model}
            turnCount={n}
            summary={props.analysis?.summary}
            analyzedBy={props.analysis?.analyzedBy}
          />
        )}
        {turn && (
          <div className="w-full">
            <div className="mx-auto mb-4 flex w-full max-w-3xl items-center justify-between">
              <PhaseChip phase={turn.phase} />
              {turn.timestamp && effectiveTurns[0].timestamp && (
                <span className="font-mono text-[11px] tabular-nums text-zinc-500">
                  t+{Math.max(0, Math.round((turn.timestamp - effectiveTurns[0].timestamp) / 1000))}s
                </span>
              )}
            </div>
            <TurnStage
              key={turn.stepId}
              turn={turn}
              note={turnNote}
              stage={stage}
              skip={skip}
              onAdvance={advanceStage}
            />
          </div>
        )}
        {atOutcome && (
          <OutcomeCard
            passed={props.passed}
            reward={props.reward}
            errorType={props.errorType}
            failedTests={failedTests}
            reviewHint={props.analysis?.reviewHint}
            backHref={backHref}
          />
        )}
      </main>

      {/* Bottom bar: avatar + prev/next */}
      <footer className="flex items-center justify-between border-t border-zinc-900 px-6 py-3">
        <AgentAvatar mood={mood} name={`${agentName} · ${modelLabel(agent?.model ?? props.model)}`} />
        <div className="flex items-center gap-2">
          <NavBtn onClick={prev} disabled={atTitle}>
            ← Prev
          </NavBtn>
          <NavBtn onClick={next} disabled={atOutcome} primary pulse={turnDone && !atOutcome}>
            {turn && !turnDone && !skip ? "Skip ⏭" : "Next →"}
          </NavBtn>
        </div>
        <div className="hidden w-40 text-right text-[10px] leading-4 text-zinc-600 sm:block">
          <Kbd>←</Kbd> <Kbd>→</Kbd> navigate · <Kbd>Space</Kbd> skip/next · <Kbd>a</Kbd> autoplay
        </div>
      </footer>
    </div>
  );
}

function NavBtn({
  onClick,
  disabled,
  primary,
  pulse,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  pulse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-30 ${
        primary
          ? "bg-zinc-100 text-zinc-900 hover:bg-white"
          : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
      } ${pulse ? "animate-pulse" : ""}`}
    >
      {children}
    </button>
  );
}

/**
 * One clickable cell per turn, colored by phase, grouped visually into sections. Doubles
 * as the progress bar (played turns are bright, future ones dim) and the section-jump
 * control (click any cell).
 */
function ProgressStrip({
  sections,
  turns,
  pos,
  total,
  onJump,
}: {
  sections: PhaseSection[];
  turns: TrajectoryTurn[];
  pos: number;
  total: number;
  onJump: (index: number) => void;
}) {
  const PHASE_BAR: Record<TurnPhase, string> = {
    plan: "bg-violet-500",
    explore: "bg-sky-500",
    implement: "bg-emerald-500",
    verify: "bg-amber-500",
    debug: "bg-red-500",
    conclude: "bg-zinc-400",
  };
  return (
    <div>
      <div className="flex h-2 w-full gap-px overflow-hidden rounded">
        {turns.map((t) => (
          <button
            key={t.stepId}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onJump(t.index);
            }}
            title={`Turn ${t.index + 1} — ${PHASE_LABEL[t.phase]}`}
            className={`min-w-0 flex-1 transition-opacity ${PHASE_BAR[t.phase]} ${
              t.index <= pos ? "opacity-100" : "opacity-25 hover:opacity-60"
            }`}
          />
        ))}
      </div>
      {sections.length > 1 && total >= 8 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {sections
            .filter((s) => s.end - s.start >= 1 || sections.length <= 12)
            .map((s) => (
              <button
                key={`${s.phase}-${s.start}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onJump(s.start);
                }}
                className={`rounded-full border px-2 py-0 text-[10px] font-medium transition-opacity hover:opacity-100 ${PHASE_STYLE[s.phase]} ${
                  pos >= s.start && pos <= s.end ? "opacity-100 ring-1 ring-zinc-500" : "opacity-60"
                }`}
                title={`Jump to turns ${s.start + 1}–${s.end + 1}`}
              >
                {PHASE_LABEL[s.phase]} {s.start + 1}–{s.end + 1}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
