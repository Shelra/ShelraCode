import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { BenchmarkEnvironment, BenchmarkJson, BenchmarkJsonObject } from "./types";

const SECRET_KEY = /(api.?key|authorization|credential|password|private.?key|secret|token)/iu;

export interface RepositorySnapshot {
  commit: string | null;
  dirty: boolean;
  diffHash: string | null;
}

export function collectBenchmarkEnvironment(): BenchmarkEnvironment {
  const runtimeVersions: Record<string, string> = {
    node: process.version,
    ...(process.versions.bun ? { bun: process.versions.bun } : {}),
    ...(process.versions.v8 ? { v8: process.versions.v8 } : {}),
  };

  return {
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    cpuModel: os.cpus()[0]?.model,
    cpuCores: os.cpus().length,
    memoryMb: Math.round(os.totalmem() / 1024 / 1024),
    runtimeVersions,
  };
}

export function collectRepositorySnapshot(cwd: string): RepositorySnapshot {
  const commit = runGit(cwd, ["rev-parse", "HEAD"]);
  const status = runGit(cwd, ["status", "--porcelain"]);
  const dirty = Boolean(status);
  if (!dirty) return { commit, dirty: false, diffHash: null };

  try {
    const unstaged = execFileSync("git", ["diff", "--no-ext-diff", "--binary"], {
      cwd,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const staged = execFileSync("git", ["diff", "--cached", "--no-ext-diff", "--binary"], {
      cwd,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const hash = createHash("sha256").update(unstaged).update(staged).digest("hex");
    return { commit, dirty: true, diffHash: hash };
  } catch {
    // A dirty tree is still recorded as dirty when a very large or unusual diff
    // cannot be materialized safely for hashing.
    return { commit, dirty: true, diffHash: null };
  }
}

export function sanitizeJsonObject(value: Record<string, unknown> | undefined): BenchmarkJsonObject {
  return sanitizeValue(value ?? {}) as BenchmarkJsonObject;
}

export function redactBenchmarkText(value: string): string {
  return value
    .replace(
      /(api[_-]?key|authorization|bearer|password|secret|token)(\s*)([:=])(\s*)["']?[^"'\s,;]+/giu,
      "$1$2$3$4[redacted]",
    )
    .replace(/\bsk-or-v1-[a-z0-9_-]+\b/giu, "[redacted]");
}

export function stableJson(value: BenchmarkJson): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key] ?? null)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function configurationFingerprint(value: BenchmarkJsonObject): string {
  return createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 24);
}

export function resolveBenchmarkPath(cwd: string, candidate: string): string {
  return path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
}

function sanitizeValue(value: unknown): BenchmarkJson {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") return redactBenchmarkText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (typeof value === "object") {
    const record: BenchmarkJsonObject = {};
    for (const [key, child] of Object.entries(value)) {
      record[key] = SECRET_KEY.test(key) ? "[redacted]" : sanitizeValue(child);
    }
    return record;
  }
  return String(value);
}

function runGit(cwd: string, args: string[]): string | null {
  try {
    const output = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const value = output.trim();
    return value || null;
  } catch {
    return null;
  }
}
