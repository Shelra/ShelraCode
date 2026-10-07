import type { ScrollBoxRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { perfCount } from "../../utils/perf-probe";
import { loadEarlierStart, reconcileWindowStart, TRANSCRIPT_WINDOW, windowStartIndex } from "../transcript-window";

interface HasId {
  id: string;
}

/**
 * True while the log follows its end. OpenTUI records that the reader moved away by hand
 * (`_hasManualScroll`, set by wheel, keys and bar alike), which unlike the scroll position does not flicker
 * while new content is still being laid out; the geometry is the fallback if that field ever goes away.
 */
export function isPinnedToEnd(box: ScrollBoxRenderable | null | undefined): boolean {
  if (!box) return true;
  const manual = (box as unknown as { _hasManualScroll?: unknown })._hasManualScroll;
  if (typeof manual === "boolean") return !manual;
  return box.scrollTop >= Math.max(0, box.scrollHeight - box.viewport.height - 1);
}

/**
 * True only when the reader is looking at the end of the log. The flag alone can read "following" for an
 * instant while a page of earlier items is being laid out, and the window must never collapse then.
 */
export function isAtEnd(box: ScrollBoxRenderable | null | undefined): boolean {
  if (!box) return true;
  return isPinnedToEnd(box) && box.scrollTop >= Math.max(0, box.scrollHeight - box.viewport.height - 1);
}

/**
 * Chooses which transcript items stay mounted (see `transcript-window.ts`). Returns the first mounted index;
 * scrolling to the top of what is mounted brings the next page of earlier items in and keeps the line the
 * reader was looking at where it was.
 */
export function useTranscriptWindow(items: readonly HasId[], scrollRef: RefObject<ScrollBoxRenderable | null>) {
  const renderer = useRenderer();
  const [startId, setStartId] = useState<string | null>(null);
  const latest = useRef({ items, startId });
  latest.current = { items, startId };
  const anchor = useRef<{ height: number; top: number } | null>(null);

  const startIndex = windowStartIndex(items, startId);

  // The window follows the end of the log, and stays put while the reader is somewhere else.
  useEffect(() => {
    const next = reconcileWindowStart(items, startId, isAtEnd(scrollRef.current));
    if (next !== startId) setStartId(next);
  }, [items, startId, scrollRef]);

  // After the earlier page is laid out the log is taller: move the view down by what was added. Watching starts
  // before the page mounts and runs after every frame, so the first frame that shows the page also fixes the view.
  const settling = useRef<(() => void) | null>(null);
  const stopSettling = useCallback(() => {
    if (settling.current) renderer.removePostProcessFn(settling.current);
    settling.current = null;
  }, [renderer]);
  const startSettling = useCallback(() => {
    stopSettling();
    const startedAt = Date.now();
    const afterFrame = () => {
      const saved = anchor.current;
      const box = scrollRef.current;
      const grown = saved && box ? box.scrollHeight - saved.height : 0;
      if (saved && box && grown > 0) {
        box.scrollTop = saved.top + grown;
        perfCount("window.settled");
      } else if (saved && Date.now() - startedAt < 1500) {
        // The page is not mounted or laid out yet: keep frames coming until it is.
        renderer.requestRender();
        return;
      } else if (saved) {
        perfCount("window.gaveUp");
      }
      anchor.current = null;
      stopSettling();
    };
    settling.current = afterFrame;
    renderer.addPostProcessFn(afterFrame);
    renderer.requestRender();
  }, [renderer, scrollRef, stopSettling]);
  useEffect(() => stopSettling, [stopSettling]);

  const loadEarlier = useCallback(() => {
    const box = scrollRef.current;
    const { items: current, startId: currentStart } = latest.current;
    if (!box || windowStartIndex(current, currentStart) <= 0) return;
    const next = loadEarlierStart(current, currentStart);
    perfCount("window.loadEarlier");
    if (next === currentStart) return;
    anchor.current = { height: box.scrollHeight, top: box.scrollTop };
    setStartId(next);
    startSettling();
  }, [scrollRef, startSettling]);

  // Reaching the top of the mounted range, or leaving the end, is the reader's move: react to it.
  // The scroll box mounts once the log has content, so the listener follows whichever bar is current.
  const [bar, setBar] = useState<ScrollBoxRenderable["verticalScrollBar"] | null>(null);
  // The ref is filled once the box is on screen, after this render: read it again on every commit.
  useEffect(() => {
    const current = scrollRef.current?.verticalScrollBar ?? null;
    setBar((previous) => (previous === current ? previous : current));
  });
  useEffect(() => {
    if (!bar) return;
    const onChange = (event: { position: number }) => {
      const box = scrollRef.current;
      if (!box) return;
      perfCount("window.scrollChange");
      const { items: current, startId: currentStart } = latest.current;
      const pinned = isAtEnd(box);
      const next = reconcileWindowStart(current, currentStart, pinned);
      if (next !== currentStart) setStartId(next);
      if (!pinned && event.position <= 0) loadEarlier();
    };
    bar.on("change", onChange);
    return () => {
      bar.off("change", onChange);
    };
  }, [bar, scrollRef, loadEarlier]);

  return { startIndex, hiddenCount: startIndex, windowSize: TRANSCRIPT_WINDOW, loadEarlier };
}
