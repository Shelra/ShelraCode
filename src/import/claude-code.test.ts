import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeCodeFolderName, listClaudeCodeFiles, readClaudeCodeChat, readClaudeCodeListing } from "./claude-code";

const SESSION = "9c1f2e3d-0000-4000-8000-00000000abcd";
const CWD = "/work/kart";

/** A Claude Code chat file as it writes one: a record per line, each turn's blocks in records of their own. */
function chatLines(): string[] {
  let n = 0;
  const base = (type: string, extra: Record<string, unknown>) => ({
    type,
    uuid: `u-${++n}`,
    parentUuid: n > 1 ? `u-${n - 1}` : null,
    isSidechain: false,
    sessionId: SESSION,
    cwd: CWD,
    timestamp: new Date(Date.UTC(2026, 8, 20, 10, n)).toISOString(),
    ...extra,
  });
  const records = [
    { type: "permission-mode", permissionMode: "default", sessionId: SESSION },
    base("user", {
      isMeta: true,
      message: { role: "user", content: "<local-command-caveat>Caveat: the messages below…</local-command-caveat>" },
    }),
    base("user", { message: { role: "user", content: "<command-name>/model</command-name>" } }),
    base("user", {
      message: {
        role: "user",
        content: [
          { type: "text", text: "<system-reminder>Today's date is 2026-09-20.</system-reminder>\nBuild the kart game" },
        ],
      },
    }),
    base("assistant", {
      message: { model: "claude-sonnet-5", role: "assistant", content: [{ type: "thinking", thinking: "Plan it" }] },
    }),
    base("assistant", {
      message: {
        model: "claude-sonnet-5",
        role: "assistant",
        content: [{ type: "text", text: "Starting with the track." }],
      },
    }),
    base("assistant", {
      message: {
        model: "claude-sonnet-5",
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "Write", input: { file_path: "/work/kart/src/track.ts", content: "…" } },
        ],
      },
    }),
    base("user", {
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "File written" }] },
      toolUseResult: {},
    }),
    base("attachment", { attachment: { type: "queued_command", prompt: "make it red", commandMode: "prompt" } }),
    base("attachment", {
      attachment: {
        type: "queued_command",
        prompt: "<task-notification>done</task-notification>",
        commandMode: "task-notification",
      },
    }),
    base("assistant", {
      message: {
        model: "claude-sonnet-5",
        role: "assistant",
        content: [
          { type: "tool_use", id: "t2", name: "Bash", input: { command: "bun test", description: "Run tests" } },
        ],
      },
    }),
    base("assistant", {
      isSidechain: true,
      message: {
        model: "claude-haiku-4-5",
        role: "assistant",
        content: [{ type: "text", text: "A sub-agent's words" }],
      },
    }),
    base("assistant", {
      isApiErrorMessage: true,
      message: { model: "<synthetic>", role: "assistant", content: [{ type: "text", text: "API Error: 529" }] },
    }),
    base("assistant", {
      message: {
        model: "claude-sonnet-5",
        role: "assistant",
        content: [{ type: "text", text: "The track is red and tested." }],
      },
    }),
    { type: "ai-title", aiTitle: "Kart game with a track", sessionId: SESSION },
    base("user", {
      isCompactSummary: true,
      message: { role: "user", content: "This session is being continued from…" },
    }),
    base("user", {
      message: {
        role: "user",
        content: [
          { type: "text", text: "Add a boss level" },
          { type: "image", source: {} },
        ],
      },
    }),
    { type: "custom-title", customTitle: "Kart racer", sessionId: SESSION },
    { type: "last-prompt", lastPrompt: "Add a boss level", sessionId: SESSION },
  ];
  return records.map((record) => JSON.stringify(record));
}

describe("Claude Code's saved chats", () => {
  let root = "";
  let file = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "shelra-claude-import-"));
    const folder = path.join(root, claudeCodeFolderName(CWD));
    fs.mkdirSync(path.join(folder, SESSION, "subagents"), { recursive: true });
    file = path.join(folder, `${SESSION}.jsonl`);
    fs.writeFileSync(file, `${chatLines().join("\n")}\n`);
    fs.writeFileSync(path.join(folder, SESSION, "subagents", "agent-1.jsonl"), `${chatLines()[3]}\n`);
    fs.mkdirSync(path.join(root, claudeCodeFolderName("/work/other")));
    fs.writeFileSync(path.join(root, claudeCodeFolderName("/work/other"), "other.jsonl"), "");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("lists a folder's chats, not its sub-agents' or another folder's", () => {
    expect(claudeCodeFolderName("D:\\PROYECTS\\shelra")).toBe("D--PROYECTS-shelra");
    expect(listClaudeCodeFiles(root, CWD)).toEqual([file]);
    expect(listClaudeCodeFiles(root)).toHaveLength(2);
  });

  it("names a chat by its title, first request, folder and model from its start and end", () => {
    const listing = readClaudeCodeListing(file);

    expect(listing).toMatchObject({
      source: "claude-code",
      sourceId: SESSION,
      title: "Kart racer",
      firstRequest: "Build the kart game",
      cwd: CWD,
      model: "claude-sonnet-5",
    });
    expect(readClaudeCodeListing(path.join(root, claudeCodeFolderName("/work/other"), "other.jsonl"))).toBeNull();
  });

  it("reads the conversation without Claude Code's own notes, sub-agents or errors", async () => {
    const chat = await readClaudeCodeChat(file);

    expect(chat.title).toBe("Kart racer");
    expect(
      chat.events.map((event) =>
        event.kind === "tool"
          ? { kind: "tool", changed: event.changed, command: event.command }
          : { kind: event.kind, text: event.text },
      ),
    ).toEqual([
      { kind: "user", text: "Build the kart game" },
      { kind: "assistant", text: "Starting with the track." },
      { kind: "tool", changed: ["/work/kart/src/track.ts"], command: undefined },
      { kind: "user", text: "make it red" },
      { kind: "tool", changed: undefined, command: "bun test" },
      { kind: "assistant", text: "The track is red and tested." },
      { kind: "user", text: "Add a boss level\n[Image]" },
    ]);
  });
});
