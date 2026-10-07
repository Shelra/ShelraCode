import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Plan } from "../types/index";
import { recordSwallowedError } from "../utils/diagnostics";
import { privateText } from "./gate";
import { errorLine, recoveryOf } from "./recovery";
import { type PlanSnapshot, type TurnDigest, typedText } from "./reflection";
import { ensureMemoryDir, memoryDir } from "./store";
import { previousRequestWeight, searchTerms } from "./terms";
import type { MemoryScope } from "./types";

export { privateText };

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
  | "answered"
  /** The process ended during the turn (a closed terminal, a crash): its live record was recovered. */
  | "interrupted";

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
  /** The plan the turn worked under, as it stood when the turn ended (or when the live record was last saved). */
  plan?: PlanSnapshot;
}

export interface PendingReflection {
  at: string;
  outcome: TurnOutcome;
  digest: TurnDigest;
  /** Reflections tried on it that failed; it is dropped after MAX_ATTEMPTS. */
  attempts?: number;
}

/** A pending reflection that failed this many times is dropped: a model that never answers must not hold every turn. */
export const MAX_ATTEMPTS = 3;

const EPISODES_FILE = "episodes.jsonl";
const PENDING_FILE = "pending-reflections.jsonl";
/** Episodes rotate past this size, keeping the newest half; consolidation keeps their lessons (doc 18 §4.4). */
const EPISODES_MAX_BYTES = 4 * 1024 * 1024;
/** A pending queue that never drains (a model that never answers) keeps its newest entries only. */
const MAX_PENDING = 20;

