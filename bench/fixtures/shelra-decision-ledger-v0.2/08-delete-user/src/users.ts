import type { Database } from "bun:sqlite";

export interface User {
  id: number;
  email: string;
  name: string;
}

export function getUser(db: Database, id: number): User | undefined {
  return (
    (db.query("SELECT id, email, name FROM users WHERE id = ? AND deleted_at IS NULL").get(id) as User | null) ??
    undefined
  );
}

export function listUsers(db: Database): User[] {
  return db.query("SELECT id, email, name FROM users WHERE deleted_at IS NULL ORDER BY id").all() as User[];
}
