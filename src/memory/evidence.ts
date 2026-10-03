/**
 * Evidence for a memory (docs/architecture/21-PROJECT-MEMORY-V2.md §5.5): what a proposed record points to, checked by
 * the host before the record becomes durable. A model may propose anything; only what the host can confirm earns a
 * source above `inference`:
 *
 * - a quote of the user is `human` only when it appears, word for word, in what the user typed (this turn, or the
 *   request this turn follows up); a short quote proves nothing ("yes"), so it needs a few words;
 * - a command is `observed` only when it ran in this turn, with the result the record claims;
 * - a file or a commit must exist; that shows the record points somewhere real, not that its words are true, so the
 *   source stays `inference`.
 *
 * It also refuses what must never become durable: claims about what is running right now, and procedures that kill a
 * process by its number or run a command the destructive-command guard would stop.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join, normalize, relative } from "node:path";
import { destructiveCommandReason } from "../security/destructive";
import { namedCommands } from "./store";
import { foldText, rawTerms } from "./terms";
import type { MemorySource } from "./types";

export type EvidenceKind = "quote" | "command" | "file" | "commit" | "none";

export interface EvidenceClaim {
  type: string;
  ref: string;
}

export interface CheckedEvidence {
  kind: EvidenceKind;
  ref: string;
  /** Whether the host confirmed what the evidence points to. */
  verified: boolean;
  /** The source the evidence earns. */
  source: MemorySource;
  /** For a command: whether it passed when it ran. */
  passed?: boolean;
}

export interface EvidenceContext {
  /** What the user typed: this turn's request and the request it follows up (attachments removed). */
  userTexts: readonly string[];
  /** The commands this turn ran, with their result. */
  commands: ReadonlyArray<{ command: string; success: boolean }>;
  workspace: string;
}

/**
 * A quote states something only with a few content words ("yes, do it" proves nothing), and a quote longer than a
 * paragraph is a paste, not a statement.
 */
const MIN_QUOTE_CHARS = 20;
const MAX_QUOTE_CHARS = 300;
const MIN_QUOTE_TERMS = 3;

/** Text folded for a word-for-word comparison: accents, case, curly quotes, spacing and edge punctuation. */
export function normalizeQuote(text: string): string {
  return foldText(text)
    .replace(/[‘’‚′`]/gu, "'")
    .replace(/[“”„″«»]/gu, '"')
    .replace(/\s+/gu, " ")
    .replace(/^[\s"'.,;:!?¡¿()[\]-]+|[\s"'.,;:!?¡¿()[\]-]+$/gu, "")
    .trim();
}

/** Whether a quote appears, word for word, in one of the user's texts, and is long enough to state something. */
export function quoteFound(quote: string, userTexts: readonly string[]): boolean {
  const wanted = normalizeQuote(quote);
  if (wanted.length < MIN_QUOTE_CHARS || wanted.length > MAX_QUOTE_CHARS) return false;
  if (rawTerms(wanted).length < MIN_QUOTE_TERMS) return false;
  return userTexts.some((text) => normalizeQuote(quotableText(text)).includes(wanted));
}

/** What the user wrote in their own words: code they pasted and lines they quoted from elsewhere are not statements. */
export function quotableText(text: string): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)/gu, " ")
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");
}

function commandMatches(ran: string, ref: string): boolean {
  const a = ran.replace(/\s+/gu, " ").trim();
  const b = ref
    .replace(/^`+|`+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return b.length > 0 && (a === b || a.includes(b));
}

function insideWorkspace(workspace: string, ref: string): string | null {
  const cleaned = ref.replace(/^`+|`+$/gu, "").trim();
  if (!cleaned || cleaned.includes("\0")) return null;
  const full = isAbsolute(cleaned) ? normalize(cleaned) : join(workspace, cleaned);
  const rel = relative(workspace, full);
  return rel.startsWith("..") || isAbsolute(rel) ? null : full;
}

function commitExists(workspace: string, ref: string): boolean {
  if (!/^[0-9a-f]{7,40}$/iu.test(ref.trim())) return false;
  const result = spawnSync("git", ["--no-optional-locks", "cat-file", "-e", `${ref.trim()}^{commit}`], {
    cwd: workspace,
    timeout: 3_000,
    windowsHide: true,
  });
  return result.status === 0;
}

/** Checks what a proposed record points to, and the source that earns. */
export function checkEvidence(claim: EvidenceClaim | undefined, context: EvidenceContext): CheckedEvidence {
  const type = (claim?.type ?? "none").toLowerCase();
  const ref = (claim?.ref ?? "").trim().slice(0, 400);
  if (!claim || !ref) return { kind: "none", ref: "", verified: false, source: "inference" };
  if (type === "quote") {
    const found = quoteFound(ref, context.userTexts);
    return { kind: "quote", ref, verified: found, source: found ? "human" : "inference" };
  }
  if (type === "command") {
    const runs = context.commands.filter((run) => commandMatches(run.command, ref));
    const last = runs.at(-1);
    if (!last) return { kind: "command", ref, verified: false, source: "inference" };
    return { kind: "command", ref, verified: true, source: "observed", passed: last.success };
  }
  if (type === "file") {
    const full = insideWorkspace(context.workspace, ref);
    const exists = full !== null && existsSync(full);
    return { kind: "file", ref, verified: exists, source: "inference" };
  }
  if (type === "commit") {
    return { kind: "commit", ref, verified: commitExists(context.workspace, ref), source: "inference" };
  }
  return { kind: "none", ref, verified: false, source: "inference" };
}

/** The evidence as one frontmatter line. */
export function evidenceLine(evidence: CheckedEvidence): string {
  if (evidence.kind === "none") return "none";
  const ref = evidence.ref.replace(/\s+/gu, " ").slice(0, 240);
  const result =
    evidence.kind === "command"
      ? evidence.verified
        ? evidence.passed
          ? " (passed)"
          : " (failed)"
        : " (not run)"
      : "";
  const unconfirmed = evidence.kind !== "command" && !evidence.verified ? " (not found)" : "";
  return `${evidence.kind}: ${ref}${result}${unconfirmed}`;
}

/**
 * A claim about what is true right now ("the server is running", "currently serving on 8080"): true for an instant,
 * false the next session (seen live 2026-09-25: a "development server is running" fact kept at confidence 0.9).
 */
const LIVE_STATE = [
  /\b(?:is|are)\s+(?:now\s+|currently\s+|still\s+)?(?:running|up|serving|listening|live|started|online)\b/iu,
  /\b(?:currently|right now|at the moment)\b[^.]{0,60}\b(?:running|serving|listening|open|started)\b/iu,
  /\b(?:est[aá]n?|sigue)\s+(?:corriendo|funcionando|levantad[oa]|activ[oa])\b/iu,
];

export function claimsLiveState(text: string): boolean {
  return LIVE_STATE.some((pattern) => pattern.test(text));
}

/** Killing a process by its number: right once, for that process, and wrong for every later one. */
const KILL_BY_PID =
  /\b(?:stop-process|spps|kill|taskkill|tskill)\b[^\n`]*?(?:-id\s+\d+|\/pid\s+\d+|\s-9\s+\d+|\s\d{3,})/iu;

/** Why a record's commands make it unsafe to keep and replay, or null. */
export function unsafeProcedure(text: string, workspace: string): string | null {
  if (KILL_BY_PID.test(text)) return "it kills a process by its number";
  for (const command of namedCommands(text)) {
    const reason = destructiveCommandReason(command, workspace);
    if (reason) return `it runs a destructive command (${reason})`;
  }
  return null;
}
