import type { ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { useHiddenScrollbar } from "./use-hidden-scrollbar";

function Log({ hide }: { hide: boolean }) {
  const ref = useRef<ScrollBoxRenderable>(null);
  useHiddenScrollbar(hide ? ref : { current: null });
  return (
    <scrollbox ref={ref} height={6} width={30} stickyScroll>
      {Array.from({ length: 40 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static rows
        <text key={index}>{`row ${index + 1}`}</text>
      ))}
    </scrollbox>
  );
}

async function lastColumn(hide: boolean): Promise<string> {
  const screen = await testRender(<Log hide={hide} />, { width: 30, height: 6 });
  // The bar shows once the content is measured as taller than the view.
  await screen.renderOnce();
  await screen.renderOnce();
  const frame = screen.captureCharFrame();
  screen.renderer.destroy();
  return frame
    .split("\n")
    .slice(0, 6)
    .map((line) => line.padEnd(30).charAt(29))
    .join("");
}

describe("useHiddenScrollbar", () => {
  it("draws no bar beside a log that overflows, which still scrolls", async () => {
    // Without the hook the bar takes the last column of an overflowing log.
    expect((await lastColumn(false)).trim()).not.toBe("");
    expect((await lastColumn(true)).trim()).toBe("");
  });
});
