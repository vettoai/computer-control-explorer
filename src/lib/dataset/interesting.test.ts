import { describe, expect, it } from "vitest";

import { parseFailedTests, pickReviewTrials, type ReviewCandidate } from "./interesting";

let seq = 0;
function cand(over: Partial<ReviewCandidate>): ReviewCandidate {
  seq++;
  return {
    id: `id-${seq}`,
    slug: "some-task",
    taskName: "vettoai/some-task",
    taskChecksum: "abc",
    agent: "terminus-2",
    model: "openai/gpt-5.5",
    isOracle: false,
    reward: 0,
    passed: false,
    error: null,
    startedAt: null,
    finishedAt: null,
    durationSec: null,
    jobLabel: "job",
    relPath: `p/${seq}`,
    turns: 20,
    failedTests: [],
    ...over,
  };
}

describe("pickReviewTrials", () => {
  it("always includes passed-despite-error trials, flagged as suspicious", () => {
    const suspicious = cand({ passed: true, reward: 1, error: { type: "AgentTimeoutError", message: "" } });
    const picks = pickReviewTrials([
      suspicious,
      cand({ failedTests: ["test_a"] }),
      cand({ failedTests: ["test_a"] }),
      cand({ failedTests: ["test_b"] }),
      cand({ passed: true, reward: 1 }),
      cand({ failedTests: ["test_a"] }),
    ]);
    const pick = picks.find((p) => p.trial.id === suspicious.id);
    expect(pick).toBeDefined();
    expect(pick!.reasons.join(" ")).toMatch(/despite AgentTimeoutError/);
  });

  it("includes at least one passing trial when any pass exists", () => {
    const trials = [
      cand({ passed: true, reward: 1 }),
      ...Array.from({ length: 9 }, (_, i) => cand({ failedTests: [`test_${i % 3}`], turns: 10 + i })),
    ];
    const picks = pickReviewTrials(trials);
    expect(picks.some((p) => p.trial.passed)).toBe(true);
  });

  it("spreads picks across configs and failure signatures", () => {
    const trials = [
      cand({ model: "openai/gpt-5.5", failedTests: ["test_a"], turns: 10 }),
      cand({ model: "openai/gpt-5.5", failedTests: ["test_a"], turns: 11 }),
      cand({ model: "openai/gpt-5.5", failedTests: ["test_a"], turns: 12 }),
      cand({ model: "anthropic/claude-opus-4-8", agent: "claude-code", failedTests: ["test_b"], turns: 45 }),
      cand({ model: "gemini/gemini-3.5-flash", failedTests: ["test_c"], turns: 7 }),
    ];
    const picks = pickReviewTrials(trials, 3);
    const models = new Set(picks.map((p) => p.trial.model));
    expect(models.size).toBeGreaterThanOrEqual(2);
    const sigs = new Set(picks.map((p) => p.trial.failedTests.join(",")));
    expect(sigs.size).toBeGreaterThanOrEqual(2);
  });

  it("excludes oracle trials and caps at count", () => {
    const trials = [
      cand({ isOracle: true, agent: "oracle", passed: true, reward: 1 }),
      ...Array.from({ length: 10 }, (_, i) => cand({ turns: i })),
    ];
    const picks = pickReviewTrials(trials, 5);
    expect(picks).toHaveLength(5);
    expect(picks.every((p) => !p.trial.isOracle)).toBe(true);
  });

  it("returns empty for no candidates", () => {
    expect(pickReviewTrials([])).toEqual([]);
  });
});

describe("parseFailedTests", () => {
  it("parses pytest summary and progress lines, deduplicated", () => {
    const out = [
      "tests/test_outputs.py::test_alpha FAILED",
      "FAILED tests/test_outputs.py::test_alpha - AssertionError: boom",
      "FAILED tests/test_outputs.py::test_beta[case-1] - ValueError",
      "ERROR tests/test_outputs.py::test_gamma",
      "tests/test_outputs.py::test_ok PASSED",
    ].join("\n");
    expect(parseFailedTests(out).sort()).toEqual(["test_alpha", "test_beta[case-1]", "test_gamma"]);
  });

  it("returns empty for null or passing output", () => {
    expect(parseFailedTests(null)).toEqual([]);
    expect(parseFailedTests("5 passed in 1.2s")).toEqual([]);
  });
});
