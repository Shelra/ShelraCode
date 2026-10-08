import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureWorkspaceState, changedPaths, existedAt, mergeChangedFiles } from "./workspace-state";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readSync: vi.fn(actual.readSync) };
});

const roots: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "shelra-workspace-state-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

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

  it("detects a same-size rewrite even when its modification time is restored", () => {
    const root = workspace();
    const path = join(root, "a.ts");
    writeFileSync(path, "export const a = 1;\n");
    const stat = statSync(path);
    const before = captureWorkspaceState(root);
    writeFileSync(path, "export const a = 2;\n");
    utimesSync(path, stat.atime, stat.mtime);

    expect(changedPaths(before, captureWorkspaceState(root))).toEqual(["a.ts"]);
  });

  it("does not treat timestamp changes as content changes", () => {
    const root = workspace();
    const path = join(root, "a.ts");
    writeFileSync(path, "export const a = 1;\n");
    const before = captureWorkspaceState(root);
    utimesSync(path, new Date(), new Date(Date.now() + 5_000));

    expect(changedPaths(before, captureWorkspaceState(root))).toEqual([]);
  });

  it("does not present an unreadable workspace as an empty complete reading", () => {
    const root = workspace();
    const missing = join(root, "missing");

    expect(captureWorkspaceState(missing).kind).toBe("unknown");
  });

  it("does not report a read error as a deleted file", () => {
    const root = workspace();
    writeFileSync(join(root, "a.ts"), "export const a = 1;\n");
    vi.mocked(fs.readSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("Access denied"), { code: "EACCES" });
    });

    expect(captureWorkspaceState(root).kind).toBe("unknown");
  });

  it("does not trust a file that disappears while its content is being read", async () => {
    const root = workspace();
    const path = join(root, "a.ts");
    writeFileSync(path, "export const a = 1;\n");
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    vi.mocked(fs.readSync).mockImplementationOnce((file, buffer) => {
      const bytes = actual.readSync(file, buffer);
      rmSync(path);
      return bytes;
    });

    expect(captureWorkspaceState(root).kind).toBe("unknown");
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

  it("hashes dirty and untracked content rather than trusting size and mtime", () => {
    const root = repo();
    const tracked = join(root, "a.ts");
    const untracked = join(root, "draft.ts");
    writeFileSync(tracked, "export const a = 2;\n");
    writeFileSync(untracked, "export const draft = 1;\n");
    const trackedTime = statSync(tracked);
    const untrackedTime = statSync(untracked);
    const before = captureWorkspaceState(root);

    writeFileSync(tracked, "export const a = 3;\n");
    writeFileSync(untracked, "export const draft = 2;\n");
    utimesSync(tracked, trackedTime.atime, trackedTime.mtime);
    utimesSync(untracked, untrackedTime.atime, untrackedTime.mtime);

    expect(changedPaths(before, captureWorkspaceState(root))).toEqual(["a.ts", "draft.ts"]);
  });

  it("returns unknown when a git entry cannot have a complete file signature", () => {
    const root = repo();
    const path = join(root, "a.ts");
    rmSync(path);
    mkdirSync(path);
    writeFileSync(join(path, "replacement.ts"), "export {};\n");

    expect(captureWorkspaceState(root).kind).toBe("unknown");
  });

  it("does not fall back to a walk when Git cannot report the repository", () => {
    const root = repo();
    writeFileSync(join(root, ".git", "HEAD"), "invalid head\n");

    expect(captureWorkspaceState(root).kind).toBe("unknown");
  });

  it("returns unknown comparison when Git cannot compare the recorded commits", () => {
    const root = repo();
    const before = captureWorkspaceState(root);
    const after = captureWorkspaceState(root);
    if (!after.head) throw new Error("Expected a recorded HEAD");
    after.head.commit = "0".repeat(40);

    expect(changedPaths(before, after)).toBeNull();
  });

  it("does not compare git readings taken in different scopes", () => {
    const root = repo();
    const before = captureWorkspaceState(root);
    const after = captureWorkspaceState(root);
    if (!after.head) throw new Error("Expected a recorded HEAD");
    after.head.cwd = join(root, "other-scope");

    expect(changedPaths(before, after)).toBeNull();
  });

  it("sees files created and committed after an unborn HEAD", () => {
    const root = workspace();
    const git = (...args: string[]) => spawnSync("git", ["-C", root, ...args], { windowsHide: true, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.email", "test@example.test");
    git("config", "user.name", "test");
    const before = captureWorkspaceState(root);
    expect(before.head?.commit).toBe("");
    writeFileSync(join(root, "first.ts"), "export {};\n");
    git("add", "-A");
    git("commit", "-q", "-m", "first");
    const after = captureWorkspaceState(root);

    expect(after.files.size).toBe(0);
    expect(changedPaths(before, after)).toEqual(["first.ts"]);
  });

  it("counts only the session's folder when it works inside a larger repository", async () => {
    // Seen live 2026-09-24: a session started in a subfolder of this repository asked what BIM is; another
    // session's edits under src/ read as its own changes, and the gate sent it off to check and fix them.
    const root = repo();
    const folder = join(root, "games", "mario");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "index.html"), "<p>1</p>\n");
    const before = captureWorkspaceState(folder);

    await later();
    writeFileSync(join(root, "a.ts"), "export const a = 2;\n");
    writeFileSync(join(root, "elsewhere.ts"), "export {};\n");
    expect(changedPaths(before, captureWorkspaceState(folder))).toEqual([]);

    writeFileSync(join(folder, "index.html"), "<p>2</p>\n");
    expect(changedPaths(before, captureWorkspaceState(folder))).toEqual(["index.html"]);
  });

  it("sees what the turn committed, which leaves git status clean (seen 2026-10-03, three runs of three)", async () => {
    const root = repo();
    const git = (...args: string[]) => spawnSync("git", ["-C", root, ...args], { windowsHide: true, encoding: "utf8" });
    const start = captureWorkspaceState(root);
    expect(start.head?.commit).toMatch(/^[0-9a-f]{40}$/u);

    await later();
    writeFileSync(join(root, "a.ts"), "export const a = 'weakened';\n");
    writeFileSync(join(root, "made.test.ts"), "test('new', () => {});\n");
    git("add", "-A");
    git("commit", "-q", "-m", "change and hide it");

    const end = captureWorkspaceState(root);
    expect(end.files.size).toBe(0);
    expect(changedPaths(start, end)).toEqual(["a.ts", "made.test.ts"]);
    // What the turn created and committed did not exist before it; what it edited did.
    expect(existedAt(start, root, "made.test.ts")).toBe(false);
    expect(existedAt(start, root, "a.ts")).toBe(true);
    // A dozen git processes: well under a second alone, more under a full parallel test run.
  }, 20_000);
});

describe("mergeChangedFiles", () => {
  it("merges absolute and relative paths without duplicates", () => {
    const cwd = join(tmpdir(), "ws");
    expect(mergeChangedFiles(cwd, [join(cwd, "src", "a.ts")], ["src/a.ts", "./b.ts"])).toEqual(["src/a.ts", "b.ts"]);
  });
});
