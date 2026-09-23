import type { Database } from "bun:sqlite";

export interface User {
  id: number;
  email: string;
  name: string;
}

export function createUser(db: Database, input: { email: string; name: string }): User {
  const row = db
    .query("INSERT INTO users (email, name) VALUES (?, ?) RETURNING id, email, name")
    .get(input.email, input.name) as User;
  return row;
}

export function getUser(db: Database, id: number): User | undefined {
  return (db.query("SELECT id, email, name FROM users WHERE id = ?").get(id) as User | null) ?? undefined;
}
