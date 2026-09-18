/**
 * Shared types for Shelra's file-based project/agent memory layer.
 *
 * Modeled on the confirmed Claude Code auto-memory design (docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md §1):
 * a concise index file that is always cheap to read, plus one topic file per memory that loads on demand.
 * This is deliberately separate from the SQLite session store — memory is markdown on disk, not a DB row,
 * so it stays inspectable and editable outside the runtime.
 *
 * The provenance and temporal fields follow research/lanes/11-memory-taxonomy.md §3-4: every item carries
 * who produced it (`source`), how sure the producer was (`confidence`), when it was last confirmed against
 * reality (`lastConfirmed`), which files it depends on (`relatedFiles`, the cheap staleness signal), and
 * how often retrieval actually used it (`uses`). Supersession is recorded, never silently overwritten.
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
  | "decisions"
  /** A repeatable way of doing something in this project; the candidate pool for skill promotion. */
  | "procedure"
  /** Something that went wrong, why, and what fixed it. */
  | "failure"
  /** A stated user preference, distinct from a project requirement. */
  | "preference";

export const MEMORY_TYPES: readonly MemoryType[] = [
  "architecture",
  "debugging",
  "build",
  "testing",
  "conventions",
  "known-problems",
  "important-codepaths",
  "decisions",
  "procedure",
  "failure",
  "preference",
];

/**
 * Who produced the item. Ordered by trust: a human statement outranks an observed runtime fact, which
 * outranks a model inference, which outranks anything derived from fetched web content.
 */
export type MemorySource = "human" | "observed" | "inference" | "web";

export const MEMORY_SOURCE_WEIGHT: Record<MemorySource, number> = {
  human: 1,
  observed: 0.9,
  inference: 0.65,
  web: 0.5,
};

export interface MemoryFrontmatter {
  /** Kebab-case slug; also the topic file's basename without extension. */
  name: string;
  /** One-line summary used to judge relevance before loading the body. */
  description: string;
  metadata: {
    type: MemoryType;
    /** ISO timestamp, always written by the store — never trust a caller-supplied value. */
    modified: string;
    /** ISO timestamp of the first write of this slug. */
    created?: string;
    source?: MemorySource;
    /** 0..1; the producer's own confidence, weighted by source at retrieval time. */
    confidence?: number;
    /** ISO timestamp of the last time the content was checked against the codebase or a run. */
    lastConfirmed?: string;
    /** Workspace-relative paths the fact depends on; a change to one marks the entry "may be stale". */
    relatedFiles?: string[];
    tags?: string[];
    /** How many turns retrieval injected this entry. */
    uses?: number;
    lastUsed?: string;
    /** Slug of the entry this one replaced. */
    supersedes?: string;
    /** Number of times this slug has been rewritten. */
    revision?: number;
  };
}

export interface MemoryEntry {
  frontmatter: MemoryFrontmatter;
  body: string;
}

/** Project memory is shared; agent memory is scoped to one named agent and never appears in the project index. */
export type MemoryScope =
  | { kind: "project"; workspace: string }
  | { kind: "agent"; workspace: string; agentName: string }
  /** User-wide preferences and standing rules; `workspace` is the user's home directory. */
  | { kind: "user"; workspace: string };

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
  source?: MemorySource;
  confidence?: number;
  relatedFiles?: string[];
  tags?: string[];
  supersedes?: string;
  /** Marks the content as checked against reality now (sets `lastConfirmed`). Defaults to true on write. */
  confirmed?: boolean;
}

export type MemoryWriteResult =
  | { ok: true; indexBytes: number; indexLines: number; revision: number }
  | {
      ok: false;
      reason: "index_cap_exceeded";
      indexBytes: number;
      indexLines: number;
      capBytes: number;
      capLines: number;
    };

export type MemoryDeleteResult = { ok: true } | { ok: false; reason: "not_found" };

/** One line of the append-only history log (`history.jsonl`), the event-sourced timeline of the store. */
export interface MemoryHistoryEvent {
  at: string;
  event: "created" | "updated" | "confirmed" | "deleted" | "promoted";
  slug: string;
  source?: MemorySource;
  type?: MemoryType;
  revision?: number;
  detail?: string;
}

/** A loaded entry with its index row, as retrieval and the gate see it. */
export interface MemoryRecord {
  slug: string;
  index: MemoryIndexEntry;
  entry: MemoryEntry;
  /** Set when the record comes from the user-wide store rather than this project. */
  origin?: "user";
}
