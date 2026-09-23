import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { captureWorkspaceState, changedPaths, existedAt, mergeChangedFiles } from "./workspace-state";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "shelra-workspace-state-"));
}

/** Waits past the file system's timestamp resolution so a rewrite changes the signature. */
function later(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe("workspace state outside a git repository", () => {
  it("sees a file a shell command wrote, changed or deleted", async () => {
    const root = workspace();
    writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
    writeFileSync(join(root, "gone.ts"), "x\n");
    const before = captureWorkspaceState(root);
    expect(before.kind).toBe("walk");

    await later();
    writeFileSync(join(root, "a.ts"), "export const a = 22;\n");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "new.ts"), "export {};\n");
    rmSync(join(root, "gone.ts"));

    expect(changedPaths(before, captureWorkspaceState(root))).toEqual(["a.ts", "gone.ts", "src/new.ts"]);
  });

  it("ignores dependencies, build output and Shelra's own state", () => {
    const root = workspace();
    const before = captureWorkspaceState(root);
    for (const dir of ["node_modules/pkg", "dist", ".shelra/memory", "coverage"]) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, "file.js"), "x\n");
    }
    expect(changedPaths(before, captureWorkspaceState(root))).toEqual([]);
  });

  it("reports nothing it cannot compare", () => {
    expect(changedPaths({ kind: "unknown", files: new Map() }, { kind: "walk", files: new Map() })).toBeNull();
  });
});

const hasGit = spawnSync("git", ["--version"], { windowsHide: true }).status === 0;

describe.skipIf(!hasGit)("workspace state in a git repository", () => {
  function repo(): string {
    const root = workspace();
    const git = (...args: string[]) => spawnSync("git", ["-C", root, ...args], { windowsHide: true, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "test@example.test");
    git("config", "user.name", "test");
    writeFileSync(join(root, ".gitignore"), "generated/\n");
    writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
    return root;
  }

  it("sees a tracked file changed and an untracked file added, and not ignored output", async () => {
    const root = repo();
    const before = captureWorkspaceState(root);
    expect(before.kind).toBe("git");
    expect(before.files.size).toBe(0);

    await later();
    writeFileSync(join(root, "a.ts"), "export const a = 2;\n");
    writeFileSync(join(root, "b.ts"), "export const b = 1;\n");
    mkdirSync(join(root, "generated"));
    writeFileSync(join(root, "generated", "out.js"), "x\n");

    expect(changedPaths(before, captureWorkspaceState(root))).toEqual(["a.ts", "b.ts"]);
  });

  it("knows which files existed at the start: tracked ones, and ones already changed then (audit doc 15, 1.5)", () => {
    const root = repo();
    writeFileSync(join(root, "draft.ts"), "export {};\n");
    const start = captureWorkspaceState(root);
    writeFileSync(join(root, "new.ts"), "export {};\n");

    expect(existedAt(start, root, "a.ts")).toBe(true);
    expect(existedAt(start, root, "draft.ts")).toBe(true);
    expect(existedAt(start, root, "new.ts")).toBe(false);
  });

  it("sees a file changed again after it was already dirty", async () => {
    const root = repo();
    writeFileSync(join(root, "a.ts"), "export const a = 2;\n");
    const dirty = captureWorkspaceState(root);
    await later();
    writeFileSync(join(root, "a.ts"), "export const a = 333;\n");
    expect(changedPaths(dirty, captureWorkspaceState(root))).toEqual(["a.ts"]);
  });
});

describe("mergeChangedFiles", () => {
  it("merges absolute and relative paths without duplicates", () => {
    const cwd = join(tmpdir(), "ws");
    expect(mergeChangedFiles(cwd, [join(cwd, "src", "a.ts")], ["src/a.ts", "./b.ts"])).toEqual(["src/a.ts", "b.ts"]);
  });
});
