import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { recordSwallowedError } from "../utils/diagnostics";
import {
  MEMORY_TYPES,
  type MemoryDeleteResult,
  type MemoryEntry,
  type MemoryFrontmatter,
  type MemoryHistoryEvent,
  type MemoryIndexEntry,
  type MemoryReadEntryResult,
  type MemoryReadIndexResult,
  type MemoryRecord,
  type MemoryScope,
  type MemorySource,
  type MemoryStatus,
  type MemoryType,
  type MemoryWriteInput,
  type MemoryWriteResult,
} from "./types";

/**
 * File-based project/agent memory store.
 *
 * Deliberately not a database: memory is markdown on disk under `<workspace>/.shelra/memory/`
 * (project scope) or `<workspace>/.shelra/memory/agents/<agentName>/` (agent scope), mirroring
 * the confirmed Claude Code MEMORY.md + topic-file design. The index must stay a cheap, always-safe
 * read used to judge relevance; topic files load only on demand. See docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md.
 *
 * Every write also appends one line to `history.jsonl`, so the store has an event-sourced timeline
 * (created/updated/confirmed/deleted) without a second storage system (research/lanes/11 §3.3).
 */

const INDEX_FILE = "MEMORY.md";
const HISTORY_FILE = "history.jsonl";
export const MEMORY_INDEX_MAX_BYTES = 25 * 1024;
export const MEMORY_INDEX_MAX_LINES = 200;
/** The history log rotates when it grows past this; the newest half is kept. */
export const MEMORY_HISTORY_MAX_BYTES = 1024 * 1024;

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const INDEX_LINE_PATTERN = /^-\s*\[(.+?)\]\((.+?)\)\s*—\s*(.*)$/;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const SOURCES: readonly MemorySource[] = ["human", "observed", "inference", "web"];

