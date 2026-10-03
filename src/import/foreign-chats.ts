import type { ModelMessage } from "ai";
import fs from "fs";
import path from "path";
import readline from "readline";
import { DEFAULT_KEEP_RECENT_TOKENS, estimateMessageTokens } from "../agent/compaction";

/** The other coding agents whose saved chats Shelra can continue. */
export type ForeignSource = "claude-code" | "codex";

export const SOURCE_NAMES: Record<ForeignSource, string> = { "claude-code": "Claude Code", codex: "Codex" };

/**
 * A chat another agent saved on this machine, as /resume and `shelra import` list it: read from the start and the
 * end of its file only, since one file can hold hundreds of megabytes.
 */
export interface ForeignChatListing {
  source: ForeignSource;
  /** The other agent's own id for the chat. */
  sourceId: string;
  path: string;
  title: string | null;
  /** The first thing the user asked, on one line. */
  firstRequest: string | null;
  /** The folder the chat ran in, as the other agent recorded it. */
  cwd: string | null;
  model: string | null;
  createdAt: Date;
  updatedAt: Date;
  bytes: number;
}

/** One thing that happened in a foreign chat, in order: what the user wrote, what the agent answered, a tool it ran. */
export type ForeignEvent =
  | { kind: "user"; text: string; at: Date }
  | { kind: "assistant"; text: string; at: Date }
  | { kind: "tool"; at: Date; changed?: string[]; command?: string };

/** A foreign chat read whole. */
export interface ForeignChat {
  source: ForeignSource;
  sourceId: string;
  path: string;
  title: string | null;
  cwd: string | null;
  model: string | null;
  createdAt: Date;
  updatedAt: Date;
  events: ForeignEvent[];
}

/** A foreign chat as Shelra stores it: its turns as text, and the checkpoint the model reads before them. */
export interface ImportedTranscript {
  messages: Array<{ message: ModelMessage; at: Date }>;
  /** The index of the first message the model reads in full; the ones before it are only named in the checkpoint. */
  firstKeptIndex: number;
  checkpoint: string;
  tokensBefore: number;
}

const MAX_REQUEST_CHARS = 300;
const MAX_EARLIER_REQUESTS = 40;
const MAX_NOTE_FILES = 8;
const MAX_NOTE_COMMANDS = 4;
const MAX_COMMAND_CHARS = 80;
const MAX_CHECKPOINT_FILES = 60;

/**
 * Turns a foreign chat into Shelra messages: what the user wrote between two replies is one user message, and
 * everything the agent said and ran until the next request is one reply, its tool calls named in a bracketed note
 * at its end (their output is not kept). Every model can read plain text turns; another agent's tool calls, under
 * names Shelra's tools do not have, some providers refuse. A long chat keeps its latest turns in full and names the
 * earlier requests and changed files in the checkpoint, which no model has to write, so even a small model's
 * context holds it.
 */
export function buildImportedTranscript(
  chat: ForeignChat,
  options: { importedAt?: Date; keepRecentTokens?: number } = {},
): ImportedTranscript {
  const name = SOURCE_NAMES[chat.source];
  const messages: Array<{ message: ModelMessage; at: Date }> = [];
  const changedByMessage: string[][] = [];
  let user: { texts: string[]; at: Date } | null = null;
  let reply: { texts: string[]; at: Date; changed: string[]; commands: string[]; other: number } | null = null;

  const flushUser = () => {
    if (!user) return;
    const text = user.texts.join("\n\n").trim();
    if (text) {
      messages.push({ message: { role: "user", content: text }, at: user.at });
      changedByMessage.push([]);
    }
    user = null;
  };
  const flushReply = () => {
    if (!reply) return;
    const note = toolNote(name, reply.changed, reply.commands, reply.other, chat.cwd);
    const text = [reply.texts.join("\n\n").trim(), note].filter(Boolean).join("\n\n");
    if (text) {
      messages.push({ message: { role: "assistant", content: text }, at: reply.at });
      changedByMessage.push(reply.changed);
    }
    reply = null;
  };

  for (const event of chat.events) {
    if (event.kind === "user") {
      flushReply();
      user ??= { texts: [], at: event.at };
      // The same words twice in a row are one message the other agent recorded twice.
      if (user.texts.at(-1) !== event.text) user.texts.push(event.text);
      continue;
    }
    flushUser();
    reply ??= { texts: [], at: event.at, changed: [], commands: [], other: 0 };
    reply.at = event.at;
    if (event.kind === "assistant") {
      reply.texts.push(event.text);
      continue;
    }
    if (event.changed?.length) {
      for (const file of event.changed) if (!reply.changed.includes(file)) reply.changed.push(file);
    } else if (event.command) {
      if (!reply.commands.includes(event.command)) reply.commands.push(event.command);
    } else {
      reply.other += 1;
    }
  }
  flushUser();
  flushReply();

  const tokens = messages.map((entry) => estimateMessageTokens(entry.message));
  const tokensBefore = tokens.reduce((sum, value) => sum + value, 0);
  const firstKeptIndex = findFirstKept(
    messages.map((entry) => entry.message),
    tokens,
    options.keepRecentTokens ?? DEFAULT_KEEP_RECENT_TOKENS,
  );
  const checkpoint = buildCheckpoint(
    chat,
    messages,
    changedByMessage,
    firstKeptIndex,
    options.importedAt ?? new Date(),
  );
  return { messages, firstKeptIndex, checkpoint, tokensBefore };
}

