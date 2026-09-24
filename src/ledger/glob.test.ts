import { describe, expect, it } from "vitest";
import { globMatches, globProblem, inScope, normalizeGlob } from "./glob";

describe("decision scope globs", () => {
  it("crosses folders with ** and stays in one segment with * and ?", () => {
    expect(globMatches("src/**/*.ts", "src/a.ts")).toBe(true);
    expect(globMatches("src/**/*.ts", "src/agent/deep/b.ts")).toBe(true);
    expect(globMatches("src/*.ts", "src/agent/b.ts")).toBe(false);
    expect(globMatches("src/memory/**", "src/memory/store.ts")).toBe(true);
    expect(globMatches("src/memory/**", "src/memoryx/store.ts")).toBe(false);
    expect(globMatches("docs/?.md", "docs/a.md")).toBe(true);
    expect(globMatches("docs/?.md", "docs/ab.md")).toBe(false);
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

  it("ignores case where the filesystem does, and only there", () => {
    expect(inScope("Src/API/users.ts", ["src/api/**"], true)).toBe(true);
    expect(inScope("src/api/users.ts", ["src/API/**"], true)).toBe(true);
    expect(inScope("Src/API/users.ts", ["src/api/**"], false)).toBe(false);
  });

  it("treats an empty scope as the whole project and ignores separators and a leading ./", () => {
    expect(inScope("anything/at/all.md", [])).toBe(true);
    expect(inScope("src\\agent\\agent.ts", ["./src/agent/**"])).toBe(true);
    expect(inScope("frontend/src/app.tsx", ["src/**"])).toBe(false);
  });
});

describe("pathological globs", () => {
  it("collapses runs of **, and matches a deep path at once", () => {
    expect(normalizeGlob("**/**/**/x")).toBe("**/x");
    expect(normalizeGlob("src/**/**")).toBe("src/**");
    expect(normalizeGlob("a/***/b")).toBe("a/**/b");
    const deep = `${Array.from({ length: 24 }, (_, index) => `d${index}`).join("/")}/leaf.ts`;
    const started = performance.now();
    expect(inScope(deep, [`${"**/".repeat(12)}other.ts`])).toBe(false);
    expect(inScope(deep, [`${"**/".repeat(12)}leaf.ts`])).toBe(true);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("matches in time proportional to the pattern and the path, whatever the wildcards", () => {
    // Review round 3 (2026-09-24): single stars passed the globstar cap, a committed file skipped it, and a
    // backtracking regular expression took minutes on these.
    const started = performance.now();
    expect(inScope("a".repeat(400), [`${"*a".repeat(16)}*x`])).toBe(false);
    expect(inScope("a".repeat(400), [`${"a**".repeat(13)}x`])).toBe(false);
    expect(inScope(`src/ui/${"a-".repeat(200)}b.ts`, ["src/**/*-*-*-*-*-*-*-*-*-*-*.ts"])).toBe(true);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("over-covers a scope too long to expand instead of throwing, and keeps brace edges apart", () => {
    // Review of round 3 (2026-09-24): 30,000 serial groups overflowed the stack and ended every turn; stars
    // on both sides of a brace fused into a globstar that crossed folders.
    expect(inScope("src/a.ts", ["{a}".repeat(30_000)])).toBe(true);
    expect(globProblem("{a}".repeat(400))).toContain("longer than");
    expect(inScope("src/deep/nested/file.ts", ["src/*{,.test}*.ts"])).toBe(false);
    expect(inScope("src/a.test.ts", ["src/*{,.test}*.ts"])).toBe(true);
    expect(inScope("src/ax.ts", ["src/{a*,b}**/x.ts"])).toBe(true);
  });

  it("names a scope that keeps too many ** after collapsing", () => {
    expect(globProblem("**/**/**/src/**")).toBeNull();
    expect(globProblem("**/a/**/b/**/c/**/d")).toBe('**/a/**/b/**/c/**/d holds more than 3 "**"');
  });
});