function clip(text: string, max: number): string {
  const clean = privateText(text).replace(/\s+/gu, " ").trim();
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
  if (/^\[(?:No response|Error)\b/u.test(text)) return "error";
  if (/^\[Checked by Shelra\b/u.test(text) || verified) return "verified";
  return "answered";
}

/** Each failed command with the way the turn got past it, when it did (`recoveryOf`). */
export function failuresOf(digest: TurnDigest): EpisodeFailure[] {
  const failures: EpisodeFailure[] = [];
  digest.commands.forEach((command, index) => {
    if (command.success) return;
    const recovery = recoveryOf(digest.commands, index);
    const fixedBy = recovery ? (recovery.between[0] ?? recovery.passed.command) : undefined;
    failures.push({
      command: clip(command.command, 240),
      error: clip(errorLine(command.output), 300),
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
    request: clip(typedText(digest.userMessage), 600),
    summary: clip(digest.assistantText.slice(-1_500), 600),
    files: digest.changedFiles.slice(0, 25),
    failures: failuresOf(digest),
    toolCalls: digest.toolCalls,
    ...(extra.note ? { note: clip(extra.note, 300) } : {}),
    ...(extra.model ? { model: extra.model } : {}),
    ...(digest.plan && digest.plan.steps.length > 0 ? { plan: snapshotOf(digest.plan) } : {}),
  };
}

/** A plan snapshot small enough to keep with every episode. */
function snapshotOf(plan: PlanSnapshot): PlanSnapshot {
  return {
    title: clip(plan.title, 120),
    ...(plan.goal ? { goal: clip(plan.goal, 300) } : {}),
    steps: plan.steps.slice(0, 20).map((step) => ({ title: clip(step.title, 160), status: step.status })),
    ...(plan.criteria && plan.criteria.length > 0
      ? {
          criteria: plan.criteria.slice(0, 12).map((criterion) => ({
            id: criterion.id,
            description: clip(criterion.description, 200),
            verification: clip(criterion.verification, 200),
            ...(criterion.command ? { command: clip(criterion.command, 200) } : {}),
          })),
        }
      : {}),
  };
}

/** A session's plan as the digest field: nothing when there is no plan or it has no steps. */
export function planSnapshotOf(plan: Plan | null | undefined): { plan?: PlanSnapshot } {
  if (!plan || plan.steps.length === 0) return {};
  return {
    plan: {
      title: plan.title,
      ...(plan.goal ? { goal: plan.goal } : {}),
      steps: plan.steps.map((step) => ({ title: step.title, status: step.status ?? "pending" })),
      ...(plan.acceptanceCriteria?.length ? { criteria: plan.acceptanceCriteria } : {}),
    },
  };
}

export interface OpenPlan {
  /** When the plan was last seen, in an episode or a live record. */
  at: string;
  plan: PlanSnapshot;
}

const FINISHED_STEP = new Set(["complete"]);
/** Only a verified turn can retire an untracked plan; unverified work still needs attention. */
const ENDED_NORMALLY = new Set<TurnOutcome>(["verified"]);

/**
 * The plans still open in this project, newest first: for each plan (by title), the latest snapshot the episodes hold,
 * kept when a step is not done yet. A routine turn's small plan does not hide August's half-finished refactor: each plan
 * is its own entry (the review of doc 21, finding 4). A plan the turn never tracked (every step still pending when it
 * ended on its own) is not open: the work may well be done, and "to do" would be a guess.
 */
export function openPlans(episodes: readonly Episode[], max = 3): OpenPlan[] {
  const seen = new Set<string>();
  const open: OpenPlan[] = [];
  for (const episode of [...episodes].reverse()) {
    const plan = episode.plan;
    if (!plan || plan.steps.length === 0) continue;
    const key = plan.title.toLowerCase().replace(/\s+/gu, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const untracked = plan.steps.every((step) => step.status === "pending") && ENDED_NORMALLY.has(episode.outcome);
    if (!untracked && plan.steps.some((step) => !FINISHED_STEP.has(step.status))) open.push({ at: episode.at, plan });
    if (open.length >= max) break;
  }
  return open;
}

const STEP_LABEL: Record<string, string> = {
  complete: "done",
  claimed: "claimed, not checked",
  working: "in progress",
  failed: "failed",
  pending: "to do",
};

/** The open plans as prompt lines. */
export function describeOpenPlans(open: readonly OpenPlan[]): string[] {
  const lines: string[] = [];
  for (const { at, plan } of open) {
    const done = plan.steps.filter((step) => step.status === "complete").length;
    lines.push(
      `- "${plan.title}" (last worked on ${at.slice(0, 10)}; ${done}/${plan.steps.length} steps done)${plan.goal ? `: ${clip(plan.goal, 160)}` : ""}`,
    );
    plan.steps.forEach((step, index) => {
      lines.push(`  ${index + 1}. ${clip(step.title, 110)} — ${STEP_LABEL[step.status] ?? step.status}`);
    });
  }
  return lines;
}

function appendLine(path: string, line: string, maxBytes: number): void {
  if (existsSync(path) && statSync(path).size > maxBytes) {
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    writeFileSync(path, `${lines.slice(Math.floor(lines.length / 2)).join("\n")}\n`, "utf8");
  }
  appendFileSync(path, `${line}\n`, "utf8");
}

/** Records an episode. Never throws: memory must not fail a turn. */
export function appendEpisode(scope: MemoryScope, episode: Episode): void {
  try {
    appendLine(join(ensureMemoryDir(scope), EPISODES_FILE), JSON.stringify(episode), EPISODES_MAX_BYTES);
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

/**
 * The episodes that carry a plan, from the whole log: a busy project's routine turns must not push August's
 * half-finished refactor out of the window the other readers take (doc 21, the volume variant). Only those lines are
 * parsed.
 */
export function readPlanEpisodes(scope: MemoryScope): Episode[] {
  try {
    const path = join(memoryDir(scope), EPISODES_FILE);
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.includes('"plan":{'))
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

/**
 * A turn in progress, saved while it works (doc 18 §4.2a): one file per session under `live/`, replaced at each save
 * and removed when the turn ends and writes its episode. Another session reads it as work in progress; a file whose
 * process is gone is a turn that never ended, recovered as an "interrupted" episode. Seen live 2026-09-25: a
 * 48-minute turn of 292 tool calls wrote nothing to memory until the user cancelled it.
 */
export interface LiveEpisode extends Omit<Episode, "outcome"> {
  /** The process running the turn: the record of a process that is gone belongs to a turn that never ended. */
  pid: number;
}

const LIVE_DIR = "live";

function livePath(scope: MemoryScope, session: string): string {
  return join(memoryDir(scope), LIVE_DIR, `${session.replace(/[^A-Za-z0-9_-]/gu, "_") || "session"}.json`);
}

/** Saves what the turn in progress has done so far, replacing the session's previous save. Never throws. */
export function saveLiveEpisode(scope: MemoryScope, session: string, digest: TurnDigest, model?: string): void {
  try {
    const { outcome: _outcome, ...episode } = episodeFrom(digest, "answered", { session, ...(model ? { model } : {}) });
    mkdirSync(join(ensureMemoryDir(scope), LIVE_DIR), { recursive: true });
    const live: LiveEpisode = { ...episode, pid: process.pid };
    writeFileSync(livePath(scope, session), JSON.stringify(live), "utf8");
  } catch (error) {
    recordSwallowedError("memory.live", error);
  }
}

/** Removes the session's save once its turn wrote its episode. Never throws. */
export function clearLiveEpisode(scope: MemoryScope, session: string): void {
  try {
    rmSync(livePath(scope, session), { force: true });
  } catch (error) {
    recordSwallowedError("memory.live", error);
  }
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // The process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLiveEpisodes(scope: MemoryScope): Array<{ path: string; live: LiveEpisode }> {
  const dir = join(memoryDir(scope), LIVE_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .flatMap((name) => {
      const path = join(dir, name);
      try {
        return [{ path, live: JSON.parse(readFileSync(path, "utf8")) as LiveEpisode }];
      } catch {
        return [];
      }
    });
}

/** Turns in progress now in other processes on this project, newest first. Never throws. */
export function liveEpisodes(scope: MemoryScope): LiveEpisode[] {
  try {
    return readLiveEpisodes(scope)
      .map((item) => item.live)
      .filter((live) => live.pid !== process.pid && processAlive(live.pid))
      .sort((a, b) => b.at.localeCompare(a.at));
  } catch {
    return [];
  }
}

/**
 * Records, as an "interrupted" episode, every turn whose process ended before the turn did, and removes its save.
 * Returns how many it recovered. Never throws.
 */
export function recoverInterruptedTurns(scope: MemoryScope): number {
  let recovered = 0;
  try {
    for (const { path, live } of readLiveEpisodes(scope)) {
      if (live.pid === process.pid || processAlive(live.pid)) continue;
      const { pid: _pid, ...episode } = live;
      appendEpisode(scope, {
        ...episode,
        outcome: "interrupted",
        note: "[Interrupted — the process ended during the turn; this is what it had done by its last save.]",
      });
      rmSync(path, { force: true });
      recovered += 1;
    }
  } catch (error) {
    recordSwallowedError("memory.live", error);
  }
  return recovered;
}

function clippedDigest(digest: TurnDigest): TurnDigest {
  return {
    ...digest,
    userMessage: privateText(typedText(digest.userMessage)).slice(0, 4_000),
    assistantText: privateText(digest.assistantText).slice(-4_000),
    changedFiles: digest.changedFiles.slice(0, 50),
    commands: digest.commands.slice(-24).map((command) => ({
      command: privateText(command.command).slice(0, 400),
      success: command.success,
      output: privateText(command.output).slice(0, 800),
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

/**
 * Queues a turn whose reflection could not run now; one that already failed MAX_ATTEMPTS times is dropped instead.
 * Never throws.
 */
export function queuePendingReflection(
  scope: MemoryScope,
  digest: TurnDigest,
  outcome: TurnOutcome,
  attempts = 0,
): boolean {
  if (attempts >= MAX_ATTEMPTS) return false;
  try {
    const path = join(ensureMemoryDir(scope), PENDING_FILE);
    const queued = [
      ...readPending(path),
      { at: new Date().toISOString(), outcome, digest: clippedDigest(digest), ...(attempts > 0 ? { attempts } : {}) },
    ];
    writeFileSync(
      path,
      `${queued
        .slice(-MAX_PENDING)
        .map((item) => JSON.stringify(item))
        .join("\n")}\n`,
      "utf8",
    );
    return true;
  } catch (error) {
    recordSwallowedError("memory.pending", error);
    return false;
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

/** One line for a list of recent work: when, how it ended, what was asked, what failed and worked, which files. */
export function describeEpisode(episode: Episode): string {
  return lessonLine(episode, 1);
}

/** One line for a turn in progress in another session: since when, what was asked, how far it got. */
export function describeLiveEpisode(live: LiveEpisode): string {
  const request = live.request.length > 90 ? `${live.request.slice(0, 89)}…` : live.request;
  const files =
    live.files.length > 0
      ? ` · files: ${live.files.slice(0, 4).join(", ")}${live.files.length > 4 ? ` +${live.files.length - 4}` : ""}`
      : "";
  return `- in progress, saved ${live.at.slice(0, 16).replace("T", " ")} UTC · "${request}" · ${live.toolCalls} tool calls${files}`;
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
  const carried = query.previous !== undefined && previousRequestWeight(query.text) > 0;
  const terms = new Set(carried ? [...own, ...searchTerms(query.previous ?? "")] : own);
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