function validateIdentifier(value: string, label: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Invalid ${label} "${value}": expected kebab-case, starting with a lowercase letter.`);
  }
}

/** The folder a scope keeps its files in. */
export function memoryDir(scope: MemoryScope): string {
  if (scope.kind === "agent") {
    validateIdentifier(scope.agentName, "agentName");
    return join(scope.workspace, ".shelra", "memory", "agents", scope.agentName);
  }
  return join(scope.workspace, ".shelra", "memory");
}

/**
 * Creates a scope's folder, with a `.gitignore` that keeps it out of version control: memory is local (doc 18 §8),
 * and a model asked to "stage the relevant files" must not commit a project's episodes. Returns the folder.
 */
export function ensureMemoryDir(scope: MemoryScope): string {
  const dir = memoryDir(scope);
  mkdirSync(dir, { recursive: true });
  const ignore = join(dir, ".gitignore");
  if (scope.kind === "project" && !existsSync(ignore)) {
    try {
      writeFileSync(ignore, "# Shelra's memory of this project stays on this machine.\n*\n", "utf8");
    } catch (error) {
      recordSwallowedError("memory.gitignore", error);
    }
  }
  return dir;
}

/** Exposed for callers/tests that need to locate memory files without duplicating scope logic. */
export function memoryIndexPath(scope: MemoryScope): string {
  return join(memoryDir(scope), INDEX_FILE);
}

export function memoryEntryPath(scope: MemoryScope, slug: string): string {
  validateIdentifier(slug, "slug");
  return join(memoryDir(scope), `${slug}.md`);
}

export function memoryHistoryPath(scope: MemoryScope): string {
  return join(memoryDir(scope), HISTORY_FILE);
}

export function projectMemoryScope(workspace: string): MemoryScope {
  return { kind: "project", workspace };
}

export function agentMemoryScope(workspace: string, agentName: string): MemoryScope {
  return { kind: "agent", workspace, agentName };
}

/**
 * User-wide memory: preferences and standing rules that hold in every project, stored under
 * `~/.shelra/memory` (`SHELRA_USER_MEMORY_ROOT` overrides the root, for tests and portable setups).
 * The user should never have to teach the same preference to each repository.
 */
export function userMemoryScope(home = process.env.SHELRA_USER_MEMORY_ROOT || homedir()): MemoryScope {
  return { kind: "user", workspace: home };
}

/** Records from the user-wide store, marked so retrieval and reports say where they apply. */
export function listUserMemoryRecords(): MemoryRecord[] {
  try {
    return listMemoryRecords(userMemoryScope()).map((record) => ({ ...record, origin: "user" as const }));
  } catch {
    return [];
  }
}

export function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === "string" && (MEMORY_TYPES as readonly string[]).includes(value);
}

export function isMemorySource(value: unknown): value is MemorySource {
  return typeof value === "string" && (SOURCES as readonly string[]).includes(value);
}

const STATUSES: readonly MemoryStatus[] = ["active", "superseded", "invalidated", "archived"];

export function isMemoryStatus(value: unknown): value is MemoryStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

/** Whether an entry is current truth: an entry with no status is. */
export function isCurrentMemory(record: MemoryRecord): boolean {
  const status = record.entry.frontmatter.metadata.status;
  return status === undefined || status === "active";
}

function writeFileAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

function escapeYamlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function unescapeYamlString(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function yamlList(values: readonly string[] | undefined): string | null {
  if (!values || values.length === 0) return null;
  return `[${values.map((value) => `"${escapeYamlString(value)}"`).join(", ")}]`;
}

function parseYamlList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return undefined;
  const inner = trimmed.slice(1, -1);
  const values: string[] = [];
  const pattern = /"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null = pattern.exec(inner);
  while (match) {
    values.push(unescapeYamlString(match[1] ?? ""));
    match = pattern.exec(inner);
  }
  return values;
}

function serializeEntry(frontmatter: MemoryFrontmatter, body: string): string {
  const meta = frontmatter.metadata;
  const lines = [
    "---",
    `name: ${frontmatter.name}`,
    `description: "${escapeYamlString(frontmatter.description)}"`,
    "metadata:",
    `  type: ${meta.type}`,
    `  modified: ${meta.modified}`,
  ];
  if (meta.created) lines.push(`  created: ${meta.created}`);
  if (meta.source) lines.push(`  source: ${meta.source}`);
  if (meta.confidence !== undefined) lines.push(`  confidence: ${meta.confidence}`);
  if (meta.lastConfirmed) lines.push(`  lastConfirmed: ${meta.lastConfirmed}`);
  const related = yamlList(meta.relatedFiles);
  if (related) lines.push(`  relatedFiles: ${related}`);
  const tags = yamlList(meta.tags);
  if (tags) lines.push(`  tags: ${tags}`);
  if (meta.uses !== undefined) lines.push(`  uses: ${meta.uses}`);
  if (meta.lastUsed) lines.push(`  lastUsed: ${meta.lastUsed}`);
  if (meta.credit !== undefined) lines.push(`  credit: ${meta.credit}`);
  if (meta.supersedes) lines.push(`  supersedes: ${meta.supersedes}`);
  if (meta.revision !== undefined) lines.push(`  revision: ${meta.revision}`);
  if (meta.status && meta.status !== "active") lines.push(`  status: ${meta.status}`);
  if (meta.supersededBy) lines.push(`  supersededBy: ${meta.supersededBy}`);
  if (meta.validUntil) lines.push(`  validUntil: ${meta.validUntil}`);
  lines.push("---", "", body.trimEnd(), "");
  return lines.join("\n");
}

function readScalar(block: string, key: string): string | undefined {
  const match = block.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, "m"));
  return match?.[1]?.trim();
}

function parseEntryFile(raw: string): MemoryEntry | null {
  const match = raw.match(FRONTMATTER_PATTERN);
  if (!match) return null;
  const [, frontmatterBlock, body] = match;

  const name = readScalar(frontmatterBlock, "name");
  const type = readScalar(frontmatterBlock, "type");
  const modified = readScalar(frontmatterBlock, "modified");
  if (!name || !type || !modified) return null;

  const quotedDescription = frontmatterBlock.match(/^description:\s*"((?:[^"\\]|\\.)*)"\s*$/m);
  const bareDescription = frontmatterBlock.match(/^description:\s*(.+)$/m);
  const description = quotedDescription
    ? unescapeYamlString(quotedDescription[1])
    : bareDescription
      ? bareDescription[1].trim()
      : "";

  const source = readScalar(frontmatterBlock, "source");
  const status = readScalar(frontmatterBlock, "status");
  const confidenceRaw = readScalar(frontmatterBlock, "confidence");
  const usesRaw = readScalar(frontmatterBlock, "uses");
  const creditRaw = readScalar(frontmatterBlock, "credit");
  const revisionRaw = readScalar(frontmatterBlock, "revision");
  const confidence = confidenceRaw === undefined ? undefined : Number(confidenceRaw);
  const uses = usesRaw === undefined ? undefined : Number(usesRaw);
  const credit = creditRaw === undefined ? undefined : Number(creditRaw);
  const revision = revisionRaw === undefined ? undefined : Number(revisionRaw);

  return {
    frontmatter: {
      name,
      description,
      metadata: {
        type: type as MemoryType,
        modified,
        created: readScalar(frontmatterBlock, "created"),
        source: isMemorySource(source) ? source : undefined,
        confidence: confidence !== undefined && Number.isFinite(confidence) ? confidence : undefined,
        lastConfirmed: readScalar(frontmatterBlock, "lastConfirmed"),
        relatedFiles: parseYamlList(readScalar(frontmatterBlock, "relatedFiles")),
        tags: parseYamlList(readScalar(frontmatterBlock, "tags")),
        uses: uses !== undefined && Number.isFinite(uses) ? uses : undefined,
        lastUsed: readScalar(frontmatterBlock, "lastUsed"),
        credit: credit !== undefined && Number.isFinite(credit) ? credit : undefined,
        supersedes: readScalar(frontmatterBlock, "supersedes"),
        revision: revision !== undefined && Number.isFinite(revision) ? revision : undefined,
        status: isMemoryStatus(status) ? status : undefined,
        supersededBy: readScalar(frontmatterBlock, "supersededBy"),
        validUntil: readScalar(frontmatterBlock, "validUntil"),
      },
    },
    body: body.replace(/^\r?\n/, ""),
  };
}

function buildIndexLine(entry: MemoryIndexEntry): string {
  return `- [${entry.title}](${entry.file}) — ${entry.hook}`;
}

function parseIndex(raw: string): MemoryIndexEntry[] {
  const entries: MemoryIndexEntry[] = [];
  for (const line of raw.split(/\r?\n/u)) {
    const match = line.match(INDEX_LINE_PATTERN);
    if (!match) continue;
    entries.push({ title: match[1], file: match[2], hook: match[3] });
  }
  return entries;
}

function appendHistory(scope: MemoryScope, event: MemoryHistoryEvent): void {
  try {
    const path = memoryHistoryPath(scope);
    ensureMemoryDir(scope);
    if (existsSync(path) && statSync(path).size > MEMORY_HISTORY_MAX_BYTES) {
      const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
      writeFileAtomic(path, `${lines.slice(Math.floor(lines.length / 2)).join("\n")}\n`);
    }
    appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
  } catch (error) {
    // The timeline is a convenience; losing a line must never fail a memory write.
    recordSwallowedError("memory.history", error);
  }
}

/** Newest-last list of history events; a missing or corrupt log reads as empty. */
export function readMemoryHistory(scope: MemoryScope, limit = 200): MemoryHistoryEvent[] {
  const path = memoryHistoryPath(scope);
  if (!existsSync(path)) return [];
  try {
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    const events: MemoryHistoryEvent[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        events.push(JSON.parse(line) as MemoryHistoryEvent);
      } catch {
        // skip a torn line
      }
    }
    return events;
  } catch {
    return [];
  }
}

/** Always safe: a missing scope directory or index file is an empty result, never an error. */
export function readMemoryIndex(scope: MemoryScope): MemoryReadIndexResult {
  const path = memoryIndexPath(scope);
  if (!existsSync(path)) return { entries: [], raw: "", exists: false };
  try {
    const raw = readFileSync(path, "utf8");
    return { entries: parseIndex(raw), raw, exists: true };
  } catch (error) {
    recordSwallowedError("memory.read", error);
    return { entries: [], raw: "", exists: false };
  }
}

/** Loads one topic file body. Only call this once the index says the entry is relevant. */
export function readMemoryEntry(scope: MemoryScope, slug: string): MemoryReadEntryResult {
  const path = memoryEntryPath(scope, slug);
  if (!existsSync(path)) return { entry: null, exists: false };
  try {
    const raw = readFileSync(path, "utf8");
    return { entry: parseEntryFile(raw), exists: true };
  } catch (error) {
    recordSwallowedError("memory.read", error);
    return { entry: null, exists: false };
  }
}

export function slugFromIndexFile(file: string): string {
  return file.replace(/\.md$/u, "");
}

/** Every indexed entry with its body loaded. Bounded by the index cap, so at most 200 small files. */
export function listMemoryRecords(scope: MemoryScope): MemoryRecord[] {
  const records: MemoryRecord[] = [];
  for (const index of readMemoryIndex(scope).entries) {
    const slug = slugFromIndexFile(index.file);
    if (!IDENTIFIER_PATTERN.test(slug)) continue;
    const { entry } = readMemoryEntry(scope, slug);
    if (entry) records.push({ slug, index, entry });
  }
  return records;
}

/**
 * Upserts one topic file and its index pointer. Refuses (without writing anything) rather than
 * silently letting the index grow past the cap — the caller decides what to do about a refusal
 * (e.g. trim an older memory first), the store just never corrupts the index by growing it unbounded.
 *
 * The store is mechanical: trust rules (a human statement must not be overwritten by an inference)
 * live in the write gate, which every automatic writer goes through. Direct callers are the
 * `memory_write` tool (model-initiated) and tests.
 */
export function writeMemoryEntry(scope: MemoryScope, input: MemoryWriteInput): MemoryWriteResult {
  validateIdentifier(input.slug, "slug");
  if (!input.title.trim()) throw new Error("Memory entry title must not be empty.");
  if (!input.hook.trim()) throw new Error("Memory entry hook must not be empty.");

  const dir = memoryDir(scope);
  const file = `${input.slug}.md`;
  const currentIndex = readMemoryIndex(scope);
  const withoutExisting = currentIndex.entries.filter((entry) => entry.file !== file);
  const nextEntries = [...withoutExisting, { title: input.title, file, hook: input.hook }];
  const nextIndexRaw = `${nextEntries.map(buildIndexLine).join("\n")}\n`;
  const indexBytes = Buffer.byteLength(nextIndexRaw, "utf8");
  const indexLines = nextEntries.length;

  if (indexBytes > MEMORY_INDEX_MAX_BYTES || indexLines > MEMORY_INDEX_MAX_LINES) {
    return {
      ok: false,
      reason: "index_cap_exceeded",
      indexBytes,
      indexLines,
      capBytes: MEMORY_INDEX_MAX_BYTES,
      capLines: MEMORY_INDEX_MAX_LINES,
    };
  }

  ensureMemoryDir(scope);
  const previous = readMemoryEntry(scope, input.slug).entry;
  const now = new Date().toISOString();
  // A rewrite keeps what the entry said before, readable as its history (doc 18 §4.4).
  if (previous && previous.body.trim() !== input.body.trim()) keepVersion(scope, input.slug, previous);
  const revision = (previous?.frontmatter.metadata.revision ?? 0) + 1;
  const confidence =
    input.confidence === undefined ? undefined : Math.max(0, Math.min(1, Math.round(input.confidence * 100) / 100));

  const frontmatter: MemoryFrontmatter = {
    name: input.slug,
    description: input.description,
    metadata: {
      type: input.type,
      modified: now,
      created: previous?.frontmatter.metadata.created ?? now,
      source: input.source ?? previous?.frontmatter.metadata.source ?? "inference",
      confidence: confidence ?? previous?.frontmatter.metadata.confidence,
      lastConfirmed: input.confirmed === false ? previous?.frontmatter.metadata.lastConfirmed : now,
      relatedFiles: normalizePaths(input.relatedFiles ?? previous?.frontmatter.metadata.relatedFiles),
      tags: normalizeTags(input.tags ?? previous?.frontmatter.metadata.tags),
      uses: previous?.frontmatter.metadata.uses ?? 0,
      lastUsed: previous?.frontmatter.metadata.lastUsed,
      credit: previous?.frontmatter.metadata.credit,
      supersedes: input.supersedes ?? previous?.frontmatter.metadata.supersedes,
      revision,
    },
  };
  writeFileAtomic(join(dir, file), serializeEntry(frontmatter, input.body));
  writeFileAtomic(memoryIndexPath(scope), nextIndexRaw);
  appendHistory(scope, {
    at: now,
    event: previous ? "updated" : "created",
    slug: input.slug,
    source: frontmatter.metadata.source,
    type: input.type,
    revision,
    detail: input.hook,
  });

  return { ok: true, indexBytes, indexLines, revision };
}

const VERSIONS_DIR = "versions";
/** Versions kept per entry; the oldest go first. */
const MAX_VERSIONS = 10;

function keepVersion(scope: MemoryScope, slug: string, entry: MemoryEntry): void {
  try {
    const dir = join(memoryDir(scope), VERSIONS_DIR);
    mkdirSync(dir, { recursive: true });
    const revision = entry.frontmatter.metadata.revision ?? 1;
    writeFileAtomic(join(dir, `${slug}.r${revision}.md`), serializeEntry(entry.frontmatter, entry.body));
    const kept = readdirSync(dir)
      .filter((name) => name.startsWith(`${slug}.r`) && name.endsWith(".md"))
      .map((name) => ({ name, revision: Number(name.slice(slug.length + 2, -3)) }))
      .filter((version) => Number.isFinite(version.revision))
      .sort((a, b) => a.revision - b.revision);
    for (const old of kept.slice(0, Math.max(0, kept.length - MAX_VERSIONS))) unlinkSync(join(dir, old.name));
  } catch (error) {
    recordSwallowedError("memory.version", error);
  }
}

/** Earlier versions of an entry, oldest first: what it said before each rewrite. */
export function readMemoryVersions(scope: MemoryScope, slug: string): MemoryEntry[] {
  try {
    validateIdentifier(slug, "slug");
    const dir = join(memoryDir(scope), VERSIONS_DIR);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.startsWith(`${slug}.r`) && name.endsWith(".md"))
      .map((name) => ({ name, revision: Number(name.slice(slug.length + 2, -3)) }))
      .filter((version) => Number.isFinite(version.revision))
      .sort((a, b) => a.revision - b.revision)
      .flatMap((version) => {
        const entry = parseEntryFile(readFileSync(join(dir, version.name), "utf8"));
        return entry ? [entry] : [];
      });
  } catch {
    return [];
  }
}

/**
 * Moves an entry out of the index as archived, its file kept: room for new knowledge when the store is full, instead
 * of refusing it (doc 18 §4.4). Returns false when the entry is missing. Never throws.
 */
export function archiveMemoryEntry(scope: MemoryScope, slug: string, detail: string): boolean {
  try {
    const entry = readMemoryEntry(scope, slug).entry;
    if (!entry) return false;
    const now = new Date().toISOString();
    writeFileAtomic(
      memoryEntryPath(scope, slug),
      serializeEntry(
        { ...entry.frontmatter, metadata: { ...entry.frontmatter.metadata, status: "archived", validUntil: now } },
        entry.body,
      ),
    );
    const index = readMemoryIndex(scope).entries.filter((line) => line.file !== `${slug}.md`);
    writeFileAtomic(memoryIndexPath(scope), index.length > 0 ? `${index.map(buildIndexLine).join("\n")}\n` : "");
    appendHistory(scope, {
      at: now,
      event: "archived",
      slug,
      source: entry.frontmatter.metadata.source,
      type: entry.frontmatter.metadata.type,
      detail,
    });
    return true;
  } catch (error) {
    recordSwallowedError("memory.archive", error);
    return false;
  }
}

/** The line a newer entry carries about the fact it replaced. */
export function replacesNote(oldHook: string, until: string): string {
  return `Replaces: ${oldHook} (true until ${until.slice(0, 10)}).`;
}

/**
 * Marks `oldSlug` as no longer true because `bySlug` replaced it: the old entry leaves the index (retrieval stops
 * seeing it) with its file kept, marked superseded and until when; the newer entry records what it replaced. Returns
 * false when either entry is missing. Never throws.
 */
export function supersedeMemoryEntry(scope: MemoryScope, oldSlug: string, bySlug: string, detail?: string): boolean {
  try {
    if (oldSlug === bySlug) return false;
    const old = readMemoryEntry(scope, oldSlug).entry;
    const next = readMemoryEntry(scope, bySlug).entry;
    if (!old || !next) return false;
    const now = new Date().toISOString();
    const oldFile = memoryEntryPath(scope, oldSlug);
    const oldHook =
      readMemoryIndex(scope).entries.find((entry) => entry.file === `${oldSlug}.md`)?.hook ??
      old.frontmatter.description;
    writeFileAtomic(
      oldFile,
      serializeEntry(
        {
          ...old.frontmatter,
          metadata: { ...old.frontmatter.metadata, status: "superseded", supersededBy: bySlug, validUntil: now },
        },
        old.body,
      ),
    );
    const note = replacesNote(oldHook, now);
    const nextBody = next.body.includes(note) ? next.body : `${next.body.trimEnd()}\n\n${note}`;
    writeFileAtomic(
      memoryEntryPath(scope, bySlug),
      serializeEntry(
        { ...next.frontmatter, metadata: { ...next.frontmatter.metadata, supersedes: oldSlug } },
        nextBody,
      ),
    );
    const index = readMemoryIndex(scope).entries.filter((entry) => entry.file !== `${oldSlug}.md`);
    writeFileAtomic(memoryIndexPath(scope), index.length > 0 ? `${index.map(buildIndexLine).join("\n")}\n` : "");
    appendHistory(scope, {
      at: now,
      event: "superseded",
      slug: oldSlug,
      source: old.frontmatter.metadata.source,
      type: old.frontmatter.metadata.type,
      detail: detail ?? `replaced by ${bySlug}`,
    });
    return true;
  } catch (error) {
    recordSwallowedError("memory.supersede", error);
    return false;
  }
}

function normalizePaths(paths: readonly string[] | undefined): string[] | undefined {
  if (!paths) return undefined;
  const cleaned = [...new Set(paths.map((path) => path.trim().replaceAll("\\", "/")).filter(Boolean))].slice(0, 16);
  return cleaned.length > 0 ? cleaned : undefined;
}

function normalizeTags(tags: readonly string[] | undefined): string[] | undefined {
  if (!tags) return undefined;
  const cleaned = [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Rewrites only the usage counters of entries retrieval injected this turn. Cheap and mechanical;
 * a failure to touch a file never affects the turn.
 */
export function recordMemoryUse(scope: MemoryScope, slugs: readonly string[]): void {
  const now = new Date().toISOString();
  for (const slug of slugs) {
    try {
      const { entry } = readMemoryEntry(scope, slug);
      if (!entry) continue;
      entry.frontmatter.metadata.uses = (entry.frontmatter.metadata.uses ?? 0) + 1;
      entry.frontmatter.metadata.lastUsed = now;
      writeFileAtomic(memoryEntryPath(scope, slug), serializeEntry(entry.frontmatter, entry.body));
    } catch (error) {
      recordSwallowedError("memory.use", error);
    }
  }
}

/**
 * Credits the entries injected into a turn by what the turn's checks showed (audit doc 15, M3): +1 when the
 * project's checks passed on its final code, −1 when they still failed. Ranking and skill promotion trust
 * this, not how often an entry was retrieved.
 */
export function creditMemoryUse(scope: MemoryScope, slugs: readonly string[], delta: 1 | -1): void {
  for (const slug of slugs) {
    try {
      const { entry } = readMemoryEntry(scope, slug);
      if (!entry) continue;
      entry.frontmatter.metadata.credit = (entry.frontmatter.metadata.credit ?? 0) + delta;
      writeFileAtomic(memoryEntryPath(scope, slug), serializeEntry(entry.frontmatter, entry.body));
    } catch (error) {
      recordSwallowedError("memory.credit", error);
    }
  }
}

/** Marks an entry as re-checked against reality now without changing its content. */
export function confirmMemoryEntry(scope: MemoryScope, slug: string, detail?: string): boolean {
  try {
    const { entry } = readMemoryEntry(scope, slug);
    if (!entry) return false;
    const now = new Date().toISOString();
    entry.frontmatter.metadata.lastConfirmed = now;
    writeFileAtomic(memoryEntryPath(scope, slug), serializeEntry(entry.frontmatter, entry.body));
    appendHistory(scope, { at: now, event: "confirmed", slug, detail });
    return true;
  } catch (error) {
    recordSwallowedError("memory.confirm", error);
    return false;
  }
}

/**
 * Re-confirms the entries a command that just passed vouches for (audit doc 15, M2 and Phase 4.4): an entry
 * that names that exact command in backticks is current again, whatever its related files did since, so
 * staleness is no longer one-way. Only an exact match counts: `bun test` passing says nothing for an entry
 * that insists on `bun test --preload ./test/setup.ts`, and would rather contradict it.
 */
export function reconfirmByPassingCommands(scope: MemoryScope, commands: readonly string[]): string[] {
  const normalize = (command: string) => command.trim().replace(/\s+/gu, " ");
  const passed = new Set(commands.map(normalize).filter((command) => command.length > 0));
  if (passed.size === 0) return [];
  const confirmed: string[] = [];
  for (const record of listMemoryRecords(scope)) {
    const named = [...`${record.index.hook}\n${record.entry.body}`.matchAll(/`([^`\n]+)`/gu)].map((match) =>
      normalize(match[1] ?? ""),
    );
    const command = named.find((candidate) => passed.has(candidate));
    if (command && confirmMemoryEntry(scope, record.slug, `\`${command}\` passed`)) confirmed.push(record.slug);
  }
  return confirmed;
}

