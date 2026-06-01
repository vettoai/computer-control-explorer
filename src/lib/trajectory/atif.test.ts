import { describe, expect, it } from "vitest";

import {
  countAgentTurns,
  parseAtifTrajectory,
  parseStructuredAgentMessage,
  stripNoisyLogLines,
} from "./atif";

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

describe("parseStructuredAgentMessage", () => {
  it("returns null for plain prose (not the structured format)", () => {
    expect(parseStructuredAgentMessage("Analysis: just inspect the repo.")).toBeNull();
    expect(parseStructuredAgentMessage("{ not analysis }")).toBeNull();
  });

  it("extracts analysis + plan from a valid JSON message", () => {
    const msg = JSON.stringify({
      analysis: "The schema collides.",
      plan: "rename the table",
      commands: [{ keystrokes: "ls\n" }],
      task_complete: false,
    });
    expect(parseStructuredAgentMessage(msg)).toBe("The schema collides.\n\nPlan: rename the table");
  });

  it("tolerantly extracts from malformed JSON (literal newlines + LaTeX escapes)", () => {
    // Invalid JSON: a literal newline inside the string and `\alpha`/`\gamma` (bad escapes) —
    // exactly the shape the model emits when its escaping is off.
    const malformed =
      '{\n  "analysis": "Focal loss uses \\alpha and \\gamma.\nSecond line here.",\n' +
      '  "plan": "inspect \\beta then ls",\n' +
      '  "commands": [ { "keystrokes": "ls -la\\n" } ],\n' +
      '  "task_complete": false\n}';
    // sanity: it really is unparseable
    expect(() => JSON.parse(malformed)).toThrow();

    const out = parseStructuredAgentMessage(malformed)!;
    expect(out).not.toBeNull();
    expect(out).not.toContain('"analysis"'); // JSON scaffolding gone
    expect(out).toContain("Focal loss uses \\alpha and \\gamma."); // LaTeX preserved
    expect(out).toContain("\nSecond line here."); // literal newline kept as a real break
    expect(out).toContain("Plan: inspect \\beta then ls");
  });
});

describe("parseAtifTrajectory with a structured JSON message", () => {
  it("renders the analysis text, not the raw JSON blob", () => {
    const traj = JSON.stringify({
      schema_version: "ATIF-v1.6",
      steps: [
        {
          source: "agent",
          // a JSON-object message with no tool_calls (the harness failed to parse it)
          message: '{"analysis": "I will read solution.py first.", "task_complete": false}',
        },
      ],
    });
    const { entries } = parseAtifTrajectory(traj);
    const thinking = entries.find((e) => e.type === "thinking")!;
    expect(thinking.summary).toBe("I will read solution.py first.");
    expect(thinking.summary).not.toContain("{");
  });
});

describe("countAgentTurns", () => {
  it("counts only agent-source steps", () => {
    expect(countAgentTurns(TRAJECTORY)).toBe(2); // 2 agent steps + 1 environment step ignored
  });

  it("returns null for unparseable content or a missing steps array", () => {
    expect(countAgentTurns("not json")).toBeNull();
    expect(countAgentTurns(JSON.stringify({ schema_version: "x" }))).toBeNull();
  });
});

describe("stripNoisyLogLines", () => {
  it("drops known stderr noise outside development", () => {
    const text = "real line\nFailed to retrieve model info for foo\nkeep me";
    expect(stripNoisyLogLines(text)).toBe("real line\nkeep me");
  });
});
