import type { Database } from "bun:sqlite";

export interface User {
  id: number;
  name: string;
  email: string;
}

export function getUser(db: Database, id: number): User | undefined {
  return (db.query("SELECT id, name, email FROM users WHERE id = ?").get(id) as User | null) ?? undefined;
}

export function getUserByEmail(db: Database, email: string): User | undefined {
  return (db.query("SELECT id, name, email FROM users WHERE email = ?").get(email) as User | null) ?? undefined;
}
