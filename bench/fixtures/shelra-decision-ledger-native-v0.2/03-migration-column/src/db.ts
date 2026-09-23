import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join(import.meta.dir, "..", "migrations");

/** A database with every migration in migrations/ applied, in file-name order. */
export function openDatabase(path = ":memory:"): Database {
  const db = new Database(path);
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  return db;
}
