import path from "node:path";

import { describe, expect, it } from "vitest";

import { hintVariant, taskHintStats } from "./trial-types";
import {
  getTaskTrials,
  getTrial,
  globalRunStats,
  listTrials,
  modelLabel,
  taskTrialStats,
  type Trial,
} from "./trials";

const FIXTURE = path.join(import.meta.dirname, "__fixtures__/mini");

describe("listTrials", () => {
  it("finds every trial across nested jobs and skips aggregate result.json", async () => {
    const trials = await listTrials(FIXTURE);
    // 3 alpha (pass, fail, oracle) + 1 beta; the model-run aggregate is not a trial.
    expect(trials).toHaveLength(4);
    expect(new Set(trials.map((t) => t.slug))).toEqual(new Set(["alpha-task", "beta-task"]));
  });

  it("returns [] when there is no out/jobs", async () => {
    expect(await listTrials(path.join(FIXTURE, "nope"))).toEqual([]);
  });
});

describe("getTaskTrials", () => {
  it("returns a task's trials with parsed identity, reward, and oracle flag", async () => {
    const trials = await getTaskTrials("alpha-task", FIXTURE);
    expect(trials).toHaveLength(3);

    const pass = trials.find((t) => t.reward === 1 && !t.isOracle)!;
    expect(pass.passed).toBe(true);
    expect(pass.model).toBe("litellm_proxy/vertex_ai/gemini-3.5-flash");
    expect(pass.taskChecksum).toBe("CHK1");
    expect(pass.durationSec).toBe(300);

    const fail = trials.find((t) => t.reward === 0)!;
    expect(fail.passed).toBe(false);

    const oracle = trials.find((t) => t.isOracle)!;
    expect(oracle.agent).toBe("oracle");
    expect(oracle.model).toBeNull();
  });
});

describe("taskTrialStats", () => {
  it("groups non-oracle trials by model × checksum", async () => {
    const stats = taskTrialStats(await getTaskTrials("alpha-task", FIXTURE));
    expect(stats).toHaveLength(1); // oracle excluded → one (model, CHK1) group
    expect(stats[0]).toMatchObject({
      modelLabel: "gemini-3.5-flash",
      checksum: "CHK1",
      jobLabel: "testjob",
      trials: 2,
      passes: 1,
      passRate: 0.5,
      meanReward: 0.5,
    });
  });
});

describe("getTrial", () => {
  it("loads parsed + raw trajectory and test output", async () => {
    const [trial] = await getTaskTrials("alpha-task", FIXTURE);
    const detail = (await getTrial("alpha-task", trial.id, FIXTURE))!;
    expect(detail).not.toBeNull();
    expect(detail.trajectory).not.toBeNull();
    expect(detail.trajectory!.entries.length).toBeGreaterThan(0);
    expect(detail.trajectory!.entries.some((e) => e.summary.includes("duckdb"))).toBe(true);
    expect(detail.rawTrajectory).toContain("ATIF-v1.6");
  });

  it("loads the oracle solve output (agent/oracle.txt)", async () => {
    const oracle = (await getTaskTrials("alpha-task", FIXTURE)).find((t) => t.isOracle)!;
    const detail = (await getTrial("alpha-task", oracle.id, FIXTURE))!;
    expect(detail.solveOutput).toContain("solve complete");
  });

  it("returns null for an unknown trial id", async () => {
    expect(await getTrial("alpha-task", "deadbeef", FIXTURE)).toBeNull();
  });
});

describe("modelLabel", () => {
  it("keeps the final path segment", () => {
    expect(modelLabel("litellm_proxy/vertex_ai/gemini-3.5-flash")).toBe("gemini-3.5-flash");
    expect(modelLabel(null)).toBe("unknown");
  });
});

function mkTrial(over: Partial<Trial>): Trial {
  return {
    id: Math.random().toString(36).slice(2),
    slug: "t",
    taskName: "t",
    taskChecksum: "CHK",
    agent: "terminus-2",
    model: "litellm_proxy/vertex_ai/gemini-3.5-flash",
    isOracle: false,
    reward: 0,
    passed: false,
    startedAt: null,
    finishedAt: null,
    durationSec: null,
    jobLabel: "run",
    relPath: "p",
    ...over,
  };
}

