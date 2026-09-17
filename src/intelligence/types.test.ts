import { describe, expect, it } from "vitest";
import { emptyLedger, recordUsage } from "./types";

describe("intelligence ledger token provenance", () => {
  it("marks aggregate token totals incomplete when a provider omits usage", () => {
    const ledger = emptyLedger();
    recordUsage(ledger, "implement", {
      inputTokens: 12,
      costAvailable: true,
      costUsd: 0,
      durationMs: 5,
    });

    expect(ledger.inputTokens).toBe(12);
    expect(ledger.inputTokensComplete).toBe(true);
    expect(ledger.outputTokensComplete).toBe(false);
  });
});
