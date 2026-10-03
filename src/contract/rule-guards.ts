/**
 * Rule guards: a project rule the host recognizes holds whatever the model does. Each guard reads the rule in the rules
 * in force (the active decisions, the user's standing rules, and the standing rules the request itself states) and
 * checks what the turn added:
 *
 * - no new dependencies: a dependency the project's manifests did not declare when the turn started
 *   (src/contract/dependency-guard.ts);
 * - nothing sensitive in logs ("logs must never contain email addresses"): a log call that passes a value named for what
 *   it is (`user.email`, `newEmail`, `password`), outside string literals and masking calls, that the file's log calls
 *   did not pass before the turn;
 * - no hard deletes ("this project never removes rows"): more `DELETE FROM` statements, outside comments, than the file
 *   had before the turn.
 *
 * The raw request is never read as a rule: a bug report ("No compila; instala las dependencias que falten") would block
 * the fix it asks for. The request wins when it asks in so many words ("log the new email", "permanently delete").
 * These are the rules the decision chain gives in plain words, with no check of their own, and that Claude Code and
 * Codex broke there (docs/EXECUTION-PLAN.md, F6); they are also rules real projects keep for privacy and retention.
 */
import { inScope } from "../ledger/glob";
import { FORBIDS_NEW_DEPENDENCIES } from "./dependency-guard";
import { isTestFile } from "./test-protection";

export type RuleGuardKind = "dependency" | "sensitive-log" | "hard-delete";

/** A rule in force, and where it comes from. */
export interface RuleInForce {
  text: string;
  origin: "decision" | "standing-rule" | "request";
  /** A decision's id. */
  id?: string;
  /** A decision's scope: the files it governs; empty for the whole project. */
  scope?: readonly string[];
}

export interface RuleViolation {
  kind: RuleGuardKind;
  rule: RuleInForce;
  /** What the turn added that breaks it, as the subject of a sentence ("src/a.ts logs an email address"). */
  detail: string;
}

export interface ChangedFile {
  path: string;
  /** The file before the turn: "" for a new file. */
  before: string;
  after: string;
}

export interface RuleGuardInput {
  rules: readonly RuleInForce[];
  request: string;
  files: readonly ChangedFile[];
  /** Dependencies the turn added that the request did not tell it to add. */
  addedDependencies: readonly string[];
}

interface SensitiveTerm {
  words: RegExp;
  /** The last word or two of a name that holds such a value. */
  names: readonly string[];
  label: string;
}

const SENSITIVE: readonly SensitiveTerm[] = [
  {
    words: /e-?mails?|email address(?:es)?|correos?(?: electr[oó]nicos?)?/iu,
    names: ["email", "emailaddress", "mail"],
    label: "an email address",
  },
  {
    words: /passwords?|contrase[nñ]as?/iu,
    names: ["password", "passwd", "pwd", "passphrase"],
    label: "a password",
  },
  {
    words: /api keys?|tokens?|secrets?|secretos?|claves?/iu,
    names: ["token", "secret", "apikey", "accesstoken", "refreshtoken", "authtoken", "clientsecret"],
    label: "a secret",
  },
  { words: /phone numbers?|tel[eé]fonos?/iu, names: ["phone", "phonenumber"], label: "a phone number" },
];

const TERM =
  "(?:e-?mails?|email address(?:es)?|passwords?|api keys?|tokens?|secrets?|phone numbers?|correos?(?: electr[oó]nicos?)?|contrase[nñ]as?|secretos?|claves?|tel[eé]fonos?)";
/** "Logs must never contain email addresses", "never log passwords", "los logs nunca deben contener correos". */
const FORBIDS_SENSITIVE_LOGS = [
  new RegExp(
    `\\blogs?\\s+(?:must|should|may|can|shall)\\s+(?:never|not)\\s+(?:contain|include|show|hold|print|record|have)\\b[^.\\n]{0,30}${TERM}`,
    "iu",
  ),
  new RegExp(`\\b(?:never|don't|do not|dont|must not)\\s+(?:log|print)\\b[^.\\n]{0,40}${TERM}`, "iu"),
  new RegExp(
    `\\blogs?\\s+(?:nunca|no)\\s+(?:deben|pueden)?\\s*(?:contener|incluir|mostrar|tener)\\b[^.\\n]{0,30}${TERM}`,
    "iu",
  ),
  new RegExp(`\\bnunca\\s+(?:registres|loguees|imprimas|escribas)\\b[^.\\n]{0,40}${TERM}`, "iu"),
];

