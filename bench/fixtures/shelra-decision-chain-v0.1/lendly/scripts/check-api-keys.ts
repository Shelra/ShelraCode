// The check of D-0002: every key of every JSON body the API answers is snake_case. It calls every route in
// the route table, reads first and deletions last, with a sample body.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const load = (path: string) => import(pathToFileURL(resolve(process.cwd(), path)).href);
const { openDatabase } = await load("src/db.ts");
const { handle, routes } = await load("src/api/router.ts");

const now = new Date("2026-09-01T10:00:00.000Z");
const db = openDatabase(":memory:");
const sample = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  title: "Dune",
  author: "Frank Herbert",
  isbn: "9780441172719",
  user_id: 1,
  book_id: 1,
};
handle(db, { method: "POST", path: "/users", body: sample }, now);
handle(db, { method: "POST", path: "/books", body: sample }, now);

const problems: string[] = [];
function walk(value: unknown, where: string): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, where);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (!/^[a-z][a-z0-9_]*$/u.test(key)) problems.push(`${where}: "${key}" is not snake_case`);
      walk(item, where);
    }
  }
}

const order = ["GET", "POST", "PUT", "PATCH", "DELETE"];
for (const method of order) {
  for (const route of routes as Array<{ method: string; path: string }>) {
    if (route.method !== method) continue;
    const path = route.path.replace(/:[^/]+/gu, "1");
    walk(handle(db, { method, path, query: {}, body: sample }, now).body, `${method} ${route.path}`);
  }
}

if (problems.length > 0) {
  console.error(`D-0002 broken:\n${[...new Set(problems)].map((problem) => `  ${problem}`).join("\n")}`);
  process.exit(1);
}
console.log("D-0002 holds: every API key is snake_case");
