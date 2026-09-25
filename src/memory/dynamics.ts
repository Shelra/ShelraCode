import type { MemoryFrontmatter } from "./types";

/**
 * How strong a memory is, the way human memory works (docs/architecture/18-MEMORY-V2.md §4.6). A memory comes to mind
 * more easily the more often and the more recently it was used, and fades along a power law when it is not (ACT-R's
 * base-level activation, Anderson & Schooler 1991: the odds that something is needed again follow exactly that curve).
 * What mattered (a user's statement, a costly failure) is kept longer, as salient events are. Nothing here calls a
 * model or reads the disk: strength is a pure function of an entry's own history.
 */

type Metadata = MemoryFrontmatter["metadata"];

const DAY_MS = 24 * 60 * 60_000;
/** ACT-R's decay rate; 0.5 fits human recall data across many studies. */
const DECAY = 0.5;
/** Recalls kept per entry: enough for the sum, small enough for a frontmatter line. */
export const MAX_RECALLS = 12;
/** Below this strength an unimportant, uncredited inference has faded and is archived at consolidation. */
export const FADED = 0.2;
/** An entry this important never fades by disuse: the user said it, or it cost a lot to learn. */
export const IMPORTANT = 0.7;

/** Every moment the memory was formed, rehearsed or confirmed, oldest first. */
function events(meta: Metadata): number[] {
  const times = [
    meta.created ?? meta.modified,
    ...(meta.recalls ?? []),
    ...(meta.lastConfirmed && meta.lastConfirmed !== (meta.created ?? meta.modified) ? [meta.lastConfirmed] : []),
  ]
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  return times.length > 0 ? times : [Date.parse(meta.modified)].filter(Number.isFinite);
}

/** ACT-R base-level activation: ln Σ t_j^-d over the memory's history, t in days. */
export function activation(meta: Metadata, now = Date.now()): number {
  const sum = events(meta).reduce((total, time) => total + Math.max(0.25, (now - time) / DAY_MS) ** -DECAY, 0);
  return sum > 0 ? Math.log(sum) : -10;
}

/**
 * Strength in (0,1): about 0.73 the day a memory forms, 0.22 after three months unused, 0.9 when it was used several
 * times in the last week.
 */
export function strength(meta: Metadata, now = Date.now()): number {
  return 1 / (1 + Math.exp(-(activation(meta, now) + 1)));
}

/**
 * How much a memory mattered when it formed: what the user said counts most, then what was observed, then what a
 * model inferred. Stored at capture when known (a failure that took many tries), estimated otherwise.
 */
export function importance(meta: Metadata): number {
  if (meta.importance !== undefined) return meta.importance;
  if (meta.source === "human") return 1;
  if (meta.type === "failure" || meta.type === "known-problems") return 0.6;
  if (meta.source === "observed") return 0.55;
  return 0.45;
}

/** What the model is told about how sure memory is: a firm memory, or one fading from disuse. */
export function strengthLabel(meta: Metadata, now = Date.now()): "firm" | "fading" | undefined {
  const value = strength(meta, now);
  if (value >= 0.75 || (meta.credit ?? 0) >= 2) return "firm";
  if (value <= 0.3) return "fading";
  return undefined;
}

/** Whether an entry has faded enough to archive: unused, unimportant, never credited, and old. */
export function hasFaded(meta: Metadata, now = Date.now()): boolean {
  if (meta.source === "human" || importance(meta) >= IMPORTANT || (meta.credit ?? 0) > 0) return false;
  const age = (now - Date.parse(meta.created ?? meta.modified)) / DAY_MS;
  return age > 45 && strength(meta, now) < FADED;
}

/** Adds today's recall to an entry's history: one per day, the newest MAX_RECALLS kept. */
export function withRecall(recalls: readonly string[] | undefined, now = new Date()): string[] {
  const today = now.toISOString().slice(0, 10);
  const kept = (recalls ?? []).filter((day) => day !== today);
  return [...kept, today].slice(-MAX_RECALLS);
}