/** "This project never removes rows", "deleting a user sets its deleted_at", "soft deletes only", "borrado lógico". */
const FORBIDS_HARD_DELETES = [
  /\bnever\s+(?:removes?|deletes?|drops?)\s+(?:any\s+)?(?:rows|records)\b/iu,
  /\bdelet\w*\b[^.\n]{0,40}\bsets?\b[^.\n]{0,30}\bdeleted_at\b/iu,
  /\b(?:only\s+soft[- ]delet\w*|soft[- ]deletes?\s+only)\b/iu,
  /\b(?:never|don't|do not|must not)\s+(?:hard[- ])?(?:delete|remove)\s+(?:any\s+)?(?:rows|records)\b/iu,
  /\bnunca\s+(?:borra|elimina|borramos|eliminamos)\w*\s+(?:filas|registros)\b/iu,
  /\bsolo\s+borrado\s+l[oó]gico\b/iu,
];

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|py|go|rb|java|kt|cs|php|rs|swift)$/iu;

/** A file whose code the log and delete guards read: source, not tests. */
export function isGuardedSource(path: string): boolean {
  return SOURCE_FILE.test(path) && !isTestFile(path);
}

function firstMatching(rules: readonly RuleInForce[], patterns: readonly RegExp[]): RuleInForce | null {
  return rules.find((rule) => patterns.some((pattern) => pattern.test(rule.text))) ?? null;
}

/** Whether a rule a guard reads is in force: the cheap test before any file is read. */
export function guardedKinds(rules: readonly RuleInForce[]): Set<RuleGuardKind> {
  const kinds = new Set<RuleGuardKind>();
  if (firstMatching(rules, FORBIDS_NEW_DEPENDENCIES)) kinds.add("dependency");
  if (firstMatching(rules, FORBIDS_SENSITIVE_LOGS)) kinds.add("sensitive-log");
  if (firstMatching(rules, FORBIDS_HARD_DELETES)) kinds.add("hard-delete");
  return kinds;
}

/**
 * The text of an expression with its string literals emptied; a template literal and a Python f-string keep what they
 * interpolate.
 */
