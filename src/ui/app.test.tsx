import { type CapturedSpan, RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { ChatEntry } from "../types/index";
import { MessageView, MotionPickerModal } from "./app";
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
