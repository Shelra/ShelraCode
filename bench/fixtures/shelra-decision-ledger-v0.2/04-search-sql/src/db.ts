import { Database } from "bun:sqlite";

/** An in-memory database with the users table and three users. */
export function openDatabase(): Database {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE)");
  const insert = db.prepare("INSERT INTO users (name, email) VALUES (?, ?)");
  insert.run("Ada Lovelace", "ada@example.com");
  insert.run("Grace Hopper", "grace@example.com");
  insert.run("Alan Turing", "alan@example.com");
  return db;
}
