import { describe, expect, it } from "vitest";
import { globToRegExp, inScope } from "./glob";

describe("decision scope globs", () => {
  it("crosses folders with ** and stays in one segment with * and ?", () => {
    expect(globToRegExp("src/**/*.ts").test("src/a.ts")).toBe(true);
    expect(globToRegExp("src/**/*.ts").test("src/agent/deep/b.ts")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/agent/b.ts")).toBe(false);
    expect(globToRegExp("src/memory/**").test("src/memory/store.ts")).toBe(true);
    expect(globToRegExp("src/memory/**").test("src/memoryx/store.ts")).toBe(false);
    expect(globToRegExp("docs/?.md").test("docs/a.md")).toBe(true);
    expect(globToRegExp("docs/?.md").test("docs/ab.md")).toBe(false);
  });

  it("reads a pattern without wildcards as a file or a whole folder", () => {
    expect(inScope("src/tools/bash.ts", ["src/tools/bash.ts"])).toBe(true);
    expect(inScope("src/security/destructive.ts", ["src/security"])).toBe(true);
    expect(inScope("src/security/destructive.ts", ["src/security/"])).toBe(true);
    expect(inScope("src/securityx.ts", ["src/security"])).toBe(false);
  });

  it("treats an empty scope as the whole project and ignores separators and a leading ./", () => {
    expect(inScope("anything/at/all.md", [])).toBe(true);
    expect(inScope("src\\agent\\agent.ts", ["./src/agent/**"])).toBe(true);
    expect(inScope("frontend/src/app.tsx", ["src/**"])).toBe(false);
  });
});