/** The first message of the latest turns that fit the budget, always a request so no reply loses its question. */
function findFirstKept(messages: ModelMessage[], tokens: number[], budget: number): number {
  let total = 0;
  let index = messages.length;
  while (index > 0 && total + (tokens[index - 1] ?? 0) <= budget) {
    index -= 1;
    total += tokens[index] ?? 0;
  }
  if (index === 0) return 0;
  // The turn that crossed the budget is left out whole; a single turn larger than the budget is kept anyway.
  let start = index;
  while (start < messages.length && messages[start]?.role !== "user") start += 1;
  if (start < messages.length) return start;
  let last = messages.length - 1;
  while (last > 0 && messages[last]?.role !== "user") last -= 1;
  return Math.max(0, last);
}

function toolNote(name: string, changed: string[], commands: string[], other: number, cwd: string | null): string {
  if (changed.length === 0 && commands.length === 0 && other === 0) return "";
  const parts: string[] = [];
  if (changed.length > 0)
    parts.push(
      `changed ${listWithMore(
        changed.map((file) => relativeTo(file, cwd)),
        MAX_NOTE_FILES,
      )}`,
    );
  if (commands.length > 0) {
    // A script's first line says what it is (`cat > notes.md <<'EOF'`); the rest would fill the note.
    const shown = commands.map((command) => `\`${oneLine(command.trim().split("\n")[0] ?? "", MAX_COMMAND_CHARS)}\``);
    parts.push(`ran ${listWithMore(shown, MAX_NOTE_COMMANDS)}`);
  }
  if (other > 0) parts.push(`${other} other tool call${other === 1 ? "" : "s"}`);
  return `[In ${name}: ${parts.join("; ")}]`;
}

function buildCheckpoint(
  chat: ForeignChat,
  messages: Array<{ message: ModelMessage; at: Date }>,
  changedByMessage: string[][],
  firstKeptIndex: number,
  importedAt: Date,
): string {
  const name = SOURCE_NAMES[chat.source];
  const lines = [
    `This chat was started in ${name} and imported into Shelra on ${day(importedAt)}; it continues here.`,
    `- ${name} session ${chat.sourceId}${chat.cwd ? `, folder ${chat.cwd}` : ""}${chat.model ? `, model ${chat.model}` : ""}, from ${stamp(chat.createdAt)} to ${stamp(chat.updatedAt)}.`,
    `- Its requests and replies are kept as text. The tools ${name} ran are named in brackets after each reply; their output was not kept and the files may have changed since, so read them again before relying on them.`,
  ];
  if (firstKeptIndex > 0) {
    const earlier = messages.slice(0, firstKeptIndex);
    const requests = earlier
      .filter((entry) => entry.message.role === "user")
      .map((entry) =>
        oneLine(typeof entry.message.content === "string" ? entry.message.content : "", MAX_REQUEST_CHARS),
      );
    const changed = [...new Set(changedByMessage.slice(0, firstKeptIndex).flat())].map((file) =>
      relativeTo(file, chat.cwd),
    );
    lines.push(
      `- The ${earlier.length} earliest messages are not repeated here; the latest ones follow in full.`,
      "",
      "Earlier requests, oldest first:",
    );
    const shown =
      requests.length > MAX_EARLIER_REQUESTS
        ? [...requests.slice(0, 5), null, ...requests.slice(requests.length - (MAX_EARLIER_REQUESTS - 5))]
        : requests;
    let number = 0;
    for (const request of shown) {
      if (request === null) {
        const skipped = requests.length - MAX_EARLIER_REQUESTS;
        lines.push(`… ${skipped} more request${skipped === 1 ? "" : "s"} …`);
        number += skipped;
        continue;
      }
      number += 1;
      lines.push(`${number}. ${request}`);
    }
    if (changed.length > 0) {
      lines.push("", `Files it changed earlier: ${listWithMore(changed, MAX_CHECKPOINT_FILES)}`);
    }
  }
  return lines.join("\n");
}

function listWithMore(items: string[], max: number): string {
  if (items.length <= max) return items.join(", ");
  return `${items.slice(0, max).join(", ")} (+${items.length - max} more)`;
}

function relativeTo(file: string, cwd: string | null): string {
  if (!cwd || !path.isAbsolute(file)) return file;
  const relative = path.relative(cwd, file);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative.replaceAll("\\", "/") : file;
}

/** Text on one line, cut at `max` characters. */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function stamp(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** A timestamp a record carried, or the fallback when it has none or it does not parse. */
export function parseTime(value: unknown, fallback: Date): Date {
  if (typeof value !== "string" && typeof value !== "number") return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

/** The JSON records of a file's first `bytes` bytes: whole lines only, a line that does not parse skipped. */
export function readHeadRecords(file: string, bytes: number): Array<Record<string, unknown>> {
  const text = readRange(file, 0, bytes);
  if (text === null) return [];
  const lines = text.split("\n");
  if (text.length >= bytes) lines.pop();
  return parseLines(lines);
}

/** The JSON records of a file's last `bytes` bytes: whole lines only. */
export function readTailRecords(file: string, size: number, bytes: number): Array<Record<string, unknown>> {
  const start = Math.max(0, size - bytes);
  const text = readRange(file, start, bytes);
  if (text === null) return [];
  const lines = text.split("\n");
  if (start > 0) lines.shift();
  return parseLines(lines);
}

/** Calls `onRecord` with each JSON record of a file, read as a stream; `keep` skips a line before it is parsed. */
export async function forEachRecord(
  file: string,
  keep: (line: string) => boolean,
  onRecord: (record: Record<string, unknown>) => void,
): Promise<void> {
  const lines = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line || !keep(line)) continue;
    const record = parseLine(line);
    if (record) onRecord(record);
  }
}

function readRange(file: string, start: number, bytes: number): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buffer, 0, bytes, start);
    return buffer.subarray(0, read).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function parseLines(lines: string[]): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    const record = parseLine(line);
    if (record) records.push(record);
  }
  return records;
}

function parseLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const value = JSON.parse(trimmed) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
