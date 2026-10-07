import type { ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { TRANSCRIPT_WINDOW } from "../transcript-window";
import { useTranscriptWindow } from "./use-transcript-window";

const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `row:${i}`, text: `row ${i}` }));

function Log({ items }: { items: { id: string; text: string }[] }) {
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const { startIndex } = useTranscriptWindow(items, scrollRef);
  return (
    <scrollbox ref={scrollRef} stickyScroll stickyStart="bottom" flexGrow={1}>
      {items.slice(startIndex).map((item) => (
        <text key={item.id}>{item.text}</text>
      ))}
    </scrollbox>
  );
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 120));

// biome-ignore lint/suspicious/noExplicitAny: reaching OpenTUI's scroll box in the rendered tree
function findScrollBox(node: any): ScrollBoxRenderable | null {
  if (node?.constructor?.name === "ScrollBoxRenderable") return node;
  for (const child of node?.getChildren?.() ?? []) {
    const found = findScrollBox(child);
    if (found) return found;
  }
  return null;
}

describe("useTranscriptWindow", () => {
  it("mounts only the end of a long log, and the reader can still reach every entry", async () => {
    const items = rows(TRANSCRIPT_WINDOW * 3);
    const screen = await testRender(<Log items={items} />, { width: 40, height: 12 });
    await settle();
    await screen.renderOnce();

    const mounted = () => {
      let count = 0;
      const walk = (node: { getChildren?: () => unknown[] }) => {
        count += 1;
        for (const child of (node.getChildren?.() ?? []) as { getChildren?: () => unknown[] }[]) walk(child);
      };
      walk(screen.renderer.root);
      return count;
    };
    // Following the end: the last rows are on screen and the first ones are not even mounted.
    expect(screen.captureCharFrame()).toContain(`row ${items.length - 1}`);
    const boxesAtEnd = mounted();

    const box = findScrollBox(screen.renderer.root);
    expect(box).not.toBeNull();
    // The reader pushes up to the top of what is mounted: the next page mounts...
    box?.scrollBy(-1_000_000);
    await settle();
    await screen.renderOnce();
    await settle();
    await screen.renderOnce();
    expect(mounted()).toBeGreaterThan(boxesAtEnd);

    // ...and the view stays on the rows the reader was looking at instead of jumping to the new top.
    const firstMounted = items.length - TRANSCRIPT_WINDOW;
    expect(screen.captureCharFrame()).toContain(`row ${firstMounted}`);
    // A line above the old top is now reachable.
    box?.scrollBy(-1);
    await settle();
    await screen.renderOnce();
    expect(screen.captureCharFrame()).toContain(`row ${firstMounted - 1}`);
    screen.renderer.destroy();
  });

  it("keeps everything mounted while the log is short", async () => {
    const items = rows(20);
    const screen = await testRender(<Log items={items} />, { width: 40, height: 30 });
    await settle();
    await screen.renderOnce();
    const frame = screen.captureCharFrame();
    expect(frame).toContain("row 0");
    expect(frame).toContain("row 19");
    screen.renderer.destroy();
  });
});
