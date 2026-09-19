import { describe, expect, it } from "vitest";
import { fallbackTitle, looksLikeReasoning, normalizeRecap, validTitle } from "./auxiliary";

describe("recap normalization", () => {
  it("rejects echoed recap instructions instead of exposing them in the composer area", () => {
    expect(normalizeRecap("We need to output a terse coding-session recap, no bullets or headings.")).toBe("");
  });

  it("keeps a concise operational recap", () => {
    expect(normalizeRecap("Updated session hydration. Restart verification remains pending.")).toBe(
      "Updated session hydration. Restart verification remains pending.",
    );
  });

  it("drops a recap that is the model thinking out loud", () => {
    expect(
      normalizeRecap("The user wants me to create a recap of this coding session. Let me analyze what happened: 1."),
    ).toBe("");
    expect(normalizeRecap("Okay, so the tests fail because of the comparison.")).toBe("");
  });

  it("removes <think> blocks and keeps what follows", () => {
    expect(normalizeRecap("<think>plan the recap</think>Fixed isExpired; tests pass.")).toBe(
      "Fixed isExpired; tests pass.",
    );
    expect(normalizeRecap("<think>never closed")).toBe("");
  });

  it("does not reject real recaps that merely mention a user", () => {
    expect(normalizeRecap("The user model now validates emails; run the suite next.")).not.toBe("");
    expect(normalizeRecap("Added a user-facing error for expired sessions.")).not.toBe("");
  });
});

describe("title validation", () => {
  it("accepts a short single-line title and strips quotes and a final period", () => {
    expect(validTitle('"Fix token refresh tests."')).toBe("Fix token refresh tests");
    expect(validTitle("Fix token refresh tests\nA second line")).toBe("Fix token refresh tests");
  });

  it("rejects reasoning, run-on sentences and empty output", () => {
    expect(
      validTitle(
        "The user wants an overview of a project, including what each file does, its exports, and how tests cover them.",
      ),
    ).toBeNull();
    expect(validTitle("Let me think about a good title for this")).toBeNull();
    expect(validTitle("")).toBeNull();
    expect(validTitle(undefined)).toBeNull();
    expect(validTitle("a b c d e f g h i j k")).toBeNull();
  });

  it("rejects tool-call markup and JSON that a model answered with instead of a title", () => {
    expect(validTitle('{"tool":"bash",')).toBeNull();
    expect(validTitle('[{"name":"read_file"}]')).toBeNull();
    expect(validTitle("<tool_call>bash</tool_call>")).toBeNull();
    // A leading label is stripped rather than rejected.
    expect(validTitle('Title: "Fix tests"')).toBe("Fix tests");
  });

  it("falls back to the first words of what the user asked", () => {
    expect(fallbackTitle("Fix the failing token refresh tests in src/auth.ts and keep the public API unchanged")).toBe(
      "Fix the failing token refresh tests in",
    );
    expect(fallbackTitle("")).toBe("New session");
    expect(fallbackTitle("```ts\ncode only\n```")).toBe("New session");
  });
});

describe("looksLikeReasoning", () => {
  it("recognises thinking-out-loud openers", () => {
    for (const text of [
      "Let me analyze this.",
      "I need to write a recap",
      "The user asked for an overview",
      "Hmm, the tests",
    ]) {
      expect(looksLikeReasoning(text)).toBe(true);
    }
  });

  it("leaves ordinary text alone", () => {
    for (const text of ["Fixed isExpired", "Session refresh tests", "Refactor the user store"]) {
      expect(looksLikeReasoning(text)).toBe(false);
    }
  });
});
