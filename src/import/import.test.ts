import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Agent } from "../agent/agent";
import { FakeProvider } from "../providers/fake";
import type { ProviderStream, ProviderStreamRequest } from "../providers/types";
import { closeDatabase } from "../storage/db";
import { buildChatEntries, loadTranscriptState, SessionStore } from "../storage/index";
import { claudeCodeFolderName } from "./claude-code";
import { importForeignChat, listForeignChats } from "./index";

// Run with `bun test`: the session store is `bun:sqlite`.

const SESSION = "4f200c79-cb1a-4879-a1f6-c51eea1d6473";

class RecordingProvider extends FakeProvider {
  readonly requests: ProviderStreamRequest[] = [];
  override stream(request: ProviderStreamRequest): ProviderStream {
    this.requests.push(request);
    return super.stream(request);
  }
}

function claudeChat(cwd: string): string {
  let n = 0;
  const record = (type: string, message: Record<string, unknown>) =>
    JSON.stringify({
      type,
      uuid: `u-${++n}`,
      isSidechain: false,
      sessionId: SESSION,
      cwd,
      timestamp: new Date(Date.UTC(2026, 8, 12, 9, n)).toISOString(),
      message,
    });
  return [
    record("user", { role: "user", content: "Build the kart game" }),
    record("assistant", {
      model: "claude-sonnet-5",
      role: "assistant",
      content: [{ type: "text", text: "Starting with the track." }],
    }),
    record("assistant", {
      model: "claude-sonnet-5",
      role: "assistant",
      content: [{ type: "tool_use", id: "t1", name: "Edit", input: { file_path: path.join(cwd, "src", "track.ts") } }],
    }),
    record("user", { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] }),
    record("assistant", {
      model: "claude-sonnet-5",
      role: "assistant",
      content: [{ type: "text", text: "The track works." }],
    }),
    JSON.stringify({ type: "ai-title", aiTitle: "Kart game", sessionId: SESSION }),
  ].join("\n");
}

describe("continuing a Claude Code chat in Shelra (the owner, 2026-10-03)", () => {
  const originalHome = process.env.HOME;
  const originalResearch = process.env.SHELRA_RESEARCH;
  let home = "";
  let project = "";

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "shelra-import-home-"));
    project = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "shelra-import-project-")));
    process.env.HOME = home;
    process.env.SHELRA_RESEARCH = "off";
    vi.spyOn(os, "homedir").mockReturnValue(home);
    closeDatabase();
    const folder = path.join(home, ".claude", "projects", claudeCodeFolderName(project));
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `${SESSION}.jsonl`), claudeChat(project));
  });

  afterEach(() => {
    closeDatabase();
    vi.restoreAllMocks();
    process.env.HOME = originalHome;
    if (originalResearch === undefined) delete process.env.SHELRA_RESEARCH;
    else process.env.SHELRA_RESEARCH = originalResearch;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  });

  it("imports the chat once, with its own date, where /resume lists it", async () => {
    const [listed] = listForeignChats({ cwd: project, home });
    expect(listed).toMatchObject({ source: "claude-code", sourceId: SESSION, title: "Kart game", importedAs: null });
    if (!listed) throw new Error("the chat was not listed");

    const first = await importForeignChat(listed, { fallbackCwd: project, home });
    const again = await importForeignChat(listed, { fallbackCwd: project, home });

    expect(first).toMatchObject({ created: true, folder: project, messages: 2, summarized: 0 });
    expect(again).toMatchObject({ created: false, sessionId: first.sessionId });
    expect(listForeignChats({ cwd: project, home })).toEqual([]);
    expect(listForeignChats({ cwd: project, home, includeImported: true })[0]?.importedAs).toBe(first.sessionId);

    const [chat] = new SessionStore(project).listSessions();
    expect(chat).toMatchObject({
      id: first.sessionId,
      title: "Kart game",
      firstRequest: "Build the kart game",
      messages: 2,
    });
    expect(chat?.updatedAt.toISOString()).toBe("2026-09-12T09:05:00.000Z");
    const shown = buildChatEntries(first.sessionId).map((entry) => entry.content);
    expect(shown[0]).toContain("This chat was started in Claude Code and imported into Shelra");
    expect(shown.slice(1)).toEqual([
      "Build the kart game",
      "Starting with the track.\n\nThe track works.\n\n[In Claude Code: changed src/track.ts]",
    ]);
  });

  it("hands the model the imported conversation when the chat continues", async () => {
    const [listed] = listForeignChats({ cwd: project, home });
    if (!listed) throw new Error("the chat was not listed");
    const { sessionId } = await importForeignChat(listed, { fallbackCwd: project, home });
    expect(loadTranscriptState(sessionId).messages).toHaveLength(3);

    const provider = new RecordingProvider("Adding the boss level.");
    const agent = new Agent(undefined, undefined, "fake-model", undefined, { provider, cwd: project });
    expect(agent.openSavedSession(sessionId)?.session.id).toBe(sessionId);
    for await (const _chunk of agent.processMessage("Now add a boss level")) {
      // drain
    }

    const sent = JSON.stringify(provider.requests[0]?.messages);
    expect(sent).toContain("imported into Shelra");
    expect(sent).toContain("Build the kart game");
    expect(sent).toContain("[In Claude Code: changed src/track.ts]");
    expect(sent).toContain("Now add a boss level");
    expect(sent.indexOf("Build the kart game")).toBeLessThan(sent.indexOf("Now add a boss level"));
  });
});
