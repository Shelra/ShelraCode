/**
 * Rule guards: a project rule the host recognizes holds whatever the model does. Each guard reads the rule in the text
 * of the rules in force (the request, the active decisions, the user's standing rules) and checks what the turn added:
 *
 * - no new dependencies: a dependency the project's manifests did not declare when the turn started
 *   (src/contract/dependency-guard.ts);
 * - nothing sensitive in logs ("logs must never contain email addresses"): a new log call that passes a value whose name
 *   says what it is (`user.email`, `newEmail`, `password`), outside string literals;
 * - no hard deletes ("this project never removes rows; deleting sets deleted_at"): a new `DELETE FROM` statement.
 *
 * The request wins when it asks in so many words ("log the new email", "permanently delete"). These are the rules the
 * decision chain gives in plain words, with no check of their own, and that Claude Code and Codex broke there
 * (docs/EXECUTION-PLAN.md, F6); they are also among the rules real projects keep for privacy and data retention.
 */
import { dependencyRule } from "./dependency-guard";
import { isTestFile } from "./test-protection";

export type RuleGuardKind = "dependency" | "sensitive-log" | "hard-delete";

export interface RuleViolation {
  kind: RuleGuardKind;
  /** The rule as written. */
  rule: string;
  /** What the turn added that breaks it. */
  detail: string;
}

export interface ChangedFile {
  path: string;
  /** The file before the turn: "" for a new file. */
  before: string;
  after: string;
}

export interface RuleGuardInput {
  rules: readonly string[];
  request: string;
  files: readonly ChangedFile[];
  /** Dependencies the turn added that the request did not tell it to add. */
  addedDependencies: readonly string[];
}

interface SensitiveTerm {
  words: RegExp;
  /** An identifier that holds such a value. */
  identifier: RegExp;
  label: string;
}

const SENSITIVE: readonly SensitiveTerm[] = [
  {
    words: /e-?mails?|email address(?:es)?|correos?(?: electr[oó]nicos?)?/iu,
    identifier: /e_?mail/iu,
    label: "an email address",
  },
  { words: /passwords?|contrase[nñ]as?/iu, identifier: /password|passwd|^pwd$/iu, label: "a password" },
  { words: /api keys?|tokens?|secrets?|secretos?|claves?/iu, identifier: /token|secret|api_?key/iu, label: "a secret" },
  { words: /phone numbers?|tel[eé]fonos?/iu, identifier: /phone/iu, label: "a phone number" },
];

const TERM =
  "(?:e-?mails?|email address(?:es)?|passwords?|api keys?|tokens?|secrets?|phone numbers?|correos?(?: electr[oó]nicos?)?|contrase[nñ]as?|secretos?|claves?|tel[eé]fonos?)";
const FORBIDS_SENSITIVE_LOGS = [
  new RegExp(
    `\\b(?:logs?|logging|log (?:lines?|output|messages?))\\b[^.\\n]{0,60}\\b(?:never|not|no)\\b[^.\\n]{0,40}${TERM}`,
    "iu",
  ),
  new RegExp(`\\b(?:never|don't|do not|dont|must not)\\s+(?:log|print|write)\\b[^.\\n]{0,40}${TERM}`, "iu"),
  new RegExp(`\\b(?:los\\s+)?logs?\\b[^.\\n]{0,40}\\b(?:nunca|no)\\b[^.\\n]{0,40}${TERM}`, "iu"),
  new RegExp(`\\b(?:no|nunca)\\s+(?:registres|loguees|imprimas|escribas|guardes)\\b[^.\\n]{0,40}${TERM}`, "iu"),
];

const FORBIDS_HARD_DELETES = [
  /\bnever\s+(?:removes?|deletes?|drops?)\s+(?:any\s+)?(?:rows|records)\b/iu,
  /\bsoft[- ]delet/iu,
  /\bno\s+(?:hard\s+)?deletes?\b/iu,
  /\b(?:never|don't|do not|must not)\s+(?:hard[- ])?(?:delete|remove)\b[^.\n]{0,30}\b(?:rows|records)\b/iu,
  /\bnunca\s+(?:borra|elimina|borramos|eliminamos)\w*\b[^.\n]{0,30}\b(?:filas|registros)\b/iu,
  /\bborrado\s+l[oó]gico\b/iu,
];

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|py|go|rb|java|kt|cs|php|rs|swift)$/iu;

function firstMatching(rules: readonly string[], patterns: readonly RegExp[]): string | null {
  for (const rule of rules) {
    if (patterns.some((pattern) => pattern.test(rule))) return rule.replace(/\s+/gu, " ").trim();
  }
  return null;
}

