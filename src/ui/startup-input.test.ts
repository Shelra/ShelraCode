import { describe, expect, it } from "vitest";
import { resolveStartupKeyAction } from "./startup-input";

describe("startup input", () => {
  it("accepts OpenTUI enter names and CR/LF sequences", () => {
    for (const key of [{ name: "return" }, { name: "enter" }, { sequence: "\r" }, { sequence: "\n" }]) {
      expect(resolveStartupKeyAction(key, "onboarding", true)).toBe("install");
    }
  });

  it("keeps retry available without an install runtime", () => {
    expect(resolveStartupKeyAction({ name: "return" }, "onboarding", false)).toBeUndefined();
    expect(resolveStartupKeyAction({ name: "r" }, "onboarding", false)).toBe("retry");
  });

  it("supports retry and exit from recoverable startup states", () => {
    expect(resolveStartupKeyAction({ name: "r" }, "recoverable-error", false)).toBe("retry");
    expect(resolveStartupKeyAction({ name: "escape" }, "recoverable-error", false)).toBe("exit");
    expect(resolveStartupKeyAction({ name: "c", ctrl: true }, "recoverable-error", false)).toBe("exit");
  });
});
