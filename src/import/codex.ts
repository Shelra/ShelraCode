import fs from "fs";
import os from "os";
import path from "path";
import {
  asRecord,
  asString,
  type ForeignChat,
  type ForeignChatListing,
  type ForeignEvent,
  forEachRecord,
  oneLine,
  parseTime,
  readHeadRecords,
} from "./foreign-chats";

/**
 * Codex's saved chats: one JSON-lines "rollout" per chat in `~/.codex/sessions/YYYY/MM/DD/` (or under `CODEX_HOME`),
 * and in `archived_sessions/` once archived; the names the user saw are in `session_index.jsonl`. A chat a
 * sub-agent ran is not listed. The format is Codex's own: a record this reader does not know is skipped.
 */
export function codexHome(home = os.homedir()): string {
  return process.env.CODEX_HOME?.trim() || path.join(home, ".codex");
}

const HEAD_BYTES = 256 * 1024;
const MAX_FIRST_REQUEST = 200;

/** The rollout files, newest first. */
export function listCodexFiles(root: string): string[] {
  const files: Array<{ file: string; mtime: number }> = [];
  const walk = (directory: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory() && depth < 4) walk(full, depth + 1);
      else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
        try {
          files.push({ file: full, mtime: fs.statSync(full).mtimeMs });
        } catch {
          // A file removed while listing is not listed.
        }
      }
    }
  };
  walk(path.join(root, "sessions"), 0);
  walk(path.join(root, "archived_sessions"), 0);
  return files.sort((a, b) => b.mtime - a.mtime).map((entry) => entry.file);
}

/** The names Codex shows for its chats, by id: the latest entry of `session_index.jsonl` wins. */
export function readCodexTitles(root: string): Map<string, string> {
  const titles = new Map<string, string>();
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, "session_index.jsonl"), "utf8");
  } catch {
    return titles;
  }
  for (const line of text.split("\n")) {
    try {
      const record = asRecord(JSON.parse(line));
      const id = asString(record?.id);
      const name = asString(record?.thread_name);
      if (id && name) titles.set(id, oneLine(name, 120));
    } catch {
      // A line that does not parse names nothing.
    }
  }
  return titles;
}

/** A rollout's listing from its first records; null for a sub-agent's chat or one with no request from the user. */
export function readCodexListing(file: string, titles: Map<string, string>): ForeignChatListing | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const head = readHeadRecords(file, HEAD_BYTES);
  const meta = asRecord(head.find((record) => record.type === "session_meta")?.payload);
  if (!meta || isSubAgent(meta)) return null;
  const sourceId = asString(meta.id) ?? asString(meta.session_id) ?? idFromName(file);
  let firstRequest: string | null = null;
  let model: string | null = null;
  for (const record of head) {
    const payload = asRecord(record.payload);
    if (record.type === "turn_context") model ??= asString(payload?.model);
    if (!firstRequest && record.type === "response_item" && payload?.type === "message" && payload.role === "user") {
      const text = userText(payload.content);
      if (text) firstRequest = oneLine(text, MAX_FIRST_REQUEST);
    }
  }
  const title = titles.get(sourceId) ?? null;
  if (!firstRequest && !title) return null;
  return {
    source: "codex",
    sourceId,
    path: file,
    title,
    firstRequest,
    cwd: asString(meta.cwd),
    model,
    createdAt: parseTime(meta.timestamp, stat.mtime),
    updatedAt: stat.mtime,
    bytes: stat.size,
  };
}

/** Reads a Codex rollout whole, as a stream. A compaction's rebuilt history repeats earlier turns and is skipped. */
export async function readCodexChat(file: string, titles: Map<string, string>): Promise<ForeignChat> {
  const stat = fs.statSync(file);
  const events: ForeignEvent[] = [];
  let meta: Record<string, unknown> | null = null;
  let model: string | null = null;
  let last = stat.mtime;
  let createdAt: Date | null = null;
  await forEachRecord(
    file,
    (line) => line.includes('"session_meta"') || line.includes('"turn_context"') || line.includes('"response_item"'),
    (record) => {
      const payload = asRecord(record.payload);
      if (!payload) return;
      const at = parseTime(record.timestamp, last);
      last = at;
      if (record.type === "session_meta") {
        meta ??= payload;
        createdAt ??= parseTime(payload.timestamp, at);
        return;
      }
      createdAt ??= at;
      if (record.type === "turn_context") {
        model = asString(payload.model) ?? model;
        return;
      }
      if (record.type !== "response_item") return;
      if (payload.type === "message") {
        if (payload.role === "user") {
          const text = userText(payload.content);
          if (text) events.push({ kind: "user", text, at });
        } else if (payload.role === "assistant") {
          const text = assistantText(payload.content);
          if (text) events.push({ kind: "assistant", text, at });
        }
        return;
      }
      if (
        payload.type === "function_call" ||
        payload.type === "custom_tool_call" ||
        payload.type === "local_shell_call"
      ) {
        for (const call of describeToolCall(payload)) events.push({ kind: "tool", at, ...call });
      }
    },
  );
  const metaRecord = meta as Record<string, unknown> | null;
  const sourceId = asString(metaRecord?.id) ?? asString(metaRecord?.session_id) ?? idFromName(file);
  return {
    source: "codex",
    sourceId,
    path: file,
    title: titles.get(sourceId) ?? null,
    cwd: asString(metaRecord?.cwd),
    model,
    createdAt: createdAt ?? stat.mtime,
    // When the chat last moved: its last record, not the file's time.
    updatedAt: last,
    events,
  };
}