/** The text of an expression with its string literals emptied; a template literal keeps what it interpolates. */
export function withoutStringLiterals(code: string): string {
  let out = "";
  let index = 0;
  while (index < code.length) {
    const char = code[index] as string;
    if (char === '"' || char === "'") {
      index += 1;
      while (index < code.length && code[index] !== char) index += code[index] === "\\" ? 2 : 1;
      index += 1;
      out += '""';
    } else if (char === "`") {
      index += 1;
      while (index < code.length && code[index] !== "`") {
        if (code[index] === "\\") index += 2;
        else if (code[index] === "$" && code[index + 1] === "{") {
          let depth = 1;
          index += 2;
          let inner = "";
          while (index < code.length && depth > 0) {
            if (code[index] === "{") depth += 1;
            else if (code[index] === "}") depth -= 1;
            if (depth > 0) inner += code[index];
            index += 1;
          }
          out += ` ${withoutStringLiterals(inner)} `;
        } else index += 1;
      }
      index += 1;
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
}

const LOG_CALL =
  /\b(?:log|logger\.\w+|logging\.\w+|console\.(?:log|info|warn|error|debug)|print|printf|fmt\.Print\w*|Log\.\w+)\s*\(/gu;

/** The log calls in a file, as written, each up to its closing parenthesis. */
export function logCalls(code: string): string[] {
  const calls: string[] = [];
  for (const match of code.matchAll(LOG_CALL)) {
    const start = match.index ?? 0;
    let depth = 0;
    let end = start;
    let quote: string | null = null;
    for (let index = start; index < Math.min(code.length, start + 2_000); index += 1) {
      const char = code[index];
      if (quote) {
        if (char === "\\") index += 1;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === "`") quote = char;
      else if (char === "(") depth += 1;
      else if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    if (end > start) calls.push(code.slice(start, end));
  }
  return calls;
}

const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();

/** Log calls in `after` that `before` did not have. */
function newLogCalls(before: string, after: string): string[] {
  const known = new Set(logCalls(before).map(normalize));
  return logCalls(after).filter((call) => !known.has(normalize(call)));
}

/** Whether a log call passes a value of the term's kind: an identifier, not a word in a message. */
function passesSensitiveValue(call: string, term: SensitiveTerm): boolean {
  const code = withoutStringLiterals(call.slice(call.indexOf("(")));
  return (code.match(/[A-Za-z_$][\w$]*/gu) ?? []).some((name) => term.identifier.test(name));
}

function countDeletes(code: string): number {
  return (code.match(/\bDELETE\s+FROM\b|\bdeleteFrom\s*\(/giu) ?? []).length;
}

/** Whether any rule in force is one a guard enforces: the cheap test before any file is read. */
export function hasGuardedRule(rules: readonly string[]): boolean {
  return (
    dependencyRule(rules) !== null ||
    firstMatching(rules, FORBIDS_SENSITIVE_LOGS) !== null ||
    firstMatching(rules, FORBIDS_HARD_DELETES) !== null
  );
}

/** What the turn added that a recognized rule forbids; empty when nothing does. */
export function ruleViolations(input: RuleGuardInput): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const sources = input.files.filter((file) => SOURCE_FILE.test(file.path) && !isTestFile(file.path));

  if (input.addedDependencies.length > 0) {
    const rule = dependencyRule(input.rules);
    if (rule) violations.push({ kind: "dependency", rule, detail: `added ${input.addedDependencies.join(", ")}` });
  }

  const logRule = firstMatching(input.rules, FORBIDS_SENSITIVE_LOGS);
  if (logRule) {
    const terms = SENSITIVE.filter((term) => term.words.test(logRule));
    const allowed = (term: SensitiveTerm) =>
      new RegExp(
        `\\blog(?:s|ged)?\\s+(?:the\\s+|their\\s+|its\\s+)?(?:new\\s+|old\\s+)?(?:${term.words.source})`,
        "iu",
      ).test(input.request);
    for (const file of sources) {
      for (const call of newLogCalls(file.before, file.after)) {
        const term = terms.find((candidate) => !allowed(candidate) && passesSensitiveValue(call, candidate));
        if (term) {
          violations.push({
            kind: "sensitive-log",
            rule: logRule,
            detail: `${file.path} logs ${term.label}: ${normalize(call).slice(0, 160)}`,
          });
          break;
        }
      }
    }
  }

  const deleteRule = firstMatching(input.rules, FORBIDS_HARD_DELETES);
  const hardDeleteAsked =
    /\b(?:permanently|hard)[- ]?delet|\bDELETE\s+FROM\b|\bborr\w*\s+(?:definitivamente|f[ií]sicamente)\b/iu.test(
      input.request,
    );
  if (deleteRule && !hardDeleteAsked) {
    for (const file of sources) {
      if (countDeletes(file.after) > countDeletes(file.before)) {
        violations.push({ kind: "hard-delete", rule: deleteRule, detail: `${file.path} adds a DELETE statement` });
      }
    }
  }
  return violations;
}
