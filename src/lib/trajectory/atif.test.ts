import { describe, expect, it } from "vitest";

import { parseAtifTrajectory, stripNoisyLogLines } from "./atif";

const TRAJECTORY = JSON.stringify({
  schema_version: "ATIF-v1.6",
  agent: { name: "terminus-2", model_name: "litellm_proxy/vertex_ai/gemini-3.5-flash" },
  steps: [
    {
      source: "agent",
      message: "Analysis: inspect the schema.",
      tool_calls: [
        { tool_call_id: "t1", function_name: "bash", arguments: { keystrokes: "ls -la" } },
      ],
      observation: { results: [{ source_call_id: "t1", content: "files\nProcess exited with code 0" }] },
    },
    {
      source: "agent",
      message: "boom",
      tool_calls: [
        { tool_call_id: "t2", function_name: "bash", arguments: { keystrokes: "false" } },
      ],
      observation: { results: [{ source_call_id: "t2", content: "exit code: 1" }] },
    },
    { source: "environment", message: "ignored — not an agent step", tool_calls: [] },
  ],
  final_metrics: { n_episodes: 2 },
});

describe("parseAtifTrajectory", () => {
  it("extracts agent identity and skips non-agent steps", () => {
    const parsed = parseAtifTrajectory(TRAJECTORY);
    expect(parsed.agent).toEqual({
      name: "terminus-2",
      model: "litellm_proxy/vertex_ai/gemini-3.5-flash",
    });
    expect(parsed.metrics).toEqual({ n_episodes: 2 });
  });

  it("splits thinking from commands and derives exit status", () => {
    const { entries } = parseAtifTrajectory(TRAJECTORY);
    const thinking = entries.filter((e) => e.type === "thinking");
    const commands = entries.filter((e) => e.type === "command");
    expect(thinking[0].summary).toBe("inspect the schema."); // "Analysis: " stripped
    expect(commands[0]).toMatchObject({ summary: "ls -la", status: "completed" });
    expect(commands[1]).toMatchObject({ summary: "false", status: "failed" });
  });
});

describe("stripNoisyLogLines", () => {
  it("drops known stderr noise outside development", () => {
    const text = "real line\nFailed to retrieve model info for foo\nkeep me";
    expect(stripNoisyLogLines(text)).toBe("real line\nkeep me");
  });
});
