import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  MemoryDeleteResult,
  MemoryEntry,
  MemoryFrontmatter,
  MemoryIndexEntry,
  MemoryReadEntryResult,
  MemoryReadIndexResult,
  MemoryScope,
  MemoryType,
  MemoryWriteInput,
  MemoryWriteResult,
} from "./types";

/**
 * File-based project/agent memory store.
 *
 * Deliberately not a database: memory is markdown on disk under `<workspace>/.shelra/memory/`
 * (project scope) or `<workspace>/.shelra/memory/agents/<agentName>/` (agent scope), mirroring
 * the confirmed Claude Code MEMORY.md + topic-file design. The index must stay a cheap, always-safe
 * read used to judge relevance; topic files load only on demand. See docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md.
 */

const INDEX_FILE = "MEMORY.md";
export const MEMORY_INDEX_MAX_BYTES = 25 * 1024;
export const MEMORY_INDEX_MAX_LINES = 200;

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const INDEX_LINE_PATTERN = /^-\s*\[(.+?)\]\((.+?)\)\s*—\s*(.*)$/;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function validateIdentifier(value: string, label: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Invalid ${label} "${value}": expected kebab-case, starting with a lowercase letter.`);
  }
}

function scopeDir(scope: MemoryScope): string {
  if (scope.kind === "agent") {
    validateIdentifier(scope.agentName, "agentName");
    return join(scope.workspace, ".shelra", "memory", "agents", scope.agentName);
  }
  return join(scope.workspace, ".shelra", "memory");
}

/** Exposed for callers/tests that need to locate memory files without duplicating scope logic. */
export function memoryIndexPath(scope: MemoryScope): string {
  return join(scopeDir(scope), INDEX_FILE);
}

export function memoryEntryPath(scope: MemoryScope, slug: string): string {
  validateIdentifier(slug, "slug");
  return join(scopeDir(scope), `${slug}.md`);
}

export function projectMemoryScope(workspace: string): MemoryScope {
  return { kind: "project", workspace };
}

export function agentMemoryScope(workspace: string, agentName: string): MemoryScope {
  return { kind: "agent", workspace, agentName };
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

function serializeEntry(frontmatter: MemoryFrontmatter, body: string): string {
  const description = `"${escapeYamlString(frontmatter.description)}"`;
  return [
    "---",
    `name: ${frontmatter.name}`,
    `description: ${description}`,
    "metadata:",
    `  type: ${frontmatter.metadata.type}`,
    `  modified: ${frontmatter.metadata.modified}`,
    "---",
    "",
    body.trimEnd(),
    "",
  ].join("\n");
}

function parseEntryFile(raw: string): MemoryEntry | null {
  const match = raw.match(FRONTMATTER_PATTERN);
  if (!match) return null;
  const [, frontmatterBlock, body] = match;

  const nameMatch = frontmatterBlock.match(/^name:\s*(.+)$/m);
  const typeMatch = frontmatterBlock.match(/^\s*type:\s*(.+)$/m);
  const modifiedMatch = frontmatterBlock.match(/^\s*modified:\s*(.+)$/m);
  if (!nameMatch || !typeMatch || !modifiedMatch) return null;

  const quotedDescription = frontmatterBlock.match(/^description:\s*"((?:[^"\\]|\\.)*)"\s*$/m);
  const bareDescription = frontmatterBlock.match(/^description:\s*(.+)$/m);
  const description = quotedDescription
    ? unescapeYamlString(quotedDescription[1])
    : bareDescription
      ? bareDescription[1].trim()
      : "";

  return {
    frontmatter: {
      name: nameMatch[1].trim(),
      description,
      metadata: {
        type: typeMatch[1].trim() as MemoryType,
        modified: modifiedMatch[1].trim(),
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

/** Always safe: a missing scope directory or index file is an empty result, never an error. */
export function readMemoryIndex(scope: MemoryScope): MemoryReadIndexResult {
  const path = memoryIndexPath(scope);
  if (!existsSync(path)) return { entries: [], raw: "", exists: false };
  try {
    const raw = readFileSync(path, "utf8");
    return { entries: parseIndex(raw), raw, exists: true };
  } catch {
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
  } catch {
    return { entry: null, exists: false };
  }
}

/**
 * Upserts one topic file and its index pointer. Refuses (without writing anything) rather than
 * silently letting the index grow past the cap — the caller decides what to do about a refusal
 * (e.g. trim an older memory first), the store just never corrupts the index by growing it unbounded.
 */
export function writeMemoryEntry(scope: MemoryScope, input: MemoryWriteInput): MemoryWriteResult {
  validateIdentifier(input.slug, "slug");
  if (!input.title.trim()) throw new Error("Memory entry title must not be empty.");
  if (!input.hook.trim()) throw new Error("Memory entry hook must not be empty.");

  const dir = scopeDir(scope);
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

  mkdirSync(dir, { recursive: true });

  const frontmatter: MemoryFrontmatter = {
    name: input.slug,
    description: input.description,
    metadata: { type: input.type, modified: new Date().toISOString() },
  };
  writeFileAtomic(join(dir, file), serializeEntry(frontmatter, input.body));
  writeFileAtomic(memoryIndexPath(scope), nextIndexRaw);

  return { ok: true, indexBytes, indexLines };
}

/**
 * Removes one memory entry — the "forget" operation a memory system needs alongside store and
 * retrieve (docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md §16): a wrong or superseded entry
 * left in place quietly adds noise to every future retrieval. Removes the index line and the
 * topic file. Self-healing: either one existing is enough to count as "found," so a partially
 * corrupted state (e.g. the topic file deleted by hand but the index line left behind) still
 * cleans up fully rather than getting stuck. Never throws for a missing slug — same "refuse
 * safely, don't corrupt" philosophy as `writeMemoryEntry`.
 */
export function deleteMemoryEntry(scope: MemoryScope, slug: string): MemoryDeleteResult {
  validateIdentifier(slug, "slug");

  const dir = scopeDir(scope);
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

  return { ok: true };
}
