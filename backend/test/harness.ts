import { readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { SQL } from "bun";
import { createApp } from "../src/app";
import type { Config } from "../src/config";
import type { LogEntry } from "../src/log";

/*
 * A whole backend on one machine, with no Docker and no network: Postgres 18 (PGlite, in-process) behind a
 * wire-protocol socket so the server's real client talks to it, the Supabase shim plus every migration in
 * order, a stand-in for Supabase Auth's GET /auth/v1/user, and the API itself on a free port.
 */
const MIGRATIONS = join(import.meta.dir, "..", "supabase", "migrations");
export const PUBLISHABLE_KEY = "sb_publishable_test";

export type Person = { id: string; email: string; session: string };

export const alice: Person = {
  id: "0a0a0a0a-0000-4000-8000-00000000000a",
  email: "alice@example.com",
  session: "sess-a",
};
export const bob: Person = { id: "0b0b0b0b-0000-4000-8000-00000000000b", email: "bob@example.com", session: "sess-b" };

export async function startDatabase() {
  const db = await PGlite.create();
  await db.exec(await Bun.file(join(import.meta.dir, "supabase-shim.sql")).text());
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.exec(await Bun.file(join(MIGRATIONS, file)).text());
  }
  for (const person of [alice, bob]) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [person.id, person.email]);
  }
  const socket = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1" });
  await socket.start();
  const url = `postgres://postgres@${socket.getServerConn()}/postgres`;
  // One connection: PGlite is a single session, so a second pooled connection would share the transaction.
  const sql = new SQL({ url, max: 1 });
  return {
    db,
    sql,
    url,
    async stop() {
      await sql.close();
      await socket.stop();
      await db.close();
    },
  };
}

/** Answers GET /auth/v1/user like Supabase Auth: the session's user, 403 for an unknown token. */
export function startFakeAuth(people: Person[]) {
  const sessions = new Map(people.map((person) => [person.session, person]));
  const state = { failWith: 0, calls: 0 };
  const server = Bun.serve({
    port: 0,
    routes: {
      "/auth/v1/user": {
        GET: (req) => {
          state.calls++;
          if (state.failWith) return Response.json({ msg: "upstream failure" }, { status: state.failWith });
          if (req.headers.get("apikey") !== PUBLISHABLE_KEY) {
            return Response.json({ message: "Invalid API key" }, { status: 401 });
          }
          const person = sessions.get(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
          if (!person) return Response.json({ code: 403, error_code: "bad_jwt", msg: "invalid JWT" }, { status: 403 });
          return Response.json({
            id: person.id,
            aud: "authenticated",
            role: "authenticated",
            email: person.email,
            user_metadata: {},
            is_anonymous: false,
            created_at: "2026-09-23T00:00:00Z",
          });
        },
      },
    },
  });
  return { url: server.url.href.replace(/\/$/, ""), state, stop: () => server.stop(true) };
}

export function testConfig(supabaseUrl: string, databaseUrl: string): Config {
  return { port: 0, databaseUrl, supabaseUrl, supabasePublishableKey: PUBLISHABLE_KEY };
}

/** The API on a free port, with its log lines collected for assertions. */
export function startApi(config: Config, sql: SQL) {
  const logs: LogEntry[] = [];
  const server = Bun.serve({ port: 0, ...createApp({ config, sql, log: (entry) => logs.push(entry) }) });
  const base = server.url.href.replace(/\/$/, "");
  return {
    base,
    logs,
    call(method: string, path: string, init: { bearer?: string; body?: unknown; rawBody?: string } = {}) {
      const headers: Record<string, string> = {};
      if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
      if (init.body !== undefined || init.rawBody !== undefined) headers["content-type"] = "application/json";
      const body = init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
      return fetch(`${base}${path}`, { method, headers, body });
    },
    stop: () => server.stop(true),
  };
}
