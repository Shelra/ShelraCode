import { useEffect, useRef, useState } from "react";

/**
 * Readable streaming. A fast model delivers whole paragraphs in one frame and its reasoning changes
 * several times a second; seen 2026-09-22, the thinking line and the answer "flashed past, impossible
 * to see". Text is revealed at a reading pace and only speeds up to stay within a couple of seconds
 * of the model, so a slow model still shows words as they come and a fast one never lags far behind.
 */
export const REVEAL_CHARS_PER_SECOND = 120;
/** The most the revealed text may trail the model's text, in time. */
export const REVEAL_MAX_LAG_MS = 2_000;
/** How long one reasoning sentence stays on screen before the next replaces it. */
export const THOUGHT_DWELL_MS = 1_600;
const TICK_MS = 33;

/** The most text left to reveal: anything beyond it shows at once, it could not be read in time anyway. */
const MAX_BACKLOG = REVEAL_CHARS_PER_SECOND * (REVEAL_MAX_LAG_MS / 1_000) * 2;

/** Characters to reveal in one tick for a given backlog: the reading pace, or faster to catch up. */
export function revealStep(backlog: number, tickMs = TICK_MS): number {
  if (backlog <= 0) return 0;
  const reading = (REVEAL_CHARS_PER_SECOND * tickMs) / 1_000;
  const catchUp = (backlog * tickMs) / REVEAL_MAX_LAG_MS;
  const overflow = backlog - MAX_BACKLOG;
  return Math.min(backlog, Math.max(1, Math.round(Math.max(reading, catchUp, overflow))));
}

/**
 * A streamed answer moves into the log while it is still being revealed. The streaming view keeps its
 * progress here on every tick, because the log's newest answer reads it while it first renders: in the
 * same update that removes the streaming view, before that view's cleanup could run.
 */
let handOff: { text: string; shown: number } | null = null;

function startingLength(target: string, resume: boolean): number {
  const previous = handOff;
  if (!resume || !previous) return target.length;
  handOff = null;
  // The progress of another answer (a stream cut short, an earlier session) is not this one's.
  const continues = target.startsWith(previous.text) || previous.text.startsWith(target);
  return continues ? Math.min(previous.shown, target.length) : target.length;
}

/**
 * The part of `target` to show now. `resume` continues a hand-off from the streaming view; without
 * one the text shows in full (history, a resumed session). Reduced motion shows everything at once.
 */
export function usePacedText(
  target: string,
  options: { reduced: boolean; resume?: boolean; live?: boolean; onProgress?: () => void },
): string {
  const { reduced, resume = false, live = false, onProgress } = options;
  const [shown, setShown] = useState(() => {
    if (!live) return startingLength(target, resume);
    // A new stream starts from nothing, so no earlier stream's progress is left to pick up.
    handOff = { text: target, shown: 0 };
    return 0;
  });
  const shownRef = useRef(shown);
  const targetRef = useRef(target);
  const progressRef = useRef(onProgress);
  targetRef.current = target;
  progressRef.current = onProgress;

  // One timer while there is text left to reveal. It must not restart on every delta: a model that
  // streams faster than a tick would reset it before it ever fired, and nothing would show.
  const behind = !reduced && shown < target.length;
  useEffect(() => {
    if (!behind) return;
    const timer = setInterval(() => {
      const goal = targetRef.current.length;
      if (shownRef.current >= goal) return;
      shownRef.current += revealStep(goal - shownRef.current);
      if (live) handOff = { text: targetRef.current, shown: shownRef.current };
      setShown(shownRef.current);
      progressRef.current?.();
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [behind, live]);

  return reduced ? target : target.slice(0, Math.min(shown, target.length));
}

/** Holds each new value for at least `ms` before showing the next, so a fast stream stays readable. */
export function useDwell<T>(value: T, ms: number, reduced: boolean): T {
  const [shown, setShown] = useState(value);
  const shownAt = useRef(Date.now());
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    if (reduced || Object.is(value, shown)) return;
    const wait = Math.max(0, shownAt.current + ms - Date.now());
    const timer = setTimeout(() => {
      shownAt.current = Date.now();
      setShown(latest.current);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, shown, ms, reduced]);

  return reduced ? value : shown;
}
