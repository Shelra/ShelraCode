import type { ModelMessage } from "ai";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan, ToolResult } from "../types/index";
import { closeDatabase } from "./db";
import { SessionStore } from "./sessions";
import { appendCompaction, appendMessages, buildChatEntries, loadPersistedPlanState } from "./transcript";

const originalHome = process.env.HOME;

describe("durable executable plan state", () => {
  const tempRoot = path.join(process.cwd(), ".tmp-plan-state-tests");
  let tempHome = "";
  let tempCwd = "";

  beforeEach(() => {
    fs.mkdirSync(tempRoot, { recursive: true });
    tempHome = fs.mkdtempSync(path.join(tempRoot, "shelra-memory-home-"));
    tempCwd = fs.mkdtempSync(path.join(tempRoot, "shelra-memory-cwd-"));
    process.env.HOME = tempHome;
    vi.spyOn(os, "homedir").mockReturnValue(tempHome);
    closeDatabase();
  });

  afterEach(() => {
    closeDatabase();
    vi.restoreAllMocks();
    process.env.HOME = originalHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(tempCwd, { recursive: true, force: true });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("survives transcript compaction and a SQLite close/reopen cycle", () => {
    const session = new SessionStore(tempCwd).createSession("test-model", "agent", tempCwd);
    const plan: Plan = {
      title: "Persistent memory",
      summary: "Keep structured intent after restart",
      goal: "Resume coherently",
      acceptanceCriteria: [
        { id: "AC1", description: "Chat survives restart", verification: "restart integration test" },
        { id: "AC2", description: "Plan progress survives", verification: "inspect restored step" },
      ],
      steps: [
        { title: "Persist", description: "Write the checkpoint", satisfies: ["AC1"] },
        { title: "Resume", description: "Reload it", satisfies: ["AC2"] },
      ],
    };

    appendMessages(session.id, [
      assistantToolCall("plan-1", "generate_plan"),
      toolResult("plan-1", "generate_plan", { success: true, output: "Plan", plan }),
      assistantToolCall("update-1", "update_plan_step"),
      toolResult("update-1", "update_plan_step", {
        success: true,
        output: "Step complete",
        planUpdate: { index: 0, status: "complete", evidence: "saved in SQLite" },
      }),
      { role: "user", content: "Continue after compaction" },
    ]);
    appendCompaction(session.id, 5, "Earlier execution summarized", 8_000);

    expect(buildChatEntries(session.id).some((entry) => entry.toolResult?.plan)).toBe(false);
    expect(loadPersistedPlanState(session.id)?.steps[0]).toMatchObject({
      status: "complete",
      evidence: "saved in SQLite",
    });

    closeDatabase();

    const restored = loadPersistedPlanState(session.id);
    expect(restored?.acceptanceCriteria).toEqual(plan.acceptanceCriteria);
    expect(restored?.steps).toMatchObject([
      { title: "Persist", status: "complete", evidence: "saved in SQLite" },
      { title: "Resume", status: "pending" },
    ]);
  });
});

function assistantToolCall(toolCallId: string, toolName: string): ModelMessage {
  return {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId, toolName, input: {} }],
  } as unknown as ModelMessage;
}

function toolResult(toolCallId: string, toolName: string, output: ToolResult): ModelMessage {
  return {
    role: "tool",
    content: [{ type: "tool-result", toolCallId, toolName, output }],
  } as unknown as ModelMessage;
}
