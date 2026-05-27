import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getTaskTrials,
  getTrial,
  listTrials,
  modelLabel,
  taskTrialStats,
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
