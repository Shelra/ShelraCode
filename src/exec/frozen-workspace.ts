import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readdir, readlink, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import type { VerificationWorkspacePaths } from "./verification-environment";

interface CopyLimits {
  maxFiles: number;
  maxBytes: number;
  maxFileBytes: number;
  maxDepth: number;
}

const DEFAULT_LIMITS: CopyLimits = {
  maxFiles: 100_000,
  maxBytes: 2 * 1024 ** 3,
  maxFileBytes: 256 * 1024 ** 2,
  maxDepth: 64,
};
const BUFFER_BYTES = 64 * 1024;
const OMITTED = [".git"];

export interface FrozenWorkspaceReceipt {
  mode: "private-copy";
  candidate: string;
  oracle: string | null;
  candidateFiles: number;
  candidateBytes: number;
  omitted: string[];
  oracleRoots: string[];
  processIsolation: "unavailable" | "windows-appcontainer";
}

export interface FrozenWorkspace extends VerificationWorkspacePaths {
  receipt: FrozenWorkspaceReceipt;
  /** Detects source drift and modification of frozen expectations; it is not OS isolation. */
  integrity(): Promise<void>;
  cleanup(): Promise<void>;
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(rel))
  );
}

function sameVersion(a: Awaited<ReturnType<typeof stat>>, b: Awaited<ReturnType<typeof stat>>): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

/** A full, bounded content reading. Links inside the source are materialized; external links never follow. */
async function snapshot(root: string, roots: string[], limits: CopyLimits, destination?: string) {
  const hash = createHash("sha256");
  let files = 0;
  let bytes = 0;
  let nodes = 0;
  const walk = async (path: string, depth: number, ancestors: Set<string>): Promise<void> => {
    if (depth > limits.maxDepth || ++nodes > limits.maxFiles * 2 + 100)
      throw new Error("Frozen workspace exceeds its directory/depth limit.");
    const full = join(root, path);
    const entry = await lstat(full);
    const actual = await realpath(full);
    if (!within(root, actual)) throw new Error(`Frozen workspace refuses an external link: ${path}`);
    const link = entry.isSymbolicLink() ? await readlink(full) : "";
    const before = await stat(actual);
    // Content paths, not inode identities, define the copy. Each hard link becomes an independent file.
    if (before.isDirectory()) {
      if (ancestors.has(actual)) throw new Error(`Frozen workspace refuses a directory cycle: ${path}`);
      hash.update(JSON.stringify(["directory", path]));
      if (destination) await mkdir(join(destination, path), { recursive: true });
      const children = (await readdir(actual)).sort();
      const nextAncestors = new Set(ancestors).add(actual);
      for (const child of children) {
        if (OMITTED.includes(child)) continue;
        await walk(join(path, child), depth + 1, nextAncestors);
      }
      if (JSON.stringify(children) !== JSON.stringify((await readdir(actual)).sort()))
        throw new Error(`Frozen workspace changed while reading: ${path || "."}`);
    } else if (before.isFile()) {
      if (++files > limits.maxFiles || before.size > limits.maxFileBytes || bytes + before.size > limits.maxBytes)
        throw new Error(`Frozen workspace exceeds its file/byte limit: ${path}`);
      const content = createHash("sha256");
      const input = await open(actual, "r");
      let output: Awaited<ReturnType<typeof open>> | undefined;
      let readBytes = 0;
      try {
        if (!sameVersion(before, await input.stat()))
          throw new Error(`Frozen workspace changed before reading: ${path}`);
        if (destination) {
          await mkdir(dirname(join(destination, path)), { recursive: true });
          output = await open(join(destination, path), "wx", before.mode & 0o777);
        }
        const buffer = Buffer.allocUnsafe(BUFFER_BYTES);
        while (true) {
          const { bytesRead } = await input.read(buffer, 0, buffer.length, null);
          if (bytesRead === 0) break;
          readBytes += bytesRead;
          if (readBytes > limits.maxFileBytes || bytes + readBytes > limits.maxBytes)
            throw new Error(`Frozen workspace grew beyond its byte limit: ${path}`);
          const chunk = buffer.subarray(0, bytesRead);
          content.update(chunk);
          if (output) {
            let written = 0;
            while (written < bytesRead) {
              const result = await output.write(chunk, written, bytesRead - written);
              if (result.bytesWritten === 0) throw new Error(`Frozen workspace could not finish copying: ${path}`);
              written += result.bytesWritten;
            }
          }
        }
        if (
          readBytes !== before.size ||
          !sameVersion(before, await input.stat()) ||
          !sameVersion(before, await stat(actual))
        )
          throw new Error(`Frozen workspace changed while copying: ${path}`);
      } finally {
        await input.close();
        await output?.close();
      }
      bytes += readBytes;
      hash.update(JSON.stringify(["file", path, before.mode & 0o111, readBytes, content.digest("hex")]));
    } else {
      throw new Error(`Frozen workspace refuses a special file: ${path}`);
    }
    if ((await realpath(full)) !== actual || (link && (await readlink(full)) !== link))
      throw new Error(`Frozen workspace link changed while reading: ${path}`);
  };
  for (const path of roots) await walk(path, 0, new Set());
  return { fingerprint: `sha256:${hash.digest("hex")}`, files, bytes };
}

