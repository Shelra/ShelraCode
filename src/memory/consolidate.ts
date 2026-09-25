import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordSwallowedError } from "../utils/diagnostics";
import { hasFaded, strength } from "./dynamics";
import { readEpisodes } from "./episodes";
import { admitCandidates, type ReflectionCandidate } from "./reflection";
import { appendReflectionAudit, archiveMemoryEntry, ensureMemoryDir, listMemoryRecords, memoryDir } from "./store";
import type { MemoryScope } from "./types";

/**
 * Consolidation, the way sleep consolidates a day into memory (docs/architecture/18-MEMORY-V2.md §4.6). Deterministic,
 * no model call, at most once every INTERVAL per project, run before a turn's retrieval:
 *
 * - episodes become knowledge: a command that failed in several separate turns, and what got past it each time,
 *   becomes one observed lesson with its count, stronger the more often it happened;
 * - what faded is archived: an inference nobody used for months, never credited and never important, leaves the index
 *   with its file kept, and comes back when a request recalls it (store.ts recallArchivedEntry). What the user said is
 *   never forgotten this way.
 */

export interface ConsolidationReport {
  ran: boolean;
  lessons: string[];
  archived: string[];
}

const STATE_FILE = "consolidation.json";
/** A day, less a few hours, so a person who starts at about the same time each day gets one pass a day. */
const INTERVAL_MS = 20 * 60 * 60_000;
/** Episodes read per pass, newest last. */
const EPISODES_READ = 400;
/** A failure is a lesson once it happened in this many separate turns. */
const RECURRING = 2;
/** At most this many entries fade per pass: forgetting is gradual. */
const MAX_FADED = 20;

function head(command: string, words = 3): string {
  return command.trim().split(/\s+/u).slice(0, words).join(" ");
}

function kebab(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 40)
    .replace(/-+$/u, "");
}

/** The failures that recurred across episodes, each as one observed lesson. */
export function recurringLessons(scope: MemoryScope): ReflectionCandidate[] {
  const groups = new Map<
    string,
    { command: string; error: string; fixedBy: string; turns: Set<string>; last: string }
  >();
  for (const episode of readEpisodes(scope, EPISODES_READ)) {
    for (const failure of episode.failures) {
      if (!failure.fixedBy) continue;
      const key = `${head(failure.command).toLowerCase()} => ${head(failure.fixedBy).toLowerCase()}`;
      const group = groups.get(key) ?? {
        command: failure.command,
        error: failure.error,
        fixedBy: failure.fixedBy,
        turns: new Set<string>(),
        last: episode.at,
      };
      group.turns.add(episode.at);
      if (episode.at >= group.last) {
        group.last = episode.at;
        group.error = failure.error;
        group.fixedBy = failure.fixedBy;
      }
      groups.set(key, group);
    }
  }
  const lessons: ReflectionCandidate[] = [];
  for (const group of groups.values()) {
    const count = group.turns.size;
    if (count < RECURRING) continue;
    const slug = kebab(`recurring ${head(group.command)} ${head(group.fixedBy, 2)}`) || "recurring-failure";
    lessons.push({
      slug: /^[a-z]/u.test(slug) ? slug : `r-${slug}`,
      title: `${head(group.command)} keeps failing here`,
      hook: `\`${head(group.command, 5)}\` failed in ${count} turns; what worked: \`${head(group.fixedBy, 6)}\``,
      type: "failure",
      description: `A failure seen in ${count} separate turns, and what got past it`,
      body: [
        `\`${group.command}\` failed in ${count} separate turns (last on ${group.last.slice(0, 10)}) with:`,
        group.error,
        `What got past it each time: \`${group.fixedBy}\`.`,
      ].join("\n"),
      source: "observed",
      confidence: 0.9,
      importance: Math.min(0.95, 0.5 + 0.1 * count),
      tags: ["consolidated", "recurring"],
    });
  }
  return lessons;
}

function lastRun(scope: MemoryScope): number {
  try {
    const path = join(memoryDir(scope), STATE_FILE);
    if (!existsSync(path)) return 0;
    const at = Date.parse((JSON.parse(readFileSync(path, "utf8")) as { lastRun?: string }).lastRun ?? "");
    return Number.isFinite(at) ? at : 0;
  } catch {
    return 0;
  }
}

/** One consolidation pass when one is due (or `force`). Never throws: memory upkeep must not fail a turn. */
export function consolidateMemory(
  scope: MemoryScope,
  options: { now?: number; force?: boolean } = {},
): ConsolidationReport {
  const now = options.now ?? Date.now();
  const report: ConsolidationReport = { ran: false, lessons: [], archived: [] };
  try {
    if (!options.force && now - lastRun(scope) < INTERVAL_MS) return report;
    const dir = ensureMemoryDir(scope);
    writeFileSync(join(dir, STATE_FILE), `${JSON.stringify({ lastRun: new Date(now).toISOString() })}\n`, "utf8");
    report.ran = true;

    const lessons = recurringLessons(scope);
    const admitted = lessons.length > 0 ? admitCandidates(scope, lessons) : { decisions: [], written: [] };
    report.lessons = admitted.written;

    for (const record of listMemoryRecords(scope)) {
      if (report.archived.length >= MAX_FADED) break;
      const meta = record.entry.frontmatter.metadata;
      if (!hasFaded(meta, now)) continue;
      const detail = `faded from disuse (strength ${strength(meta, now).toFixed(2)}, last used ${(meta.lastUsed ?? meta.created ?? meta.modified).slice(0, 10)})`;
      if (archiveMemoryEntry(scope, record.slug, detail)) report.archived.push(record.slug);
    }

    appendReflectionAudit(scope, {
      at: new Date(now).toISOString(),
      qualified: true,
      reason: `consolidation: ${report.lessons.length} recurring lesson(s), ${report.archived.length} faded`,
      candidates: lessons.length,
      decisions: admitted.decisions,
      written: [...report.lessons, ...report.archived.map((slug) => `archived:${slug}`)],
    });
  } catch (error) {
    recordSwallowedError("memory.consolidate", error);
  }
  return report;
}
