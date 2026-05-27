import path from "node:path";

import { describe, expect, it } from "vitest";

import { getDatasetInfo, getTask, listCategories, listTasks } from "./loader";

const FIXTURE = path.join(import.meta.dirname, "__fixtures__/mini");

describe("listTasks", () => {
  it("lists task dirs (with task.toml), sorted, skipping non-task dirs", async () => {
    const tasks = await listTasks(FIXTURE);
    expect(tasks.map((t) => t.slug)).toEqual(["alpha-task", "beta-task"]);
  });

  it("parses metadata from task.toml", async () => {
    const [alpha] = await listTasks(FIXTURE);
    expect(alpha).toMatchObject({
      slug: "alpha-task",
      name: "vettoai/alpha-task",
      title: "Alpha Task Title",
      category: "Data Querying",
      tags: ["sql", "duckdb"],
      difficulty: "hard",
    });
  });

  it("returns [] when the dataset dir has no dataset/ folder", async () => {
    expect(await listTasks(path.join(FIXTURE, "nope"))).toEqual([]);
  });
});

describe("getDatasetInfo", () => {
  it("reads name (org stripped) + description from dataset/dataset.toml", async () => {
    expect(await getDatasetInfo(FIXTURE)).toEqual({
      name: "mini-fixture-dataset",
      description: "A tiny fixture dataset for tests.",
    });
  });

  it("returns null when there is no dataset.toml", async () => {
    expect(await getDatasetInfo(path.join(FIXTURE, "nope"))).toBeNull();
  });
});

describe("listCategories", () => {
  it("returns distinct categories, sorted", async () => {
    expect(await listCategories(FIXTURE)).toEqual(["Data Querying", "Debugging"]);
  });
});

describe("getTask", () => {
  it("returns metadata + the file tree with text content", async () => {
    const task = await getTask("alpha-task", FIXTURE);
    expect(task).not.toBeNull();
    expect(task!.category).toBe("Data Querying");
    expect(task!.files.map((f) => f.path)).toEqual([
      "instruction.md",
      "task.toml",
      "tests/test.sh",
    ]);
    const instruction = task!.files.find((f) => f.path === "instruction.md");
    expect(instruction!.content).toContain("revenue rollup");
    // full toml is available for the metadata panel
    expect((task!.toml.environment as Record<string, unknown>).allow_internet).toBe(false);
  });

  it("returns null for a missing task", async () => {
    expect(await getTask("does-not-exist", FIXTURE)).toBeNull();
  });

  it("returns null for a non-task directory", async () => {
    expect(await getTask("not-a-task", FIXTURE)).toBeNull();
  });

  it("rejects path-traversal slugs", async () => {
    expect(await getTask("../alpha-task", FIXTURE)).toBeNull();
    expect(await getTask("a/b", FIXTURE)).toBeNull();
  });
});
