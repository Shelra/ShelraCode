import { Database } from "bun:sqlite";

/** An in-memory database with the users table and three users. */
export function openDatabase(): Database {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, deleted_at TEXT)",
  );
  const insert = db.prepare("INSERT INTO users (email, name) VALUES (?, ?)");
  insert.run("ada@example.com", "Ada");
  insert.run("grace@example.com", "Grace");
  insert.run("alan@example.com", "Alan");
  return db;
}
