import type { ProviderAdapter, ProviderUsage } from "../providers/types";
import { decideMemoryWrite, type GateDecision } from "./gate";
import { appendReflectionAudit, listMemoryRecords, writeMemoryEntry } from "./store";
import { MEMORY_TYPES, type MemoryRecord, type MemoryScope, type MemoryType, type MemoryWriteInput } from "./types";

/**
 * Automatic memory capture after meaningful work.
 *
 * Two writers, one gate. Deterministic extraction handles what needs no judgment: an explicit user
 * directive ("always run the linter before committing") becomes a human-sourced entry without a
 * model call. A bounded reflection call handles what does: given a compact digest of the turn
 * (what was asked, what changed, which commands ran and how they ended), the model proposes up to
 * five durable, project-specific facts, and the write gate decides which of them land. The turn
 * never waits on this to report its result, and a failure here never fails the turn.
 */

export interface TurnCommand {
  command: string;
  success: boolean;
  output: string;
}

export interface TurnDigest {
  userMessage: string;
  assistantText: string;
  changedFiles: string[];
  commands: TurnCommand[];
  /** True when the turn produced verification-shaped evidence (tests, build, real request). */
  verified: boolean;
  /** The turn ended with the host's `[Not verified]` note: the project's checks still failed on its code. */
  endedUnverified?: boolean;
  toolCalls: number;
}

/** What a turn that ended unverified may teach is kept, but it never outranks a confirmed fact. */
const UNVERIFIED_CONFIDENCE_CAP = 0.4;

export interface ReflectionCandidate extends MemoryWriteInput {}

export interface ReflectionReport {
  qualified: boolean;
  reason: string;
  candidates: ReflectionCandidate[];
  decisions: Array<{ slug: string; action: GateDecision["action"]; reason: string }>;
  written: string[];
  usage?: ProviderUsage;
  error?: string;
}

const MAX_CANDIDATES = 5;
const MAX_PROMPT_CHARS = 9_000;

/**
 * What the user states as lasting, in their own words (docs/architecture/18-MEMORY-V2.md §4.2). Task-local
 * prohibitions ("do not modify tests" inside one request) are constraints of that task, not of the project, and do not
 * become permanent rules; the reflection step may still record a convention it judges durable.
 *
 * - a rule: a sentence that starts with always, never, from now on, going forward, prefer (and the Spanish forms);
 * - a fact: "remember that …", "we use …", "this project uses …";
 * - a correction: "no, we use …", "actually, …", "we don't use X anymore", "use Y instead of X".
 */
const RULE_START =
  /^(?:always|never|from now on|going forward|prefer|en adelante|a partir de ahora|siempre|nunca|jam[aá]s|prefiero)\b/iu;
const REMEMBER_START =
  /^(?:remember that|keep in mind that|note that|recuerda que|ten en cuenta que|toma en cuenta que)\s+/iu;
