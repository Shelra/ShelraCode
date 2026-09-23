# Shelra backend

The account service: a Bun HTTP API in front of Supabase (Postgres and Auth). In Phase 1 it knows accounts and
the device tokens that connect a machine's `shelra` CLI to an account (`shelra login`, `whoami`, `logout`).
The CLI and the agent keep working without it. Why it looks like this, the boundaries and the backlog:
[docs/architecture/16-BACKEND.md](../docs/architecture/16-BACKEND.md).

Not deployed yet.

## Layout

| Path | What |
| --- | --- |
| `src/index.ts` | Entry: validate env, check the database, serve, close on SIGTERM |
| `src/app.ts` | Routes (`Bun.serve` router), the per-request wrapper (request id, errors, log line) |
| `src/identity.ts` | Who is calling: a Supabase session (checked by Supabase Auth) or a device token |
| `src/db.ts` | Postgres client; `asUser()` runs work as the person, under row-level security |
| `src/http.ts`, `src/log.ts`, `src/config.ts`, `src/tokens.ts` | Error shape, JSON logs, env validation, token primitives |
| `supabase/migrations/` | The schema, applied with the Supabase CLI |
| `supabase/config.toml`, `supabase/templates/` | Auth settings Shelra depends on (email code length, expiry, templates) |
| `test/` | `bun test` suites on PGlite (Postgres 18 in-process, no Docker) with a Supabase shim |
| `scripts/check-supabase.ts` | End-to-end check against the real Supabase project |

## Commands (from `backend/`)

| Action | Command |
| --- | --- |
| Install | `bun install` (Bun 1.4 or later) |
| Run locally | `bun run dev` (needs `.env`, see `.env.example`) |
| Tests | `bun test` |
| Type check | `bun run typecheck` |
| Lint and format (from the repo root) | `bunx biome check backend` |
| Apply migrations | `bun run db:push` |
| Check against the real project | `bun run check:supabase` |

## Setting up a Supabase project

1. Create a project (the free plan is enough). New projects only have publishable (`sb_publishable_...`) and
   secret (`sb_secret_...`) keys.
2. Copy `.env.example` to `.env` and fill it from the dashboard: `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`
   (Project Settings → API Keys) and `DATABASE_URL` (Connect → direct connection on an IPv6 host, or the
   shared pooler in **session** mode on an IPv4-only host), ending in `?sslmode=require`. A password with
   special characters must be percent-encoded.
3. `bun run db:push` applies `supabase/migrations/` (Supabase CLI through `bunx`, no Docker, no linking) and
   records them in `supabase_migrations.schema_migrations`.
4. Auth email settings, once: `bunx supabase@2.117.0 login`, `bunx supabase@2.117.0 link --project-ref <ref>
   --workdir .`, then `bunx supabase@2.117.0 config diff --workdir .` and `config push --workdir .`. The file
   declares only the email code settings and templates; `config push` changes nothing else. Pasting
   `supabase/templates/sign-in-code.html` into the dashboard's "Confirm signup" and "Magic Link" templates does
   the same.
5. Supabase's built-in email only reaches members of the project's team, 2 messages an hour. Anyone else needs
   custom SMTP (dashboard → Authentication → SMTP).

## Trying the whole flow

With the server running (`bun run dev`), from the repository root (an installed `shelra` built before these
commands existed does not have them):

```sh
bun run src/index.ts login --api-url http://localhost:3001   # asks for the email, then the code
bun run src/index.ts whoami
bun run src/index.ts logout
```

`bun run check:supabase` does the same against the real project without sending an email (it creates and
deletes a throwaway account with `SUPABASE_SECRET_KEY`, which only this check reads). Add
`--login-email <your team address>` to also run the real `shelra login`, which emails you a code.

## Rules

- The server never holds a Supabase secret key. `DATABASE_URL` is its only privileged credential, and it
  never leaves the server.
- Every table lives in the `shelra` schema (not exposed to Supabase's Data API), has row-level security,
  and is changed only by a migration. Work done for a person goes through `asUser()`.
- Clients (website, CLI) talk to Supabase only to sign in; all application data goes through this API.
- Schema changes: add a new file in `supabase/migrations/` (`<UTC timestamp>_<name>.sql`), never edit one that
  has been pushed.
