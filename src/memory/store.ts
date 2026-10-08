import { randomUUID } from "node:crypto";
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
import { withRecall } from "./dynamics";
import { humanTopicDirectory, listHumanTopics, prepareHumanTopic, readHumanTopic } from "./human-files";
import { withMemoryLock } from "./lock";
import { normalizeMemorySubject, sameSubject, subjectFor, subjectFromStatement } from "./subjects";
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

/** How long usage bookkeeping (recall, use, credit) may hold the thread waiting for another session's write. */
const BOOKKEEPING_WAIT_MS = 50;

function safeMemoryMutation<T>(
  scope: MemoryScope,
  label: string,
  fallback: T,
  operation: () => T,
  maxWaitMs?: number,
): T {
  try {
    return withMemoryLock(memoryDir(scope), operation, maxWaitMs);
  } catch (error) {
    recordSwallowedError(`memory.${label}`, error);
    return fallback;
  }
}

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
  const human = join(humanTopicDirectory(memoryDir(scope)), `${slug}.md`);
  if (existsSync(human)) return human;
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

const STATUSES: readonly MemoryStatus[] = ["active", "superseded", "invalidated", "archived", "done"];

export function isMemoryStatus(value: unknown): value is MemoryStatus {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}

/** Whether an entry is current truth: an entry with no status is. */
export function isCurrentMemory(record: MemoryRecord): boolean {
  const status = record.entry.frontmatter.metadata.status;
  return status === undefined || status === "active";
}

function writeFileAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp-${randomUUID()}`;
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, path);
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch (cleanupError) {
      recordSwallowedError("memory.atomic-cleanup", cleanupError);
    }
    throw error;
  }
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
  if (meta.indexTitle !== undefined) lines.push(`  indexTitle: "${escapeYamlString(meta.indexTitle)}"`);
  if (meta.indexHook !== undefined) lines.push(`  indexHook: "${escapeYamlString(meta.indexHook)}"`);
  if (meta.source) lines.push(`  source: ${meta.source}`);
  if (meta.confidence !== undefined) lines.push(`  confidence: ${meta.confidence}`);
  if (meta.lastConfirmed) lines.push(`  lastConfirmed: ${meta.lastConfirmed}`);
  if (meta.subject) {
    lines.push(`  subjectEntity: "${escapeYamlString(meta.subject.entity)}"`);
    if (meta.subject.environment) lines.push(`  subjectEnvironment: "${escapeYamlString(meta.subject.environment)}"`);
  }
  const conflicts = yamlList(meta.conflictsWith);
  if (conflicts) lines.push(`  conflictsWith: ${conflicts}`);
  if (meta.conflictCount) lines.push(`  conflictCount: ${meta.conflictCount}`);
  if (meta.lastPassedCommand) lines.push(`  lastPassedCommand: "${escapeYamlString(meta.lastPassedCommand)}"`);
  if (meta.commandObservedAt) lines.push(`  commandObservedAt: ${meta.commandObservedAt}`);
  const related = yamlList(meta.relatedFiles);
  if (related) lines.push(`  relatedFiles: ${related}`);
  const tags = yamlList(meta.tags);
  if (tags) lines.push(`  tags: ${tags}`);
  if (meta.uses !== undefined) lines.push(`  uses: ${meta.uses}`);
  const recalls = yamlList(meta.recalls);
  if (recalls) lines.push(`  recalls: ${recalls}`);
  if (meta.importance !== undefined) lines.push(`  importance: ${meta.importance}`);
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
  const importanceRaw = readScalar(frontmatterBlock, "importance");
  const importance = importanceRaw === undefined ? undefined : Number(importanceRaw);
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
        indexTitle: parseYamlList(`[${readScalar(frontmatterBlock, "indexTitle") ?? ""}]`)?.[0],
        indexHook: parseYamlList(`[${readScalar(frontmatterBlock, "indexHook") ?? ""}]`)?.[0],
        modified,
        created: readScalar(frontmatterBlock, "created"),
        source: isMemorySource(source) ? source : undefined,
        confidence: confidence !== undefined && Number.isFinite(confidence) ? confidence : undefined,
        lastConfirmed: readScalar(frontmatterBlock, "lastConfirmed"),
        subject:
          readScalar(frontmatterBlock, "subjectEntity") !== undefined
            ? normalizeMemorySubject({
                entity: parseYamlList(`[${readScalar(frontmatterBlock, "subjectEntity")}]`)?.[0],
                ...(readScalar(frontmatterBlock, "subjectEnvironment") !== undefined
                  ? { environment: parseYamlList(`[${readScalar(frontmatterBlock, "subjectEnvironment")}]`)?.[0] }
                  : {}),
              })
            : undefined,
        conflictsWith: parseYamlList(readScalar(frontmatterBlock, "conflictsWith")),
        conflictCount: Number.parseInt(readScalar(frontmatterBlock, "conflictCount") ?? "0", 10) || undefined,
        lastPassedCommand: parseYamlList(`[${readScalar(frontmatterBlock, "lastPassedCommand") ?? ""}]`)?.[0],
        commandObservedAt: readScalar(frontmatterBlock, "commandObservedAt"),
        relatedFiles: parseYamlList(readScalar(frontmatterBlock, "relatedFiles")),
        tags: parseYamlList(readScalar(frontmatterBlock, "tags")),
        uses: uses !== undefined && Number.isFinite(uses) ? uses : undefined,
        recalls: parseYamlList(readScalar(frontmatterBlock, "recalls")),
        importance:
          importance !== undefined && Number.isFinite(importance) ? Math.max(0, Math.min(1, importance)) : undefined,
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

/** An index entry is one line: a title or hook that holds a line break would hide the entry from every reader. */
function oneLine(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function buildIndexLine(entry: MemoryIndexEntry): string {
  return `- [${oneLine(entry.title).replace(/\]\(/gu, "] (")}](${entry.file}) — ${oneLine(entry.hook)}`;
}

/**
 * Reads the index one entry per line. An entry a writer broke across lines (seen live 2026-09-25: a lesson whose
 * title held a clip marker's line break, so `memory_list` said "No project memory saved yet") is joined back.
 */
function parseIndex(raw: string): MemoryIndexEntry[] {
  const blocks: string[] = [];
  for (const line of raw.split(/\r?\n/u)) {
    const last = blocks.length - 1;
    if (/^-\s*\[/u.test(line)) blocks.push(line);
    // Only an entry that does not parse yet takes the next line: a line after a whole entry is not part of it.
    else if (last >= 0 && line.trim() && !INDEX_LINE_PATTERN.test(blocks[last] ?? "")) {
      blocks[last] = `${blocks[last]} ${line.trim()}`;
    }
  }
  const entries: MemoryIndexEntry[] = [];
  for (const block of blocks) {
    const match = block.match(INDEX_LINE_PATTERN);
    if (match) entries.push({ title: oneLine(match[1]), file: match[2], hook: oneLine(match[3]) });
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
    return {
      entries: [],
      raw: "",
      exists: true,
      complete: false,
      warnings: [`Memory projection unavailable: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

/** Loads one topic file body. Only call this once the index says the entry is relevant. */
export function readMemoryEntry(scope: MemoryScope, slug: string): MemoryReadEntryResult {
  const path = memoryEntryPath(scope, slug);
  if (!existsSync(path)) return { entry: null, exists: false };
  try {
    const human = join(humanTopicDirectory(memoryDir(scope)), `${slug}.md`);
    const raw = path === human ? readHumanTopic(memoryDir(scope), `${slug}.md`) : readFileSync(path, "utf8");
    return { entry: parseEntryFile(raw), exists: true };
  } catch (error) {
    recordSwallowedError("memory.read", error);
    return { entry: null, exists: false };
  }
}

