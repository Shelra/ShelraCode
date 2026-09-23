import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type { Client } from "@libsql/client";

/*
 * The users of email + password sign-in, kept in a libSQL database: a local
 * file in development (`.data/auth.db`) and any libSQL/Turso URL in production
 * (AUTH_DATABASE_URL + AUTH_DATABASE_TOKEN). Only the email, the name and an
 * scrypt hash of the password are stored. Server-side only.
 *
 * A `file:` URL needs the native `libsql` binding, so that client is loaded
 * only then; a remote URL uses the fetch-based web client, which runs on
 * serverless hosts (Vercel) without any native module.
 */
export type StoredUser = { id: string; email: string; name: string | null; passwordHash: string };

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const defaultUrl = "file:./.data/auth.db";

// Without a database URL, email sign-in only works in development (local file).
export function passwordAuthAvailable(): boolean {
  return Boolean(process.env.AUTH_DATABASE_URL) || process.env.NODE_ENV === "development";
}

let client: Promise<Client> | null = null;
let ready: Promise<void> | null = null;

function db(): Promise<Client> {
  if (!client) {
    const url = process.env.AUTH_DATABASE_URL ?? defaultUrl;
    const authToken = process.env.AUTH_DATABASE_TOKEN;
    if (url.startsWith("file:")) {
      mkdirSync(dirname(url.slice("file:".length)), { recursive: true });
      client = import("@libsql/client").then((mod) => mod.createClient({ url }));
    } else {
      client = import("@libsql/client/web").then((mod) => mod.createClient({ url, authToken }));
    }
  }
  return client;
}

function schema(): Promise<void> {
  ready ??= db()
    .then((c) =>
      c.execute(
        `CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          name TEXT,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`,
      ),
    )
    .then(() => undefined);
  return ready;
}

export function normalizeEmail(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function findUserByEmail(email: string): Promise<StoredUser | null> {
  await schema();
  const result = await (await db()).execute({
    sql: "SELECT id, email, name, password_hash FROM users WHERE email = ?",
    args: [email],
  });
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    name: row.name == null ? null : String(row.name),
    passwordHash: String(row.password_hash),
  };
}

export async function createUser(input: { email: string; name: string | null; password: string }): Promise<StoredUser> {
  await schema();
  const user = {
    id: randomUUID(),
    email: input.email,
    name: input.name,
    passwordHash: await hashPassword(input.password),
  };
  await (await db()).execute({
    sql: "INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)",
    args: [user.id, user.email, user.name, user.passwordHash],
  });
  return user;
}

// scrypt (Node's built-in); the random salt travels with the hash.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
