import { describe, expect, it } from "vitest";
import { formatRepeatSummary, summarizeRepeats, wilsonInterval } from "./repeat";

describe("wilsonInterval", () => {
  it("matches the published 95% interval and stays inside [0, 1] at the edges", () => {
    const mid = wilsonInterval(5, 10);
    expect(mid.low).toBeCloseTo(0.2366, 3);
    expect(mid.high).toBeCloseTo(0.7634, 3);
    const none = wilsonInterval(0, 8);
    expect(none.low).toBe(0);
    expect(none.high).toBeCloseTo(0.3244, 3);
    expect(wilsonInterval(8, 8).high).toBe(1);
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

describe("summarizeRepeats", () => {
  it("reports pass@1 over every attempt, pass^k per task and false completions", () => {
    const summary = summarizeRepeats([
      [
        { taskId: "a", passed: true, falseCompletion: false },
        { taskId: "b", passed: false, falseCompletion: true },
      ],
      [
        { taskId: "a", passed: true, falseCompletion: false },
        { taskId: "b", passed: true, falseCompletion: false },
      ],
      [
        { taskId: "a", passed: true, falseCompletion: false },
        { taskId: "b", passed: false, falseCompletion: false },
      ],
    ]);
    expect(summary).toMatchObject({
      repeats: 3,
      trials: 6,
      passes: 4,
      passAllK: { tasks: 1, of: 2 },
      falseCompletions: 1,
    });
    expect(summary.passAt1).toBeCloseTo(4 / 6);
    expect(summary.perTask).toEqual([
      { taskId: "a", passes: 3, attempts: 3, falseCompletions: 0 },
      { taskId: "b", passes: 1, attempts: 3, falseCompletions: 1 },
    ]);
    const lines = formatRepeatSummary(summary);
    expect(lines[0]).toBe("Repeated 3 times:");
    expect(lines.at(-1)).toContain(
      "pass@1 67% (95% CI 30%–90%, 6 attempts) · pass^3 1/2 tasks · false completions 1/6",
    );
  });

  it("counts pass^k only over tasks attempted in every repeat", () => {
    const summary = summarizeRepeats([
      [{ taskId: "a", passed: true, falseCompletion: false }],
      [
        { taskId: "a", passed: true, falseCompletion: false },
        { taskId: "late", passed: true, falseCompletion: false },
      ],
    ]);
    expect(summary.passAllK).toEqual({ tasks: 1, of: 1 });
  });
});
