import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  opendirSync,
  openSync,
  readSync,
  realpathSync,
  rmSync,
  type Stats,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveWorkspacePath } from "../security/workspace-guard";

const VERIFY_DIR = ".shelra/verify";
const MAX_FILES = 20;
const MAX_FILE_BYTES = 200 * 1024;
const MAX_DEPTH = 3;
// Bound metadata exploration too, including empty directories and generated Python caches.
const MAX_NODES = 128;

export type CheckerFilesResult = { ok: true; files: ReadonlyMap<string, string> } | { ok: false; reason: string };
export type CheckerFilesOperation = { ok: true } | { ok: false; reason: string };

interface CheckerLocation {
  root: string;
  verify: string;
  exists: boolean;
}

function fail(error: unknown): { ok: false; reason: string } {
  return { ok: false, reason: error instanceof Error ? error.message : String(error) };
}

function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function statIfPresent(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function safeNode(path: string, root: string): Stats | null {
  const stat = statIfPresent(path);
  if (!stat) return null;
  if (stat.isSymbolicLink()) throw new Error(`Checker path is a symbolic link or junction: ${path}`);
  if (stat.isFile() && stat.nlink > 1) throw new Error(`Checker file has hard-link aliases: ${path}`);
  if (!stat.isDirectory() && !stat.isFile())
    throw new Error(`Checker path is not a regular file or directory: ${path}`);
  if (!inside(root, realpathSync.native(path))) throw new Error(`Checker path resolves outside its workspace: ${path}`);
  return stat;
}

/** Resolve the workspace first; neither Shelra's general scratch permission nor a linked verify area widens it. */
function location(workspace: string): CheckerLocation {
  const root = realpathSync.native(resolve(workspace));
  if (!lstatSync(root).isDirectory()) throw new Error("Checker workspace is not a directory.");
  const shelra = join(root, ".shelra");
  const parent = safeNode(shelra, root);
  if (parent && !parent.isDirectory()) throw new Error("Checker .shelra parent is not a directory.");
  const verify = resolveWorkspacePath(VERIFY_DIR, root).path;
  const target = parent ? safeNode(verify, root) : null;
  if (target && !target.isDirectory()) throw new Error("Checker verify area is not a directory.");
  return { root, verify, exists: target !== null };
}

function relativeFileProblem(path: string): string | null {
  if (!path.startsWith(`${VERIFY_DIR}/`) || path.includes("\\") || path.includes("\0")) {
    return `Checker file must have a canonical workspace-relative path under ${VERIFY_DIR}/.`;
  }
  const parts = path.slice(VERIFY_DIR.length + 1).split("/");
  if (parts.length > MAX_DEPTH) return `Checker files exceed the maximum depth of ${MAX_DEPTH}.`;
  if (
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        part.includes(":") ||
        /[. ]$/u.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
    )
  ) {
    return "Checker file path contains traversal, an alias or a reserved name.";
  }
  return null;
}

/** The checker tools use this before a write, with exactly the same path and cwd as the file tool. */
export function checkerWriteProblem(workspace: string, rawPath: string, cwd = workspace): string | null {
  try {
    const area = location(workspace);
    const path = resolveWorkspacePath(rawPath, { root: resolve(workspace), base: resolve(cwd) }).path;
    const rel = relative(resolve(workspace), path).replaceAll(sep, "/");
    const problem = relativeFileProblem(rel);
    if (problem) return problem;
    const target = resolve(area.root, rel);
    if (!inside(area.verify, target) || target === area.verify) return "Checker file is outside the verify area.";
    const parts = rel.slice(VERIFY_DIR.length + 1).split("/");
    let current = area.verify;
    for (let index = 0; index < parts.length; index += 1) {
      current = join(current, parts[index]);
      const stat = safeNode(current, area.root);
      if (!stat) continue;
      if (index === parts.length - 1 && !stat.isFile()) return "Checker write target is not a regular file.";
      if (index < parts.length - 1 && !stat.isDirectory()) return "Checker file parent is not a directory.";
    }
    return null;
  } catch (error) {
    return fail(error).reason;
  }
}

/** Only compiled Python cache files are excluded; Python source and every link still get inspected. */
function pythonCache(path: string): boolean {
  return path.split("/").includes("__pycache__") && path.endsWith(".pyc");
}

function validText(bytes: Buffer): string {
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (bytes.some((byte) => byte < 32 && byte !== 9 && byte !== 10 && byte !== 13)) {
    throw new Error("Checker file contains binary control bytes.");
  }
  // Buffer preserves a UTF-8 BOM, which TextDecoder removes by default.
  return bytes.toString("utf8");
}

function sameVersion(before: Stats, after: Stats): boolean {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

function readText(path: string, root: string): string {
  const leaf = safeNode(path, root);
  if (!leaf?.isFile()) throw new Error(`Checker file disappeared or is not regular: ${path}`);
  if (leaf.size > MAX_FILE_BYTES) throw new Error(`Checker file exceeds ${MAX_FILE_BYTES} bytes: ${path}`);
  const file = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(file);
    if (!before.isFile() || !sameVersion(leaf, before)) throw new Error(`Checker file changed while opening: ${path}`);
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const read = readSync(file, buffer, bytes, buffer.length - bytes, null);
      if (read === 0) break;
      bytes += read;
    }
    const after = safeNode(path, root);
    if (bytes > MAX_FILE_BYTES) throw new Error(`Checker file exceeds ${MAX_FILE_BYTES} bytes: ${path}`);
    if (!after || bytes !== before.size || !sameVersion(before, fstatSync(file)) || !sameVersion(before, after)) {
      throw new Error(`Checker file changed while being captured: ${path}`);
    }
    return validText(buffer.subarray(0, bytes));
  } finally {
    closeSync(file);
  }
}

