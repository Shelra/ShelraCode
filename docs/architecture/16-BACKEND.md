# 16. Backend, Phase 1 (2026-09-23)

Phase 1 is the smallest server that gives Shelra a correct, secure and evolvable foundation, proven by one
real workflow end to end: **connecting a machine's `shelra` CLI to a ShelraCode account**. It is not "the
backend, done". Code: `backend/` (commands in `backend/README.md`) and `src/account/` in the CLI.

Labels as in doc 15: `CODE` (read in the source), `RUN` (executed for this work), `WEB` (official
documentation, read 2026-09-23), `INFERENCE`.

## 1. What Shelra needed

Before this work (`CODE`, `RUN`):

```
Website (Next.js, Vercel)            CLI `shelra` (Bun, the developer's machine)
  landing, guides                      Agent.processMessage: model steps, tools, gate, memory
  sign-in: Auth.js + libSQL users      ~/.shelra: shelra.db (sessions, messages, tool results,
    (not live: production answers        usage, checkpoints, benchmarks), auth.json (OpenRouter
     503 "AUTH_SECRET is missing")       key), user-settings.json
  /dashboard: demo, every value        <project>/.shelra/memory: project memory
    simulated in the browser           models: OpenRouter (user's key) or local llama.cpp
        |                                   |
        '------------ nothing connects them: no server, no shared account -----------'
```

- The CLI needs nothing from a server to do its work, and it must stay that way (principles 4 and 5 in
  `PRODUCT.md`: any model, private stays possible).
- The website's sign-in was built but never went live, so no real user exists anywhere. Its dashboard
  (missions, usage, API keys, team, billing) is a demo whose `frontend/CLAUDE.md` says "wiring a real API
  means replacing the store's actions".
- The one thing both clients lack, and that every dashboard page depends on, is **an account that the
  website and the CLI both recognize**. That is the Phase 1 slice.

## 2. Boundaries

