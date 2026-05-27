import { describe, expect, it } from "vitest";

import { ancestorDirs, buildFileTree, type TreeDir } from "./file-tree";

describe("buildFileTree", () => {
  const tree = buildFileTree([
    { path: "task.toml", size: 1 },
    { path: "README.md", size: 2 },
    { path: "tests/test.sh", size: 3 },
    { path: "environment/Dockerfile", size: 4 },
    { path: "environment/files/opt/app.py", size: 5 },
  ]);

  it("lists directories before files, alphabetically", () => {
    expect(tree.map((n) => `${n.type}:${n.name}`)).toEqual([
      "dir:environment",
      "dir:tests",
      "file:README.md",
      "file:task.toml",
    ]);
  });

  it("nests directories and keeps full paths on leaves", () => {
    const env = tree.find((n) => n.name === "environment") as TreeDir;
    const filesDir = env.children.find((n) => n.name === "files") as TreeDir;
    expect(filesDir.path).toBe("environment/files");
    const opt = filesDir.children[0] as TreeDir;
    expect(opt.children[0]).toMatchObject({
      type: "file",
      name: "app.py",
      path: "environment/files/opt/app.py",
    });
  });
});

describe("ancestorDirs", () => {
  it("returns each directory on the path to a file", () => {
    expect(ancestorDirs("environment/files/opt/app.py")).toEqual([
      "environment",
      "environment/files",
      "environment/files/opt",
    ]);
  });

  it("returns [] for a root-level file", () => {
    expect(ancestorDirs("task.toml")).toEqual([]);
  });
});