/**
 * Removes one memory entry — the "forget" operation a memory system needs alongside store and
 * retrieve (docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md §16): a wrong or superseded entry
 * left in place quietly adds noise to every future retrieval. Removes the index line and the
 * topic file. Self-healing: either one existing is enough to count as "found," so a partially
 * corrupted state (e.g. the topic file deleted by hand but the index line left behind) still
 * cleans up fully rather than getting stuck. Never throws for a missing slug — same "refuse
 * safely, don't corrupt" philosophy as `writeMemoryEntry`.
 */
export function deleteMemoryEntry(scope: MemoryScope, slug: string, detail?: string): MemoryDeleteResult {
  validateIdentifier(slug, "slug");

  const dir = memoryDir(scope);
  const file = `${slug}.md`;
  const entryPath = join(dir, file);
  const fileExists = existsSync(entryPath);

  const currentIndex = readMemoryIndex(scope);
  const withoutEntry = currentIndex.entries.filter((entry) => entry.file !== file);
  const wasIndexed = withoutEntry.length !== currentIndex.entries.length;

  if (!fileExists && !wasIndexed) {
    return { ok: false, reason: "not_found" };
  }

  if (fileExists) unlinkSync(entryPath);
  if (wasIndexed) {
    const nextIndexRaw = withoutEntry.length > 0 ? `${withoutEntry.map(buildIndexLine).join("\n")}\n` : "";
    writeFileAtomic(memoryIndexPath(scope), nextIndexRaw);
  }
  appendHistory(scope, { at: new Date().toISOString(), event: "deleted", slug, detail });

  return { ok: true };
}

