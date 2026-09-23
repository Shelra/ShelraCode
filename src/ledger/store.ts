import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { recordSwallowedError } from "../utils/diagnostics";
import { DECISION_SOURCES, type Decision, type DecisionProposal, type DecisionStatus } from "./types";

/**
 * The ledger lives in the repository, one Markdown file per decision, so it is versioned and reviewed with
 * the code it governs (the owner's requirement, 2026-09-18). Files without a ledger id in their front matter,
 * such as a project's own ADRs kept in the same folder, are left alone.
 */
export const LEDGER_DIR = "docs/decisions";

const MAX_TITLE = 120;
const MAX_RULE = 1_500;
const MAX_CHECK = 300;
const MAX_SCOPE = 20;
const ID_RE = /^D-\d{4,}$/u;

export function ledgerDir(workspace: string): string {
  return join(workspace, LEDGER_DIR);
}

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/gu, "")
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 48)
      .replace(/-+$/u, "") || "decision"
  );
}

export function formatDecision(decision: Decision): string {
  const lines = [
    "---",
    `id: ${decision.id}`,
    `title: ${JSON.stringify(decision.title)}`,
    `status: ${decision.status}`,
    `source: ${decision.source}`,
    `scope: ${JSON.stringify(decision.scope)}`,
    ...(decision.check ? [`check: ${JSON.stringify(decision.check)}`] : []),
    `proposed: ${decision.proposed}`,
    ...(decision.approved ? [`approved: ${decision.approved}`] : []),
    ...(decision.supersedes ? [`supersedes: ${decision.supersedes}`] : []),
    ...(decision.supersededBy ? [`superseded_by: ${decision.supersededBy}`] : []),
    "---",
    "",
    decision.rule.trim(),
    ...(decision.why ? ["", "## Why", "", decision.why.trim()] : []),
    ...(decision.evidence ? ["", "## Evidence", "", decision.evidence.trim()] : []),
    "",
  ];
  return lines.join("\n");
}

/** A YAML scalar as people write it: "double" (JSON), 'single' ('' is a quote) or plain (a # comment dropped). */
function parseScalar(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Not JSON: kept as written.
    }
    return value;
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value.replace(/\s+#.*$/u, "");
}

/** A flow list, JSON (`["a"]`, what the ledger writes) or YAML with plain items (`[a, 'b']`). */
function parseFlowList(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    // YAML's own flow form.
  }
  const items: string[] = [];
  let current = "";
  let depth = 0;
  let quote: string | undefined;
  // Commas inside quotes and inside {a,b} alternatives belong to the item.
  for (const char of raw.slice(1, raw.lastIndexOf("]"))) {
    if (quote) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth = Math.max(0, depth - 1);
    } else if (char === "," && depth === 0) {
      items.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  items.push(current);
  return items.map(parseScalar).filter(Boolean);
}

/** The front matter's top-level fields: scalars, flow lists and block lists (`key:` then `- item` lines). */
function frontMatterFields(block: string): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {};
  const lines = block.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^\s|^#/u.test(line)) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (value.startsWith("[")) {
      fields[key] = parseFlowList(value);
    } else if (value === "") {
      const items: string[] = [];
      while (/^\s*-(?:\s|$)/u.test(lines[index + 1] ?? "")) {
        index += 1;
        const item = parseScalar((lines[index] ?? "").replace(/^\s*-/u, ""));
        if (item) items.push(item);
      }
      fields[key] = items;
    } else {
      fields[key] = parseScalar(value);
    }
  }
  return fields;
}

function section(body: string, heading: string): string | undefined {
  const match = new RegExp(`(?:^|\\n)## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`, "u").exec(body);
  const text = match?.[1]?.trim();
  return text ? text : undefined;
}