export function slugFromIndexFile(file: string): string {
  return file.replace(/^human\//u, "").replace(/\.md$/u, "");
}

/** Active topics, including human knowledge omitted by the short projection. */
export function loadMemoryRecords(scope: MemoryScope): {
  records: MemoryRecord[];
  complete: boolean;
  warnings: string[];
} {
  const records = new Map<string, MemoryRecord>();
  const warnings: string[] = [];
  const projection = readMemoryIndex(scope);
  warnings.push(...(projection.warnings ?? []));
  for (const index of projection.entries) {
    const slug = slugFromIndexFile(index.file);
    if (!IDENTIFIER_PATTERN.test(slug)) continue;
    const { entry } = readMemoryEntry(scope, slug);
    if (entry) {
      const record = { slug, index, entry };
      if (isCurrentMemory(record)) records.set(slug, record);
    } else warnings.push(`${index.file}: indexed topic unavailable.`);
  }
  const human = listHumanTopics(memoryDir(scope));
  warnings.push(...human.warnings);
  for (const { file, raw } of human.topics) {
    const slug = slugFromIndexFile(file);
    const entry = parseEntryFile(raw);
    const meta = entry?.frontmatter.metadata;
    if (
      !entry ||
      entry.frontmatter.name !== slug ||
      meta?.source !== "human" ||
      !isMemoryType(meta.type) ||
      !meta.indexTitle ||
      !meta.indexHook
    ) {
      records.delete(slug);
      warnings.push(`${file}: invalid self-indexing human topic.`);
      continue;
    }
    const record = { slug, entry, index: { file: `human/${file}`, title: meta.indexTitle, hook: meta.indexHook } };
    if (isCurrentMemory(record)) records.set(slug, record);
    else records.delete(slug);
  }
  return { records: [...records.values()], complete: warnings.length === 0, warnings };
}

export function listMemoryRecords(scope: MemoryScope): MemoryRecord[] {
  return loadMemoryRecords(scope).records;
}

export function readActiveMemoryIndex(
  scope: MemoryScope,
): MemoryReadIndexResult & { complete: boolean; warnings: string[] } {
  const loaded = loadMemoryRecords(scope);
  return {
    entries: loaded.records.map((record) => ({
      ...record.index,
      subject: record.entry.frontmatter.metadata.subject ?? subjectFromStatement(record.index.hook),
      conflictsWith: record.entry.frontmatter.metadata.conflictsWith,
      conflictCount: record.entry.frontmatter.metadata.conflictCount,
    })),
    raw: readMemoryIndex(scope).raw,
    exists: loaded.records.length > 0 || existsSync(memoryIndexPath(scope)),
    complete: loaded.complete,
    warnings: loaded.warnings,
  };
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
  return withMemoryLock(memoryDir(scope), () => writeMemoryEntryUnlocked(scope, input));
}

function writeMemoryEntryUnlocked(scope: MemoryScope, input: MemoryWriteInput): MemoryWriteResult {
  validateIdentifier(input.slug, "slug");
  if (!input.title.trim()) throw new Error("Memory entry title must not be empty.");
  if (!input.hook.trim()) throw new Error("Memory entry hook must not be empty.");

  const dir = memoryDir(scope);
  const file = `${input.slug}.md`;
  const currentIndex = readMemoryIndex(scope);
  const withoutExisting = currentIndex.entries.filter((entry) => slugFromIndexFile(entry.file) !== input.slug);
  const previous = readMemoryEntry(scope, input.slug).entry;
  const human = (input.source ?? previous?.frontmatter.metadata.source) === "human";
  if (previous?.frontmatter.metadata.source === "human" && !human)
    throw new Error("A human-stated memory cannot be replaced by a non-human write.");
  let nextEntries = [
    ...withoutExisting,
    { title: input.title, file: human ? `human/${file}` : file, hook: input.hook },
  ];
  let nextIndexRaw = `${nextEntries.map(buildIndexLine).join("\n")}\n`;
  const withinBudget = () =>
    Buffer.byteLength(nextIndexRaw, "utf8") <= MEMORY_INDEX_MAX_BYTES && nextEntries.length <= MEMORY_INDEX_MAX_LINES;
  if (!human && currentIndex.complete !== false && !withinBudget()) {
    for (const pointer of withoutExisting) {
      const slug = slugFromIndexFile(pointer.file);
      if (!IDENTIFIER_PATTERN.test(slug) || !existsSync(join(humanTopicDirectory(dir), `${slug}.md`))) continue;
      const canonical = readMemoryEntry(scope, slug).entry;
      if (
        canonical?.frontmatter.metadata.source !== "human" ||
        !canonical.frontmatter.metadata.indexHook ||
        !canonical.frontmatter.metadata.indexTitle
      )
        continue;
      nextEntries = nextEntries.filter((entry) => entry.file !== pointer.file);
      nextIndexRaw = `${nextEntries.map(buildIndexLine).join("\n")}\n`;
      if (withinBudget()) break;
    }
  }
  const indexBytes = Buffer.byteLength(nextIndexRaw, "utf8");
  const indexLines = nextEntries.length;
  const fitsProjection =
    currentIndex.complete !== false && indexBytes <= MEMORY_INDEX_MAX_BYTES && indexLines <= MEMORY_INDEX_MAX_LINES;

  if (!human && currentIndex.complete === false)
    throw new Error("Memory projection unavailable; no inference was written.");

  if (!human && !fitsProjection) {
    return {
      ok: false,
      reason: "index_cap_exceeded",
      indexBytes,
      indexLines,
      capBytes: MEMORY_INDEX_MAX_BYTES,
      capLines: MEMORY_INDEX_MAX_LINES,
    };
  }

  const previousHook =
    previous?.frontmatter.metadata.indexHook ??
    currentIndex.entries.find((entry) => slugFromIndexFile(entry.file) === input.slug)?.hook;
  const relatedFiles = normalizePaths(input.relatedFiles ?? previous?.frontmatter.metadata.relatedFiles);
  const subject = subjectFor({
    ...input,
    source: human ? "human" : (input.source ?? previous?.frontmatter.metadata.source),
  });
  const previousSubject =
    previous?.frontmatter.metadata.subject ?? (previousHook ? subjectFromStatement(previousHook) : undefined);
  if (previous && !sameSubject(subject, previousSubject)) throw new Error("A memory write cannot change its subject.");
  ensureMemoryDir(scope);
  const now = new Date().toISOString();
  // A rewrite keeps what the entry said before, readable as its history (doc 18 §4.4).
  if (previous && previous.body.trim() !== input.body.trim()) keepVersion(scope, input.slug, previous);
  const revision = (previous?.frontmatter.metadata.revision ?? 0) + 1;
  const confidence =
    input.confidence === undefined ? undefined : Math.max(0, Math.min(1, Math.round(input.confidence * 100) / 100));
  const sameClaim =
    previous?.body.trimEnd() === input.body.trimEnd() &&
    previousHook === oneLine(input.hook) &&
    JSON.stringify(previous?.frontmatter.metadata.relatedFiles ?? []) === JSON.stringify(relatedFiles ?? []);

  const frontmatter: MemoryFrontmatter = {
    name: input.slug,
    description: input.description,
    metadata: {
      type: input.type,
      indexTitle: human ? oneLine(input.title) : undefined,
      indexHook: human ? oneLine(input.hook) : undefined,
      modified: now,
      created: previous?.frontmatter.metadata.created ?? now,
      source: input.source ?? previous?.frontmatter.metadata.source ?? "inference",
      subject,
      conflictsWith:
        input.conflictsWith === undefined
          ? previous?.frontmatter.metadata.conflictsWith
          : [...new Set(input.conflictsWith)].slice(0, 128),
      conflictCount:
        input.conflictCount ??
        (input.conflictsWith === undefined ? previous?.frontmatter.metadata.conflictCount : input.conflictsWith.length),
      confidence: confidence ?? previous?.frontmatter.metadata.confidence,
      lastConfirmed:
        input.confirmed === true ? now : sameClaim ? previous?.frontmatter.metadata.lastConfirmed : undefined,
      lastPassedCommand: sameClaim ? previous?.frontmatter.metadata.lastPassedCommand : undefined,
      commandObservedAt: sameClaim ? previous?.frontmatter.metadata.commandObservedAt : undefined,
      relatedFiles,
      tags: normalizeTags(input.tags ?? previous?.frontmatter.metadata.tags),
      uses: previous?.frontmatter.metadata.uses ?? 0,
      recalls: previous?.frontmatter.metadata.recalls,
      importance: input.importance ?? previous?.frontmatter.metadata.importance,
      lastUsed: previous?.frontmatter.metadata.lastUsed,
      credit: previous?.frontmatter.metadata.credit,
      supersedes: input.supersedes ?? previous?.frontmatter.metadata.supersedes,
      revision,
    },
  };
  const serialized = serializeEntry(frontmatter, input.body);
  const topicPath = human ? prepareHumanTopic(dir, file, Buffer.byteLength(serialized, "utf8")) : join(dir, file);
  writeFileAtomic(topicPath, serialized);
  let projected = false;
  let projectionWarning: string | undefined;
  if (human) {
    if (fitsProjection) {
      try {
        writeFileAtomic(memoryIndexPath(scope), nextIndexRaw);
        projected = true;
      } catch (error) {
        projectionWarning = error instanceof Error ? error.message : String(error);
        recordSwallowedError("memory.projection", error);
      }
    } else
      projectionWarning =
        currentIndex.complete === false
          ? "Short index unavailable; the human topic remains stored and retrievable."
          : "Short index capacity reached; the human topic remains stored and retrievable.";
  } else {
    writeFileAtomic(memoryIndexPath(scope), nextIndexRaw);
    projected = true;
  }
  appendHistory(scope, {
    at: now,
    event: previous ? "updated" : "created",
    slug: input.slug,
    source: frontmatter.metadata.source,
    type: input.type,
    revision,
    detail: input.hook,
  });

  return {
    ok: true,
    indexBytes: projected ? indexBytes : Buffer.byteLength(currentIndex.raw, "utf8"),
    indexLines: projected ? indexLines : currentIndex.entries.length,
    revision,
    ...(human ? { projected, ...(projectionWarning ? { projectionWarning } : {}) } : {}),
  };
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
  return safeMemoryMutation(scope, "archive", false, () => archiveMemoryEntryUnlocked(scope, slug, detail));
}
function archiveMemoryEntryUnlocked(scope: MemoryScope, slug: string, detail: string): boolean {
  try {
    const entry = readMemoryEntry(scope, slug).entry;
    if (!entry) return false;
    const now = new Date().toISOString();
    const line = readMemoryIndex(scope).entries.find((item) => slugFromIndexFile(item.file) === slug);
    writeFileAtomic(
      memoryEntryPath(scope, slug),
      serializeEntry(
        { ...entry.frontmatter, metadata: { ...entry.frontmatter.metadata, status: "archived", validUntil: now } },
        entry.body,
      ),
    );
    const index = readMemoryIndex(scope).entries.filter((item) => slugFromIndexFile(item.file) !== slug);
    writeFileAtomic(memoryIndexPath(scope), index.length > 0 ? `${index.map(buildIndexLine).join("\n")}\n` : "");
    // The archive keeps each entry's index line, so a request that matches it can bring it back (recallArchivedEntry).
    const archived: ArchivedEntry = {
      slug,
      title: line?.title ?? slug,
      hook: line?.hook ?? entry.frontmatter.description,
      at: now,
      reason: detail,
    };
    appendFileSync(join(ensureMemoryDir(scope), ARCHIVE_FILE), `${JSON.stringify(archived)}\n`, "utf8");
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

const ARCHIVE_FILE = "archive.jsonl";

export interface ArchivedEntry {
  slug: string;
  title: string;
  hook: string;
  at: string;
  reason: string;
}

/** The entries archived and not brought back, newest last; one per slug. Never throws. */
export function listArchivedEntries(scope: MemoryScope): ArchivedEntry[] {
  try {
    const path = join(memoryDir(scope), ARCHIVE_FILE);
    if (!existsSync(path)) return [];
    const bySlug = new Map<string, ArchivedEntry>();
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line) as ArchivedEntry;
        bySlug.delete(item.slug);
        bySlug.set(item.slug, item);
      } catch {
        // a torn line
      }
    }
    return [...bySlug.values()];
  } catch {
    return [];
  }
}