function isSubAgent(meta: Record<string, unknown>): boolean {
  if (meta.thread_source === "subagent") return true;
  const source = asRecord(meta.source);
  return Boolean(source && "subagent" in source);
}

function idFromName(file: string): string {
  const match = path.basename(file).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match?.[1] ?? path.basename(file, ".jsonl");
}

/**
 * Text Codex adds to a user message is not the user's words: the folder's AGENTS.md, the environment, a note that
 * a turn was stopped, a sub-agent's notice, the plugins it recommends, the tags around an image.
 */
const HOST_TEXT = [
  "# AGENTS.md instructions for",
  "<environment_context>",
  "<user_instructions>",
  "<turn_aborted>",
  "<subagent_notification>",
  "<recommended_plugins>",
  "<user_shell_command>",
  "<image name=",
  "</image>",
];

function userText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content) {
    const block = asRecord(part);
    if (!block) continue;
    if (block.type === "input_image") {
      parts.push("[Image]");
      continue;
    }
    if (block.type !== "input_text" || typeof block.text !== "string") continue;
    const text = block.text.trim();
    if (!text || HOST_TEXT.some((prefix) => text.startsWith(prefix))) continue;
    parts.push(text);
  }
  const text = parts.join("\n").trim();
  return text || null;
}

function assistantText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) => {
      const block = asRecord(part);
      return block?.type === "output_text" && typeof block.text === "string" ? block.text : "";
    })
    .join("")
    .trim();
  return text || null;
}

type ToolCallNote = { changed?: string[]; command?: string };

/**
 * A tool call as the bracketed note names it: the files a patch changed, the command a shell ran. Codex's code mode
 * (`exec`) runs a script that calls its tools; the commands and patches written in the script are named the same way.
 */
function describeToolCall(payload: Record<string, unknown>): ToolCallNote[] {
  const name = asString(payload.name) ?? "";
  if (payload.type === "custom_tool_call" && name === "apply_patch") {
    const changed = patchFiles(asString(payload.input) ?? "");
    return [changed.length > 0 ? { changed } : {}];
  }
  if (payload.type === "custom_tool_call" && name === "exec") {
    return describeScript(asString(payload.input) ?? "");
  }
  if (payload.type === "local_shell_call") {
    return [commandOf(asRecord(payload.action)?.command)];
  }
  if (payload.type === "function_call") {
    let args: Record<string, unknown> | null = null;
    try {
      args = asRecord(JSON.parse(asString(payload.arguments) ?? "{}"));
    } catch {
      args = null;
    }
    if (name === "apply_patch") {
      const changed = patchFiles(asString(args?.input) ?? asString(args?.patch) ?? "");
      return [changed.length > 0 ? { changed } : {}];
    }
    if (name === "exec_command" || name === "shell" || name === "shell_command" || name === "container.exec") {
      return [commandOf(args?.cmd ?? args?.command)];
    }
  }
  return [{}];
}

/** The commands (`cmd: "…"`) and patched files a code-mode script names; one note for a script that names neither. */
function describeScript(script: string): ToolCallNote[] {
  const notes: ToolCallNote[] = [];
  for (const match of script.matchAll(/\bcmd:\s*("(?:[^"\\]|\\.)*")/g)) {
    try {
      const command = JSON.parse(match[1] ?? '""') as unknown;
      if (typeof command === "string" && command.trim()) notes.push({ command: command.trim() });
    } catch {
      // A command written some other way is counted as a call, not named.
    }
  }
  // Inside a script the patch is a string literal: its lines end at an escaped `\n` or a quote.
  const changed: string[] = [];
  for (const match of script.matchAll(/\*\*\* (?:Add|Update|Delete) File: (.+?)(?=\\n|\n|\r|["'`])/g)) {
    const file = match[1]?.replaceAll("\\\\", "\\").trim();
    if (file && !changed.includes(file)) changed.push(file);
  }
  if (changed.length > 0) notes.push({ changed });
  return notes.length > 0 ? notes : [{}];
}

function commandOf(value: unknown): ToolCallNote {
  if (typeof value === "string" && value.trim()) return { command: value.trim() };
  if (Array.isArray(value)) {
    const words = value.filter((word): word is string => typeof word === "string");
    // `["bash", "-lc", "npm test"]` ran `npm test`.
    const shell = words.length === 3 && /^-\w*c$/.test(words[1] ?? "") ? words[2] : null;
    const command = (shell ?? words.join(" ")).trim();
    return command ? { command } : {};
  }
  return {};
}

function patchFiles(patch: string): string[] {
  const files: string[] = [];
  for (const match of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
    const file = match[1]?.trim();
    if (file && !files.includes(file)) files.push(file);
  }
  return files;
}