/** Never recursively remove a replaced root or a path the host did not allocate. */
async function removePrivateRoot(root: string, parent: string): Promise<void> {
  if (dirname(root) !== parent || !within(parent, root) || root === parent)
    throw new Error("Frozen workspace cleanup target is outside its allocated directory.");
  const entry = await lstat(root);
  if (!entry.isDirectory() || entry.isSymbolicLink() || (await realpath(root)) !== root)
    throw new Error("Frozen workspace cleanup refuses a replaced directory.");
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

export async function freezeWorkspace(
  workspace: string,
  benchmarkRoot?: string,
  options: { limits?: Partial<CopyLimits>; oracleRoots?: string[] } = {},
): Promise<FrozenWorkspace> {
  const source = await realpath(workspace);
  const oracleSource = benchmarkRoot ? await realpath(benchmarkRoot) : undefined;
  const parent = await realpath(tmpdir());
  const root = await mkdtemp(join(parent, "shelra-grade-"));
  const candidate = join(root, "candidate");
  const oracle = join(root, "oracle");
  const home = join(root, "home");
  const temp = join(root, "temp");
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const oracleRoots = options.oracleRoots ?? [""];
  try {
    if (oracleRoots.length === 0 || oracleRoots.some((path) => isAbsolute(path) || path.split(/[\\/]/u).includes("..")))
      throw new Error("Frozen workspace refuses invalid expectation roots.");
    if (within(source, root) || (oracleSource && within(oracleSource, root)))
      throw new Error("Frozen workspace cannot be created inside a source it is copying.");
    await Promise.all([mkdir(candidate), mkdir(oracle), mkdir(home), mkdir(temp)]);
    const captured = await snapshot(source, [""], limits, candidate);
    const expectations = oracleSource ? await snapshot(oracleSource, oracleRoots, limits, oracle) : undefined;
    const receipt: FrozenWorkspaceReceipt = {
      mode: "private-copy",
      candidate: captured.fingerprint,
      oracle: expectations?.fingerprint ?? null,
      candidateFiles: captured.files,
      candidateBytes: captured.bytes,
      omitted: [...OMITTED],
      oracleRoots: oracleSource ? oracleRoots : [],
      processIsolation: "unavailable",
    };
    const integrity = async () => {
      if ((await snapshot(source, [""], limits)).fingerprint !== captured.fingerprint)
        throw new Error("The original candidate changed after it was frozen.");
      if (expectations && (await snapshot(oracle, oracleRoots, limits)).fingerprint !== expectations.fingerprint)
        throw new Error("The frozen benchmark expectations changed during evaluation.");
    };
    // Verify both source stability and copy correctness before any code is allowed to run.
    await integrity();
    if ((await snapshot(candidate, [""], limits)).fingerprint !== captured.fingerprint)
      throw new Error("The frozen candidate does not match its source.");
    if (
      expectations &&
      oracleSource &&
      (await snapshot(oracleSource, oracleRoots, limits)).fingerprint !== expectations.fingerprint
    )
      throw new Error("The benchmark expectations changed while being frozen.");
    return {
      workspace: candidate,
      ...(oracleSource ? { benchmarkRoot: oracle } : {}),
      home,
      temp,
      receipt,
      integrity,
      cleanup: () => removePrivateRoot(root, parent),
    };
  } catch (error) {
    await removePrivateRoot(root, parent);
    throw error;
  }
}
