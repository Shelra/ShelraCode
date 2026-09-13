import { describe, expect, it } from "vitest";
import { normalizeRecap } from "./auxiliary";

describe("recap normalization", () => {
  it("rejects echoed recap instructions instead of exposing them in the composer area", () => {
    expect(normalizeRecap("We need to output a terse coding-session recap, no bullets or headings.")).toBe("");
  });

  it("keeps a concise operational recap", () => {
    expect(normalizeRecap("Updated session hydration. Restart verification remains pending.")).toBe(
      "Updated session hydration. Restart verification remains pending.",
    );
  });
});
