/**
 * Shared types for Shelra's file-based project/agent memory layer.
 *
 * Modeled on the confirmed Claude Code auto-memory design (docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md §1):
 * a concise index file that is always cheap to read, plus one topic file per memory that loads on demand.
 * This is deliberately separate from the SQLite session store — memory is markdown on disk, not a DB row,
 * so it stays inspectable and editable outside the runtime.
 */

/** Small, code-relevant taxonomy. Not the strategic-research memory taxonomy under `.claude/agents` — unrelated. */
export type MemoryType =
  | "architecture"
  | "debugging"
  | "build"
  | "testing"
  | "conventions"
  | "known-problems"
  | "important-codepaths"
  | "decisions";

export interface MemoryFrontmatter {
  /** Kebab-case slug; also the topic file's basename without extension. */
  name: string;
  /** One-line summary used to judge relevance before loading the body. */
  description: string;
  metadata: {
    type: MemoryType;
    /** ISO timestamp, always written by the store — never trust a caller-supplied value. */
    modified: string;
  };
}

export interface MemoryEntry {
  frontmatter: MemoryFrontmatter;
  body: string;
}

/** Project memory is shared; agent memory is scoped to one named agent and never appears in the project index. */
export type MemoryScope =
  | { kind: "project"; workspace: string }
  | { kind: "agent"; workspace: string; agentName: string };

export interface MemoryIndexEntry {
  /** Human-readable title, used as the markdown link text. */
  title: string;
  /** Topic filename relative to the scope directory, e.g. "known-flaky-test.md". */
  file: string;
  /** One-line hook shown in the index — not the full description. */
  hook: string;
}

export interface MemoryReadIndexResult {
  entries: MemoryIndexEntry[];
  raw: string;
  exists: boolean;
}

export interface MemoryReadEntryResult {
  entry: MemoryEntry | null;
  exists: boolean;
}

export interface MemoryWriteInput {
  /** Kebab-case slug: filename base and frontmatter `name`. */
  slug: string;
  /** Human-readable title for the index link text. */
  title: string;
  /** One-line index hook — kept short deliberately; the index must stay a pointer list. */
  hook: string;
  type: MemoryType;
  /** Frontmatter `description` — may be a little more detail than the index hook. */
  description: string;
  body: string;
}

export type MemoryWriteResult =
  | { ok: true; indexBytes: number; indexLines: number }
  | {
      ok: false;
      reason: "index_cap_exceeded";
      indexBytes: number;
      indexLines: number;
      capBytes: number;
      capLines: number;
    };

export type MemoryDeleteResult = { ok: true } | { ok: false; reason: "not_found" };
