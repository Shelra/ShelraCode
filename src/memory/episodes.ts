import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordSwallowedError } from "../utils/diagnostics";
import { redact } from "../utils/session-trace";
import type { TurnDigest } from "./reflection";
import { memoryDir } from "./store";
import { searchTerms } from "./terms";
import type { MemoryScope } from "./types";

/**
 * Episodic memory: what happened in each turn that did work, written by the host on every outcome, with no model
 * call (docs/architecture/18-MEMORY-V2.md §4.2). A turn that ends Limited, Paused, blocked or unverified teaches as
 * much as one that succeeds, and before this nothing recorded it: the owner's 25-minute game turn of 2026-09-24 left no
 * trace in memory. Episodes are one JSON line each in `<project>/.shelra/memory/episodes.jsonl`; retrieval turns
 * similar ones into short lessons for a new task.
 *
 * A turn whose reflection could not run (no model answering, the free allowance used up) is queued in
 * `pending-reflections.jsonl` and reflected later, when a model answers: the lesson is deferred, never lost.
 */

export type TurnOutcome =
  | "verified"
  | "unverified"
  | "limited"
  | "paused"
  | "stopped"
  | "blocked"
  | "cancelled"
  | "error"
  | "answered";

export interface EpisodeFailure {
  command: string;
  error: string;
  /** The next command that succeeded after it, when there was one: what the turn did instead. */
  fixedBy?: string;
}

export interface Episode {
  at: string;
  session?: string;
  outcome: TurnOutcome;
  request: string;
  /** The end of what the turn answered, clipped. */
  summary: string;
  files: string[];
  failures: EpisodeFailure[];
  toolCalls: number;
  /** The host's closing note ("[Limited — …]", "[Not verified — …]"), clipped. */
  note?: string;
  model?: string;
}

export interface PendingReflection {
  at: string;
  outcome: TurnOutcome;
  digest: TurnDigest;
}

const EPISODES_FILE = "episodes.jsonl";
const PENDING_FILE = "pending-reflections.jsonl";
/** Episodes rotate past this size, keeping the newest half; consolidation keeps their lessons (doc 18 §4.4). */
const EPISODES_MAX_BYTES = 4 * 1024 * 1024;
/** A pending queue that never drains (a model that never answers) keeps its newest entries only. */
const MAX_PENDING = 20;

