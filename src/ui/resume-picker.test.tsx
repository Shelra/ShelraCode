import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { SessionListing } from "../storage/sessions";
import { foreignResumeChat } from "./resume";
import { ResumePickerModal } from "./resume-picker";
import { dark } from "./theme";

const now = new Date(2026, 8, 25, 12, 0, 0);

function chat(overrides: Partial<SessionListing> & Pick<SessionListing, "id">): SessionListing {
  return {
    title: null,
    firstRequest: null,
    messages: 12,
    model: "openrouter/qwen/qwen3-235b-a22b-2507",
    mode: "agent",
    workspace: "D:/PROYECTS/demo",
    updatedAt: new Date(now.getTime() - 3 * 3_600_000),
    ...overrides,
  };
}

const CHATS = [
  chat({ id: "a1", title: "Mario Kart racer in Three.js", messages: 1403 }),
  chat({ id: "b2", firstRequest: "Fix the failing token refresh tests", updatedAt: new Date(2026, 8, 24, 9) }),
];

async function frameOf(node: ReactNode) {
  const screen = await testRender(node, { width: 90, height: 30 });
  await screen.renderOnce();
  const frame = screen.captureCharFrame();
  const spans = screen.captureSpans();
  screen.renderer.destroy();
  return { frame, spans };
}

describe("ResumePickerModal", () => {
  it("lists each saved chat with what it was about, its size, its age and its model", async () => {
    const { frame } = await frameOf(
      <ResumePickerModal
        t={dark}
        chats={CHATS}
        selectedIndex={0}
        all={false}
        width={90}
        height={30}
        error={null}
        now={now}
      />,
    );
    expect(frame).toContain("[ RESUME ]  2 chats · this folder");
    expect(frame).toContain("Mario Kart racer in Three.js");
    expect(frame).toContain("1403 messages · 3h ago · qwen3-235b-a22b-2507");
    expect(frame).toContain("Fix the failing token refresh tests");
    expect(frame).toContain("yesterday");
    expect(frame).toContain("enter continue  tab every folder  esc close");
  });

  it("shows a Claude Code chat with the agent in place of its size", async () => {
    const claude = foreignResumeChat({
      source: "claude-code",
      sourceId: "4f200c79-cb1a-4879-a1f6-c51eea1d6473",
      path: "/home/dev/.claude/projects/-work-demo/4f200c79.jsonl",
      title: "Chat import from other agents",
      firstRequest: "Import my old chats",
      cwd: "D:/PROYECTS/demo",
      model: "claude-sonnet-5",
      createdAt: new Date(now.getTime() - 9 * 3_600_000),
      updatedAt: new Date(now.getTime() - 5 * 3_600_000),
      bytes: 4096,
    });
    const { frame } = await frameOf(
      <ResumePickerModal
        t={dark}
        chats={[...CHATS, claude]}
        selectedIndex={2}
        all={false}
        width={90}
        height={30}
        error={null}
        now={now}
      />,
    );
    expect(frame).toContain("3 chats · this folder");
    expect(frame).toContain("Chat import from other agents");
    expect(frame).toContain("Claude Code chat · 5h ago · claude-sonnet-5");
  });

  it("marks the chosen chat with the cursor row", async () => {
    const { spans } = await frameOf(
      <ResumePickerModal
        t={dark}
        chats={CHATS}
        selectedIndex={1}
        all={false}
        width={90}
        height={30}
        error={null}
        now={now}
      />,
    );
    const span = spans.lines.flatMap((line) => line.spans).find((part) => part.text.includes("Fix the failing"));
    expect(span?.bg.equals(RGBA.fromHex(dark.selectedBg))).toBe(true);
    expect(span?.fg.equals(RGBA.fromHex(dark.brand))).toBe(true);
  });

  it("titles /import's list and says so when no Claude Code or Codex chat is left to import", async () => {
    const { frame } = await frameOf(
      <ResumePickerModal
        t={dark}
        chats={[]}
        selectedIndex={0}
        all={false}
        imports
        width={90}
        height={30}
        error={null}
        now={now}
      />,
    );
    expect(frame).toContain("[ IMPORT ]  0 Claude Code and Codex chats · this folder");
    expect(frame).toContain("No Claude Code or Codex chats to import in this folder.");
  });

  it("shows each chat's folder across every folder, and says so when there is nothing to continue", async () => {
    const all = await frameOf(
      <ResumePickerModal t={dark} chats={CHATS} selectedIndex={0} all width={90} height={30} error={null} now={now} />,
    );
    expect(all.frame).toContain("· every folder");
    expect(all.frame).toContain("D:/PROYECTS/demo");
    expect(all.frame).toContain("tab this folder");

    const empty = await frameOf(
      <ResumePickerModal
        t={dark}
        chats={[]}
        selectedIndex={0}
        all={false}
        width={90}
        height={30}
        error={null}
        now={now}
      />,
    );
    expect(empty.frame).toContain("No earlier chats in this folder.");
    expect(empty.frame).toContain("tab every folder  esc close");
    expect(empty.frame).not.toContain("enter continue");
  });

  it("keeps the list open with the reason when a chat cannot be opened", async () => {
    const { frame } = await frameOf(
      <ResumePickerModal
        t={dark}
        chats={CHATS}
        selectedIndex={0}
        all={false}
        width={90}
        height={30}
        error={'Session "a1" was not found.'}
        now={now}
      />,
    );
    expect(frame).toContain('Session "a1" was not found.');
  });

  it("shows a long reason whole, so the command it gives can be copied", async () => {
    const folder = "D:\\PROYECTS\\test-shelra\\02-Mario Kart-style 3D racing game";
    const reason = `That chat belongs to ${folder}. Continue it there: cd "${folder}"; shelra -s e5bc0e28b5c2`;
    const { frame } = await frameOf(
      <ResumePickerModal
        t={dark}
        chats={CHATS}
        selectedIndex={0}
        all
        width={90}
        height={30}
        error={reason}
        now={now}
      />,
    );
    // The panel's rows, borders and padding stripped, read as one text.
    const text = frame
      .split("\n")
      .map((line) => line.replace(/^[\s│]+|[\s│]+$/g, ""))
      .join(" ")
      .replace(/\s+/g, " ");
    expect(text).toContain("shelra -s e5bc0e28b5c2");
    expect(text).toContain("enter continue");
  });
});