const FACT_START =
  /^(?:we use|we're using|we are using|this project uses|the project uses|usamos|el proyecto usa|en este proyecto usamos)\b/iu;
// "No problem, it is fine" is not a correction: a bare "no" needs its comma, and the rest must state a project fact.
const CORRECTION_START =
  /^(?:(?:no|nope|wrong|incorrect)\s*[,.:;!]|(?:actually|en realidad|te equivocas|that's wrong|eso est[aá] mal)\b[,.:;!]?)\s*/iu;
const CORRECTION_STATEMENT =
  /\b(?:we(?:'re| are)? (?:use|using|run|build|deploy|test|keep|store|call)|this project|the project|usamos|el proyecto|se usa|lives in|is in|is at|est[aá] en|vive en)\b/iu;
const NO_LONGER =
  /\b(?:we (?:don't|do not|no longer) use|we stopped using|we (?:moved|migrated) (?:away )?from|ya no usamos|dejamos de usar|migramos de)\b/iu;
const INSTEAD = /\b(?:use|usa|utiliza|usamos)\b.{2,80}\b(?:instead of|rather than|en vez de|en lugar de)\b/iu;
/** A preference about how Shelra talks to this person holds in every project: it goes to the user-wide store. */
const PERSONAL =
  /\b(?:answer|respond|reply|write to me|talk to me|explain|responde|contesta|h[aá]blame|escr[ií]beme|expl[ií]came)\b.{0,40}\b(?:in|en)\s+(?:spanish|english|espa[nñ]ol|ingl[eé]s|castellano)\b|\b(?:my|mi)\s+(?:language|idioma)\b/iu;

function slugify(text: string, prefix = ""): string {
  const base = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48)
    .replace(/-+$/u, "");
  const combined = `${prefix}${base}`.replace(/^[^a-z]+/u, "");
  return combined || "memory-entry";
}

/** A message's sentences; a period inside a name, a path or a version ("Node 20.11", "src/index.ts") does not end one. */
function sentencesOf(message: string): string[] {
  return message
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) =>
      sentence
        .trim()
        .replace(/\s+/gu, " ")
        .replace(/[.!]+$/u, ""),
    )
    .filter(Boolean);
}

type DirectiveKind = "rule" | "fact" | "correction";

/** What a sentence states as lasting, and the statement itself; null when it states nothing lasting. */
function directiveOf(sentence: string, document: boolean): { kind: DirectiveKind; statement: string } | null {
  if (/^(never mind|always wondered|never thought)/iu.test(sentence)) return null;
  if (RULE_START.test(sentence)) {
    // A structured document (a spec with "#" headings) states what this task should do: its "prefer" lines are the
    // task's requirements, not standing rules (seen live 2026-09-24).
    if (document && /^(prefer|prefiero)\b/iu.test(sentence)) return null;
    return { kind: "rule", statement: sentence };
  }
  const remember = REMEMBER_START.exec(sentence);
  if (remember) return { kind: "fact", statement: sentence.slice(remember[0].length) };
  // Specs describe the task's target: only its explicit rules and "remember that" lines last beyond it.
  if (document) return null;
  if (NO_LONGER.test(sentence)) return { kind: "correction", statement: sentence };
  const correction = CORRECTION_START.exec(sentence);
  if (correction) {
    const rest = sentence.slice(correction[0].length);
    if (CORRECTION_STATEMENT.test(rest)) return { kind: "correction", statement: rest };
  }
  if (FACT_START.test(sentence)) return { kind: "fact", statement: sentence };
  if (INSTEAD.test(sentence)) return { kind: "correction", statement: sentence };
  return null;
}

/**
 * Explicit standing instructions, facts and corrections in the user's own words, captured without a model call.
 * Ordinary prose ("never mind", "I always wondered") is not captured; a lead-in to a list is not a complete rule;
 * a preference about how Shelra talks to this person is tagged `user-wide` for the user's own store.
 */
export function extractUserDirectives(userMessage: string): ReflectionCandidate[] {
  const candidates: ReflectionCandidate[] = [];
  const seen = new Set<string>();
  const document = /^#{1,6}\s/mu.test(userMessage);
  const today = new Date().toISOString().slice(0, 10);
  for (const sentence of sentencesOf(userMessage)) {
    // A lead-in to a list ("… so that it tests your ability to reason about:") is not a complete statement.
    // Nor is a question ("should we always use X?").
    if (/[:?]$/u.test(sentence) || sentence.length < 8 || sentence.length > 300) continue;
    const directive = directiveOf(sentence, document);
    if (!directive || directive.statement.length < 8) continue;
    const statement = directive.statement.charAt(0).toUpperCase() + directive.statement.slice(1);
    const prefix = directive.kind === "rule" ? "user-rule-" : directive.kind === "fact" ? "user-fact-" : "user-fix-";
    const slug = slugify(statement, prefix);
    if (seen.has(slug)) continue;
    seen.add(slug);
    const personal = PERSONAL.test(sentence);
    candidates.push({
      slug,
      title: statement.length > 60 ? `${statement.slice(0, 57)}...` : statement,
      hook: statement,
      type: directive.kind === "rule" ? "preference" : "conventions",
      description: `${directive.kind === "correction" ? "User correction" : directive.kind === "fact" ? "User statement" : "User instruction"} on ${today}: ${statement}`,
      // The statement alone: a shared boilerplate body made unrelated short rules look like duplicates.
      body: `${statement}.\n\n(${directive.kind === "correction" ? "Corrected" : "Stated"} by the user on ${today}.)`,
      source: "human",
      confidence: 1,
      tags: [
        "user-directive",
        ...(directive.kind === "correction" ? ["correction"] : []),
        ...(personal ? ["user-wide"] : []),
      ],
    });
  }
  return candidates.slice(0, 5);
}

export function turnQualifiesForReflection(digest: TurnDigest): { qualified: boolean; reason: string } {
  const failed = digest.commands.filter((command) => !command.success).length;
  const succeededAfterFailure =
    failed > 0 && digest.commands.findIndex((command) => !command.success) < digest.commands.length - 1;
  if (digest.changedFiles.length > 0 && digest.verified) return { qualified: true, reason: "verified change" };
  // The hardest turns end unverified; they teach what fails and what did not work (audit doc 15, M4).
  if (digest.changedFiles.length > 0 && digest.endedUnverified) {
    return { qualified: true, reason: "a change whose checks still fail" };
  }
  if (succeededAfterFailure) return { qualified: true, reason: "a command failed and later work succeeded" };
  if (digest.toolCalls >= 8) return { qualified: true, reason: "substantial investigation" };
  return { qualified: false, reason: "no verified change, failure, or substantial investigation" };
}

/**
 * Machine-observed fallback: a command that failed and a later command that succeeded is a fact
 * worth keeping even when the model's extraction returns nothing — the exact shape of the
 * "trap discovered the hard way" that a future session pays for again without memory.
 */
export function deterministicFailureCandidates(digest: TurnDigest): ReflectionCandidate[] {
  const candidates: ReflectionCandidate[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < digest.commands.length; index += 1) {
    const failed = digest.commands[index];
    if (!failed || failed.success) continue;
    const recovered = digest.commands.slice(index + 1).find((command) => command.success);
    if (!recovered) continue;
    const slug = slugify(`${failed.command.split(/\s+/u).slice(0, 4).join(" ")} failed`, "failure-");
    if (seen.has(slug)) continue;
    seen.add(slug);
    const errorHead =
      failed.output
        .trim()
        .split(/\r?\n/u)
        .find((line) => line.trim()) ?? "(no output)";
    candidates.push({
      slug,
      title: `${clip(failed.command, 50)} failed until ${clip(recovered.command, 40)}`,
      hook: `\`${clip(failed.command, 60)}\` failed (${clip(errorHead, 80)}); \`${clip(recovered.command, 60)}\` then succeeded`,
      type: "failure",
      description: `Observed on ${new Date().toISOString().slice(0, 10)}: a command failed and later work succeeded`,
      body: [
        `Running \`${clip(failed.command, 200)}\` failed with:`,
        "```",
        clip(failed.output, 400),
        "```",
        `Later, \`${clip(recovered.command, 200)}\` succeeded${recovered.output.trim() ? ` (${clip(recovered.output.trim().split(/\r?\n/u)[0] ?? "", 120)})` : ""}.`,
        "Check whether the second command (or a step between them) is a prerequisite before repeating the first.",
      ].join("\n"),
      source: "observed",
      confidence: 0.6,
      tags: ["failure", "recovered"],
    });
    if (candidates.length >= 2) break;
  }
  return candidates;
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 15)}\n...[clipped]`;
}

export function buildReflectionPrompt(
  digest: TurnDigest,
  existing: readonly MemoryRecord[],
): { system: string; prompt: string } {
  const system = [
    "You extract durable project knowledge from one coding turn so a future session on this repository starts as an expert, not from zero.",
    'Return ONLY a JSON object of the form {"memories":[...]} with at most 5 items. No prose, no markdown fences.',
    'Each item: {"type":<one of ' +
      MEMORY_TYPES.join("|") +
      '>,"slug":<kebab-case>,"title":<short>,"hook":<one line>,"description":<one line>,"body":<markdown, 1-8 lines, exact commands/paths/flags>,"confidence":<0..1>,"relatedFiles":[<workspace-relative paths this depends on>],"tags":[<keywords>]}.',
    "Keep only what is non-obvious, project-specific, and reusable: a command that must be run in a particular way, a trap and its fix, a convention the code enforces, a decision and the alternative rejected, a procedure that took several steps to discover.",
    "Do not store what a fresh reader gets by opening a file (file listings, function signatures), the task itself, credentials, or anything the user only asked once.",
    'If the turn taught nothing durable, return {"memories":[]}.',
  ].join("\n");
  const sections: string[] = [
    `REQUEST:\n${clip(digest.userMessage, 1_200)}`,
    `FILES CHANGED: ${digest.changedFiles.length > 0 ? digest.changedFiles.join(", ") : "(none)"}`,
    `VERIFIED: ${digest.verified ? "yes" : "no"}`,
  ];
  if (digest.endedUnverified) {
    sections.push(
      "OUTCOME: the turn ended unverified: the project's checks still failed on its code. Keep what the commands showed (what fails, how, and what did not work), never a fix that was not confirmed.",
    );
  }
  if (digest.commands.length > 0) {
    sections.push(
      `COMMANDS (last ${Math.min(digest.commands.length, 12)}):\n${digest.commands
        .slice(-12)
        .map(
          (command) =>
            `$ ${clip(command.command, 160)}\n  -> ${command.success ? "ok" : "FAILED"}: ${clip(command.output, 240).replaceAll("\n", " ")}`,
        )
        .join("\n")}`,
    );
  }
  sections.push(`FINAL REPORT:\n${clip(digest.assistantText, 1_500)}`);
  if (existing.length > 0) {
    sections.push(
      `ALREADY SAVED (do not repeat; you may revise by reusing a slug):\n${existing
        .slice(0, 40)
        .map((record) => `- ${record.slug}: ${record.index.hook}`)
        .join("\n")}`,
    );
  }
  return { system, prompt: clip(sections.join("\n\n"), MAX_PROMPT_CHARS) };
}

/** JSON schema for the reflection reply, for providers that can enforce structured output. */
export const REFLECTION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    memories: {
      type: "array",
      maxItems: MAX_CANDIDATES,
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: [...MEMORY_TYPES] },
          slug: { type: "string" },
          title: { type: "string" },
          hook: { type: "string" },
          description: { type: "string" },
          body: { type: "string" },
          confidence: { type: "number" },
          relatedFiles: { type: "array", items: { type: "string" } },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["type", "slug", "title", "hook", "description", "body", "confidence"],
        additionalProperties: false,
      },
    },
  },
  required: ["memories"],
  additionalProperties: false,
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/** Tolerant JSON extraction: accepts fenced or prefixed output and drops malformed items. */
export function parseReflectionCandidates(text: string): ReflectionCandidate[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const items = Array.isArray((parsed as { memories?: unknown })?.memories)
    ? ((parsed as { memories: unknown[] }).memories as unknown[])
    : Array.isArray(parsed)
      ? (parsed as unknown[])
      : [];
  const candidates: ReflectionCandidate[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const type = asString(record.type) as MemoryType;
    const body = asString(record.body);
    const title = asString(record.title) || asString(record.hook);
    const hook = asString(record.hook) || title;
    if (!(MEMORY_TYPES as readonly string[]).includes(type) || !body || !title) continue;
    const confidence =
      typeof record.confidence === "number" ? record.confidence : Number.parseFloat(asString(record.confidence));
    candidates.push({
      slug: slugify(asString(record.slug) || title),
      title: title.slice(0, 80),
      hook: hook.slice(0, 160),
      type,
      description: (asString(record.description) || hook).slice(0, 200),
      body,
      source: "inference",
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.6,
      relatedFiles: asStringArray(record.relatedFiles),
      tags: asStringArray(record.tags),
    });
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return candidates;
}

/** Applies the gate to each candidate and writes the admitted ones. Pure store I/O; no model. */
export function admitCandidates(
  scope: MemoryScope,
  candidates: readonly ReflectionCandidate[],
  records?: readonly MemoryRecord[],
): { decisions: ReflectionReport["decisions"]; written: string[] } {
  let current = records ? [...records] : listMemoryRecords(scope);
  const decisions: ReflectionReport["decisions"] = [];
  const written: string[] = [];
  for (const candidate of candidates) {
    const decision = decideMemoryWrite(candidate, current);
    decisions.push({ slug: decision.slug, action: decision.action, reason: decision.reason });
    if (decision.action !== "create" && decision.action !== "update") continue;
    try {
      const result = writeMemoryEntry(scope, { ...candidate, slug: decision.slug });
      if (result.ok) {
        written.push(decision.slug);
        current = listMemoryRecords(scope);
      } else {
        decisions[decisions.length - 1] = {
          slug: decision.slug,
          action: "skip",
          reason: `index full (${result.indexLines}/${result.capLines})`,
        };
      }
    } catch (error) {
      decisions[decisions.length - 1] = {
        slug: decision.slug,
        action: "reject",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { decisions, written };
}

export interface ReflectOptions {
  scope: MemoryScope;
  provider: ProviderAdapter;
  modelId: string;
  digest: TurnDigest;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * One bounded model call, then the gate. Skips the call entirely for turns that taught nothing
 * (no verified change, no failure, little investigation) so ordinary chat costs nothing extra.
 */
export async function reflectOnTurn(options: ReflectOptions): Promise<ReflectionReport> {
  const qualification = turnQualifiesForReflection(options.digest);
  const report: ReflectionReport = { ...qualification, candidates: [], decisions: [], written: [] };
  if (!qualification.qualified) {
    // Why a turn taught nothing is part of the audit too (doc 18 §2.2 R8): before, only qualifying turns left a record.
    appendReflectionAudit(options.scope, {
      at: new Date().toISOString(),
      qualified: false,
      reason: qualification.reason,
      candidates: 0,
      decisions: [],
      written: [],
    });
    return report;
  }
  const records = listMemoryRecords(options.scope);
  const { system, prompt } = buildReflectionPrompt(options.digest, records);
  const timeoutMs = options.timeoutMs ?? 30_000;
  let rawText = "";
  try {
    // Provider-enforced JSON first: small models hand-write broken JSON often enough (a stray `{`
    // mid-object was seen live) that letting the provider constrain the shape is worth one call.
    if (options.provider.generateStructured) {
      try {
        const structured = await options.provider.generateStructured({
          modelId: options.modelId,
          system,
          prompt,
          schema: REFLECTION_SCHEMA,
          schemaName: "memories",
          maxOutputTokens: 1_500,
          temperature: 0.2,
          timeout: { totalMs: timeoutMs, stepMs: timeoutMs, chunkMs: Math.min(15_000, timeoutMs) },
          signal: options.signal,
        });
        report.usage = mergeUsage(report.usage, structured.usage);
        rawText = structured.text;
        report.candidates = parseReflectionCandidates(JSON.stringify(structured.data ?? {}));
        if (report.candidates.length === 0 && Array.isArray((structured.data as { memories?: unknown[] })?.memories)) {
          rawText = `${rawText}\n[structured reply had no admissible memories]`;
        }
      } catch {
        // fall through to the plain-text path
      }
    }
    // One retry: a malformed JSON reply is common enough with small models that a second, more
    // literal request is cheaper than losing the turn's knowledge.
    for (
      let attempt = 0;
      attempt < 2 && report.candidates.length === 0 && !/no admissible memories/u.test(rawText);
      attempt += 1
    ) {
      const result = await options.provider.generateText({
        modelId: options.modelId,
        system:
          attempt === 0
            ? system
            : `${system}\nYour previous reply was not valid JSON. Reply with the JSON object only.`,
        prompt,
        maxOutputTokens: 1_500,
        temperature: attempt === 0 ? 0.2 : 0,
        timeout: { totalMs: timeoutMs, stepMs: timeoutMs, chunkMs: Math.min(15_000, timeoutMs) },
        signal: options.signal,
      });
      report.usage = mergeUsage(report.usage, result.usage);
      rawText = result.text;
      report.candidates = parseReflectionCandidates(result.text);
      if (report.candidates.length === 0 && /"memories"\s*:\s*\[\s*\]/u.test(result.text)) break;
    }
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  }
  if (options.digest.endedUnverified) {
    report.candidates = report.candidates.map((candidate) => ({
      ...candidate,
      confidence: Math.min(candidate.confidence ?? UNVERIFIED_CONFIDENCE_CAP, UNVERIFIED_CONFIDENCE_CAP),
      tags: [...new Set([...(candidate.tags ?? []), "unverified"])],
    }));
  }
  // The mechanically observed trap (a command that failed until something else was done) is
  // recorded unless the model's own candidates already mention the recovering command; twice in
  // one evening the model recorded the implementation and skipped the one fact the next session
  // would pay for again. The gate merges any genuine overlap.
  const covered = (command: string): boolean => {
    const head = command.trim().split(/\s+/u).slice(0, 3).join(" ").toLowerCase();
    return report.candidates.some((candidate) =>
      `${candidate.hook}
${candidate.body}`
        .toLowerCase()
        .includes(head),
    );
  };
  const fallback = deterministicFailureCandidates(options.digest).filter((candidate) => {
    const recovered = candidate.body.match(/Later, `([^`]+)` succeeded/u)?.[1];
    return !recovered || !covered(recovered);
  });
  const admitted = admitCandidates(options.scope, [...report.candidates, ...fallback], records);
  report.decisions = admitted.decisions;
  report.written = admitted.written;
  appendReflectionAudit(options.scope, {
    at: new Date().toISOString(),
    qualified: report.qualified,
    reason: report.reason,
    rawText: clip(rawText, 2_000),
    candidates: report.candidates.length + fallback.length,
    decisions: report.decisions,
    written: report.written,
    ...(report.error ? { error: report.error } : {}),
  });
  return report;
}

function mergeUsage(current: ProviderUsage | undefined, next: ProviderUsage | undefined): ProviderUsage | undefined {
  if (!next) return current;
  if (!current) return next;
  return {
    inputTokens: (current.inputTokens ?? 0) + (next.inputTokens ?? 0),
    outputTokens: (current.outputTokens ?? 0) + (next.outputTokens ?? 0),
    totalTokens: (current.totalTokens ?? 0) + (next.totalTokens ?? 0),
    costUsdTicks:
      current.costUsdTicks === undefined && next.costUsdTicks === undefined
        ? undefined
        : (current.costUsdTicks ?? 0) + (next.costUsdTicks ?? 0),
  };
}
