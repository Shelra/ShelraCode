import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";
import { dark, light, type Theme } from "./theme";

const CONTENT =
  "Fixed both failures.\n\n## What changed\n\n- one\n- two\n\n## Verification\n\nDone.\n\n```ts\nconst a = 1;\n```\n\nAfter code.";

async function render(t: Theme, content = CONTENT, width = 60) {
  const screen = await testRender(<Markdown t={t} content={content} />, { width, height: 24 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await screen.renderOnce();
  const frame = screen.captureCharFrame();
  const spans = screen.captureSpans();
  screen.renderer.destroy();
  return { frame, spans };
}

describe("Markdown", () => {
  it("separates blocks with a blank line and keeps a heading attached to what it introduces", async () => {
    const { frame } = await render(dark);
    const lines = frame.split("\n").map((line) => line.trimEnd());
    const at = (text: string) => lines.findIndex((line) => line.includes(text));
    expect(lines[at("What changed") - 1]).toBe("");
    expect(at("• one")).toBe(at("What changed") + 1);
    expect(lines[at("Verification") - 1]).toBe("");
    expect(lines[at("After code.") - 1]).toBe("");
  });

  it("hangs wrapped list lines under the text, not under the bullet", async () => {
    const long = `- ${"word ".repeat(30).trim()}`;
    const { frame } = await render(dark, long, 40);
    const lines = frame
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean);
    expect(lines[0]?.startsWith("• word")).toBe(true);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines.slice(1)) expect(line.startsWith("  word")).toBe(true);
  });

  it("draws quotes with a bar and rules as a line, without leaking raw markup", async () => {
    const { frame } = await render(dark, "> quoted text\n\n---\n\nafter");
    expect(frame).toContain("│ quoted text");
    expect(frame).not.toContain("> quoted");
    expect(frame).toContain("────────");
    expect(frame).not.toContain("---");
  });

  it("conceals inline markers and shows a link's target after its label", async () => {
    const { frame } = await render(dark, "A **bold** and `code` and [link](https://example.com/a) here", 80);
    expect(frame).toContain("A bold and code and link (example.com/a) here");
  });

  it("keeps table rows one line tall", async () => {
    const { frame } = await render(dark, "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |");
    const rows = frame.split("\n").filter((line) => line.includes("│"));
    expect(rows).toHaveLength(3);
  });

  it.each([
    ["dark", dark],
    ["light", light],
  ] as const)("draws fenced code from theme tokens in the %s theme", async (_name, t) => {
    const { frame, spans } = await render(t);
    expect(frame).toContain("const a = 1;");
    const colours = spans.lines.flatMap((line) => line.spans.filter((span) => span.text.includes("const")));
    // `const` is a keyword: it takes the theme's info colour, never the renderer's fixed white.
    expect(colours.some((span) => span.fg.equals(RGBA.fromHex(t.info)))).toBe(true);
    expect(colours.every((span) => !span.fg.equals(RGBA.fromHex("#FFFFFF")))).toBe(true);
  });

  it("does not leak the fence markers of a half-streamed code block", async () => {
    const { frame } = await render(dark, "Before\n\n```sh\nbun te");
    expect(frame).toContain("bun te");
    expect(frame).not.toContain("```");
  });

  it("does not leak the markers of half-typed emphasis as a message streams", async () => {
    const { frame } = await render(dark, "Almost **bold");
    expect(frame).toContain("Almost **bold");
  });
});