describe("globalRunStats", () => {
  it("aggregates across tasks per run, counts distinct tasks/solved, includes oracle last", () => {
    const trials: Trial[] = [
      mkTrial({ slug: "a", reward: 1, passed: true, jobLabel: "gemini-nohints" }),
      mkTrial({ slug: "b", reward: 0, passed: false, jobLabel: "gemini-nohints" }),
      mkTrial({ slug: "a", reward: 1, passed: true, jobLabel: "gemini-nohints" }), // re-trial of a
      mkTrial({
        slug: "a",
        reward: 1,
        passed: true,
        jobLabel: "oracle",
        agent: "oracle",
        model: null,
        isOracle: true,
      }),
    ];
    const stats = globalRunStats(trials);
    expect(stats).toHaveLength(2); // one gemini run + one oracle run

    const gem = stats.find((s) => s.jobLabel === "gemini-nohints")!;
    expect(gem).toMatchObject({
      agent: "terminus-2",
      modelLabel: "gemini-3.5-flash",
      isOracle: false,
      tasks: 2, // a, b
      trials: 3,
      passes: 2,
      tasksSolved: 1, // only a ever passed
    });
    expect(gem.passRate).toBeCloseTo(2 / 3);
    expect(gem.meanReward).toBeCloseTo((1 + 0 + 1) / 3);

    // oracle is included and sorted to the bottom (reference ceiling)
    expect(stats[stats.length - 1]).toMatchObject({ jobLabel: "oracle", isOracle: true, tasks: 1 });
  });
});

describe("hintVariant", () => {
  it("reads the variant from the job-folder name, with negation winning over bare 'hint'", () => {
    expect(hintVariant("gemini-with-hints")).toBe("with");
    expect(hintVariant("gemini-hints")).toBe("with");
    expect(hintVariant("Hinted-Run")).toBe("with");
    expect(hintVariant("gemini-no-hints")).toBe("without");
    expect(hintVariant("gemini-nohints")).toBe("without");
    expect(hintVariant("no_hint_baseline")).toBe("without");
    expect(hintVariant("hint-free")).toBe("without");
    expect(hintVariant("testjob")).toBeNull();
    expect(hintVariant("oracle")).toBeNull();
  });
});

describe("taskHintStats", () => {
  it("splits per-task pass rate by hint variant, ignoring unlabelled runs and oracle", () => {
    const trials: Trial[] = [
      mkTrial({ slug: "alpha", jobLabel: "gemini-with-hints", reward: 1, passed: true }),
      mkTrial({ slug: "alpha", jobLabel: "gemini-with-hints", reward: 1, passed: true }),
      mkTrial({ slug: "alpha", jobLabel: "gemini-with-hints", reward: 0, passed: false }),
      mkTrial({ slug: "alpha", jobLabel: "gemini-no-hints", reward: 0, passed: false }),
      mkTrial({ slug: "alpha", jobLabel: "gemini-no-hints", reward: 0, passed: false }),
      mkTrial({ slug: "alpha", jobLabel: "testjob", reward: 1, passed: true }), // no marker → ignored
      mkTrial({
        slug: "alpha",
        jobLabel: "with-hints",
        reward: 1,
        passed: true,
        isOracle: true,
        agent: "oracle",
      }), // oracle → excluded
      mkTrial({ slug: "beta", jobLabel: "no-hints", reward: 1, passed: true }),
    ];
    const stats = taskHintStats(trials);

    expect(stats.alpha.withHints).toMatchObject({ trials: 3, passes: 2 });
    expect(stats.alpha.withHints!.passRate).toBeCloseTo(2 / 3);
    expect(stats.alpha.withoutHints).toEqual({ trials: 2, passes: 0, passRate: 0 });
    expect(stats.beta.withHints).toBeNull();
    expect(stats.beta.withoutHints).toEqual({ trials: 1, passes: 1, passRate: 1 });
  });

  it("omits tasks that have no hint-labelled trials", () => {
    const stats = taskHintStats([mkTrial({ slug: "x", jobLabel: "testjob" })]);
    expect(stats.x).toBeUndefined();
  });
});
