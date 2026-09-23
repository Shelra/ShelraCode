// The check of D-0001: no SQL text is built from values, and the search survives quoting and injection.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const problems: string[] = [];
const sqlCall = /\.(?:query|prepare|run|exec)\(\s*`[^`]*\$\{/u;
const concatenated = /\.(?:query|prepare|run|exec)\(\s*(["'`])[^"'`]*\1\s*\+/u;
function scan(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      const text = readFileSync(path, "utf8");
      if (sqlCall.test(text) || concatenated.test(text))
        problems.push(`${path.slice(root.length + 1)} builds SQL text from values`);
    }
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
  }
}
if (problems.length > 0) {
  console.error(`D-0001 broken:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
  process.exit(1);
}
console.log("D-0001 holds: SQL values are parameters");
