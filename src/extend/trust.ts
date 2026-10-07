/**
 * Trust for code a repository asks Shelra to run. A hook is a command that runs on the host, outside any sandbox, so a
 * hook defined in a file the project (or an agent working in it) can write is a proposal until the person approves it.
 *
 * What runs is the *approved snapshot*, stored in the user's folder (`~/.shelra/trust.json`), not the file. So an agent
 * that edits a hook, or deletes it from the file to get past it, changes nothing about what is enforced: the snapshot
 * keeps running until the person removes or re-approves it. Approving is a person's action (`/hooks`, `shelra hooks
 * approve`); no tool offered to the model can do it.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { withMemoryLock } from "../memory/lock";
import { getProductUserDir } from "../product/identity";
import { atomicWrite } from "./store";

export interface ApprovedHook {
  id: string;
  fingerprint: string;
  event: string;
  matcher?: string;
  command?: string;
  args?: string[];
  shell?: string;
  timeout?: number;
  failurePolicy: "open" | "closed";
  async: boolean;
  description?: string;
  /** Which settings layer it was defined in when approved. */
  layer: "project" | "local";
  approvedAt: string;
}

interface TrustFile {
  version: 1;
  projects: Record<string, { hooks: ApprovedHook[] }>;
}

function trustPath(): string {
  return join(getProductUserDir(), "trust.json");
}

export function projectKey(root: string): string {
  let real: string;
  try {
    real = realpathSync.native(root);
  } catch {
    real = resolve(root);
  }
  return process.platform === "win32" ? real.toLowerCase() : real;
}

let cache: { signature: string; file: TrustFile; at: number } | null = null;

function signature(path: string): string {
  try {
    const raw = readFileSync(path, "utf8");
    return createHash("sha1").update(raw).digest("hex");
  } catch {
    return "missing";
  }
}

function readFile(): TrustFile {
  const path = trustPath();
  const now = Date.now();
  if (cache && now - cache.at < 750 && cache.signature !== "stale") return cache.file;
  const sig = existsSync(path) ? signature(path) : "missing";
  if (cache && cache.signature === sig) {
    cache.at = now;
    return cache.file;
  }
  let file: TrustFile = { version: 1, projects: {} };
  if (sig !== "missing") {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<TrustFile>;
      if (parsed && typeof parsed === "object" && parsed.projects && typeof parsed.projects === "object")
        file = { version: 1, projects: parsed.projects };
    } catch {
      /* an unreadable trust file approves nothing */
    }
  }
  cache = { signature: sig, file, at: now };
  return file;
}

export function invalidateTrustCache(): void {
  cache = null;
}

export function fingerprintOf(hook: {
  event: string;
  matcher?: string;
  command?: string;
  args?: string[];
  shell?: string;
  timeout?: number;
  failurePolicy?: string;
  async?: boolean;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        hook.event,
        hook.matcher ?? "",
        hook.command ?? "",
        hook.args ?? [],
        hook.shell ?? "",
        hook.timeout ?? 0,
        hook.failurePolicy ?? "open",
        hook.async ?? false,
      ]),
    )
    .digest("hex")
    .slice(0, 16);
}

export function approvedHooks(root: string): ApprovedHook[] {
  return readFile().projects[projectKey(root)]?.hooks ?? [];
}

function mutate(change: (file: TrustFile) => void): void {
  const directory = join(getProductUserDir(), ".locks", "trust");
  withMemoryLock(directory, () => {
    invalidateTrustCache();
    const file = readFile();
    const next: TrustFile = { version: 1, projects: { ...file.projects } };
    change(next);
    atomicWrite(trustPath(), `${JSON.stringify(next, null, 2)}\n`);
    invalidateTrustCache();
  });
}

/** Approves these hooks for the project: their definitions become the enforced snapshot. A person's action. */
export function approveHooks(root: string, hooks: Array<Omit<ApprovedHook, "approvedAt">>): ApprovedHook[] {
  const key = projectKey(root);
  const approvedAt = new Date().toISOString();
  const added: ApprovedHook[] = hooks.map((hook) => ({ ...hook, approvedAt }));
  mutate((file) => {
    const existing = file.projects[key]?.hooks ?? [];
    const byFingerprint = new Map(existing.map((hook) => [hook.fingerprint, hook]));
    for (const hook of added) byFingerprint.set(hook.fingerprint, hook);
    file.projects[key] = { hooks: [...byFingerprint.values()] };
  });
  return added;
}

/** Removes an approved hook by id or fingerprint. A person's action. */
export function revokeHook(root: string, idOrFingerprint: string): number {
  const key = projectKey(root);
  let removed = 0;
  mutate((file) => {
    const existing = file.projects[key]?.hooks ?? [];
    const kept = existing.filter((hook) => hook.id !== idOrFingerprint && hook.fingerprint !== idOrFingerprint);
    removed = existing.length - kept.length;
    file.projects[key] = { hooks: kept };
  });
  return removed;
}
