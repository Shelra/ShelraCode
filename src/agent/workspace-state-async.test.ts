import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureWorkspaceState, captureWorkspaceStateAsync, changedPaths, readHeadCommit } from "./workspace-state";

const hasGit = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;
const roots: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "shelra-workspace-async-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const gitIn = (root: string, ...args: string[]) =>
  spawnSync("git", ["-C", root, ...args], { windowsHide: true, encoding: "utf8" });

function repo(): string {
  const root = workspace();
  gitIn(root, "init", "-q", "-b", "main");
  gitIn(root, "config", "user.email", "test@example.test");
  gitIn(root, "config", "user.name", "test");
  writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
  gitIn(root, "add", "-A");
  gitIn(root, "commit", "-q", "-m", "init");
  return root;
}

describe("captureWorkspaceStateAsync", () => {
  it("reads a folder outside git the way the blocking reading does", async () => {
    const root = workspace();
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "src", "a.ts"), "a");
    writeFileSync(join(root, "b.ts"), "b");
    writeFileSync(join(root, "node_modules", "dep.js"), "ignored");
    const blocking = captureWorkspaceState(root);
    const async = await captureWorkspaceStateAsync(root);
    expect(async.kind).toBe("walk");
    expect([...async.files]).toEqual(expect.arrayContaining([...blocking.files]));
    expect(async.files.size).toBe(blocking.files.size);
    expect(async.files.has("node_modules/dep.js")).toBe(false);
  });

  it.skipIf(!hasGit)("reads a git repository the way the blocking reading does, commit included", async () => {
    const root = repo();
    writeFileSync(join(root, "a.ts"), "export const a = 2;\n");
    writeFileSync(join(root, "new.ts"), "export const n = 1;\n");
    const blocking = captureWorkspaceState(root);
    const async = await captureWorkspaceStateAsync(root);
    expect(async.kind).toBe("git");
    expect(async.head?.commit).toBe(blocking.head?.commit);
    expect(async.head?.commit).toMatch(/^[0-9a-f]{40,64}$/u);
    expect([...async.files.keys()].sort()).toEqual([...blocking.files.keys()].sort());
    expect(changedPaths(blocking, async)).toEqual([]);
  });

  it.skipIf(!hasGit)("leaves the event loop free while git works", async () => {
    const root = repo();
    for (let i = 0; i < 400; i += 1) writeFileSync(join(root, `untracked-${i}.ts`), `export const v${i} = ${i};\n`);
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 1);
    try {
      await captureWorkspaceStateAsync(root);
    } finally {
      clearInterval(timer);
    }
    // A blocking reading would let none of them run.
    expect(ticks).toBeGreaterThan(2);
  });
});

describe.skipIf(!hasGit)("readHeadCommit", () => {
  it("names the commit a branch points at, as git does", () => {
    const root = repo();
    expect(readHeadCommit(root)).toBe(gitIn(root, "rev-parse", "HEAD").stdout.trim());
  });

  it("follows the branch after the refs were packed", () => {
    const root = repo();
    gitIn(root, "pack-refs", "--all");
    expect(readHeadCommit(root)).toBe(gitIn(root, "rev-parse", "HEAD").stdout.trim());
  });

  it("gives up on a reftable repository, whose refs only git can read", () => {
    const root = repo();
    mkdirSync(join(root, ".git", "reftable"), { recursive: true });
    expect(readHeadCommit(root)).toBeNull();
  });

  it("reads a detached HEAD", () => {
    const root = repo();
    const sha = gitIn(root, "rev-parse", "HEAD").stdout.trim();
    gitIn(root, "checkout", "-q", "--detach");
    expect(readHeadCommit(root)).toBe(sha);
  });

  it("says a repository without commits has none, and gives up on anything it cannot read", () => {
    const root = workspace();
    gitIn(root, "init", "-q", "-b", "main");
    expect(readHeadCommit(root)).toBe("");
    expect(readHeadCommit(workspace())).toBeNull();
  });
});
