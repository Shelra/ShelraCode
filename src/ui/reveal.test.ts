import { describe, expect, it } from "vitest";
import { REVEAL_CHARS_PER_SECOND, REVEAL_MAX_LAG_MS, revealStep } from "./reveal";

/** Ticks of 33 ms until the backlog is shown, as the paced view does it. */
function ticksToReveal(backlog: number): number {
  let left = backlog;
  let ticks = 0;
  while (left > 0 && ticks < 10_000) {
    left -= revealStep(left, 33);
    ticks += 1;
  }
  return ticks;
}

describe("revealStep", () => {
  it("reveals a short text at a reading pace", () => {
    // 120 characters take about a second, not one frame.
    const seconds = (ticksToReveal(REVEAL_CHARS_PER_SECOND) * 33) / 1_000;
    expect(seconds).toBeGreaterThan(0.8);
    expect(seconds).toBeLessThan(1.3);
  });

  it("speeds up for a long answer so it never trails the model by much more than the lag budget", () => {
    // A fast model delivers 6,000 characters at once: the reveal catches up instead of taking 50 s.
    const first = revealStep(6_000, 33);
    expect(first).toBeGreaterThan(90);
    const seconds = (ticksToReveal(6_000) * 33) / 1_000;
    expect(seconds).toBeLessThan((REVEAL_MAX_LAG_MS / 1_000) * 4);
  });

  it("never overshoots and always makes progress", () => {
    expect(revealStep(0)).toBe(0);
    expect(revealStep(1)).toBe(1);
    expect(revealStep(3)).toBeLessThanOrEqual(3);
  });
});
