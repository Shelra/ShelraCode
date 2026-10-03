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
  readTailRecords,
} from "./foreign-chats";

/**
 * Claude Code's saved chats: one JSON-lines file per chat in `~/.claude/projects/<folder>/<id>.jsonl` (or under
 * `CLAUDE_CONFIG_DIR`), the folder named after the path it ran in. Sub-agents' chats live in sub-folders and are
 * not listed. The format is Claude Code's own and undocumented: a record this reader does not know is skipped.
 */
export function claudeCodeProjectsDir(home = os.homedir()): string {
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
  return path.join(configured || path.join(home, ".claude"), "projects");
}

/** The name Claude Code gives a folder's chats directory: every character other than a letter or digit is a `-`. */
export function claudeCodeFolderName(folder: string): string {
  return folder.replace(/[^a-zA-Z0-9]/g, "-");
}

const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 256 * 1024;
const MAX_FIRST_REQUEST = 200;

/**
 * The chat files under the projects directory, newest first. With `folderPrefix`, only the directories whose name
 * starts with that folder's (case aside), which holds its sub-folders' chats too; the caller checks each chat's own
 * folder, since the name alone mixes `shelra` and `shelra-old`.
 */
export function listClaudeCodeFiles(projectsDir: string, folderPrefix?: string): string[] {
  let directories: string[];
  try {
    directories = fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const prefix = folderPrefix ? claudeCodeFolderName(folderPrefix).toLowerCase() : null;
  const files: Array<{ file: string; mtime: number }> = [];
  for (const directory of directories) {
    if (prefix && !directory.toLowerCase().startsWith(prefix)) continue;
    const full = path.join(projectsDir, directory);
    let names: string[];
    try {
      names = fs.readdirSync(full).filter((name) => name.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        files.push({ file: path.join(full, name), mtime: fs.statSync(path.join(full, name)).mtimeMs });
      } catch {
        // A file removed while listing is not listed.
      }
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime).map((entry) => entry.file);
}

/** A chat file's listing from its first and last records; null for a file with no request from the user. */
export function readClaudeCodeListing(file: string): ForeignChatListing | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const head = readHeadRecords(file, HEAD_BYTES);
  const tail = stat.size > HEAD_BYTES ? readTailRecords(file, stat.size, TAIL_BYTES) : [];
  let cwd: string | null = null;
  let createdAt: Date | null = null;
  let firstRequest: string | null = null;
  for (const record of head) {
    if (record.isSidechain === true) continue;
    cwd ??= asString(record.cwd);
    if (!createdAt && typeof record.timestamp === "string") createdAt = parseTime(record.timestamp, stat.mtime);
    if (!firstRequest) {
      const text = userText(record);
      if (text) firstRequest = oneLine(text, MAX_FIRST_REQUEST);
    }
  }
  const records = [...head, ...tail];
  const title = latestTitle(records);
  let model: string | null = null;
  let lastPrompt: string | null = null;
  // When the chat last moved: its last message, not the file's time, which Claude Code touches when it only opens it.
  let updatedAt: Date | null = null;
  for (const record of records) {
    if (record.isSidechain === true) continue;
    if ((record.type === "user" || record.type === "assistant") && typeof record.timestamp === "string") {
      const at = parseTime(record.timestamp, stat.mtime);
      if (!updatedAt || at > updatedAt) updatedAt = at;
    }
    if (record.type === "assistant") model = assistantModel(record) ?? model;
    if (record.type === "last-prompt") lastPrompt = asString(record.lastPrompt) ?? lastPrompt;
    if (!cwd) cwd = asString(record.cwd);
  }
  firstRequest ??= lastPrompt ? oneLine(lastPrompt, MAX_FIRST_REQUEST) : null;
  if (!firstRequest && !title) return null;
  return {
    source: "claude-code",
    sourceId: sessionIdOf(file, records),
    path: file,
    title,
    firstRequest,
    cwd,
    model,
    createdAt: createdAt ?? updatedAt ?? stat.mtime,
    updatedAt: updatedAt ?? stat.mtime,
    bytes: stat.size,
  };
}

/** Reads a Claude Code chat whole, as a stream: the main conversation only, in the order it was written. */
export async function readClaudeCodeChat(file: string): Promise<ForeignChat> {
  const stat = fs.statSync(file);
  const events: ForeignEvent[] = [];
  const titles: Array<Record<string, unknown>> = [];
  let cwd: string | null = null;
  let model: string | null = null;
  let sessionId: string | null = null;
  let createdAt: Date | null = null;
  let last = stat.mtime;
  const seen = new Set<string>();
  await forEachRecord(
    file,
    // Only these lines can carry a turn or a title; the rest (file snapshots, progress) can be large and are skipped
    // unparsed.
    (line) =>
      line.includes('"type":"user"') ||
      line.includes('"type":"assistant"') ||
      line.includes('"queued_command"') ||
      line.includes('-title"'),
    (record) => {
      if (record.isSidechain === true) return;
      if (record.type === "ai-title" || record.type === "custom-title") {
        titles.push(record);
        return;
      }
      const uuid = asString(record.uuid);
      if (uuid) {
        // A message Claude Code wrote twice (a resumed chat repeats its history) counts once.
        if (seen.has(uuid)) return;
        seen.add(uuid);
      }
      const at = parseTime(record.timestamp, last);
      last = at;
      createdAt ??= at;
      cwd ??= asString(record.cwd);
      sessionId ??= asString(record.sessionId);
      if (record.type === "assistant") {
        if (record.isApiErrorMessage === true) return;
        model = assistantModel(record) ?? model;
        const message = asRecord(record.message);
        const content = Array.isArray(message?.content) ? message.content : [];
        for (const part of content) {
          const block = asRecord(part);
          if (!block) continue;
          if (block.type === "text") {
            const text = asString(block.text)?.trim();
            if (text) events.push({ kind: "assistant", text, at });
          } else if (block.type === "tool_use") {
            events.push({ kind: "tool", at, ...describeToolUse(asString(block.name) ?? "", asRecord(block.input)) });
          }
        }
        return;
      }
      const text = userText(record);
      if (text) events.push({ kind: "user", text, at });
    },
  );
  return {
    source: "claude-code",
    sourceId: sessionId ?? path.basename(file, ".jsonl"),
    path: file,
    title: latestTitle(titles),
    cwd,
    model,
    createdAt: createdAt ?? stat.mtime,
    updatedAt: last,
    events,
  };
}

/**
 * What the user wrote in a record: a prompt, or a message sent while a turn ran (Claude Code keeps those as
 * `queued_command` attachments). Claude Code's own notes are not the user's words: meta records, compaction
 * summaries, slash-command echoes, task notifications and `<system-reminder>` blocks are left out.
 */
function userText(record: Record<string, unknown>): string | null {
  if (record.type === "attachment") {
    const attachment = asRecord(record.attachment);
    if (attachment?.type !== "queued_command" || attachment.commandMode !== "prompt") return null;
    return cleanUserText(contentText(attachment.prompt));
  }
  if (record.type !== "user" || record.isMeta === true || record.isCompactSummary === true) return null;
  if (record.isVisibleInTranscriptOnly === true) return null;
  const message = asRecord(record.message);
  return cleanUserText(contentText(message?.content));
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    const block = asRecord(part);
    if (!block) continue;
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    else if (block.type === "image") parts.push("[Image]");
    // A tool result is the tool's output, not the user's words.
  }
  return parts.join("\n");
}