**Execution plane: the developer's machine (unchanged).** Repository files, edits, shell and tools, the
agent loop, model calls (the user's OpenRouter key or a local model), transcripts, tool output,
checkpoints, benchmarks, and project memory under `.shelra/memory` (it belongs to the repository).
None of it is sent to the backend.

**Control plane: the backend.** Identity (Supabase Auth) and the credentials that bind a machine to an
account (device tokens). Later, only data an account needs across machines, each item justified by a visible
product need (section 9).

**The agent never calls the backend.** Only `shelra login`, `whoami` and `logout` do (`src/index.ts`, dynamic
import of `src/account/commands.ts`), so an unreachable service cannot affect a coding session (the resilience
rule in `AGENTS.md`).

**Clients and Supabase.** Clients (website, CLI) talk to Supabase **only to sign in**, with the publishable
key. All application data goes through the Shelra API, the only holder of the database credential. The rule
is enforced, not just agreed: application tables live in the `shelra` schema, which Supabase's Data API does
not expose (`WEB`: "A custom schema isn't reachable through the Supabase Data API until you expose it").

## 3. Decisions

| Question | Decision | Why (evidence) |
| --- | --- | --- |
| Where | `backend/`, a separate Bun package beside `frontend/` | Same convention as `frontend/`; the CLI compiles to one binary and must not carry a server. Root Vitest and `.npmignore` exclude it. |
| HTTP | `Bun.serve` routes, no framework | Five routes. Bun's router has params and per-method handlers (Bun ≥ 1.2.3, `WEB`); what it lacks (no middleware, issue oven-sh/bun#17608) is one 40-line wrapper (`handle` in `app.ts`) that adds the request id, the error shape and the log line. Hono 4.13 would add a dependency and a second router over Bun's for middleware we have one of; Elysia 1.4 has 2.0 in beta. Revisit when shared middleware passes three concerns or CORS arrives. |
| Validation | zod 4 | Already the CLI's schema library. |
| Database access | Bun's built-in SQL client over `DATABASE_URL`, plain parameterized SQL | No dependency; tagged-template values are bound parameters. Testable against a real Postgres engine without Docker (PGlite 0.5.8, Postgres 18, through `pglite-socket`, `RUN`). supabase-js would need PostgREST (untestable locally without Docker) and a secret key; an ORM buys nothing for one table. |
| Supabase | Postgres, Auth, RLS. Not Storage, Realtime, Edge Functions, the Data API or GraphQL | Nothing in Shelra needs files, live updates or a second server runtime. |
| Keys | Publishable key in clients; **no secret key in the server** | New projects have only `sb_publishable_`/`sb_secret_` keys since November 2025, and the legacy ones are deprecated by the end of 2026 (`WEB`). The server checks sessions with the publishable key and reads data with `DATABASE_URL`. The config refuses a secret key in the publishable slot, and a remote database without `sslmode=require`. |
| Session check | `GET /auth/v1/user` (Supabase Auth itself) | The only check that also rejects a session signed out before its token expired (`WEB`: Supabase's server-side guide says only fetching the user detects a session ended on the server; a local JWT check accepts the unexpired token). Minting a long-lived token is exactly where that matters. JWKS verification (`jose`) can come when the website calls the API often (section 9). |
| Authorization | RLS on every table; the API does a person's work through `asUser()` | `asUser` switches the transaction to Supabase's `authenticated` role with the person's id in the JWT claim settings, what PostgREST does (`WEB`; `postgres` is granted `authenticated` on Supabase). Policies are the one definition of ownership, and queries also filter by user. Tests show RLS alone stops cross-user access when a query forgets the filter (section 7). |
| CLI sign-in | Email code (Supabase OTP), then a **device token** | Works without a browser (over SSH). No Supabase device flow exists (`WEB`), and a browser-and-website flow needs website pages Phase 1 does not own. The CLI keeps no Supabase session (no refresh-token rotation across concurrent processes); it keeps a per-machine token, revocable on its own. |
| Account URL | Only from `--api-url` (stored with the token), never from an environment variable | The CLI loads a project's `.env`; a repository must not be able to redirect a person's sign-in session to another server. |
| Deploy | Not deployed; recommendation in section 8 | Deploying is outward-facing and may cost money: the owner decides. |

## 4. Data model

One table, `shelra.access_tokens` (`backend/supabase/migrations/20260923150000_access_tokens.sql`):

| Column | Why it exists today |
| --- | --- |
| `id` | `shelra logout` revokes by id |
| `user_id` → `auth.users` (cascade) | Whose token it is; deleting the account deletes its tokens |
| `name` | `whoami` shows which machine this is (`shelra on <hostname>` by default) |
| `token_prefix` | `whoami` shows `shr_XXXXXXXX` without the secret |
| `token_hash` (unique) | SHA-256 of the token; the token itself is shown once and never stored |
| `created_at` | `whoami` shows since when |

The account itself is Supabase's `auth.users`: no `profiles` table until Shelra stores something about a
person. Revoking deletes the row. The `authenticated` role may select, insert and delete (own rows, by
policy) and never update. `anon` and `service_role` cannot use the schema.

Not in the database, on purpose: transcripts, tool output, repositories, memory, checkpoints, benchmark
runs, the OpenRouter key. They are large, private and local, and no product need moves them.

## 5. The vertical slice

```
shelra login --api-url <url>
  1. GET  <api>/v1/auth/config                  -> Supabase URL + publishable key
  2. POST <supabase>/auth/v1/otp {email}        -> Supabase emails a 6-digit code (creates the account once)
  3. POST <supabase>/auth/v1/verify {code}      -> short-lived session (memory only)
  4. POST <api>/v1/tokens  Bearer <session>     -> API asks Supabase Auth who this is (GET /auth/v1/user),
                                                   inserts the token hash as that person (RLS), returns
                                                   shr_... once
  5. POST <supabase>/auth/v1/logout             -> the session ends
  6. ~/.shelra/auth.json { account: { apiUrl, token, tokenId, email } }; a previous token is revoked
shelra whoami  -> GET <api>/v1/me  Bearer shr_...   (hash lookup, then auth.users)
shelra logout  -> DELETE <api>/v1/tokens/<id>       (the row is deleted; the token stops working)
```

Rules the API enforces: only a signed-in session creates tokens (a leaked device token cannot mint more,
403); a device token revokes only itself (403); another person's token is `not_found` (404); at most 50 tokens
per account (409).

## 6. API

`GET /health` (the process is up; no dependencies), `GET /v1/auth/config`, `GET /v1/me`, `POST /v1/tokens`,
`DELETE /v1/tokens/:id`. Versioned under `/v1`. A success is the resource as JSON; an error is
`{ "error": { "code", "message", "requestId", "issues"? } }`:

| Code | Status | When |
| --- | --- | --- |
| `invalid_request` | 400 | Body is not JSON or fails its schema (`issues` names each field) |
| `unauthenticated` | 401 | No credential, or one that is invalid, expired, signed out or revoked (`WWW-Authenticate: Bearer`) |
| `forbidden` | 403 | Known caller, action not allowed (device token minting, revoking another machine) |
| `not_found` | 404 | No such route, or no such token in this account (another person's id included) |
| `conflict` | 409 | The account already holds the maximum of tokens |
| `internal` | 500 | Anything unexpected; the client gets only the request id |
| `unavailable` | 503 | Supabase Auth did not answer |

Every response carries `x-request-id`. Every request writes one JSON log line: route, method, status,
duration, user id when known and, for a 5xx, the cause with its stack (connection-string passwords
redacted). Clients see no stack trace in any environment; Bun's development error page is off. Bodies are
capped at 64 KB. No CORS headers: browsers cannot call the API cross-origin until the website needs it.

## 7. Verification (2026-09-23)

| Check | Result |
| --- | --- |
| `bun test` in `backend/` (API, database guarantees, config) on PGlite with a Supabase shim | 32 pass (`RUN`) |
| Mutations: RLS off + API filter removed; API filter removed alone; `asUser` without the role switch; device tokens allowed to mint | 4 fail; 0 fail (RLS alone holds); 4 fail; 1 fail: the tests catch each break (`RUN`) |
| `bunx vitest run src/account/account.test.ts` (CLI login, retries, whoami, logout, errors) | 11 pass (`RUN`) |
| Real Supabase CLI 2.117.0 `db push --db-url` against local Postgres 18 (shim) | Applied, recorded in `supabase_migrations.schema_migrations`, second push "up to date" (`RUN`) |
| Local end to end: real `bun src/index.ts`, real `shelra` CLI with a scratch HOME, Postgres 18, a stand-in for Supabase Auth's four endpoints | login (a wrong code, then the right one), whoami, second login revokes the first token (401), logout, whoami refused; rows hold only 64-character hashes (`RUN`) |
| `SHELRA_BUILD_SKIP_INSTALL=1 bun run build`, then `dist/shelra.exe` | Help lists `login`, `whoami`, `logout`; `whoami` runs (the lazily imported module is bundled); `login` refuses plain http to a remote host (`RUN`) |
| Against a real Supabase project (`bun run check:supabase`) | **Not run: no project exists yet.** It covers what the stand-ins cannot: Supabase's roles and `auth.uid()`, real sessions, the Data API refusing the `shelra` schema |
| Email delivery of the code | **Not verified** (needs a project; built-in email reaches team members only) |

## 8. Deployment (recommendation, not done)

**Railway**, as one long-running service: the code needs no change (a persistent connection pool, graceful
SIGTERM), and the owner already has an account and a logged-in CLI. Settings: root directory `backend`,
start `bun src/index.ts`, health check `/health`, Bun pinned by `packageManager` (Railpack, `WEB`), env
`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (never `SUPABASE_SECRET_KEY`). Railway's outbound
IPv6 is opt-in, so use Supabase's shared pooler in session mode (IPv4) or enable IPv6 for the direct
connection. Railway's config files are deprecated for new services (`WEB`); set these in the dashboard.
Plans: Hobby is $5 a month; the free plan has $1 of credit.

Alternative: **Vercel**, where the website already runs. Its Bun runtime is in beta; since 2026-08-10 it accepts a
`Bun.serve()` entry but runs it as functions. Each instance then needs Supabase's transaction pooler, a pool of one
and `prepare: false`, a small code change.

When deployed: set the CLI's default `--api-url` to the public URL, and only then document the commands in
`README.md`.

## 9. Review and backlog

Review after the build (section 30 of the brief):

- **Removed:** `last_used_at` (nothing read it, and it turned every `whoami` into a write) and soft revocation
  (nothing needed the history). The table went from 8 columns to 6, and the person's role lost update rights.
- **Two sources of truth, one left:** the website's Auth.js + libSQL user store. It holds no users (never
  live), but it must go before anyone signs in there. The handoff is in section 10.
- **Privilege:** the server connects as `postgres` (it bypasses RLS) and drops to `authenticated` for a
  person's work. Two queries run with the full role, both keyed by a verified value: the token lookup and the
  `auth.users` read. A dedicated login role would narrow this (LATER).
- **Known limits:** the token cap counts, then inserts, so two concurrent mints can exceed it by one
  (harmless). An unsupported method on a known path answers 404, not 405 (Bun's router), and an oversized
  body gets Bun's own 413.

| When | Item |
| --- | --- |
| NOW (done) | `backend/` (Bun.serve, SQL, zod), one migration, RLS via `asUser`, the five routes, errors, logs, config checks, tests, the local end-to-end run, the CLI commands, `bun run check:supabase` |
| NEXT (visible need) | 1. Create the Supabase project and run `db:push` and `check:supabase` (owner's project). 2. Website sign-in moves to Supabase Auth and Auth.js/libSQL go (section 10). 3. `GET /v1/tokens` for the dashboard's API keys page. 4. Custom SMTP before anyone outside the team signs in. 5. Deploy (section 8), then the CLI's default URL. |
| LATER (likely, premature) | Opt-in usage sync (the CLI has `usage_events`; the dashboard shows usage), only after a privacy decision. Local JWT verification (JWKS) once the website calls the API per page. A dedicated least-privilege database role. CORS allow-list if the browser calls the API directly. Rate limiting when an unauthenticated endpoint that costs something appears. A CI secret-scanning pattern for `shr_` tokens. |
| NOT YET (avoid) | Remote agent execution ("missions", agents, repos), teams and organizations, billing, integrations, storing transcripts, memory or code, queues, workers, Redis, WebSockets, GraphQL, Edge Functions, microservices, an ORM, a second database. |

## 10. Handoff to the website

The website session owns `frontend/`; this work did not edit it. To join the same accounts:

1. Sign-in moves to Supabase Auth (`@supabase/supabase-js` + `@supabase/ssr`, env
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). GitHub and Google become Supabase
   providers, using the same OAuth apps with Supabase's callback URL. Email sign-in uses the same code emails
   as the CLI (or passwords; Supabase adds the reset flow the current site lacks). Then remove Auth.js,
   `src/lib/users.ts`, `@libsql/client` and the `AUTH_*` variables.
2. Keep the session fresh in Next 16's request hook as `@supabase/ssr` documents (check
   `node_modules/next/dist/docs/`).
3. Call the API from the server (route handlers or server components) with
   `Authorization: Bearer <the user's access token>`. No CORS needed.
4. The API keys page: `GET /v1/tokens` (NEXT) and `DELETE /v1/tokens/:id` replace `lib/demo` for keys.
