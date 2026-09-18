import { describe, expect, it } from "vitest";
import { dominantLineEnding, normalizeLineEndings, restoreLineEndings } from "./line-endings";

describe("line endings", () => {
  it("detects the dominant ending", () => {
    expect(dominantLineEnding("a\r\nb\r\nc")).toBe("\r\n");
    expect(dominantLineEnding("a\nb\nc")).toBe("\n");
    expect(dominantLineEnding("a\r\nb\nc\nd")).toBe("\n");
    expect(dominantLineEnding("single line")).toBe("\n");
  });

  it("normalizes and restores", () => {
    expect(normalizeLineEndings("a\r\nb\r\n")).toBe("a\nb\n");
    expect(restoreLineEndings("a\nb\n", "\r\n")).toBe("a\r\nb\r\n");
    expect(restoreLineEndings("a\r\nb\n", "\r\n")).toBe("a\r\nb\r\n");
    expect(restoreLineEndings("a\nb\n", "\n")).toBe("a\nb\n");
  });
});
