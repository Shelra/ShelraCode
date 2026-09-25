import type { SessionListing } from "../storage/sessions";

/** What a saved chat is called in the /resume list: its title, else what the user first asked. */
export function chatLabel(chat: Pick<SessionListing, "title" | "firstRequest">): string {
  return chat.title?.trim() || chat.firstRequest?.trim() || "Untitled chat";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** When a chat was last used, the way a person says it: "just now", "5m ago", "yesterday", "Sep 12". */
export function relativeTime(date: Date, now: Date): string {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** The model's own name, without the provider and vendor: `qwen3-235b-a22b-2507`. */
function shortModel(model: string): string {
  return model.split("/").pop() || model;
}

/** The second line of a chat in the list: its size, when it was last used and the model. */
export function chatMeta(chat: Pick<SessionListing, "messages" | "updatedAt" | "model">, now: Date): string {
  return [
    `${chat.messages} message${chat.messages === 1 ? "" : "s"}`,
    relativeTime(chat.updatedAt, now),
    shortModel(chat.model),
  ].join(" · ");
}

/**
 * The folder a chat belongs to, for a list that spans every folder: its name, with the folders above it
 * while they fit, and a long name cut at its end rather than its start (`02-Mario Kart-style 3D rac…`).
 */
export function chatFolder(chat: Pick<SessionListing, "workspace">, max: number): string {
  const parts = chat.workspace.replaceAll("\\", "/").replace(/\/+$/, "").split("/");
  const name = parts.pop() ?? chat.workspace;
  if (name.length >= max) return `${name.slice(0, Math.max(1, max - 1))}…`;
  let shown = name;
  while (parts.length > 0 && shown.length + (parts.at(-1)?.length ?? 0) + 1 <= max) {
    shown = `${parts.pop()}/${shown}`;
  }
  return parts.length > 0 && shown.length + 2 <= max ? `…/${shown}` : shown;
}

/**
 * A message cut into lines of at most `width` cells at its spaces, a word longer than a line (a path) cut
 * where it must: every character stays, so a command in it can still be read and copied.
 */
export function wrapWords(text: string, width: number): string[] {
  const room = Math.max(1, width);
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word;
    if (line && line.length + 1 + rest.length > room) {
      lines.push(line);
      line = "";
    }
    while (rest.length > room - (line ? line.length + 1 : 0)) {
      const take = room - (line ? line.length + 1 : 0);
      if (take <= 0) {
        lines.push(line);
        line = "";
        continue;
      }
      lines.push(line ? `${line} ${rest.slice(0, take)}` : rest.slice(0, take));
      line = "";
      rest = rest.slice(take);
    }
    line = line ? `${line} ${rest}` : rest;
  }
  if (line) lines.push(line);
  return lines;
}

/** Whether a typed command asks for /resume, and over every folder: `/resume`, `/resume --all`, `/sessions all`. */
export function parseResumeCommand(command: string): { all: boolean } | null {
  const words = command.trim().toLowerCase().split(/\s+/);
  if (words[0] !== "/resume" && words[0] !== "/sessions") return null;
  const rest = words.slice(1);
  if (rest.length === 0) return { all: false };
  if (rest.length === 1 && (rest[0] === "--all" || rest[0] === "all" || rest[0] === "-a")) return { all: true };
  return null;
}
