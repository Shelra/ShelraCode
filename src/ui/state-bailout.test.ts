import { describe, expect, it } from "vitest";
import { type SessionUsageSummary, sameSnapshot, sameUsageSummary } from "./observability";

const usage = (overrides: Partial<SessionUsageSummary> = {}): SessionUsageSummary => ({
  inputTokens: 100,
  outputTokens: 20,
  totalTokens: 120,
  costMicros: 0,
  eventCount: 3,
  models: ["a", "b"],
  sources: ["main"],
  lastUpdatedAt: 5,
  ...overrides,
});

describe("sameUsageSummary", () => {
  it("treats a re-read of unchanged usage as the same, so polling does not redraw the screen", () => {
    expect(sameUsageSummary(usage(), usage())).toBe(true);
  });

  it("sees every figure the screen shows", () => {
    expect(sameUsageSummary(usage(), usage({ totalTokens: 121 }))).toBe(false);
    expect(sameUsageSummary(usage(), usage({ costMicros: 1 }))).toBe(false);
    expect(sameUsageSummary(usage(), usage({ eventCount: 4 }))).toBe(false);
    expect(sameUsageSummary(usage(), usage({ models: ["a"] }))).toBe(false);
    expect(sameUsageSummary(usage(), usage({ lastUpdatedAt: null }))).toBe(false);
  });
});

describe("sameSnapshot", () => {
  it("keeps equal snapshots and null as they are", () => {
    expect(sameSnapshot(null, null)).toBe(true);
    expect(sameSnapshot({ phase: "act", steps: [1, 2] }, { phase: "act", steps: [1, 2] })).toBe(true);
  });

  it("reports a change, including to or from nothing", () => {
    expect(sameSnapshot({ phase: "act" }, { phase: "verify" })).toBe(false);
    expect(sameSnapshot(null, { phase: "act" })).toBe(false);
    expect(sameSnapshot({ phase: "act" }, null)).toBe(false);
  });

  it("never throws on a value that cannot be serialised", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(sameSnapshot(loop, { ...loop })).toBe(false);
  });
});
