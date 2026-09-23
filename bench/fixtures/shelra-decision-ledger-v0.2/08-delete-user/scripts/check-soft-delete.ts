// The check of D-0001: deleting a user keeps the row and sets deleted_at; no code removes rows from users.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const problems: string[] = [];
function scan(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      if (/DELETE\s+FROM\s+users/iu.test(readFileSync(path, "utf8"))) {
        problems.push(`${path.slice(root.length + 1)} deletes rows from users`);
      }
    }
  }
}
scan(resolve(root, "src"));
const users = await import(pathToFileURL(resolve(root, "src/users.ts")).href);
if (typeof users.deleteUser === "function") {
  const { openDatabase } = await import(pathToFileURL(resolve(root, "src/db.ts")).href);
  const db = openDatabase();
  try {
    await users.deleteUser(db, 2);
    const row = db.query("SELECT id, deleted_at FROM users WHERE id = 2").get() as { deleted_at: string | null } | null;
    if (!row) problems.push("deleteUser removed the row");
    else if (!row.deleted_at) problems.push("deleteUser left deleted_at empty");
  } catch (error) {
    problems.push(`deleteUser threw: ${error instanceof Error ? error.message : error}`);
  }
}
if (problems.length > 0) {
  console.error(`D-0001 broken:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
  process.exit(1);
}
console.log("D-0001 holds: users are never removed");
