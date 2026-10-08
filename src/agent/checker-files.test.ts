import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  opendirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureCheckerFiles,
  checkerFilesMatch,
  checkerWriteProblem,
  clearCheckerFiles,
  restoreCheckerFiles,
} from "./checker-files";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, opendirSync: vi.fn(actual.opendirSync) };
});

const roots: string[] = [];
const links: string[] = [];

function fixture(): { root: string; verify: string; source: string } {
  const root = mkdtempSync(join(tmpdir(), "shelra-checker-files-"));
  roots.push(root);
  const verify = join(root, ".shelra", "verify");
  mkdirSync(verify, { recursive: true });
  const source = join(root, "source.ts");
  writeFileSync(source, "export const value = 1;\n");
  return { root, verify, source };
}

function directoryLink(path: string, target: string): void {
  // Windows junctions do not require the developer-mode privilege that file symlinks need.
  symlinkSync(target, path, process.platform === "win32" ? "junction" : "dir");
  links.push(path);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const path of links.splice(0).reverse()) {
    try {
      unlinkSync(path);
    } catch {
      // A rejected restore/clear may have left the junction; rm removes its entry, never its target.
      rmSync(path, { force: true });
    }
  }
  for (const root of roots.splice(0)) {
    const rel = relative(resolve(tmpdir()), resolve(root));
    if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
      throw new Error("Test cleanup target escaped its scratch directory.");
    }
    rmSync(resolve(root), { recursive: true, force: true });
  }
});

