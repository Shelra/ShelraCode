import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/**
 * What the final answer says the turn did, checked against what the host saw (2026-10-03, from the false-completion
 * analysis: a report that names a command it never ran or a file it never wrote reads as done to the person). Only
 * claims made in the past tense about this turn's own work count: "run `npm test` to check" is advice, not a claim.
 * Deterministic and quiet: nothing is said unless a claim has no trace at all.
 */

const RAN =
  /\b(?:I\s+)?(?:ran|re-?ran|executed|re-?executed)\b|(?:^|[\s(¿¡])(?:ejecut[eé]|corr[ií]|volv[ií] a ejecutar|lanc[eé])(?=$|[\s,.;:!?)])/iu;
const WROTE =
  /\b(?:I\s+)?(?:created|added|wrote|updated|modified|edited|changed|implemented|rewrote)\b|(?:^|[\s(¿¡])(?:cre[eé]|a[nñ]ad[ií]|agregu[eé]|escrib[ií]|modifiqu[eé]|actualic[eé]|edit[eé]|cambi[eé]|implement[eé])(?=$|[\s,.;:!?)])/iu;
const REMOVED =
  /\b(?:removed|deleted|renamed|moved)\b|(?:^|[\s(¿¡])(?:elimin[eé]|borr[eé]|quit[eé]|renombr[eé]|mov[ií])(?=$|[\s,.;:!?)])/iu;
const CODE = /`([^`\n]+)`/gu;
/** A relative or absolute file path: a slash or an extension, no spaces, not a URL or an option. */
const PATH = /^(?![a-z]+:\/\/)(?!-)[-\w@.~/\\]*(?:\/[-\w@.]+|\.[A-Za-z][A-Za-z0-9]{0,7})$/u;
/** Words that start a command line. */
const COMMAND =
  /^(?:npm|npx|pnpm|yarn|bun|bunx|node|deno|python3?|py|pytest|pip|uv|go|cargo|make|just|mvn|gradle|dotnet|tsc|eslint|biome|ruff|mypy|jest|vitest|git|curl)\b/u;

function sentences(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/gu, " ")
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function normalize(command: string): string {
  return command.trim().replace(/\s+/gu, " ").replace(/^\.\//u, "");
}

export interface UnbackedClaims {
  /** Commands the answer says were run that no run of this turn matches. */
  commands: string[];
  /** Files the answer says were written that are not on disk and the turn did not change. */
  files: string[];
}

export function unbackedClaims(input: {
  answer: string;
  workspace: string;
  changedFiles: readonly string[];
  commandsRun: readonly string[];
}): UnbackedClaims {
  const ran = input.commandsRun.map(normalize);
  const changed = input.changedFiles.map((file) => file.replaceAll("\\", "/"));
  const commands = new Set<string>();
  const files = new Set<string>();
  for (const sentence of sentences(input.answer)) {
    const quoted = [...sentence.matchAll(CODE)].map((match) => (match[1] ?? "").trim()).filter(Boolean);
    if (quoted.length === 0) continue;
    if (RAN.test(sentence)) {
      for (const command of quoted.filter((item) => COMMAND.test(item))) {
        const claimed = normalize(command);
        // `bun test` matches a run of `bun test src/a.test.ts`, and the other way round.
        if (!ran.some((run) => run.includes(claimed) || claimed.includes(run))) commands.add(claimed);
      }
    }
    if (WROTE.test(sentence) && !REMOVED.test(sentence)) {
      for (const path of quoted.filter((item) => PATH.test(item) && !COMMAND.test(item))) {
        const relative = path.replaceAll("\\", "/").replace(/^\.\//u, "");
        const onDisk = existsSync(isAbsolute(path) ? path : join(input.workspace, relative));
        const touched = changed.some((file) => file === relative || file.endsWith(`/${relative}`));
        if (!onDisk && !touched) files.add(relative);
      }
    }
  }
  return { commands: [...commands], files: [...files] };
}

/** One line for the person, or null when every claim has a trace. */
export function describeUnbackedClaims(claims: UnbackedClaims): string | null {
  const parts = [
    ...(claims.commands.length > 0
      ? [`it says it ran ${claims.commands.map((command) => `\`${command}\``).join(", ")}, which this turn never ran`]
      : []),
    ...(claims.files.length > 0
      ? [
          `it names ${claims.files.map((file) => `\`${file}\``).join(", ")} as written, which ${claims.files.length === 1 ? "does" : "do"} not exist`,
        ]
      : []),
  ];
  return parts.length > 0 ? `[Shelra checked the answer: ${parts.join("; ")}.]` : null;
}