export function withoutStringLiterals(code: string): string {
  let out = "";
  let index = 0;
  /** From just after an opening brace to just after its closing one: what it interpolates. */
  const interpolation = () => {
    let depth = 1;
    let inner = "";
    while (index < code.length && depth > 0) {
      if (code[index] === "{") depth += 1;
      else if (code[index] === "}") depth -= 1;
      if (depth > 0) inner += code[index];
      index += 1;
    }
    return ` ${withoutStringLiterals(inner)} `;
  };
  while (index < code.length) {
    const char = code[index] as string;
    const fString = (char === '"' || char === "'") && /[fF]$/u.test(code.slice(Math.max(0, index - 1), index));
    if (char === '"' || char === "'") {
      index += 1;
      let kept = "";
      while (index < code.length && code[index] !== char) {
        if (code[index] === "\\") index += 2;
        else if (fString && code[index] === "{" && code[index + 1] !== "{") {
          index += 1;
          kept += interpolation();
        } else index += 1;
      }
      index += 1;
      out += `""${kept}`;
    } else if (char === "`") {
      index += 1;
      while (index < code.length && code[index] !== "`") {
        if (code[index] === "\\") index += 2;
        else if (code[index] === "$" && code[index + 1] === "{") {
          index += 2;
          out += interpolation();
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

/** Comments out: `//` and `#` to the end of the line, `/* … *\/` blocks, SQL's `--` lines. */
function withoutComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/gu, "$1")
    .replace(/(^|\s)#(?![!{])[^\n]*/gu, "$1")
    .replace(/(^|\s)--\s[^\n]*/gu, "$1");
}

const LOG_CALL =
  /(?<![.\w$])(?:log|print|printf)\s*\(|\b(?:log|logger|logging|console|Log)\.(?:log|info|warn|warning|error|debug|trace|fatal|Print\w*|Fatal\w*)\s*\(|\bfmt\.Print\w*\s*\(/gu;

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

/** The words of a name: `newEmail` → new, email; `EMAIL_ADDRESS` → email, address. */
function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .split(/[\s_$]+/u)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
}

/** A flag or a count about the value is not the value: `isEmail`, `hasPassword`, `emailCount`. */
const NOT_A_VALUE_FIRST = new Set(["is", "has", "should", "can", "valid", "needs", "show", "with", "no", "num"]);

/** The sensitive names a log call passes: identifiers outside string literals and masking calls, not called. */
function sensitiveNames(call: string): Map<SensitiveTerm, Set<string>> {
  const args = withoutStringLiterals(call.slice(call.indexOf("(")))
    // What a masking call receives is masked: `maskEmail(user.email)`, `redact(token)`.
    .replace(/\b[\w$.]*(?:mask|redact|hash|anonymi[sz]e|obfuscate|censor)\w*\s*\([^()]*\)/giu, " ");
  const found = new Map<SensitiveTerm, Set<string>>();
  for (const match of args.matchAll(/[A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)*/gu)) {
    const chain = match[0].replace(/\s+/gu, "");
    const after = args.slice((match.index ?? 0) + match[0].length).trimStart();
    if (after.startsWith("(")) continue;
    const words = wordsOf(chain.split(/\??\./u).pop() ?? "");
    if (words.length === 0 || (words.length > 1 && NOT_A_VALUE_FIRST.has(words[0] as string))) continue;
    const last = words.at(-1) as string;
    const lastTwo = words.slice(-2).join("");
    for (const term of SENSITIVE) {
      if (term.names.includes(last) || term.names.includes(lastTwo)) {
        const names = found.get(term) ?? new Set<string>();
        names.add(chain);
        found.set(term, names);
      }
    }
  }
  return found;
}

/** Every sensitive name the file's log calls pass, by term. */
function loggedNames(code: string): Map<SensitiveTerm, Set<string>> {
  const all = new Map<SensitiveTerm, Set<string>>();
  for (const call of logCalls(withoutComments(code))) {
    for (const [term, names] of sensitiveNames(call)) {
      const known = all.get(term) ?? new Set<string>();
      for (const name of names) known.add(name);
      all.set(term, known);
    }
  }
  return all;
}

function countDeletes(code: string): number {
  return (withoutComments(code).match(/\bDELETE\s+FROM\b|\bdeleteFrom\s*\(/giu) ?? []).length;
}

/** How the nudge and the verdict quote a rule. */
export function describeRule(rule: RuleInForce): string {
  const text = rule.text.length > 300 ? `${rule.text.slice(0, 299)}…` : rule.text;
  if (rule.origin === "decision") return `decision ${rule.id ?? ""} says: "${text}"`.replace("  ", " ");
  if (rule.origin === "standing-rule") return `your standing rule says: "${text}"`;
  return `the rule you stated says: "${text}"`;
}

/** What the turn added that a recognized rule forbids; empty when nothing does. */
export function ruleViolations(input: RuleGuardInput): RuleViolation[] {
  const violations: RuleViolation[] = [];
  const sources = input.files.filter((file) => SOURCE_FILE.test(file.path) && !isTestFile(file.path));
  const governs = (rule: RuleInForce, path: string) => !rule.scope?.length || inScope(path, rule.scope);

  if (input.addedDependencies.length > 0) {
    const rule = firstMatching(input.rules, FORBIDS_NEW_DEPENDENCIES);
    if (rule) violations.push({ kind: "dependency", rule, detail: `added ${input.addedDependencies.join(", ")}` });
  }

  const logRule = firstMatching(input.rules, FORBIDS_SENSITIVE_LOGS);
  if (logRule) {
    const terms = SENSITIVE.filter((term) => term.words.test(logRule.text));
    const asked = (term: SensitiveTerm) =>
      new RegExp(
        `\\blog(?:s|ged)?\\s+(?:the\\s+|their\\s+|its\\s+)?(?:new\\s+|old\\s+|user'?s?\\s+)?(?:${term.words.source})`,
        "iu",
      ).test(input.request);
    for (const file of sources.filter((candidate) => governs(logRule, candidate.path))) {
      const before = loggedNames(file.before);
      const after = loggedNames(file.after);
      const term = terms.find(
        (candidate) =>
          !asked(candidate) && [...(after.get(candidate) ?? [])].some((name) => !before.get(candidate)?.has(name)),
      );
      if (term) {
        const name = [...(after.get(term) ?? [])].find((candidate) => !before.get(term)?.has(candidate));
        violations.push({ kind: "sensitive-log", rule: logRule, detail: `${file.path} logs ${term.label} (${name})` });
      }
    }
  }

  const deleteRule = firstMatching(input.rules, FORBIDS_HARD_DELETES);
  const hardDeleteAsked =
    /\b(?:permanently|hard)[- ]?delet|\bborr\w*\s+(?:definitivamente|f[ií]sicamente)\b/iu.test(input.request) ||
    /\bDELETE FROM\b/u.test(input.request);
  if (deleteRule && !hardDeleteAsked) {
    for (const file of sources.filter((candidate) => governs(deleteRule, candidate.path))) {
      if (countDeletes(file.after) > countDeletes(file.before)) {
        violations.push({ kind: "hard-delete", rule: deleteRule, detail: `${file.path} adds a DELETE statement` });
      }
    }
  }
  return violations;
}
