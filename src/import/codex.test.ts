import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listCodexFiles, readCodexChat, readCodexListing, readCodexTitles } from "./codex";

const ID = "01a0a31b-4ad3-7431-a80d-7c381b80405f";
const CWD = "/work/api";

function rollout(meta: Record<string, unknown>): string {
  let minute = 0;
  const line = (type: string, payload: Record<string, unknown>) =>
    JSON.stringify({ timestamp: new Date(Date.UTC(2026, 8, 15, 3, minute++)).toISOString(), type, payload });
  const message = (role: string, type: string, ...texts: string[]) =>
    line("response_item", { type: "message", role, content: texts.map((text) => ({ type, text })) });
  return [
    line("session_meta", { id: ID, timestamp: "2026-09-15T03:00:00Z", cwd: CWD, originator: "codex-tui", ...meta }),
    message("developer", "input_text", "<permissions instructions>…"),
    message(
      "user",
      "input_text",
      "# AGENTS.md instructions for /work/api\n…",
      "<environment_context>\n  <cwd>/work/api</cwd>",
    ),
    line("turn_context", { model: "gpt-5.6-luna", cwd: CWD }),
    message("user", "input_text", "Fix the login endpoint"),
    line("response_item", { type: "reasoning", summary: [], encrypted_content: "…" }),
    line("response_item", {
      type: "function_call",
      name: "exec_command",
      arguments: JSON.stringify({ cmd: "npm test", workdir: CWD }),
      call_id: "c1",
    }),
    line("response_item", { type: "function_call_output", call_id: "c1", output: "1 failing" }),
    line("response_item", {
      type: "custom_tool_call",
      name: "apply_patch",
      input:
        "*** Begin Patch\n*** Update File: src/login.ts\n@@\n-a\n+b\n*** Add File: src/login.test.ts\n+x\n*** End Patch",
      call_id: "c2",
    }),
    line("response_item", { type: "custom_tool_call_output", call_id: "c2", output: "Done" }),
    // Code mode: a script that calls the tools, the patch inside a string literal.
    line("response_item", {
      type: "custom_tool_call",
      name: "exec",
      input: [
        "const calls = [",
        '  tools.exec_command({ cmd: "git status --short\\ngit diff --stat", workdir: "D:\\\\work\\\\api" }),',
        '  tools.apply_patch("*** Begin Patch\\n*** Update File: src\\\\session.ts\\n@@\\n-a\\n+b\\n*** End Patch"),',
        "];",
      ].join("\n"),
      call_id: "c3",
    }),
    line("response_item", {
      type: "custom_tool_call",
      name: "exec",
      input: "const r = await tools.view_image({})",
      call_id: "c4",
    }),
    message("assistant", "output_text", "The endpoint now checks the token."),
    line("compacted", { message: "summary", replacement_history: [] }),
    message("user", "input_text", "<turn_aborted>\nThe user interrupted…"),
    line("response_item", {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "<image name=[Image #1]>" },
        { type: "input_image", image_url: "data:…" },
        { type: "input_text", text: "</image>" },
        { type: "input_text", text: "And this screen?" },
      ],
    }),
  ].join("\n");
}

describe("Codex's saved chats", () => {
  let root = "";
  let file = "";
  let subAgent = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "shelra-codex-import-"));
    const day = path.join(root, "sessions", "2026", "09", "15");
    fs.mkdirSync(day, { recursive: true });
    file = path.join(day, `rollout-2026-09-15T03-00-00-${ID}.jsonl`);
    fs.writeFileSync(file, rollout({ source: "cli", thread_source: "user" }));
    subAgent = path.join(day, "rollout-2026-09-15T03-05-00-01a0a31b-0000-7000-8000-000000000001.jsonl");
    fs.writeFileSync(
      subAgent,
      rollout({
        id: "sub",
        source: { subagent: { thread_spawn: { parent_thread_id: ID } } },
        thread_source: "subagent",
      }),
    );
    fs.writeFileSync(
      path.join(root, "session_index.jsonl"),
      [
        JSON.stringify({ id: ID, thread_name: "Fix the login", updated_at: "2026-09-15T03:10:00Z" }),
        JSON.stringify({ id: ID, thread_name: "Login endpoint", updated_at: "2026-09-15T03:20:00Z" }),
      ].join("\n"),
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("lists the user's chats by the name Codex shows, not its sub-agents'", () => {
    const titles = readCodexTitles(root);
    expect(listCodexFiles(root)).toHaveLength(2);

    expect(readCodexListing(file, titles)).toMatchObject({
      source: "codex",
      sourceId: ID,
      title: "Login endpoint",
      firstRequest: "Fix the login endpoint",
      cwd: CWD,
      model: "gpt-5.6-luna",
    });
    expect(readCodexListing(subAgent, titles)).toBeNull();
  });

  it("reads the requests and replies without Codex's own context, and names what its tools changed and ran", async () => {
    const chat = await readCodexChat(file, readCodexTitles(root));

    expect(chat.title).toBe("Login endpoint");
    expect(chat.createdAt.toISOString()).toBe("2026-09-15T03:00:00.000Z");
    expect(
      chat.events.map((event) =>
        event.kind === "tool"
          ? { kind: "tool", changed: event.changed, command: event.command }
          : { kind: event.kind, text: event.text },
      ),
    ).toEqual([
      { kind: "user", text: "Fix the login endpoint" },
      { kind: "tool", changed: undefined, command: "npm test" },
      { kind: "tool", changed: ["src/login.ts", "src/login.test.ts"], command: undefined },
      { kind: "tool", changed: undefined, command: "git status --short\ngit diff --stat" },
      { kind: "tool", changed: ["src\\session.ts"], command: undefined },
      { kind: "tool", changed: undefined, command: undefined },
      { kind: "assistant", text: "The endpoint now checks the token." },
      { kind: "user", text: "[Image]\nAnd this screen?" },
    ]);
  });
});
