// The check of D-0001: no SQL text is built from values, wherever the text is assembled, and the search
// survives quoting and injection. A constant, a piece of SQL kept in a variable (where, columns,
// placeholders, a table name...), a choice between two literals or a list of "?" placeholders is fine. Then
// the searched text must travel as a parameter: it may not appear in the text of any statement.
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

const usersPath = resolve(root, "src/users.ts");
if (existsSync(usersPath)) {
  const users = await import(pathToFileURL(usersPath).href);
  const { openDatabase } = await import(pathToFileURL(resolve(root, "src/db.ts")).href);
  if (typeof users.searchUsers === "function") {
    for (const input of ["' OR 1=1 --", "'", "a'b", '"; DROP TABLE users; --']) {
      try {
        const found = users.searchUsers(openDatabase(), input);
        if (!Array.isArray(found) || found.length > 0) {
          problems.push(`searchUsers(${JSON.stringify(input)}) returned ${JSON.stringify(found)}, expected []`);
        }
      } catch (error) {
        problems.push(`searchUsers(${JSON.stringify(input)}) threw: ${error instanceof Error ? error.message : error}`);
      }
    }
    // What the code actually sends to SQLite: the searched text may not appear in the text of any statement,
    // however the text was assembled and however well its quotes were escaped.
    const db = openDatabase();
    const statements: string[] = [];
    for (const method of ["query", "prepare", "run", "exec"]) {
      const original = db[method];
      if (typeof original !== "function") continue;
      db[method] = (text: unknown, ...rest: unknown[]) => {
        if (typeof text === "string") statements.push(text);
        return original.call(db, text, ...rest);
      };
    }
    try {
      users.searchUsers(db, "zq7x");
      const leaked = statements.find((text) => text.toLowerCase().includes("zq7x"));
      if (leaked) problems.push(`the searched text went into the SQL text: ${JSON.stringify(leaked)}`);
    } catch (error) {
      problems.push(`searchUsers("zq7x") threw: ${error instanceof Error ? error.message : error}`);
    }
  }
}
if (problems.length > 0) {
  console.error(`D-0001 broken:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
  process.exit(1);
}
console.log("D-0001 holds: SQL values are parameters");