function scan(area: CheckerLocation, capture: boolean): Map<string, string> {
  const files = new Map<string, string>();
  let nodes = 0;
  let fileCount = 0;
  const walk = (directory: string, depth: number): void => {
    const before = safeNode(directory, area.root);
    if (!before?.isDirectory()) throw new Error(`Checker directory disappeared: ${directory}`);
    const stream = opendirSync(directory);
    try {
      for (let entry = stream.readSync(); entry !== null; entry = stream.readSync()) {
        if (++nodes > MAX_NODES) throw new Error(`Checker area exceeds ${MAX_NODES} entries.`);
        if (depth + 1 > MAX_DEPTH) throw new Error(`Checker files exceed the maximum depth of ${MAX_DEPTH}.`);
        const path = join(directory, entry.name);
        const stat = safeNode(path, area.root);
        if (!stat) throw new Error(`Checker entry disappeared during capture: ${path}`);
        const rel = relative(area.root, path).replaceAll(sep, "/");
        if (stat.isDirectory()) {
          walk(path, depth + 1);
        } else {
          if (pythonCache(rel)) continue;
          if (++fileCount > MAX_FILES) throw new Error(`Checker area exceeds ${MAX_FILES} files.`);
          const problem = relativeFileProblem(rel);
          if (problem) throw new Error(problem);
          if (capture) files.set(rel, readText(path, area.root));
        }
      }
    } finally {
      stream.closeSync();
    }
    const after = safeNode(directory, area.root);
    if (!after?.isDirectory() || !sameVersion(before, after)) {
      throw new Error(`Checker directory changed during capture: ${directory}`);
    }
  };
  if (area.exists) walk(area.verify, 0);
  if (location(area.root).exists !== area.exists) throw new Error("Checker area changed during capture.");
  return files;
}

export function captureCheckerFiles(workspace: string): CheckerFilesResult {
  try {
    return { ok: true, files: scan(location(workspace), true) };
  } catch (error) {
    return fail(error);
  }
}

/** Validate the whole bounded tree before deleting the exact, absolute verify directory. */
export function clearCheckerFiles(workspace: string): CheckerFilesOperation {
  try {
    const area = location(workspace);
    scan(area, false);
    const current = location(area.root);
    if (current.exists) rmSync(current.verify, { recursive: true });
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

function validateOriginals(workspace: string, files: ReadonlyMap<string, string>): Map<string, string> {
  location(workspace);
  if (files.size > MAX_FILES) throw new Error(`Checker originals exceed ${MAX_FILES} files.`);
  const originals = new Map<string, string>();
  const names = new Set<string>();
  for (const [path, content] of files) {
    if (typeof path !== "string" || typeof content !== "string")
      throw new Error("Checker originals are not text files.");
    const problem = relativeFileProblem(path);
    if (problem) throw new Error(problem);
    if (pythonCache(path)) throw new Error("Compiled Python cache is not an original checker file.");
    const name = process.platform === "win32" ? path.toLowerCase() : path;
    if (names.has(name)) throw new Error("Checker originals contain aliased paths.");
    names.add(name);
    const bytes = Buffer.from(content, "utf8");
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`Checker original exceeds ${MAX_FILE_BYTES} bytes: ${path}`);
    if (validText(bytes) !== content) throw new Error(`Checker original is not lossless UTF-8 text: ${path}`);
    originals.set(path, content);
  }
  for (const name of names) {
    if ([...names].some((other) => other !== name && other.startsWith(`${name}/`))) {
      throw new Error("Checker originals contain a file used as another file's directory.");
    }
  }
  return originals;
}

/** Restore from the host's originals, never from files the implementation may have edited. */
export function restoreCheckerFiles(workspace: string, files: ReadonlyMap<string, string>): CheckerFilesOperation {
  try {
    const originals = validateOriginals(workspace, files);
    const cleared = clearCheckerFiles(workspace);
    if (!cleared.ok) return cleared;
    const area = location(workspace);
    for (const [path, content] of originals) {
      const target = resolve(area.root, path);
      mkdirSync(dirname(target), { recursive: true });
      const problem = checkerWriteProblem(area.root, path);
      if (problem) throw new Error(problem);
      writeFileSync(target, content, { encoding: "utf8", flag: "wx" });
    }
    return checkerFilesMatch(area.root, originals);
  } catch (error) {
    return fail(error);
  }
}

export function checkerFilesMatch(workspace: string, files: ReadonlyMap<string, string>): CheckerFilesOperation {
  try {
    const originals = validateOriginals(workspace, files);
    const captured = captureCheckerFiles(workspace);
    if (!captured.ok) return captured;
    if (captured.files.size !== originals.size)
      return { ok: false, reason: "Checker file set differs from the originals." };
    for (const [path, content] of originals) {
      if (captured.files.get(path) !== content)
        return { ok: false, reason: `Checker file differs from its original: ${path}` };
    }
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
