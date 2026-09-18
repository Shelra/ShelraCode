import { describe, expect, it } from "vitest";
import { countStatedBehaviors, extractRequirements, isRequirementDense } from "./requirements";

describe("requirement extraction", () => {
  it("lists obligation-shaped sentences and skips process instructions", () => {
    const prompt =
      "Repair and complete migrateState in src/state.ts. Migrate version 1 state to version 2: trim userName into profile.name, move a valid theme into preferences.theme, use system for an absent or invalid theme, and preserve unrelated root metadata. Version 2 input must be returned as a deep-equal new value without mutation. Reject unsupported versions with an error. Do not modify tests. Run bun test before completing.";
    const requirements = extractRequirements(prompt);
    expect(requirements).toEqual([
      "Repair and complete migrateState in src/state.ts.",
      "Migrate version 1 state to version 2: trim userName into profile.name, move a valid theme into preferences.theme, use system for an absent or invalid theme, and preserve unrelated root metadata.",
      "Version 2 input must be returned as a deep-equal new value without mutation.",
      "Reject unsupported versions with an error.",
    ]);
    expect(isRequirementDense(prompt)).toBe(true);
  });

  it("counts enumerated behaviors inside one sentence", () => {
    const single =
      "The class must accept an injected clock, expire entries when now is greater than or equal to the expiry timestamp, make get and has remove stale entries, treat ttl 0 as immediately expired, allow overwriting a key with a new TTL, and keep delete idempotent.";
    expect(extractRequirements(single)).toHaveLength(1);
    expect(countStatedBehaviors(extractRequirements(single))).toBe(6);
    expect(isRequirementDense(single)).toBe(true);
  });

  it("treats a short single-behavior request as not dense", () => {
    expect(extractRequirements("Fix the typo in README.md.")).toEqual([]);
    expect(isRequirementDense("Rename foo to bar everywhere. Run the tests.")).toBe(false);
    expect(isRequirementDense("The parser must reject empty input.")).toBe(false);
  });

  it("caps and deduplicates", () => {
    const sentence = "The parser must reject empty input. ";
    expect(extractRequirements(sentence.repeat(5))).toHaveLength(1);
    const many = Array.from({ length: 15 }, (_, index) => `Rule ${index} must hold for input ${index}.`).join(" ");
    expect(extractRequirements(many)).toHaveLength(10);
  });
});
