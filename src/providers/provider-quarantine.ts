import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getProductUserDir } from "../product/identity";

/**
 * Durable record of upstream providers that mangled a model's output. OpenRouter routes one
 * model id to several upstreams; an upstream whose tool-call parser drops the model's calls
 * (observed 2026-09-17: Novita serving qwen3-coder-30b) does so on every process, so the
 * quarantine the adapter derives at runtime is remembered per model with an expiry. Entries
 * age out so a fixed upstream, or a transient incident, does not stay excluded forever.
 */

export interface QuarantineEntry {
  model: string;
  provider: string;
  reason: string;
  quarantinedAt: string;
}

interface QuarantineFile {
  version: 1;
  entries: QuarantineEntry[];
}

export const QUARANTINE_TTL_MS = 7 * 24 * 60 * 60_000;

export function defaultQuarantineStorePath(): string {
  return join(getProductUserDir(), "catalog", "provider-quarantine.json");
}

function readStore(path: string): QuarantineFile {
  try {
    if (!existsSync(path)) return { version: 1, entries: [] };
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<QuarantineFile>;
    return { version: 1, entries: Array.isArray(parsed.entries) ? parsed.entries.filter(isEntry) : [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

function isEntry(value: unknown): value is QuarantineEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.model === "string" &&
    typeof entry.provider === "string" &&
    typeof entry.reason === "string" &&
    typeof entry.quarantinedAt === "string"
  );
}

function isLive(entry: QuarantineEntry, now: number): boolean {
  const at = Date.parse(entry.quarantinedAt);
  return Number.isFinite(at) && now - at < QUARANTINE_TTL_MS;
}

/** Upstream providers currently quarantined for `model`, newest first. */
export function loadQuarantinedProviders(
  model: string,
  options: { path?: string; now?: number } = {},
): QuarantineEntry[] {
  const now = options.now ?? Date.now();
  return readStore(options.path ?? defaultQuarantineStorePath())
    .entries.filter((entry) => entry.model === model && isLive(entry, now))
    .sort((a, b) => b.quarantinedAt.localeCompare(a.quarantinedAt));
}

/** Records a quarantine, replacing an older entry for the same model/provider pair. */
export function recordQuarantinedProvider(
  entry: Omit<QuarantineEntry, "quarantinedAt"> & { quarantinedAt?: string },
  options: { path?: string; now?: number } = {},
): void {
  const path = options.path ?? defaultQuarantineStorePath();
  const now = options.now ?? Date.now();
  const store = readStore(path);
  const kept = store.entries.filter(
    (existing) => isLive(existing, now) && !(existing.model === entry.model && existing.provider === entry.provider),
  );
  kept.push({ ...entry, quarantinedAt: entry.quarantinedAt ?? new Date(now).toISOString() });
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.tmp-${process.pid}`;
    writeFileSync(temporary, `${JSON.stringify({ version: 1, entries: kept } satisfies QuarantineFile, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporary, path);
  } catch {
    // Persisting a routing hint must never fail a turn; the in-process quarantine still applies.
  }
}
