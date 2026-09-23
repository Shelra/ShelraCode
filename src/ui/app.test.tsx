import { type CapturedSpan, RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { ChatEntry } from "../types/index";
import { CommandApprovalPanel, ComposerFooter, MessageView, MotionPickerModal } from "./app";
import { dark } from "./theme";

async function render(node: ReactNode, width = 60, height = 8) {
  const screen = await testRender(node, { width, height });
  await screen.renderOnce();
  const frame = screen.captureCharFrame();
  const spans = screen.captureSpans().lines.flatMap((line) => line.spans);
  screen.renderer.destroy();
  return { frame, spans };
}

const find = (spans: CapturedSpan[], text: string) => spans.find((span) => span.text.includes(text));

describe("MessageView", () => {
  // Plan mode used to store its tone name on each entry, and OpenTUI drew the unknown colour "modePlan" as
  // magenta. An entry's own data never picks its colour.
  const planModeEntry = (type: "user" | "tool_call", content: string) =>
    ({ type, content, timestamp: new Date(), modeColor: "modePlan" }) as ChatEntry;

  it("draws the prompt of a sent message in the accent, whatever mode sent it", async () => {
    const { spans } = await render(
      <MessageView entry={planModeEntry("user", "Refactor the parser")} index={0} t={dark} />,
    );
    expect(find(spans, "$")?.fg.equals(RGBA.fromHex(dark.brand))).toBe(true);
  });

  it("draws the marker of a tool call in the accent", async () => {
    const { spans } = await render(
      <MessageView entry={planModeEntry("tool_call", "read src/index.ts")} index={0} t={dark} />,
    );
    expect(find(spans, "▸")?.fg.equals(RGBA.fromHex(dark.brand))).toBe(true);
  });
});

describe("MotionPickerModal", () => {
  it("shows its only row as the cursor row and offers only the keys that work", async () => {
    const { frame, spans } = await render(<MotionPickerModal t={dark} motion="full" width={60} height={20} />, 60, 20);
    const row = find(spans, "Motion");
    expect(row?.fg.equals(RGBA.fromHex(dark.brand))).toBe(true);
    expect(row?.bg.equals(RGBA.fromHex(dark.brandSoft))).toBe(true);
    expect(frame).toContain("left/right change");
    expect(frame).not.toContain("up/down");
  });
});

describe("CommandApprovalPanel", () => {
  it("shows the command and why it is destructive, with Don't run chosen", async () => {
    const { frame, spans } = await render(
      <CommandApprovalPanel
        t={dark}
        approval={{ command: "git reset --hard HEAD", reason: "discards all uncommitted changes", selected: 1 }}
      />,
      76,
      10,
    );
    expect(frame).toContain("[ COMMAND ]");
    expect(frame).toContain("git reset --hard HEAD");
    expect(frame).toContain("This command discards all uncommitted changes.");
    expect(frame).toContain("> Don't run");
    expect(frame).not.toContain("> Run it");
    expect(find(spans, "This command")?.fg.equals(RGBA.fromHex(dark.warning))).toBe(true);
    // Nine rows: it fits the log of an 80x24 terminal with its border whole.
    expect(frame.split(String.fromCharCode(10)).filter((line) => line.trim()).length).toBe(9);
  });
});

describe("ComposerFooter", () => {
  it("offers the keys that answer a command waiting for approval, not stop and queue", async () => {
    const { frame } = await render(
      <ComposerFooter
        t={dark}
        width={80}
        model="Qwen3 Coder"
        isProcessing
        showSuggestions={false}
        queuedCount={0}
        hasViews={false}
        viewOpen={false}
        approvalOpen
      />,
      80,
      1,
    );
    expect(frame).toContain("enter confirm");
    expect(frame).toContain("esc don't run");
    expect(frame).not.toContain("esc stop");
    expect(frame).not.toContain("enter queue");
  });
});
