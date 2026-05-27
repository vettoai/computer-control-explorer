import { describe, expect, it } from "vitest";

import { languageForFilename } from "./code-block";

describe("languageForFilename", () => {
  it("maps by extension", () => {
    expect(languageForFilename("solution/solve.sh")).toBe("bash");
    expect(languageForFilename("environment/files/opt/app.py")).toBe("python");
    expect(languageForFilename("task.toml")).toBe("ini");
    expect(languageForFilename("src/main.rs")).toBe("rust");
  });

  it("maps by exact filename", () => {
    expect(languageForFilename("environment/Dockerfile")).toBe("dockerfile");
    expect(languageForFilename("Makefile")).toBe("makefile");
  });

  it("returns null for unknown / plain-text files", () => {
    expect(languageForFilename("data.csv")).toBeNull();
    expect(languageForFilename("notes")).toBeNull();
    expect(languageForFilename("output.log")).toBeNull();
  });
});
