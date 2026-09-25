import type { ScrollBoxRenderable } from "@opentui/core";
import { type RefObject, useEffect } from "react";

/** Bars already set to hidden: the setting sticks, so each bar needs it once. */
const hiddenBars = new WeakSet<object>();

/**
 * Keeps a scrollbox's vertical bar hidden: the view still scrolls with the wheel and the keys, and the
 * column the bar took goes back to the content (the owner wants no bar beside the log, 2026-09-24).
 * A `visible: false` option is not enough: OpenTUI shows the bar again as soon as the content overflows,
 * unless visibility is set on the bar itself, which marks it as chosen rather than automatic.
 */
export function useHiddenScrollbar(ref: RefObject<ScrollBoxRenderable | null>): void {
  useEffect(() => {
    const bar = ref.current?.verticalScrollBar;
    if (!bar || hiddenBars.has(bar)) return;
    bar.visible = false;
    hiddenBars.add(bar);
  });
}
