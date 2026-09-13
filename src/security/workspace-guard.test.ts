import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { resolveWorkspacePath } from "./workspace-guard";

describe("workspace path guard", () => {
  it("allows contained paths and rejects traversal", () => {
    const root = mkdtempSync(join(tmpdir(), "grok-workspace-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "file.ts"), "ok");
    expect(resolveWorkspacePath("src/file.ts", root).relativePath).toBe("src/file.ts");
    expect(() => resolveWorkspacePath("../outside.ts", root)).toThrow("outside the workspace");
  });

  it("resolves paths several levels deep into directories that do not exist yet", () => {
    const root = mkdtempSync(join(tmpdir(), "grok-workspace-"));
    expect(resolveWorkspacePath("newdir/file.ts", root).relativePath).toBe("newdir/file.ts");
    expect(resolveWorkspacePath("a/b/c/deep.ts", root).relativePath).toBe("a/b/c/deep.ts");
    expect(resolveWorkspacePath("a/b/c/deep.ts", root).path).toBe(join(root, "a", "b", "c", "deep.ts"));
    expect(() => resolveWorkspacePath("../nope/outside.ts", root)).toThrow("outside the workspace");
  });

  it("rejects a not-yet-existing path under a symlinked directory that escapes the workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "grok-workspace-"));
    const outside = mkdtempSync(join(tmpdir(), "grok-outside-"));
    symlinkSync(outside, join(root, "escape"), "junction");
    expect(() => resolveWorkspacePath("escape/new/file.ts", root)).toThrow("resolves outside");
  });

  it("rejects a symlink that points outside the workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "grok-workspace-"));
    const outside = mkdtempSync(join(tmpdir(), "grok-outside-"));
    writeFileSync(join(outside, "secret.txt"), "secret");
    symlinkSync(outside, join(root, "linked"), "junction");
    expect(() => resolveWorkspacePath("linked/secret.txt", root)).toThrow("resolves outside");
  });
});