function clip(text: string, max: number): string {
  const clean = redact(text).replace(/\s+/gu, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** The outcome a closing host note names, or what the turn's evidence says when it ended without one. */
export function turnOutcome(note: string | undefined, verified: boolean): TurnOutcome {
  const text = note?.trim() ?? "";
  if (/^\[Limited\b/u.test(text)) return "limited";
  if (/^\[Paused\b/u.test(text)) return "paused";
  if (/^\[Stopped\b/u.test(text)) return "stopped";
  if (/^\[Cancelled\b/u.test(text)) return "cancelled";
  if (/^\[Not verified\b/u.test(text)) return "unverified";
  if (/^\[Not marked complete\b/u.test(text)) return "blocked";
  if (/^\[No response\b/u.test(text)) return "error";
  if (/^\[Checked by Shelra\b/u.test(text) || verified) return "verified";
  return "answered";
}

/** Each failed command with the command that succeeded next, the way the turn got past it. */
export function failuresOf(digest: TurnDigest): EpisodeFailure[] {
  const failures: EpisodeFailure[] = [];
  digest.commands.forEach((command, index) => {
    if (command.success) return;
    const fixedBy = digest.commands.slice(index + 1).find((later) => later.success)?.command;
    failures.push({
      command: clip(command.command, 240),
      error: clip(command.output, 300),
      ...(fixedBy ? { fixedBy: clip(fixedBy, 240) } : {}),
    });
  });
  return failures.slice(-6);
}

/** Whether a turn did anything worth an episode: a tool call, a changed file or a command. */
export function didWork(digest: TurnDigest): boolean {
  return digest.toolCalls > 0 || digest.changedFiles.length > 0 || digest.commands.length > 0;
}

export function episodeFrom(
  digest: TurnDigest,
  outcome: TurnOutcome,
  extra: { session?: string; note?: string; model?: string } = {},
): Episode {
  return {
    at: new Date().toISOString(),
    ...(extra.session ? { session: extra.session } : {}),
    outcome,
    request: clip(digest.userMessage, 600),
    summary: clip(digest.assistantText.slice(-1_500), 600),
    files: digest.changedFiles.slice(0, 25),
    failures: failuresOf(digest),
    toolCalls: digest.toolCalls,
    ...(extra.note ? { note: clip(extra.note, 300) } : {}),
    ...(extra.model ? { model: extra.model } : {}),
  };
}

function appendLine(path: string, dir: string, line: string, maxBytes: number): void {
  mkdirSync(dir, { recursive: true });
  if (existsSync(path) && statSync(path).size > maxBytes) {
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    writeFileSync(path, `${lines.slice(Math.floor(lines.length / 2)).join("\n")}\n`, "utf8");
  }
  appendFileSync(path, `${line}\n`, "utf8");
}

/** Records an episode. Never throws: memory must not fail a turn. */
export function appendEpisode(scope: MemoryScope, episode: Episode): void {
  try {
    const dir = memoryDir(scope);
    appendLine(join(dir, EPISODES_FILE), dir, JSON.stringify(episode), EPISODES_MAX_BYTES);
  } catch (error) {
    recordSwallowedError("memory.episode", error);
  }
}

export function readEpisodes(scope: MemoryScope, limit = 500): Episode[] {
  try {
    const path = join(memoryDir(scope), EPISODES_FILE);
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Episode];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function clippedDigest(digest: TurnDigest): TurnDigest {
  return {
    ...digest,
    userMessage: redact(digest.userMessage).slice(0, 4_000),
    assistantText: redact(digest.assistantText).slice(-4_000),
    changedFiles: digest.changedFiles.slice(0, 50),
    commands: digest.commands.slice(-24).map((command) => ({
      command: redact(command.command).slice(0, 400),
      success: command.success,
      output: redact(command.output).slice(0, 800),
    })),
  };
}

function readPending(path: string): PendingReflection[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as PendingReflection];
      } catch {
        return [];
      }
    });
}

/** Queues a turn whose reflection could not run now. Never throws. */
export function queuePendingReflection(scope: MemoryScope, digest: TurnDigest, outcome: TurnOutcome): void {
  try {
    const dir = memoryDir(scope);
    const path = join(dir, PENDING_FILE);
    mkdirSync(dir, { recursive: true });
    const queued = [...readPending(path), { at: new Date().toISOString(), outcome, digest: clippedDigest(digest) }];
    writeFileSync(
      path,
      `${queued
        .slice(-MAX_PENDING)
        .map((item) => JSON.stringify(item))
        .join("\n")}\n`,
      "utf8",
    );
  } catch (error) {
    recordSwallowedError("memory.pending", error);
  }
}

/** Takes the oldest queued reflection out of the queue; null when there is none. Never throws. */
export function takePendingReflection(scope: MemoryScope): PendingReflection | null {
  try {
    const path = join(memoryDir(scope), PENDING_FILE);
    const queued = readPending(path);
    const [first, ...rest] = queued;
    if (!first) return null;
    writeFileSync(path, rest.length > 0 ? `${rest.map((item) => JSON.stringify(item)).join("\n")}\n` : "", "utf8");
    return first;
  } catch (error) {
    recordSwallowedError("memory.pending", error);
    return null;
  }
}

export function pendingReflectionCount(scope: MemoryScope): number {
  try {
    return readPending(join(memoryDir(scope), PENDING_FILE)).length;
  } catch {
    return 0;
  }
}

export interface EpisodeLesson {
  at: string;
  outcome: TurnOutcome;
  /** One line for the prompt: when, how it ended, what was asked, what failed and what worked. */
  line: string;
  score: number;
  /** How many attempts at the same request it stands for. */
  attempts: number;
}

/** Past attempts shown per request: a lesson is short, and two are enough to change a plan. */
const MAX_LESSONS = 2;
const LESSON_CHARS = 420;

function lessonTerms(episode: Episode): Set<string> {
  return new Set(
    searchTerms(
      [
        episode.request,
        episode.files.join(" "),
        ...episode.failures.map((failure) => `${failure.command} ${failure.error} ${failure.fixedBy ?? ""}`),
      ].join(" "),
    ),
  );
}

function lessonLine(episode: Episode, attempts: number): string {
  const quote = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
  const parts = [
    `${episode.at.slice(0, 10)} · ${episode.outcome}${attempts > 1 ? ` (${attempts} attempts)` : ""} · "${quote(episode.request, 90)}"`,
  ];
  const failure = episode.failures.at(-1);
  if (failure) {
    parts.push(
      `\`${quote(failure.command, 70)}\` failed (${quote(failure.error, 80)})${failure.fixedBy ? `; worked: \`${quote(failure.fixedBy, 70)}\`` : ""}`,
    );
  }
  if (episode.files.length > 0) {
    parts.push(
      `files: ${episode.files.slice(0, 4).join(", ")}${episode.files.length > 4 ? ` +${episode.files.length - 4}` : ""}`,
    );
  }
  if (episode.note && episode.outcome !== "verified") parts.push(quote(episode.note, 110));
  return quote(`- ${parts.join(" · ")}`, LESSON_CHARS);
}

/**
 * The past attempts most like this request, as short lessons (doc 18 §4.3 tier 3): what was tried, how it ended,
 * what failed and what got past it. Repeated attempts at the same request count as one, newest first. A lesson
 * needs two of the request's terms, or half of them, so an unrelated past turn never shows up.
 */
export function episodeLessons(
  episodes: readonly Episode[],
  query: { text: string; previous?: string },
  max = MAX_LESSONS,
): EpisodeLesson[] {
  const own = searchTerms(query.text);
  const terms = new Set(own.length < 4 && query.previous ? [...own, ...searchTerms(query.previous)] : own);
  if (terms.size === 0 || episodes.length === 0) return [];
  // Newest first, and one per request: a task resumed three times is one lesson with its attempts counted.
  const byRequest = new Map<string, { episode: Episode; attempts: number }>();
  for (const episode of [...episodes].reverse()) {
    const key = episode.request.toLowerCase().replace(/\s+/gu, " ").slice(0, 200);
    const seen = byRequest.get(key);
    if (seen) seen.attempts += 1;
    else byRequest.set(key, { episode, attempts: 1 });
  }
  const candidates = [...byRequest.values()].map((item) => ({ ...item, terms: lessonTerms(item.episode) }));
  const frequency = new Map<string, number>();
  for (const { terms: episodeTerms } of candidates) {
    for (const term of episodeTerms) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  }
  const total = candidates.length;
  const idf = (term: string) =>
    Math.log(1 + (total - (frequency.get(term) ?? 0) + 0.5) / ((frequency.get(term) ?? 0) + 0.5));
  let queryMass = 0;
  for (const term of terms) queryMass += idf(term);
  const lessons: EpisodeLesson[] = [];
  for (const { episode, attempts, terms: episodeTerms } of candidates) {
    const matched = [...terms].filter((term) => episodeTerms.has(term));
    if (matched.length < 2 && matched.length * 2 < terms.size) continue;
    const mass = matched.reduce((sum, term) => sum + idf(term), 0);
    // A turn that failed or stopped teaches more than one that went through without trouble.
    const teaches = episode.failures.length > 0 || !["verified", "answered"].includes(episode.outcome) ? 1.2 : 1;
    lessons.push({
      at: episode.at,
      outcome: episode.outcome,
      line: lessonLine(episode, attempts),
      score: (mass / Math.max(queryMass, 1e-9)) * teaches,
      attempts,
    });
  }
  return lessons.sort((a, b) => b.score - a.score || b.at.localeCompare(a.at)).slice(0, max);
}