/** Records whose text Claude Code wrote, not the user: a command's echo, its output, a background task's notice. */
const HOST_TEXT = [
  "<command-name>",
  "<command-message>",
  "<command-args>",
  "<local-command-stdout>",
  "<local-command-stderr>",
  "<local-command-caveat>",
  "<task-notification>",
  "<bash-input>",
  "<bash-stdout>",
  "<bash-stderr>",
  "<user-memory-input>",
  "[Request interrupted by user",
];

function cleanUserText(text: string): string | null {
  const cleaned = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    // What the user pasted is their words; the tags around it are Claude Code's.
    .replace(/<\/?pasted_content\b[^>]*>/g, "")
    .trim();
  if (!cleaned) return null;
  if (HOST_TEXT.some((prefix) => cleaned.startsWith(prefix))) return null;
  if (cleaned.startsWith("Caveat: The messages below were generated by the user while running local commands")) {
    return null;
  }
  return cleaned;
}

function assistantModel(record: Record<string, unknown>): string | null {
  const model = asString(asRecord(record.message)?.model);
  return model && !model.startsWith("<") ? model : null;
}

function latestTitle(records: Array<Record<string, unknown>>): string | null {
  let custom: string | null = null;
  let generated: string | null = null;
  for (const record of records) {
    if (record.type === "custom-title") custom = asString(record.customTitle) ?? custom;
    if (record.type === "ai-title") generated = asString(record.aiTitle) ?? generated;
  }
  const title = custom ?? generated;
  return title ? oneLine(title, 120) : null;
}

function sessionIdOf(file: string, records: Array<Record<string, unknown>>): string {
  for (const record of records) {
    const id = asString(record.sessionId);
    if (id) return id;
  }
  return path.basename(file, ".jsonl");
}

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);

/** A tool call as the bracketed note names it: the files an edit changed, the command a shell ran. */
function describeToolUse(
  name: string,
  input: Record<string, unknown> | null,
): { changed?: string[]; command?: string } {
  if (EDIT_TOOLS.has(name)) {
    const file = asString(input?.file_path) ?? asString(input?.notebook_path);
    return file ? { changed: [file] } : {};
  }
  if (SHELL_TOOLS.has(name)) {
    const command = asString(input?.command);
    return command ? { command } : {};
  }
  return {};
}
