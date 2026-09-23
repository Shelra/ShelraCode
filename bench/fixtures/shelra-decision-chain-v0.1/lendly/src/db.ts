import { Database } from "bun:sqlite";

const TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    isbn TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
];

/** Opens the library's database and creates its tables: in memory unless a file is given. */
export function openDatabase(path = ":memory:"): Database {
  const db = new Database(path);
  db.run("PRAGMA foreign_keys = ON");
  for (const table of TABLES) db.run(table);
  return db;
}
