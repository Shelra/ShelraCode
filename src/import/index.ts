import fs from "fs";
import os from "os";
import { findImportedSession, listImportedChats, saveImportedSession } from "../storage/imports";
import { resolveWorkspace } from "../storage/workspaces";
import { claudeCodeProjectsDir, listClaudeCodeFiles, readClaudeCodeChat, readClaudeCodeListing } from "./claude-code";
import { codexHome, listCodexFiles, readCodexChat, readCodexListing, readCodexTitles } from "./codex";
import { buildImportedTranscript, type ForeignChatListing, type ForeignSource } from "./foreign-chats";

export { type ForeignChatListing, type ForeignSource, SOURCE_NAMES } from "./foreign-chats";

export interface ForeignChatQuery {
  /** The folder whose chats are listed: its workspace (its git root, else itself), sub-folders included. */
  cwd: string;
  /** List every folder's chats. */
  all?: boolean;
  sources?: ForeignSource[];
  /** Keep the chats already imported (each then names its session); left out by default. */
  includeImported?: boolean;
  limit?: number;
  /** The home folder the agents' directories are under; the user's by default. */
  home?: string;
}

export interface ListedForeignChat extends ForeignChatListing {
  /** The Shelra session it was imported as, when it was. */
  importedAs: string | null;
}

/**
 * The chats Claude Code and Codex saved on this machine, newest first: this folder's by default, every folder's
 * with `all`. Each file is read only at its start and end, so listing stays fast however long the chats are; an
 * unreadable directory or file lists nothing rather than failing.
 */
export function listForeignChats(query: ForeignChatQuery): ListedForeignChat[] {
  const home = query.home ?? os.homedir();
  const sources = query.sources ?? ["claude-code", "codex"];
  const limit = query.limit ?? 50;
  const scope = query.all ? null : workspaceKey(query.cwd);
  if (!query.all && !scope) return [];
  const imported = safe(() => listImportedChats(), new Map<string, string>());
  const keys = new Map<string, string | null>();
  const inScope = (cwd: string | null) => {
    if (!scope) return true;
    if (!cwd) return false;
    if (!keys.has(cwd)) keys.set(cwd, workspaceKey(cwd));
    return keys.get(cwd) === scope;
  };

  const chats: ListedForeignChat[] = [];
  const collect = (files: string[], read: (file: string) => ForeignChatListing | null) => {
    let found = 0;
    for (const file of files) {
      if (found >= limit) break;
      const listing = read(file);
      if (!listing || !inScope(listing.cwd)) continue;
      const importedAs = imported.get(`${listing.source}:${listing.sourceId}`) ?? null;
      if (importedAs && !query.includeImported) continue;
      chats.push({ ...listing, importedAs });
      found += 1;
    }
  };
  if (sources.includes("claude-code")) {
    const projects = claudeCodeProjectsDir(home);
    collect(listClaudeCodeFiles(projects, scope ?? undefined), readClaudeCodeListing);
  }
  if (sources.includes("codex")) {
    const root = codexHome(home);
    const titles = readCodexTitles(root);
    collect(listCodexFiles(root), (file) => readCodexListing(file, titles));
  }
  return chats.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, limit);
}

export interface ForeignImportResult {
  sessionId: string;
  /** False when the chat had been imported already and `sessionId` is that session. */
  created: boolean;
  /** The folder the session belongs to: the chat's own, or `fallbackCwd` when that folder is gone. */
  folder: string;
  messages: number;
  /** How many of the earliest messages the model reads only as a list in the checkpoint. */
  summarized: number;
}

/**
 * Imports a listed chat as a saved Shelra session, once: a chat imported before returns its session. The chat is
 * read whole (as a stream), turned into text turns and a checkpoint, and stored with its own dates; a chat whose
 * folder no longer exists belongs to `fallbackCwd`, where /resume continues it.
 */
export async function importForeignChat(
  listing: Pick<ForeignChatListing, "source" | "sourceId" | "path">,
  options: { fallbackCwd: string; home?: string },
): Promise<ForeignImportResult> {
  const existing = findImportedSession(listing.source, listing.sourceId);
  if (existing) {
    return { sessionId: existing.sessionId, created: false, folder: existing.cwd, messages: 0, summarized: 0 };
  }
  const chat =
    listing.source === "claude-code"
      ? await readClaudeCodeChat(listing.path)
      : await readCodexChat(listing.path, readCodexTitles(codexHome(options.home ?? os.homedir())));
  const transcript = buildImportedTranscript(chat);
  if (transcript.messages.length === 0) {
    throw new Error(`That ${listing.source === "codex" ? "Codex" : "Claude Code"} chat holds no message to continue.`);
  }
  const folder = chat.cwd && isDirectory(chat.cwd) ? chat.cwd : options.fallbackCwd;
  const sessionId = saveImportedSession({
    source: chat.source,
    sourceId: listing.sourceId,
    sourcePath: chat.path,
    sourceUpdatedAt: chat.updatedAt,
    cwd: folder,
    // An untitled chat is named in /resume by its first request, as Shelra's own are.
    title: chat.title,
    model: chat.model ?? chat.source,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messages: transcript.messages,
    checkpoint: {
      summary: transcript.checkpoint,
      firstKeptIndex: transcript.firstKeptIndex,
      tokensBefore: transcript.tokensBefore,
    },
  });
  return {
    sessionId,
    created: true,
    folder,
    messages: transcript.messages.length,
    summarized: transcript.firstKeptIndex,
  };
}

function workspaceKey(cwd: string): string | null {
  try {
    const key = resolveWorkspace(cwd).scopeKey;
    return process.platform === "win32" ? key.toLowerCase() : key;
  } catch {
    return null;
  }
}

function isDirectory(folder: string): boolean {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}
