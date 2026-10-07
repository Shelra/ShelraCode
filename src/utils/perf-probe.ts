/**
 * Counters for the responsiveness harness (`scripts/perf/ui-stress.tsx`): how often a hot path runs and
 * how long it takes. Off unless `SHELRA_PERF_PROBE=1`, so a normal session pays one boolean check.
 */
const ENABLED = process.env.SHELRA_PERF_PROBE === "1";

interface ProbeEntry {
  calls: number;
  totalMs: number;
  maxMs: number;
}

const entries = new Map<string, ProbeEntry>();

function entryFor(name: string): ProbeEntry {
  let entry = entries.get(name);
  if (!entry) {
    entry = { calls: 0, totalMs: 0, maxMs: 0 };
    entries.set(name, entry);
  }
  return entry;
}

/** Counts one run of a hot path. */
export function perfCount(name: string): void {
  if (ENABLED) entryFor(name).calls += 1;
}

/** Runs `fn`, recording how long it took when the probe is on. */
export function perfTime<T>(name: string, fn: () => T): T {
  if (!ENABLED) return fn();
  const started = performance.now();
  try {
    return fn();
  } finally {
    const took = performance.now() - started;
    const entry = entryFor(name);
    entry.calls += 1;
    entry.totalMs += took;
    entry.maxMs = Math.max(entry.maxMs, took);
  }
}

/** What the probe saw so far, by name. */
export function perfSnapshot(): Record<string, ProbeEntry> {
  return Object.fromEntries([...entries].map(([name, entry]) => [name, { ...entry }]));
}

export function perfReset(): void {
  entries.clear();
}
