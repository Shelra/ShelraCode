import { describe, expect, it } from "vitest";
import {
  type BudgetUsage,
  checkBudget,
  estimateModelCostMicros,
  estimateRequestCostMicros,
  parseBudgetUsd,
} from "./budget";

const usage: BudgetUsage = {
  requestMicros: 0,
  taskMicros: 0,
  sessionMicros: 250_000,
  dayMicros: 250_000,
};

const model = {
  id: "openrouter/example/coder",
  name: "Example Coder",
  contextWindow: 32_000,
  inputPrice: 0.000001,
  outputPrice: 0.000002,
  reasoning: false,
  description: "test model",
  maxOutputTokens: 100,
};

describe("budget policy", () => {
  it("estimates input and output cost in integer microdollars", () => {
    expect(estimateModelCostMicros(model, 10, 5)).toBe(20);
    expect(estimateRequestCostMicros(model, 10)).toBe(210);
  });

  it("blocks a request when session usage plus its estimate crosses the limit", () => {
    const check = checkBudget({ maxSessionUsd: 0.0004 }, usage, "session", 200_000);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("session budget would be exceeded");
  });

  it("allows a free request under a zero budget", () => {
    const check = checkBudget({ maxRequestUsd: 0, maxSessionUsd: 0 }, usage, "request", 0);
    expect(check.allowed).toBe(true);
  });

  it("parses non-negative CLI values and rejects invalid amounts", () => {
    expect(parseBudgetUsd("0")).toBe(0);
    expect(parseBudgetUsd("1.25")).toBe(1.25);
    expect(() => parseBudgetUsd("-1")).toThrow("non-negative");
  });
});
