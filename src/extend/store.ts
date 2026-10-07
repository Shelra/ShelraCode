/**
 * Safe writes for every definition Shelra manages (skills, agents, hooks, rules, instruction files): an atomic
 * replace, an optimistic-concurrency check, a snapshot of what was there before (the recovery path), and a lock
 * that holds across processes. Every mutation returns what changed, where, and the hash it now has, so nothing is
 * ever reported as saved without having been read back.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { withMemoryLock } from "../memory/lock";

export type DefinitionKind = "skill" | "agent" | "hook" | "rule" | "instructions";

/** The first 12 hex characters of the SHA-256 of the text: a version label, not a security boundary. */
export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

export function readTextIfExists(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

/** Writes through a temporary file in the same folder, so a reader never sees half a file. */
export function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(temporary, content, "utf8");
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      renameSync(temporary, path);
      return;
    } catch (error) {
      lastError = error;
      // Windows refuses a rename over a file another process has open for a moment.
      const until = Date.now() + 20 * (attempt + 1);
      while (Date.now() < until) {
        /* brief spin: the lock API this store sits beside is synchronous too */
      }
    }
  }
  rmSync(temporary, { force: true });
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export interface WriteDefinitionInput {
  /** The file to create or replace. */
  path: string;
  content: string;
  kind: DefinitionKind;
  /** The definition's name, used for the history folder. */
  name: string;
  /** The `.shelra` folder of the scope the definition lives in; history and locks live under it. */
  scopeDir: string;
  /** When set, the write is refused unless the file still has this hash (the caller read it earlier). */
  expectedHash?: string;
  /** How many earlier versions to keep. */
  keepVersions?: number;
}

export type WriteDefinitionResult =
  | {
      ok: true;
      path: string;
      created: boolean;
      /** False when the content was identical and nothing was written. */
      changed: boolean;
      hash: string;
      previousHash: string | null;
      /** Where the previous version was kept, when there was one. */
      snapshot: string | null;
    }
  | { ok: false; conflict: boolean; reason: string; currentHash: string | null };

function historyDirectory(scopeDir: string, kind: DefinitionKind, name: string): string {
  return join(scopeDir, "history", `${kind}s`, name.replace(/[^A-Za-z0-9._-]/gu, "_"));
}

export function listVersions(scopeDir: string, kind: DefinitionKind, name: string): string[] {
  try {
    const dir = historyDirectory(scopeDir, kind, name);
    return existsSync(dir)
      ? readdirSync(dir)
          .filter((file) => file.endsWith(".bak"))
          .sort()
          .reverse()
          .map((file) => join(dir, file))
      : [];
  } catch {
    return [];
  }
}

/** Replaces `path` with `content` under the folder lock, keeping the previous version. Never throws. */
export function writeDefinition(input: WriteDefinitionInput): WriteDefinitionResult {
  const lockDirectory = join(input.scopeDir, ".locks", "extend");
  try {
    return withMemoryLock(lockDirectory, () => {
      const previous = readTextIfExists(input.path);
      const previousHash = previous === null ? null : contentHash(previous);
      if (input.expectedHash !== undefined && previousHash !== input.expectedHash) {
        return {
          ok: false as const,
          conflict: true,
          reason: `${input.path} changed since it was read (now ${previousHash ?? "missing"}, expected ${input.expectedHash}); read it again and merge`,
          currentHash: previousHash,
        };
      }
      const hash = contentHash(input.content);
      if (previous !== null && previousHash === hash) {
        return {
          ok: true as const,
          path: input.path,
          created: false,
          changed: false,
          hash,
          previousHash,
          snapshot: null,
        };
      }
      let snapshot: string | null = null;
      if (previous !== null) {
        const dir = historyDirectory(input.scopeDir, input.kind, input.name);
        mkdirSync(dir, { recursive: true });
        snapshot = join(dir, `${new Date().toISOString().replace(/[:.]/gu, "-")}-${previousHash}.bak`);
        writeFileSync(snapshot, previous, "utf8");
        const old = readdirSync(dir)
          .filter((file) => file.endsWith(".bak"))
          .sort();
        for (const file of old.slice(0, Math.max(0, old.length - (input.keepVersions ?? 20))))
          rmSync(join(dir, file), { force: true });
      }
      atomicWrite(input.path, input.content);
      // Read back: a report of "saved" is only as good as what is on disk now.
      const written = readTextIfExists(input.path);
      if (written === null || contentHash(written) !== hash) {
        return {
          ok: false as const,
          conflict: false,
          reason: `${input.path} could not be read back after writing`,
          currentHash: null,
        };
      }
      return {
        ok: true as const,
        path: input.path,
        created: previous === null,
        changed: true,
        hash,
        previousHash,
        snapshot,
      };
    });
  } catch (error) {
    return {
      ok: false,
      conflict: false,
      reason: writeFailure(error),
      currentHash: null,
    };
  }
}

/** The lock these writes share with project memory says "memory"; here it is another session writing definitions. */
function writeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /busy in another session/u.test(message)
    ? "another Shelra session is writing definitions in this project right now; try again in a moment"
    : message;
}

/** Removes a definition, keeping its last version in the history folder. Never throws. */
export function removeDefinition(input: Omit<WriteDefinitionInput, "content">): WriteDefinitionResult {
  const lockDirectory = join(input.scopeDir, ".locks", "extend");
  try {
    return withMemoryLock(lockDirectory, () => {
      const previous = readTextIfExists(input.path);
      if (previous === null)
        return { ok: false as const, conflict: false, reason: `${input.path} does not exist`, currentHash: null };
      const previousHash = contentHash(previous);
      if (input.expectedHash !== undefined && previousHash !== input.expectedHash) {
        return {
          ok: false as const,
          conflict: true,
          reason: `${input.path} changed since it was read`,
          currentHash: previousHash,
        };
      }
      const dir = historyDirectory(input.scopeDir, input.kind, input.name);
      mkdirSync(dir, { recursive: true });
      const snapshot = join(dir, `${new Date().toISOString().replace(/[:.]/gu, "-")}-${previousHash}.bak`);
      writeFileSync(snapshot, previous, "utf8");
      rmSync(input.path, { force: true });
      return { ok: true as const, path: input.path, created: false, changed: true, hash: "", previousHash, snapshot };
    });
  } catch (error) {
    return {
      ok: false,
      conflict: false,
      reason: writeFailure(error),
      currentHash: null,
    };
  }
}

export function fileSignature(path: string): string {
  try {
    const stat = statSync(path);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
}
