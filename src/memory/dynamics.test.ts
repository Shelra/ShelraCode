import { describe, expect, it } from "vitest";
import { hasFaded, importance, MAX_RECALLS, strength, strengthLabel, withRecall } from "./dynamics";
import type { MemoryFrontmatter } from "./types";

const NOW = Date.parse("2026-09-25T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60_000).toISOString();

function meta(overrides: Partial<MemoryFrontmatter["metadata"]> = {}): MemoryFrontmatter["metadata"] {
  return { type: "conventions", modified: daysAgo(1), created: daysAgo(1), source: "inference", ...overrides };
}

describe("memory strength, the way human memory works (doc 18 §4.6)", () => {
  it("is high when a memory is fresh, fades when unused, and grows with use", () => {
    const fresh = strength(meta(), NOW);
    const unused = strength(meta({ created: daysAgo(90), modified: daysAgo(90) }), NOW);
    const habit = strength(
      meta({
        created: daysAgo(90),
        modified: daysAgo(90),
        recalls: [1, 2, 3, 4, 5].map((days) => daysAgo(days).slice(0, 10)),
      }),
      NOW,
    );
    expect(fresh).toBeGreaterThan(0.7);
    expect(unused).toBeLessThan(0.3);
    expect(habit).toBeGreaterThan(0.85);
    // Forgetting follows a power law: most of it happens early, then it slows.
    const at = (days: number) => strength(meta({ created: daysAgo(days), modified: daysAgo(days) }), NOW);
    expect(at(1) - at(10)).toBeGreaterThan(at(10) - at(100));
  });

  it("keeps what mattered: the user's words, a costly failure, a credited entry never fade by disuse", () => {
    const old = { created: daysAgo(200), modified: daysAgo(200) };
    expect(hasFaded(meta(old), NOW)).toBe(true);
    expect(hasFaded(meta({ ...old, source: "human" }), NOW)).toBe(false);
    expect(hasFaded(meta({ ...old, importance: 0.8 }), NOW)).toBe(false);
    expect(hasFaded(meta({ ...old, credit: 1 }), NOW)).toBe(false);
    // Young entries are not judged yet, however unused.
    expect(hasFaded(meta({ created: daysAgo(30), modified: daysAgo(30) }), NOW)).toBe(false);
    expect(importance(meta({ source: "human" }))).toBe(1);
    expect(importance(meta({ type: "failure", source: "observed" }))).toBeGreaterThan(importance(meta()));
  });

  it("tells the model how sure memory is", () => {
    expect(strengthLabel(meta({ recalls: [daysAgo(1).slice(0, 10), daysAgo(2).slice(0, 10)] }), NOW)).toBe("firm");
    expect(strengthLabel(meta({ created: daysAgo(150), modified: daysAgo(150) }), NOW)).toBe("fading");
    expect(strengthLabel(meta({ created: daysAgo(20), modified: daysAgo(20) }), NOW)).toBeUndefined();
  });

  it("counts one recall a day and keeps the newest", () => {
    const today = new Date(NOW);
    expect(withRecall(["2026-09-25"], today)).toEqual(["2026-09-25"]);
    const many = Array.from({ length: 20 }, (_, day) => `2026-08-${String(day + 1).padStart(2, "0")}`);
    const kept = withRecall(many, today);
    expect(kept).toHaveLength(MAX_RECALLS);
    expect(kept.at(-1)).toBe("2026-09-25");
  });
});
