import { describe, expect, it } from "vitest";
import { loadEarlierStart, reconcileWindowStart, windowStartIndex } from "./transcript-window";

const items = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `item:${i}` }));
const size = { windowSize: 10, slack: 4, page: 5 };

describe("windowStartIndex", () => {
  it("mounts everything while the log is short", () => {
    expect(windowStartIndex(items(7), null, 10)).toBe(0);
  });

  it("follows the end of a long log when nothing is pinned", () => {
    expect(windowStartIndex(items(100), null, 10)).toBe(90);
  });

  it("starts at the pinned item, wherever the end of the log has moved to", () => {
    expect(windowStartIndex(items(100), "item:40", 10)).toBe(40);
    expect(windowStartIndex(items(130), "item:40", 10)).toBe(40);
  });

  it("falls back to the end of the log when the pinned item no longer exists", () => {
    expect(windowStartIndex(items(100), "item:gone", 10)).toBe(90);
  });
});

describe("reconcileWindowStart", () => {
  it("keeps following the end of the log for a reader who is there", () => {
    expect(reconcileWindowStart(items(100), null, true, size)).toBeNull();
  });

  it("pins the window when the reader leaves the end, so arriving items never remove what is being read", () => {
    const pinned = reconcileWindowStart(items(100), null, false, size);
    expect(pinned).toBe("item:90");
    // Ten more arrive while the reader stays where they are: the start does not move.
    const later = items(110);
    expect(reconcileWindowStart(later, pinned, false, size)).toBe("item:90");
    expect(windowStartIndex(later, pinned, 10)).toBe(90);
  });

  it("lets the window move forward again only after the reader is back at the end and it has outgrown its slack", () => {
    const grown = items(100);
    // 100 - 80 = 20 mounted, more than the window of 10 plus the slack of 4.
    expect(reconcileWindowStart(grown, "item:80", true, size)).toBeNull();
    // 100 - 88 = 12 mounted: inside the slack, nothing to do yet.
    expect(reconcileWindowStart(grown, "item:88", true, size)).toBe("item:88");
  });

  it("is stable: reconciling its own answer changes nothing", () => {
    for (const pinned of [true, false]) {
      const first = reconcileWindowStart(items(100), "item:60", pinned, size);
      expect(reconcileWindowStart(items(100), first, pinned, size)).toBe(first);
    }
  });

  it("has nothing to window in a short log", () => {
    expect(reconcileWindowStart(items(8), "item:2", false, size)).toBeNull();
  });
});

describe("loadEarlierStart", () => {
  it("reveals one page of earlier items", () => {
    expect(loadEarlierStart(items(100), null, size)).toBe("item:85");
    expect(loadEarlierStart(items(100), "item:85", size)).toBe("item:80");
  });

  it("stops at the first item, and then reports nothing more to load", () => {
    expect(loadEarlierStart(items(100), "item:3", size)).toBe("item:0");
    expect(loadEarlierStart(items(100), "item:0", size)).toBe("item:0");
  });

  it("reaches every item of a long session, page by page", () => {
    const log = items(1000);
    let start: string | null = null;
    let steps = 0;
    while (windowStartIndex(log, start, 150) > 0 && steps < 100) {
      start = loadEarlierStart(log, start, { windowSize: 150, page: 100 });
      steps += 1;
    }
    expect(windowStartIndex(log, start, 150)).toBe(0);
    expect(steps).toBe(9);
  });
});
