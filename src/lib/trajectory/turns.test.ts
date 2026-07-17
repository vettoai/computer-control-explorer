import { describe, expect, it } from "vitest";

import { classifyTurnPhase, parseAtifTurns, phaseSections } from "./turns";

function atif(steps: unknown[]): string {
  return JSON.stringify({
    schema_version: "ATIF-v1.6",
    agent: { name: "terminus-2", model_name: "gemini/gemini-3.5-flash" },
    steps,
  });
}

const agentStep = (over: Record<string, unknown>) => ({ source: "agent", message: "", ...over });

describe("parseAtifTurns", () => {
  it("keeps thought and every tool call together in one turn", () => {
    const raw = atif([
      { source: "user", message: "do the task" },
      agentStep({
        step_id: "s1",
        message: "Analysis: I will look around first.",
        tool_calls: [
          { tool_call_id: "c1", function_name: "bash_command", arguments: { keystrokes: "ls -la" } },
          { tool_call_id: "c2", function_name: "bash_command", arguments: { keystrokes: "cat README.md" } },
        ],
        observation: {
          results: [
            { source_call_id: "c1", content: "file-a\nfile-b" },
            { source_call_id: "c2", content: "# readme" },
          ],
        },
      }),
    ]);
    const { turns, agent } = parseAtifTurns(raw);
    expect(agent?.name).toBe("terminus-2");
    expect(turns).toHaveLength(1);
    expect(turns[0].thought).toBe("I will look around first.");
    expect(turns[0].tools).toHaveLength(2);
    expect(turns[0].tools[0].command).toBe("ls -la");
    expect(turns[0].tools[0].output).toBe("file-a\nfile-b");
    expect(turns[0].tools[1].output).toBe("# readme");
  });

  it("skips non-agent steps and handles thought-only turns", () => {
    const raw = atif([
      { source: "user", message: "task" },
      agentStep({ step_id: "s1", message: "Let me think about the approach." }),
      agentStep({
        step_id: "s2",
        message: "",
        tool_calls: [
          { tool_call_id: "c1", function_name: "bash_command", arguments: { keystrokes: "pytest -x" } },
        ],
        observation: { results: [{ source_call_id: "c1", content: "1 passed\nexit code: 0" }] },
      }),
    ]);
    const { turns } = parseAtifTurns(raw);
    expect(turns).toHaveLength(2);
    expect(turns[0].tools).toHaveLength(0);
    expect(turns[0].thought).toContain("approach");
    expect(turns[1].thought).toBeNull();
  });

  it("marks a failing command from its exit code", () => {
    const raw = atif([
      agentStep({
        step_id: "s1",
        message: "",
        tool_calls: [
          { tool_call_id: "c1", function_name: "bash_command", arguments: { keystrokes: "make build" } },
        ],
        observation: { results: [{ source_call_id: "c1", content: "boom\nexit code: 2" }] },
      }),
    ]);
    const { turns } = parseAtifTurns(raw);
    expect(turns[0].tools[0].status).toBe("failed");
  });
});

describe("classifyTurnPhase", () => {
  const tool = (command: string, status: "completed" | "failed" = "completed") => ({
    id: "t",
    command,
    functionName: "bash_command",
    output: null,
    status,
  });

  it("labels explore / implement / verify / debug / conclude", () => {
    const opts = { prevFailed: false, isLast: false };
    expect(classifyTurnPhase({ index: 1, thought: null, tools: [tool("grep -r foo src/")] }, opts)).toBe("explore");
    expect(classifyTurnPhase({ index: 2, thought: null, tools: [tool("sed -i 's/a/b/' x.py")] }, opts)).toBe("implement");
    expect(classifyTurnPhase({ index: 3, thought: null, tools: [tool("pytest tests/")] }, opts)).toBe("verify");
    expect(
      classifyTurnPhase({ index: 4, thought: null, tools: [tool("cat x.py")] }, { prevFailed: true, isLast: false }),
    ).toBe("debug");
    expect(
      classifyTurnPhase(
        {
          index: 5,
          thought: null,
          tools: [{ id: "t", command: "mark_task_complete", functionName: "mark_task_complete", output: null, status: "completed" }],
        },
        opts,
      ),
    ).toBe("conclude");
  });

  it("thought-only turns plan early and conclude at the end", () => {
    expect(classifyTurnPhase({ index: 0, thought: "plan…", tools: [] }, { prevFailed: false, isLast: false })).toBe("plan");
    expect(classifyTurnPhase({ index: 9, thought: "done…", tools: [] }, { prevFailed: false, isLast: true })).toBe("conclude");
  });

  it("verify outranks debug so a re-test after a failure reads as verifying", () => {
    expect(
      classifyTurnPhase(
        { index: 6, thought: null, tools: [{ id: "t", command: "pytest -q", functionName: "bash_command", output: null, status: "completed" }] },
        { prevFailed: true, isLast: false },
      ),
    ).toBe("verify");
  });
});

describe("phaseSections", () => {
  it("groups contiguous same-phase turns", () => {
    const raw = atif([
      agentStep({ step_id: "a", message: "Plan first." }),
      agentStep({
        step_id: "b",
        message: "",
        tool_calls: [{ tool_call_id: "c", function_name: "bash_command", arguments: { keystrokes: "ls" } }],
        observation: { results: [{ source_call_id: "c", content: "ok" }] },
      }),
      agentStep({
        step_id: "d",
        message: "",
        tool_calls: [{ tool_call_id: "e", function_name: "bash_command", arguments: { keystrokes: "cat f" } }],
        observation: { results: [{ source_call_id: "e", content: "ok" }] },
      }),
    ]);
    const { turns } = parseAtifTurns(raw);
    const sections = phaseSections(turns);
    expect(sections).toEqual([
      { phase: "plan", start: 0, end: 0 },
      { phase: "explore", start: 1, end: 2 },
    ]);
  });
});
