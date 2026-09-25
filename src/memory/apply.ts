import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryRecord, MemoryType } from "./types";

/**
 * Memory that says how to do something (doc 18 §4.2b). A turn is given such an entry and still does not act on it:
 * seen on the memory suite 2026-09-25 (a free model), a session was given "Run scripts/build-messages.ts to create
 * src/generated/messages.ts", edited the locale file the catalog is built from, never ran the script, and reported
 * done with a stale catalog. These helpers name the commands an entry gives and the entries a turn left unapplied, so
 * the host can ask once, before the turn ends.
 */

/** The kinds of entry that say how to build, test or work on the project. A failure lesson applies only on failure. */
const HOW_TO_TYPES: ReadonlySet<MemoryType> = new Set(["build", "testing", "procedure", "conventions"]);

/** How a command starts: a code span naming one of these is a command, not a word or a file name. */
const COMMAND_START_RE =
  /^(?:bun|bunx|npm|npx|pnpm|yarn|node|deno|tsx|python3?|py|pip3?|uv|poetry|pytest|cargo|go|make|just|dotnet|mvn|gradlew?|php|composer|ruby|bundle|rake|docker|\.{1,2}[\\/]|scripts[\\/])(?:\s|$)/iu;

function normalize(command: string): string {
  return command
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/(^|\s)\.[\\/]/gu, "$1")
    .replace(/\\/gu, "/")
    .toLowerCase();
}

/** The commands a text names: the lines of its shell code blocks and its inline code spans that read as commands. */
export function commandsIn(text: string): string[] {
  const found: string[] = [];
  for (const block of text.matchAll(/```[a-z0-9]*[ \t]*\r?\n([\s\S]*?)```/giu)) {
    for (const line of (block[1] ?? "").split(/\r?\n/u)) {
      const command = line.trim().replace(/^[$>]\s+/u, "");
      if (command && !command.startsWith("#") && COMMAND_START_RE.test(command)) found.push(command);
    }
  }
  const prose = text.replace(/```[\s\S]*?```/gu, " ");
  for (const span of prose.matchAll(/`([^`\n]+)`/gu)) {
    const command = (span[1] ?? "").trim();
    if (COMMAND_START_RE.test(command)) found.push(command);
  }
  return [...new Set(found.map(normalize))];
}

/** A command, and what it runs once a package script's name is replaced by the script itself. */
function forms(command: string, scripts: Readonly<Record<string, string>>): string[] {
  const own = normalize(command);
  const match = /^(?:bun|npm|pnpm|yarn)(?: run)? ([\w:.-]+)(.*)$/u.exec(own);
  const script = match?.[1] ? scripts[match[1]] : undefined;
  return script ? [own, normalize(`${script}${match?.[2] ?? ""}`)] : [own];
}

/** The workspace's package scripts by name; none when there is no readable package.json. */
export function packageScripts(workspace: string): Record<string, string> {
  try {
    // A byte-order mark (Windows PowerShell 5.1 writes one) does not change what npm or bun run.
    const text = readFileSync(join(workspace, "package.json"), "utf8").replace(/^﻿/u, "");
    const manifest = JSON.parse(text) as { scripts?: Record<string, unknown> };
    return Object.fromEntries(
      Object.entries(manifest.scripts ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

export interface UnappliedMemory {
  slug: string;
  title: string;
  /** The commands the entry names, none of which ran. */
  commands: string[];
}

/**
 * The how-to entries a turn was given (`given`, the slugs retrieval expanded) that name a command the turn never ran
 * (`ran`: its own commands and the host's checks). A run counts when it contains the named command, or the named
 * command contains it, directly or through a package script of the same name.
 */
export function unappliedMemories(
  records: readonly MemoryRecord[],
  given: readonly string[],
  ran: readonly string[],
  scripts: Readonly<Record<string, string>> = {},
): UnappliedMemory[] {
  const runs = ran.flatMap((command) => forms(command, scripts));
  const done = (named: string) =>
    forms(named, scripts).some((form) =>
      runs.some((run) => run.includes(form) || (run.length >= 6 && form.includes(run))),
    );
  const wanted = new Set(given);
  return records.flatMap((record) => {
    if (!wanted.has(record.slug) || !HOW_TO_TYPES.has(record.entry.frontmatter.metadata.type)) return [];
    const commands = commandsIn(`${record.index.hook}\n${record.entry.body}`);
    if (commands.length === 0 || commands.some(done)) return [];
    return [{ slug: record.slug, title: record.index.title, commands: commands.slice(0, 3) }];
  });
}
