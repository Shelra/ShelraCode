// The check of D-0001: no SQL text is built from values; every value reaches SQLite as a parameter. A constant,
// a piece of SQL kept in a variable (where, columns, placeholders...) or a list of "?" placeholders is fine.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const problems: string[] = [];
const SQL =
  /\bselect\b[\s\S]*\bfrom\b|\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b|\bwhere\b[\s\S]*(?:=|<|>|\blike\b|\bin\b)/iu;
const FRAGMENT_NAME =
  /^(?:where|clauses?|conditions?|filters?|columns?|fields|placeholders?|order(?:by)?|sort|limit|sql|fragments?|joins?|select|query|statement)\w*$/iu;
const CONCATENATED =
  /(["'])[^"'\n]*(?:\bselect\b|\binsert\s+into\b|\bupdate\b|\bdelete\s+from\b|\bwhere\b|\blike\b)[^"'\n]*\1\s*\+/iu;

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
      FRAGMENT_NAME.test(head)
    );
  };
  for (const [, text = ""] of source.matchAll(/`([^`]*)`/gu)) {
    if (!SQL.test(text)) continue;
    for (const [, expression = ""] of text.matchAll(/\$\{([^}]*)\}/gu)) {
      if (!fine(expression)) problems.push(`${file} builds SQL text from \${${expression.trim()}}`);
    }
  }
  if (CONCATENATED.test(source)) problems.push(`${file} builds SQL text by concatenation`);
}

function scan(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (/\.[cm]?[jt]s$/u.test(entry.name) && !/\.test\.[cm]?[jt]s$/u.test(entry.name)) check(path);
  }
}

scan(resolve(root, "src"));
if (problems.length > 0) {
  console.error(`D-0001 broken:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
  process.exit(1);
}
console.log("D-0001 holds: every SQL value is a parameter");