/**
 * Brings an archived entry back when it is recalled: forgetting is not losing, and what was learned once comes back
 * easily (the "savings" of human memory). The entry returns to the index as active, with this recall counted.
 * A superseded entry stays history. Returns false when there is nothing archived under that name. Never throws.
 */
export function recallArchivedEntry(scope: MemoryScope, slug: string): boolean {
  return safeMemoryMutation(scope, "recall-archive", false, () => recallArchivedEntryUnlocked(scope, slug));
}
function recallArchivedEntryUnlocked(scope: MemoryScope, slug: string): boolean {
  try {
    const entry = readMemoryEntry(scope, slug).entry;
    if (!entry || entry.frontmatter.metadata.status !== "archived") return false;
    const archived = listArchivedEntries(scope).find((item) => item.slug === slug);
    const index = readMemoryIndex(scope).entries.filter((item) => slugFromIndexFile(item.file) !== slug);
    const line = {
      title: archived?.title ?? slug,
      file:
        entry.frontmatter.metadata.source === "human" &&
        existsSync(join(humanTopicDirectory(memoryDir(scope)), `${slug}.md`))
          ? `human/${slug}.md`
          : `${slug}.md`,
      hook: archived?.hook ?? entry.frontmatter.description,
    };
    const nextIndex = `${[...index, line].map(buildIndexLine).join("\n")}\n`;
    if (Buffer.byteLength(nextIndex, "utf8") > MEMORY_INDEX_MAX_BYTES || index.length + 1 > MEMORY_INDEX_MAX_LINES) {
      return false;
    }
    const { validUntil: _until, ...rest } = entry.frontmatter.metadata;
    writeFileAtomic(
      memoryEntryPath(scope, slug),
      serializeEntry(
        { ...entry.frontmatter, metadata: { ...rest, status: "active", recalls: withRecall(rest.recalls) } },
        entry.body,
      ),
    );
    writeFileAtomic(memoryIndexPath(scope), nextIndex);
    const remaining = listArchivedEntries(scope).filter((item) => item.slug !== slug);
    writeFileAtomic(
      join(memoryDir(scope), ARCHIVE_FILE),
      remaining.length > 0 ? `${remaining.map((item) => JSON.stringify(item)).join("\n")}\n` : "",
    );
    appendHistory(scope, {
      at: new Date().toISOString(),
      event: "recalled",
      slug,
      detail: "brought back from the archive",
    });
    return true;
  } catch (error) {
    recordSwallowedError("memory.recall", error);
    return false;
  }
}