describe("host-owned checker files", () => {
  it("captures every original and restores exact UTF-8 bytes without touching project source", () => {
    const { root, verify, source } = fixture();
    const content = "\uFEFF// español\r\nexport const value = '✓';\r\n";
    writeFileSync(join(verify, "check.test.ts"), content);
    mkdirSync(join(verify, "helpers"));
    writeFileSync(join(verify, "helpers", "expected.ts"), "export const expected = 42;\n");
    const captured = captureCheckerFiles(root);
    expect(captured.ok).toBe(true);
    if (!captured.ok) throw new Error(captured.reason);
    expect(captured.files.size).toBe(2);
    expect(captured.files.get(".shelra/verify/check.test.ts")).toBe(content);
    writeFileSync(join(verify, "check.test.ts"), "modified\n");
    writeFileSync(join(verify, "extra.ts"), "extra\n");
    expect(checkerFilesMatch(root, captured.files).ok).toBe(false);
    expect(restoreCheckerFiles(root, captured.files)).toEqual({ ok: true });
    expect(readFileSync(join(verify, "check.test.ts"))).toEqual(Buffer.from(content, "utf8"));
    expect(existsSync(join(verify, "extra.ts"))).toBe(false);
    expect(checkerFilesMatch(root, captured.files)).toEqual({ ok: true });
    expect(readFileSync(source, "utf8")).toBe("export const value = 1;\n");
    expect(clearCheckerFiles(root)).toEqual({ ok: true });
    expect(existsSync(verify)).toBe(false);
    expect(readFileSync(source, "utf8")).toBe("export const value = 1;\n");
  });

  it("treats an absent verify area as empty, but a missing workspace as unknown", () => {
    const { root, verify, source } = fixture();
    rmSync(verify, { recursive: true });
    expect(captureCheckerFiles(root)).toEqual({ ok: true, files: new Map() });
    expect(clearCheckerFiles(root)).toEqual({ ok: true });
    expect(restoreCheckerFiles(root, new Map())).toEqual({ ok: true });
    expect(captureCheckerFiles(join(root, "missing"))).toEqual(expect.objectContaining({ ok: false }));
    expect(readFileSync(source, "utf8")).toBe("export const value = 1;\n");
  });

  it("does not mistake an unreadable tree for an empty or partial capture", () => {
    const { root, verify } = fixture();
    writeFileSync(join(verify, "check.ts"), "original\n");
    vi.mocked(opendirSync).mockImplementationOnce(() => {
      throw new Error("checker directory unreadable");
    });
    expect(captureCheckerFiles(root)).toEqual({ ok: false, reason: "checker directory unreadable" });
    vi.mocked(opendirSync).mockImplementationOnce(() => {
      throw new Error("checker directory unreadable");
    });
    expect(clearCheckerFiles(root)).toEqual({ ok: false, reason: "checker directory unreadable" });
    expect(readFileSync(join(verify, "check.ts"), "utf8")).toBe("original\n");
  });

  it.each([
    Buffer.from([0xff, 0xfe]),
    Buffer.from("source\0binary"),
  ])("rejects binary or invalid UTF-8 without returning a partial map (%s)", (bad) => {
    const { root, verify } = fixture();
    writeFileSync(join(verify, "valid.ts"), "valid\n");
    writeFileSync(join(verify, "binary.ts"), bad);
    expect(captureCheckerFiles(root)).toEqual(expect.objectContaining({ ok: false }));
    // Safe cleanup still removes a bad regular file; it never needs to interpret its bytes.
    expect(clearCheckerFiles(root)).toEqual({ ok: true });
  });

  it("rejects more than twenty originals completely and accepts the exact file bound", () => {
    const { root, verify } = fixture();
    for (let index = 0; index < 20; index += 1) writeFileSync(join(verify, `${index}.ts`), "check\n");
    const complete = captureCheckerFiles(root);
    expect(complete.ok && complete.files.size).toBe(20);
    writeFileSync(join(verify, "overflow.ts"), "extra\n");
    expect(captureCheckerFiles(root)).toEqual(
      expect.objectContaining({ ok: false, reason: expect.stringContaining("20 files") }),
    );
  });

  it("rejects oversized originals on capture and before a restore clears existing files", () => {
    const { root, verify } = fixture();
    const target = join(verify, "check.ts");
    writeFileSync(target, "a".repeat(200 * 1024));
    expect(captureCheckerFiles(root).ok).toBe(true);
    writeFileSync(target, "a".repeat(200 * 1024 + 1));
    expect(captureCheckerFiles(root).ok).toBe(false);
    writeFileSync(target, "keep\n");
    expect(restoreCheckerFiles(root, new Map([[".shelra/verify/check.ts", "b".repeat(200 * 1024 + 1)]]))).toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(readFileSync(target, "utf8")).toBe("keep\n");
  });

  it("rejects too-deep trees and bounds exploration of empty directories", () => {
    const deep = fixture();
    mkdirSync(join(deep.verify, "a", "b", "c"), { recursive: true });
    writeFileSync(join(deep.verify, "a", "b", "c", "test.ts"), "check\n");
    expect(captureCheckerFiles(deep.root).ok).toBe(false);
    const wide = fixture();
    for (let index = 0; index < 129; index += 1) mkdirSync(join(wide.verify, `empty-${index}`));
    expect(captureCheckerFiles(wide.root)).toEqual(
      expect.objectContaining({ ok: false, reason: expect.stringContaining("128 entries") }),
    );
  });

  it("ignores only compiled Python cache, retaining source and checking added/removed originals", () => {
    const { root, verify } = fixture();
    writeFileSync(join(verify, "check.py"), "assert True\n");
    const original = captureCheckerFiles(root);
    if (!original.ok) throw new Error(original.reason);
    mkdirSync(join(verify, "__pycache__"));
    writeFileSync(join(verify, "__pycache__", "check.cpython-313.pyc"), Buffer.from([0, 0xff, 0x12]));
    expect(checkerFilesMatch(root, original.files)).toEqual({ ok: true });
    writeFileSync(join(verify, "__pycache__", "extra.py"), "raise RuntimeError()\n");
    expect(checkerFilesMatch(root, original.files).ok).toBe(false);
    expect(restoreCheckerFiles(root, original.files)).toEqual({ ok: true });
    expect(existsSync(join(verify, "__pycache__"))).toBe(false);
  });

  it.each([
    "../source.ts",
    ".shelra/verify/../../source.ts",
    ".shelra/memory/fact.ts",
    ".shelra/verify/../source.ts",
    ".shelra/verify//file.ts",
    ".shelra\\verify\\file.ts",
    ".shelra/verify/file.ts:stream",
  ])("rejects unsafe originals before clearing anything: %s", (path) => {
    const { root, verify, source } = fixture();
    writeFileSync(join(verify, "keep.ts"), "keep\n");
    expect(restoreCheckerFiles(root, new Map([[path, "injected\n"]]))).toEqual(expect.objectContaining({ ok: false }));
    expect(readFileSync(join(verify, "keep.ts"), "utf8")).toBe("keep\n");
    expect(readFileSync(source, "utf8")).toBe("export const value = 1;\n");
  });

  it("rejects absolute and conflicting originals while allowing a validated tool target inside verify", () => {
    const { root, verify, source } = fixture();
    expect(restoreCheckerFiles(root, new Map([[source, "injected\n"]])).ok).toBe(false);
    expect(restoreCheckerFiles(root, new Map([[join(verify, "test.ts"), "check\n"]])).ok).toBe(false);
    expect(
      restoreCheckerFiles(
        root,
        new Map([
          [".shelra/verify/a", "a\n"],
          [".shelra/verify/a/test.ts", "check\n"],
        ]),
      ).ok,
    ).toBe(false);
    expect(checkerWriteProblem(root, join(verify, "test.ts"))).toBeNull();
    expect(checkerWriteProblem(root, source)).not.toBeNull();
    expect(checkerWriteProblem(root, ".shelra/verify")).not.toBeNull();
    expect(checkerWriteProblem(root, "../test.ts", verify)).not.toBeNull();
  });

  it("restores an original even when its regular file was replaced with a regular directory", () => {
    const { root, verify } = fixture();
    mkdirSync(join(verify, "check.ts"));
    writeFileSync(join(verify, "check.ts", "extra.ts"), "extra\n");
    expect(restoreCheckerFiles(root, new Map([[".shelra/verify/check.ts", "original\n"]]))).toEqual({ ok: true });
    expect(readFileSync(join(verify, "check.ts"), "utf8")).toBe("original\n");
  });

  it.each([
    ".shelra",
    ".shelra/verify",
    ".shelra/verify/helpers",
    ".shelra/verify/__pycache__",
  ])("refuses capture, restore, match and cleanup through a directory link: %s", (relativeLink) => {
    const { root, source } = fixture();
    const outside = fixture();
    writeFileSync(join(outside.root, "do-not-touch.ts"), "outside\n");
    const link = join(root, relativeLink);
    if (existsSync(link)) rmSync(link, { recursive: true });
    directoryLink(link, outside.root);
    const original = new Map([[".shelra/verify/check.ts", "original\n"]]);
    expect(captureCheckerFiles(root).ok).toBe(false);
    expect(restoreCheckerFiles(root, original).ok).toBe(false);
    expect(checkerFilesMatch(root, original).ok).toBe(false);
    expect(clearCheckerFiles(root).ok).toBe(false);
    expect(checkerWriteProblem(root, join(root, relativeLink, "check.ts"))).not.toBeNull();
    expect(readFileSync(join(outside.root, "do-not-touch.ts"), "utf8")).toBe("outside\n");
    expect(readFileSync(source, "utf8")).toBe("export const value = 1;\n");
  });

  it("also refuses directory links that point inside the same workspace", () => {
    const { root, verify } = fixture();
    const other = join(root, "other");
    mkdirSync(other);
    writeFileSync(join(other, "keep.ts"), "keep\n");
    directoryLink(join(verify, "helpers"), other);
    expect(captureCheckerFiles(root).ok).toBe(false);
    expect(clearCheckerFiles(root).ok).toBe(false);
    expect(readFileSync(join(other, "keep.ts"), "utf8")).toBe("keep\n");
  });

  it("refuses a regular file hard-linked to project source", () => {
    const { root, verify, source } = fixture();
    const linked = join(verify, "check.ts");
    linkSync(source, linked);
    expect(checkerWriteProblem(root, linked)).not.toBeNull();
    expect(captureCheckerFiles(root).ok).toBe(false);
    expect(clearCheckerFiles(root).ok).toBe(false);
    expect(restoreCheckerFiles(root, new Map([[".shelra/verify/check.ts", "changed\n"]])).ok).toBe(false);
    expect(readFileSync(source, "utf8")).toBe("export const value = 1;\n");
  });

  it.skipIf(process.platform === "win32")("refuses a symbolic link at the file itself", () => {
    const { root, verify, source } = fixture();
    const link = join(verify, "check.ts");
    symlinkSync(source, link);
    links.push(link);
    expect(captureCheckerFiles(root).ok).toBe(false);
    expect(clearCheckerFiles(root).ok).toBe(false);
    expect(checkerWriteProblem(root, link)).not.toBeNull();
    expect(readFileSync(source, "utf8")).toBe("export const value = 1;\n");
  });
});
