import { type CapturedSpan, RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { ChatEntry } from "../types/index";
import { CommandApprovalPanel, ComposerFooter, DecisionApprovalPanel, MessageView, MotionPickerModal } from "./app";
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

describe("DecisionApprovalPanel", () => {
  it("shows the proposed rule, what it covers and how it is checked, with Not now chosen", async () => {
    const { frame, spans } = await render(
      <DecisionApprovalPanel
        t={dark}
        approval={{
          decision: {
            id: "D-0004",
            title: "Money is integer cents",
            status: "proposed",
            source: "agent",
            rule: "Amounts are integers of cents; dollars appear only at display time.",
            scope: ["src/**"],
            check: "bun test src/money.test.ts",
            proposed: "2026-09-23",
            file: "docs/decisions/0004-money-is-integer-cents.md",
          },
          selected: 1,
        }}
      />,
      76,
      14,
    );
    expect(frame).toContain("[ DECISION ]");
    expect(frame).toContain("D-0004 Money is integer cents");
    expect(frame).toContain("Amounts are integers of cents; dollars appear only at display time.");
    expect(frame).toContain("Covers src/** · checked by bun test src/money.test.ts");
    expect(frame).toContain("> Not now");
    expect(frame).not.toContain("> Approve");
    expect(find(spans, "Covers src")?.fg.equals(RGBA.fromHex(dark.textMuted))).toBe(true);
    // Nine rows here, ten with a rule that wraps: the whole panel, border included, fits the log of an 80x24 terminal.
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

  it("offers esc as not now while a proposed decision waits", async () => {
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
        approvalOpen="decision"
      />,
      80,
      1,
    );
    expect(frame).toContain("esc not now");
    expect(frame).not.toContain("esc don't run");
  });

  it("shows the model mode before the model: Free in accent, Mixed in the warning colour, and how to switch", async () => {
    const footer = (modelMode: "free" | "mixed") =>
      render(
        <ComposerFooter
          t={dark}
          width={120}
          model="NVIDIA: Nemotron 3 Ultra"
          modelMode={modelMode}
          isProcessing={false}
          showSuggestions={false}
          queuedCount={0}
          hasViews={false}
          viewOpen={false}
          approvalOpen={false}
        />,
        120,
        1,
      );
    const free = await footer("free");
    expect(free.frame).toContain("● Free  NVIDIA: Nemotron 3 Ultra");
    expect(free.frame).toContain("ctrl+f free/mixed");
    expect(find(free.spans, "● Free")?.fg.equals(RGBA.fromHex(dark.accent))).toBe(true);
    const mixed = await footer("mixed");
    expect(mixed.frame).toContain("● Mixed  NVIDIA: Nemotron 3 Ultra");
    expect(find(mixed.spans, "● Mixed")?.fg.equals(RGBA.fromHex(dark.warning))).toBe(true);
  });

  it("fits the model a router picked next to the mode, at 80 and 120 columns", async () => {
    for (const width of [80, 120]) {
      const { frame } = await render(
        <ComposerFooter
          t={dark}
          width={width}
          model="Claude Sonnet 4.5 · auto"
          modelMode="mixed"
          isProcessing
          showSuggestions={false}
          queuedCount={0}
          hasViews={false}
          viewOpen={false}
          approvalOpen={false}
        />,
        width,
        1,
      );
      expect(frame).toContain("● Mixed  Claude Sonnet 4.5 · auto");
      expect(frame).toContain("esc stop");
    }
  });

  it("shows no mode where modes do not apply", async () => {
    const { frame } = await render(
      <ComposerFooter
        t={dark}
        width={80}
        model="Local Qwen"
        isProcessing={false}
        showSuggestions={false}
        queuedCount={0}
        hasViews={false}
        viewOpen={false}
        approvalOpen={false}
      />,
      80,
      1,
    );
    expect(frame).not.toContain("● Free");
    expect(frame).not.toContain("● Mixed");
  });
});
