import { describe, expect, it } from "vitest";
import { fitHints, hintsWidth, IDLE_HINTS, SHORTCUT_GROUPS, SHORTCUTS, withViewHints } from "./shortcuts";
import { SLASH_MENU_ITEMS } from "./slash-menu";

describe("fitHints", () => {
  it("keeps every hint when there is room", () => {
    expect(fitHints(IDLE_HINTS, 200)).toHaveLength(IDLE_HINTS.length);
  });

  it("drops the lowest-priority hints first and never overflows", () => {
    for (const room of [10, 24, 40, 55, 70]) {
      const fitted = fitHints(IDLE_HINTS, room);
      expect(hintsWidth(fitted)).toBeLessThanOrEqual(room);
      expect(fitted).toEqual(IDLE_HINTS.slice(0, fitted.length));
    }
    expect(fitHints(IDLE_HINTS, 24)[0]).toEqual({ key: "?", label: "shortcuts" });
  });

  it("returns nothing rather than a clipped hint when even the first does not fit", () => {
    expect(fitHints(IDLE_HINTS, 5)).toEqual([]);
  });
});

describe("shortcut catalog", () => {
  it("has entries for every group", () => {
    for (const group of SHORTCUT_GROUPS) {
      expect(SHORTCUTS.some((shortcut) => shortcut.group === group)).toBe(true);
    }
  });

  it("does not depend on keys terminals reserve", () => {
    const keys = SHORTCUTS.map((shortcut) => shortcut.keys);
    expect(keys).not.toContain("ctrl+i");
    expect(keys).not.toContain("ctrl+m");
  });
});

describe("slash command list", () => {
  it("never puts exit first, where a stray Enter would quit the app", () => {
    expect(SLASH_MENU_ITEMS[0]?.id).not.toBe("exit");
    expect(SLASH_MENU_ITEMS.at(-1)?.id).toBe("exit");
  });
});

describe("withViewHints", () => {
  it("adds nothing until a view has something to open", () => {
    expect(withViewHints(IDLE_HINTS, { hasViews: false, viewOpen: false })).toEqual([...IDLE_HINTS]);
  });

  it("offers the views right after the details key once there is something to open", () => {
    const keys = withViewHints(IDLE_HINTS, { hasViews: true, viewOpen: false }).map((hint) => hint.key);
    expect(keys.indexOf("alt+2-5")).toBe(keys.indexOf("ctrl+o") + 1);
  });

  it("leads with the way back while a view is open", () => {
    const hints = withViewHints(IDLE_HINTS, { hasViews: true, viewOpen: true });
    expect(hints[0]).toEqual({ key: "esc", label: "back to the log" });
    expect(hints.some((hint) => hint.key === "alt+2-5")).toBe(false);
  });
});
