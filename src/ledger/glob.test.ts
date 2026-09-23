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

  it("reads {a,b} as either alternative, and an unbalanced brace as itself", () => {
    expect(inScope("src/ui/app.tsx", ["src/**/*.{ts,tsx}"])).toBe(true);
    expect(inScope("src/agent/agent.ts", ["src/**/*.{ts,tsx}"])).toBe(true);
    expect(inScope("src/ui/theme.css", ["src/**/*.{ts,tsx}"])).toBe(false);
    expect(inScope("notes/decisions/0001-x.md", ["{docs,notes}/decisions"])).toBe(true);
    expect(inScope("src/{a.ts", ["src/{a.ts"])).toBe(true);
    expect(inScope("src/a}.ts", ["src/*}.ts"])).toBe(true);
  });

  it("treats an empty scope as the whole project and ignores separators and a leading ./", () => {
    expect(inScope("anything/at/all.md", [])).toBe(true);
    expect(inScope("src\\agent\\agent.ts", ["./src/agent/**"])).toBe(true);
    expect(inScope("frontend/src/app.tsx", ["src/**"])).toBe(false);
  });
});
