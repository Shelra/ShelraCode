/**
 * Which part of the transcript is mounted in the terminal UI.
 *
 * Every mounted item costs layout and tree traversal on every frame, whether it changed or not (measured
 * 2026-10-06: 34 renderables per turn, ~0.11 ms of each frame per turn). A long session therefore made every
 * keystroke and every streamed token slower. The history is still all stored and all reachable: only the
 * items near the end are mounted, and reaching the top of the log mounts the next page of earlier ones.
 */

/** Items kept mounted while following the end of the log. */
export const TRANSCRIPT_WINDOW = 150;
/** How far the mounted range may grow past the window before it moves forward again. */
export const TRANSCRIPT_SLACK = 60;
/** Earlier items mounted each time the user reaches the top of what is mounted. */
export const TRANSCRIPT_PAGE = 100;

interface HasId {
  id: string;
}

/**
 * Where the mounted range starts. `startId` is the first item the user asked to keep (it moves back when
 * earlier items are loaded); `null` follows the end of the log. An id that no longer exists is ignored.
 */
export function windowStartIndex(
  items: readonly HasId[],
  startId: string | null,
  windowSize: number = TRANSCRIPT_WINDOW,
): number {
  const tail = Math.max(0, items.length - windowSize);
  if (startId === null) return tail;
  // Searching from the end: the anchor is almost always near it, and ids are unique.
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.id === startId) return Math.min(index, items.length);
  }
  return tail;
}

/**
 * The start the window should have given where the user is looking.
 *
 * - Scrolled away from the end: the start is pinned to an item, so content arriving at the bottom never
 *   removes what is being read.
 * - Back at the end: once the mounted range has outgrown the window plus its slack, the start follows the
 *   end of the log again.
 */
export function reconcileWindowStart(
  items: readonly HasId[],
  startId: string | null,
  pinnedToEnd: boolean,
  options: { windowSize?: number; slack?: number } = {},
): string | null {
  const windowSize = options.windowSize ?? TRANSCRIPT_WINDOW;
  const slack = options.slack ?? TRANSCRIPT_SLACK;
  if (items.length <= windowSize) return null;
  const index = windowStartIndex(items, startId, windowSize);

  if (!pinnedToEnd) {
    if (startId !== null && items.some((item) => item.id === startId)) return startId;
    return items[index]?.id ?? null;
  }
  if (startId === null) return null;
  return items.length - index > windowSize + slack ? null : startId;
}

/** The start after revealing one more page of earlier items. */
export function loadEarlierStart(
  items: readonly HasId[],
  startId: string | null,
  options: { windowSize?: number; page?: number } = {},
): string | null {
  const index = windowStartIndex(items, startId, options.windowSize ?? TRANSCRIPT_WINDOW);
  if (index <= 0) return startId;
  const next = Math.max(0, index - (options.page ?? TRANSCRIPT_PAGE));
  return items[next]?.id ?? startId;
}