/** A ledger file, or null for anything else (a foreign ADR, a README, a malformed file). */
export function parseDecision(raw: string, file: string): Decision | null {
  const text = raw.replaceAll("\r\n", "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u.exec(text);
  if (!match) return null;
  const fields = frontMatterFields(match[1] ?? "");
  const id = fields.id;
  const status = fields.status;
  const source = fields.source;
  if (typeof id !== "string" || !ID_RE.test(id)) return null;
  if (status !== "proposed" && status !== "active" && status !== "superseded") return null;
  if (typeof source !== "string" || !(DECISION_SOURCES as readonly string[]).includes(source)) return null;
  const body = match[2] ?? "";
  const rule = body.split(/\n## /u)[0]?.trim() ?? "";
  if (typeof fields.title !== "string" || !rule) return null;
  const scope = Array.isArray(fields.scope) ? fields.scope : [];
  const optional = (key: string) => {
    const value = fields[key];
    return typeof value === "string" && value ? value : undefined;
  };
  const why = section(body, "Why");
  const evidence = section(body, "Evidence");
  const check = optional("check");
  const approved = optional("approved");
  const supersedes = optional("supersedes");
  const supersededBy = optional("superseded_by");
  return {
    id,
    title: fields.title,
    status,
    source: source as Decision["source"],
    rule,
    ...(why ? { why } : {}),
    ...(evidence ? { evidence } : {}),
    scope,
    ...(check ? { check } : {}),
    proposed: optional("proposed") ?? "",
    ...(approved ? { approved } : {}),
    ...(supersedes ? { supersedes } : {}),
    ...(supersededBy ? { supersededBy } : {}),
    file: `${LEDGER_DIR}/${file}`,
  };
}

/** Every ledger decision of the workspace, in id order; an unreadable folder reads as an empty ledger. */
export function listDecisions(workspace: string): Decision[] {
  const dir = ledgerDir(workspace);
  if (!existsSync(dir)) return [];
  const decisions: Decision[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".md"));
  } catch (error) {
    recordSwallowedError("ledger.read", error);
    return [];
  }
  for (const name of names) {
    try {
      const decision = parseDecision(readFileSync(join(dir, name), "utf8"), name);
      if (decision) decisions.push(decision);
    } catch (error) {
      recordSwallowedError("ledger.read", error);
    }
  }
  return decisions.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

export function activeDecisions(workspace: string): Decision[] {
  return listDecisions(workspace).filter((decision) => decision.status === "active");
}

export function findDecision(workspace: string, id: string): Decision | undefined {
  return listDecisions(workspace).find((decision) => decision.id === id.trim().toUpperCase());
}

function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

function saveDecision(workspace: string, decision: Decision): void {
  mkdirSync(ledgerDir(workspace), { recursive: true });
  writeAtomic(join(workspace, decision.file), formatDecision(decision));
}

export type LedgerResult = { ok: true; decision: Decision } | { ok: false; reason: string };

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

/** Records a proposal. It becomes a commitment only when the user approves it. */
export function proposeDecision(workspace: string, proposal: DecisionProposal, now = new Date()): LedgerResult {
  const title = proposal.title.trim();
  const rule = proposal.rule.trim();
  const check = proposal.check?.trim();
  const scope = (proposal.scope ?? []).map((item) => item.trim()).filter(Boolean);
  if (!title || title.includes("\n") || title.length > MAX_TITLE) {
    return { ok: false, reason: `A decision needs a one-line title of at most ${MAX_TITLE} characters.` };
  }
  if (!rule || rule.length > MAX_RULE) {
    return { ok: false, reason: `A decision needs a rule of at most ${MAX_RULE} characters.` };
  }
  if (check !== undefined && (check.includes("\n") || check.length > MAX_CHECK)) {
    return { ok: false, reason: `A check is one command line of at most ${MAX_CHECK} characters.` };
  }
  if (scope.length > MAX_SCOPE) return { ok: false, reason: `A scope lists at most ${MAX_SCOPE} globs.` };
  const outside = scope.find(
    (item) => isAbsolute(item) || /^[A-Za-z]:/u.test(item) || item.split(/[\\/]/u).includes(".."),
  );
  if (outside) return { ok: false, reason: `Scope globs are relative to the project, inside it: ${outside}` };
  const existing = listDecisions(workspace);
  if (proposal.supersedes) {
    const replaced = existing.find((decision) => decision.id === proposal.supersedes);
    if (!replaced || replaced.status !== "active") {
      return { ok: false, reason: `${proposal.supersedes} is not an active decision, so nothing can supersede it.` };
    }
  }
  const same = existing.find(
    (decision) => decision.status !== "superseded" && normalizeTitle(decision.title) === normalizeTitle(title),
  );
  if (same && same.id !== proposal.supersedes) {
    return { ok: false, reason: `This is already recorded as ${same.id} (${same.status}).` };
  }
  const next = existing.reduce((max, decision) => Math.max(max, Number(decision.id.slice(2))), 0) + 1;
  const number = String(next).padStart(4, "0");
  const decision: Decision = {
    id: `D-${number}`,
    title,
    status: "proposed",
    source: proposal.source,
    rule,
    ...(proposal.why?.trim() ? { why: proposal.why.trim() } : {}),
    ...(proposal.evidence?.trim() ? { evidence: proposal.evidence.trim() } : {}),
    scope,
    ...(check ? { check } : {}),
    proposed: today(now),
    ...(proposal.supersedes ? { supersedes: proposal.supersedes } : {}),
    file: `${LEDGER_DIR}/${number}-${slugify(title)}.md`,
  };
  saveDecision(workspace, decision);
  return { ok: true, decision };
}

/**
 * Changes a decision's status by editing its front matter lines in the file as written, so nothing else a
 * person put in it (other keys, comments, sections beyond Why and Evidence, line endings) is lost.
 */
function setStatus(
  workspace: string,
  decision: Decision,
  status: DecisionStatus,
  fields: Record<string, string>,
): Decision {
  const path = join(workspace, decision.file);
  const raw = readFileSync(path, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const text = raw.replaceAll("\r\n", "\n");
  const match = /^---\n([\s\S]*?)\n---(?=\n|$)/u.exec(text);
  if (!match) return decision;
  const lines = (match[1] ?? "").split("\n");
  for (const [key, value] of Object.entries({ status, ...fields })) {
    const at = lines.findIndex((line) => line.startsWith(`${key}:`));
    if (at >= 0) lines[at] = `${key}: ${value}`;
    else lines.push(`${key}: ${value}`);
  }
  const updated = ["---", ...lines, "---"].join("\n") + text.slice(match[0].length);
  writeAtomic(path, updated.replaceAll("\n", eol));
  return parseDecision(updated, basename(decision.file)) ?? { ...decision, status };
}

/** The user's yes: a proposal becomes an active commitment, and the decision it supersedes steps down. */
export function approveDecision(workspace: string, id: string, now = new Date()): LedgerResult {
  const decision = findDecision(workspace, id);
  if (!decision) return { ok: false, reason: `No decision ${id} in ${LEDGER_DIR}.` };
  if (decision.status !== "proposed")
    return { ok: false, reason: `${decision.id} is ${decision.status}, not a proposal.` };
  if (decision.supersedes) {
    const replaced = findDecision(workspace, decision.supersedes);
    if (replaced?.status === "active") setStatus(workspace, replaced, "superseded", { superseded_by: decision.id });
  }
  return { ok: true, decision: setStatus(workspace, decision, "active", { approved: today(now) }) };
}

/** The user's no: the proposal is dropped; git keeps the record of it if it was committed. */
export function rejectDecision(workspace: string, id: string): LedgerResult {
  const decision = findDecision(workspace, id);
  if (!decision) return { ok: false, reason: `No decision ${id} in ${LEDGER_DIR}.` };
  if (decision.status !== "proposed")
    return { ok: false, reason: `${decision.id} is ${decision.status}, not a proposal.` };
  unlinkSync(join(workspace, decision.file));
  return { ok: true, decision };
}