const REFLECTIONS_FILE = "reflections.jsonl";

export interface ReflectionAuditRecord {
  at: string;
  qualified: boolean;
  reason: string;
  /** Model output, clipped; the evidence for why memory did or did not change. */
  rawText?: string;
  candidates: number;
  decisions: Array<{ slug: string; action: string; reason: string }>;
  written: string[];
  error?: string;
}

/** Why memory changed (or did not) after a turn — the audit trail for automatic capture. */
export function appendReflectionAudit(scope: MemoryScope, record: ReflectionAuditRecord): void {
  try {
    const path = join(memoryDir(scope), REFLECTIONS_FILE);
    ensureMemoryDir(scope);
    if (existsSync(path) && statSync(path).size > MEMORY_HISTORY_MAX_BYTES) {
      const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
      writeFileAtomic(path, `${lines.slice(Math.floor(lines.length / 2)).join("\n")}\n`);
    }
    appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  } catch (error) {
    // audit is a convenience
    recordSwallowedError("memory.audit", error);
  }
}

export function readReflectionAudit(scope: MemoryScope, limit = 50): ReflectionAuditRecord[] {
  const path = join(memoryDir(scope), REFLECTIONS_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as ReflectionAuditRecord];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/** Records a skill promotion in the timeline (the skill file itself lives under `.agents/skills`). */
export function recordMemoryPromotion(scope: MemoryScope, slug: string, detail: string): void {
  appendHistory(scope, { at: new Date().toISOString(), event: "promoted", slug, detail });
}
