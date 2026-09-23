import type { Database } from "bun:sqlite";
import type { User } from "../domain";

interface UserRow {
  id: number;
  name: string;
  email: string;
  created_at: string;
}

function toUser(row: UserRow): User {
  return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at };
}

export function listUsers(db: Database): User[] {
  return (db.query("SELECT id, name, email, created_at FROM users ORDER BY id").all() as UserRow[]).map(toUser);
}

export function getUser(db: Database, id: number): User | undefined {
  const row = db.query("SELECT id, name, email, created_at FROM users WHERE id = ?").get(id) as UserRow | null;
  return row ? toUser(row) : undefined;
}

export function findUserByEmail(db: Database, email: string): User | undefined {
  const row = db.query("SELECT id, name, email, created_at FROM users WHERE email = ?").get(email) as UserRow | null;
  return row ? toUser(row) : undefined;
}

export function createUser(db: Database, name: string, email: string, now: Date): User {
  const row = db
    .query("INSERT INTO users (name, email, created_at) VALUES (?, ?, ?) RETURNING id, name, email, created_at")
    .get(name, email, now.toISOString()) as UserRow;
  return toUser(row);
}
