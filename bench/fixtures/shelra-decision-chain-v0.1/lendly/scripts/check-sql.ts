// The check of D-0001: no SQL text is built from values; every value reaches SQLite as a parameter. A constant,
// a piece of SQL kept in a variable (where, columns, placeholders, a table name...), a choice between two
// literals or a list of "?" placeholders is fine. Then the API is exercised with a marker value, and the text
// of every statement it ran must be free of it: the net under the reading of the source.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const problems: string[] = [];
const SQL =
  /\bselect\b[\s\S]*\bfrom\b|\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b|\bwhere\b[\s\S]*(?:=|<|>|\blike\b|\bin\b)/iu;
const FRAGMENT_NAME =
  /^(?:where|clauses?|conditions?|filters?|columns?|fields|placeholders?|order(?:by)?|sort|limit|sql|fragments?|joins?|select|query|statement|tables?)\w*$/iu;
/** A choice between two literals, `flag ? "" : " WHERE ..."`, with or without parentheses: still a constant. */
const LITERAL_CHOICE =
  /^\(?\s*!?[\w$.]+\s*\?\s*(?:"[^"\n]*"|'[^'\n]*'|`[^`$]*`)\s*:\s*(?:"[^"\n]*"|'[^'\n]*'|`[^`$]*`)\s*\)?$/u;
/**
 * A quoted SQL fragment followed by `+`, and the expression joined to it: another literal, a template, a
 * parenthesized group or a name. Two literals joined with `+` are only a long constant; anything else is
 * judged like a template's `${}`.
 */
const CONCATENATION =
  /(?:"(?:[^"\\\n]|\\.)*(?:\bselect\b|\binsert\s+into\b|\bupdate\b|\bdelete\s+from\b|\bwhere\b|\blike\b)(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*(?:\bselect\b|\binsert\s+into\b|\bupdate\b|\bdelete\s+from\b|\bwhere\b|\blike\b)(?:[^'\\\n]|\\.)*')\s*\+\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`|\((?:[^()\n]|\([^()\n]*\))*\)|[\w$.]+)?/giu;

function check(path: string): void {
  const source = readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gmu, "$1");
  const file = relative(root, path);
  const constants = new Set(
    [...source.matchAll(/\bconst\s+(\w+)\s*=\s*(?:"[^"\n]*"|'[^'\n]*'|`[^`$]*`)\s*;/gu)].map(([, name]) => name),
  );
  const fine = (expression: string) => {
    const trimmed = expression.trim();
    const head = /^[\w$]+/u.exec(trimmed)?.[0] ?? "";
    return (
      /^[A-Z][A-Z0-9_]*$/u.test(trimmed) ||
      /["']\?["']/u.test(trimmed) ||
      constants.has(trimmed) ||
      FRAGMENT_NAME.test(head) ||
      LITERAL_CHOICE.test(trimmed)
    );
  };
  const holes = (template: string) => {
    for (const [, expression = ""] of template.matchAll(/\$\{([^}]*)\}/gu)) {
      if (!fine(expression)) problems.push(`${file} builds SQL text from \${${expression.trim()}}`);
    }
  };
  for (const [, text = ""] of source.matchAll(/`([^`]*)`/gu)) if (SQL.test(text)) holes(text);
  for (const [, operand] of source.matchAll(CONCATENATION)) {
    if (operand === undefined) problems.push(`${file} builds SQL text by concatenation`);
    else if (operand.startsWith("`")) holes(operand);
    else if (!/^["']/u.test(operand) && !fine(operand)) {
      problems.push(`${file} builds SQL text by concatenation with ${operand}`);
    }
  }
}

function scan(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (/\.[cm]?[jt]s$/u.test(entry.name) && !/\.test\.[cm]?[jt]s$/u.test(entry.name)) check(path);
  }
}

scan(resolve(root, "src"));

// What the code actually sends to SQLite: a marker travels through every route the API has, in bodies, a
// query and a path, and may not appear in the text of any statement, however the text was assembled and
// however well its quotes were escaped.
const MARKER = "zq7x";
const load = (path: string) => import(pathToFileURL(resolve(root, path)).href);
try {
  const { openDatabase } = await load("src/db.ts");
  const { handle } = await load("src/api/router.ts");
  const db = openDatabase(":memory:");
  const statements: string[] = [];
  for (const method of ["query", "prepare", "run", "exec"]) {
    const original = db[method];
    if (typeof original !== "function") continue;
    db[method] = (text: unknown, ...rest: unknown[]) => {
      if (typeof text === "string") statements.push(text);
      return original.call(db, text, ...rest);
    };
  }
  const now = new Date("2026-09-01T10:00:00.000Z");
  const call = (method: string, path: string, body?: unknown, query?: Record<string, string>) => {
    try {
      const response = handle(db, { method, path, ...(query ? { query } : {}), ...(body ? { body } : {}) }, now);
      return (response?.body ?? {}) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const user = Number(call("POST", "/users", { name: `${MARKER} Probe`, email: `${MARKER}@example.com` }).id) || 1;
  const book = Number(call("POST", "/books", { title: MARKER, author: MARKER, isbn: "9780306406157" }).id) || 1;
  for (const path of ["/users", `/users/${user}`, "/books", `/books/${book}`, "/loans/overdue", "/loans/export.csv"]) {
    call("GET", path);
  }
  call("GET", "/books", undefined, { q: MARKER });
  call("POST", "/loans", { user_id: user, book_id: book, userId: user, bookId: book });
  call("POST", "/loans/1/return");
  const email = `${MARKER}.new@example.com`;
  call("PUT", `/users/${user}/email`, { email, new_email: email, newEmail: email });
  call("DELETE", `/users/${user}`);
  call("POST", "/admin/cleanup");
  const leaked = statements.find((text) => text.toLowerCase().includes(MARKER));
  if (leaked) problems.push(`the SQL text holds a value the API received: ${JSON.stringify(leaked)}`);
} catch (error) {
  problems.push(`the API could not be exercised: ${error instanceof Error ? error.message : String(error)}`);
}

if (problems.length > 0) {
  console.error(`D-0001 broken:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
  process.exit(1);
}
console.log("D-0001 holds: every SQL value is a parameter");