/**
 * Marks a reminder given: it leaves the index as done, its file kept, like a note crossed off. Returns false when it
 * is missing. Never throws.
 */
export function deliverReminder(scope: MemoryScope, slug: string, detail: string): boolean {
  return safeMemoryMutation(scope, "reminder", false, () => deliverReminderUnlocked(scope, slug, detail));
}
function deliverReminderUnlocked(scope: MemoryScope, slug: string, detail: string): boolean {
  try {
    const entry = readMemoryEntry(scope, slug).entry;
    if (!entry || entry.frontmatter.metadata.type !== "reminder") return false;
    const now = new Date().toISOString();
    writeFileAtomic(
      memoryEntryPath(scope, slug),
      serializeEntry(
        { ...entry.frontmatter, metadata: { ...entry.frontmatter.metadata, status: "done", validUntil: now } },
        entry.body,
      ),
    );
    const index = readMemoryIndex(scope).entries.filter((item) => slugFromIndexFile(item.file) !== slug);
    writeFileAtomic(memoryIndexPath(scope), index.length > 0 ? `${index.map(buildIndexLine).join("\n")}\n` : "");
    appendHistory(scope, { at: now, event: "delivered", slug, detail });
    return true;
  } catch (error) {
    recordSwallowedError("memory.reminder", error);
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
  return safeMemoryMutation(scope, "supersede", false, () =>
    supersedeMemoryEntryUnlocked(scope, oldSlug, bySlug, detail),
  );
}
function supersedeMemoryEntryUnlocked(scope: MemoryScope, oldSlug: string, bySlug: string, detail?: string): boolean {
  try {
    if (oldSlug === bySlug) return false;
    const old = readMemoryEntry(scope, oldSlug).entry;
    const next = readMemoryEntry(scope, bySlug).entry;
    if (!old || !next) return false;
    if (old.frontmatter.metadata.source === "human" && next.frontmatter.metadata.source !== "human") return false;
    const oldHookForScope =
      old.frontmatter.metadata.indexHook ??
      readMemoryIndex(scope).entries.find((entry) => slugFromIndexFile(entry.file) === oldSlug)?.hook ??
      "";
    const nextHookForScope =
      next.frontmatter.metadata.indexHook ??
      readMemoryIndex(scope).entries.find((entry) => slugFromIndexFile(entry.file) === bySlug)?.hook ??
      "";
    if (
      !sameSubject(
        old.frontmatter.metadata.subject ?? subjectFromStatement(oldHookForScope),
        next.frontmatter.metadata.subject ?? subjectFromStatement(nextHookForScope),
      )
    )
      return false;
    const now = new Date().toISOString();
    const oldFile = memoryEntryPath(scope, oldSlug);
    const oldHook =
      readMemoryIndex(scope).entries.find((entry) => slugFromIndexFile(entry.file) === oldSlug)?.hook ??
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
    const index = readMemoryIndex(scope).entries.filter((entry) => slugFromIndexFile(entry.file) !== oldSlug);
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
 * A memory put to use: the model read it (memory_read), or the turn ran and passed the command it names. That is the
 * rehearsal that strengthens a memory (dynamics.ts), as retrieval practice does for a person; being shown is not.
 * Never throws.
 */
export function recordRecall(scope: MemoryScope, slugs: readonly string[]): void {
  safeMemoryMutation(scope, "recall", undefined, () => recordRecallUnlocked(scope, slugs), BOOKKEEPING_WAIT_MS);
}
function recordRecallUnlocked(scope: MemoryScope, slugs: readonly string[]): void {
  for (const slug of slugs) {
    try {
      const { entry } = readMemoryEntry(scope, slug);
      if (!entry) continue;
      entry.frontmatter.metadata.recalls = withRecall(entry.frontmatter.metadata.recalls);
      writeFileAtomic(memoryEntryPath(scope, slug), serializeEntry(entry.frontmatter, entry.body));
    } catch (error) {
      recordSwallowedError("memory.recall", error);
    }
  }
}

/** The commands an entry names in backticks, normalized: what "using" it means for a turn that runs one. */
export function namedCommands(text: string): string[] {
  return [...text.matchAll(/`([^`\n]+)`/gu)].map((match) => (match[1] ?? "").trim().replace(/\s+/gu, " "));
}

/**
 * Rewrites only the usage counters of entries retrieval injected this turn. Cheap and mechanical;
 * a failure to touch a file never affects the turn.
 */
export function recordMemoryUse(scope: MemoryScope, slugs: readonly string[]): void {
  safeMemoryMutation(scope, "use", undefined, () => recordMemoryUseUnlocked(scope, slugs), BOOKKEEPING_WAIT_MS);
}
function recordMemoryUseUnlocked(scope: MemoryScope, slugs: readonly string[]): void {
  const now = new Date().toISOString();
  for (const slug of slugs) {
    try {
      const { entry } = readMemoryEntry(scope, slug);
      if (!entry) continue;
      entry.frontmatter.metadata.uses = (entry.frontmatter.metadata.uses ?? 0) + 1;
      entry.frontmatter.metadata.lastUsed = now;
      // Being shown is exposure, not recall: an entry strengthens when it is used (recordRecall), or two look-alike
      // entries shown together would strengthen alike (doc 18 review, round 3).
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
  safeMemoryMutation(
    scope,
    "credit",
    undefined,
    () => creditMemoryUseUnlocked(scope, slugs, delta),
    BOOKKEEPING_WAIT_MS,
  );
}
function creditMemoryUseUnlocked(scope: MemoryScope, slugs: readonly string[], delta: 1 | -1): void {
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
  return safeMemoryMutation(scope, "confirm", false, () => confirmMemoryEntryUnlocked(scope, slug, detail));
}
function confirmMemoryEntryUnlocked(scope: MemoryScope, slug: string, detail?: string): boolean {
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
 * Observes an exact named command's pass without confirming arbitrary claims in its entry. A command
 * is a recall signal under the project's standing policy, never confirmation of the entry's claims.
 */
export function recordMemoryCommandEvidence(scope: MemoryScope, commands: readonly string[]): string[] {
  const normalize = (command: string) => command.trim().replace(/\s+/gu, " ");
  const passed = new Set(commands.map(normalize).filter((command) => command.length > 0));
  if (passed.size === 0) return [];
  const observed: string[] = [];
  for (const record of listMemoryRecords(scope)) {
    const named = namedCommands(`${record.index.hook}\n${record.entry.body}`);
    const command = named.find((candidate) => passed.has(candidate));
    if (!command) continue;
    const saved = safeMemoryMutation(
      scope,
      "command-evidence",
      false,
      () => {
        const entry = readMemoryEntry(scope, record.slug).entry;
        if (
          !entry ||
          !isCurrentMemory({ ...record, entry }) ||
          entry.frontmatter.metadata.revision !== record.entry.frontmatter.metadata.revision ||
          entry.body !== record.entry.body
        )
          return false;
        const now = new Date().toISOString();
        entry.frontmatter.metadata.lastPassedCommand = normalize(command);
        entry.frontmatter.metadata.commandObservedAt = now;
        writeFileAtomic(memoryEntryPath(scope, record.slug), serializeEntry(entry.frontmatter, entry.body));
        appendHistory(scope, {
          at: now,
          event: "command-observed",
          slug: record.slug,
          detail: `\`${normalize(command)}\` passed; content not confirmed`,
        });
        return true;
      },
      BOOKKEEPING_WAIT_MS,
    );
    if (saved) observed.push(record.slug);
  }
  recordRecall(scope, observed);
  return observed;
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
  return withMemoryLock(memoryDir(scope), () => deleteMemoryEntryUnlocked(scope, slug, detail));
}
function deleteMemoryEntryUnlocked(scope: MemoryScope, slug: string, detail?: string): MemoryDeleteResult {
  validateIdentifier(slug, "slug");

  const dir = memoryDir(scope);
  const file = `${slug}.md`;
  const entryPath = memoryEntryPath(scope, slug);
  const fileExists = existsSync(entryPath);
  if (fileExists && entryPath === join(humanTopicDirectory(dir), file)) readHumanTopic(dir, file);

  const currentIndex = readMemoryIndex(scope);
  const withoutEntry = currentIndex.entries.filter((entry) => slugFromIndexFile(entry.file) !== slug);
  const wasIndexed = withoutEntry.length !== currentIndex.entries.length;

  if (!fileExists && !wasIndexed) {
    return { ok: false, reason: "not_found" };
  }

  if (fileExists) unlinkSync(entryPath);
  const legacyPath = join(dir, file);
  if (legacyPath !== entryPath && existsSync(legacyPath)) unlinkSync(legacyPath);
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
  /** What wrote it: a turn's reflection, the user's words, a reminder, the daily consolidation, a dropped deferred
   * reflection, or a turn that ended without its learning step. Older records have none. */
  kind?: "reflection" | "directive" | "reminder" | "consolidation" | "dropped" | "unlearned";
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
  safeMemoryMutation(scope, "audit", undefined, () => appendReflectionAuditUnlocked(scope, record));
}
function appendReflectionAuditUnlocked(scope: MemoryScope, record: ReflectionAuditRecord): void {
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
