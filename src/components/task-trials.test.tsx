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
  it("shows an additional amber error chip alongside (not in place of) the reward", () => {
    const html = renderToStaticMarkup(
      <TaskTrials
        slug="t"
        trials={[
          mkTrial({ id: "a", reward: 0, error: { type: "AgentTimeoutError", message: "timed out" } }),
          mkTrial({ id: "b", reward: 1, passed: true }),
        ]}
        stats={[]}
      />,
    );
    expect(html).toContain("reward 0"); // reward verdict still shown — the error is extra
    expect(html).toContain("AgentTimeoutError"); // the additional error chip
    expect(html).toContain("bg-amber-100"); // amber chip styling
    expect(html).toContain("bg-red-500"); // failed dot stays red, not recolored by the error
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
