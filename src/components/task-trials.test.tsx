import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ModelStat, TrialWithTurns } from "@/lib/dataset/trial-types";

import { TaskTrials } from "./task-trials";

// next/link just wraps an <a> for our purposes — render its children with the href.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    <a href={href} {...rest}>{children}</a>,
}));

function mkTrial(over: Partial<TrialWithTurns>): TrialWithTurns {
  return {
    id: "x", slug: "t", taskName: "t", taskChecksum: "CHK", agent: "terminus-2",
    model: "litellm_proxy/vertex_ai/gemini-3.5-flash", isOracle: false, reward: 0,
    passed: false, error: null, startedAt: null, finishedAt: null, durationSec: null,
    jobLabel: "run", relPath: "p", turns: null, ...over,
  };
}

function mkStat(over: Partial<ModelStat>): ModelStat {
  return {
    model: "m", modelLabel: "gemini", checksum: "CHK", jobLabel: "run", trials: 2,
    passes: 0, passRate: 0, meanReward: 0, avgTurns: null, maxTurns: null, errors: 0, ...over,
  };
}

describe("TaskTrials error surfacing", () => {
  it("shows the error type (amber) on an errored trial row instead of a bare reward", () => {
    const html = renderToStaticMarkup(
      <TaskTrials
        slug="t"
        trials={[
          mkTrial({ id: "a", error: { type: "AgentTimeoutError", message: "timed out" } }),
          mkTrial({ id: "b", reward: 1, passed: true }),
        ]}
        stats={[]}
      />,
    );
    expect(html).toContain("AgentTimeoutError"); // shown in place of "reward 0"
    expect(html).toContain("text-amber-400"); // amber-tinted label + dot
    expect(html).toContain("bg-amber-500"); // outcome dot
    expect(html).not.toContain("reward 0"); // errored row no longer reads as a plain fail
  });

  it("renders an Errors column counting errored trials in the stats table", () => {
    const html = renderToStaticMarkup(
      <TaskTrials slug="t" trials={[mkTrial({})]} stats={[mkStat({ errors: 3 })]} />,
    );
    expect(html).toContain("Errors");
    // the count is amber when > 0
    expect(html).toMatch(/text-amber-[46]00[^>]*>3</);
  });
});
