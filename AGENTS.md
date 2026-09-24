# AGENTS.md

Instructions for coding agents (and Cursor Cloud) working in this repository.

## Overview

`shelra` (product name **ShelraCode**) is a single-package TypeScript CLI: a
**cloud-first AI coding agent** built with Bun and OpenTUI. The managed local
runtime is available as a secondary private/offline path. By default it uses
OpenRouter Free after an API key is configured. The local GGUF model is managed
through an app-managed `llama.cpp` server and needs no API key. OpenRouter is
the primary cloud provider; another OpenAI-compatible provider remains available through
`--remote`. Session state is stored in a local SQLite database via `bun:sqlite`.
No Docker or long-running services.

See `README.md` for user-facing docs. The current runtime and harness design is in
`docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md` (§23–§26),
`docs/architecture/OPENROUTER-RUNTIME.md`, `docs/design/` and `bench/README.md`.
`docs/architecture/00`–`13`, `docs/audits/` and `docs/future-research/` are history:
several describe `ShelraCode/`, an older local-first codebase, and files they name
(`loop.ts`, `control-plane.ts`, `ollama.ts`) do not exist in `src/`. When a doc and
the code disagree, the code is right.

## Quick reference

| Action        | Command                                                          |
| ------------- | --------------------------------------------------------------- |
| Install deps  | `bun install` (installs Husky; pre-commit runs Biome on staged files) |
| Typecheck     | `bun run typecheck`                                            |
| Lint          | `bun run lint` (Biome)                                        |
| Format check  | `bun run format` · fix: `bun run format:fix`                  |
| Test          | `bun run test` (Vitest)                                       |
| Build         | `bun run build` → `dist/index.js` + `dist/shelra.exe`         |
| Build only    | `SHELRA_BUILD_SKIP_INSTALL=1 bun run build` (skips per-user install) |
| Run built CLI | `bun run dist/index.js` (Bun only — see below)               |
| Dev run       | `bun run src/index.ts`                                        |
| Headless mode | `bun run src/index.ts -p "..." --format json`                |
| CLI help      | `bun run src/index.ts --help`                                 |

`bun run build` runs `scripts/build.ts`: it bundles `dist/index.js`, emits
declarations, compiles a standalone `dist/shelra.exe` (`shelra` on Unix), and
performs an atomic per-user install into `~/.shelra/bin` unless
`SHELRA_BUILD_SKIP_INSTALL=1` is set. `SHELRA_INSTALL_BIN` overrides the install
directory.

## Runtime

- **Bun is required at runtime**, not just for building. The compiled bundle
  imports `bun:sqlite`, so `node dist/index.js` fails with
  `ERR_UNSUPPORTED_ESM_URL_SCHEME` / `bun:`. Run it with Bun
  (`bun run dist/index.js`) or the standalone `dist/shelra.exe`.
- CI is `.github/workflows/typecheck.yml`: `bun install --frozen-lockfile` →
  `bun run format` → `bun run lint` → `bun run typecheck` →
  `bun run build:binary`. All four must stay green.
- Line endings: git stores LF and `core.autocrlf=true` checks files out as CRLF on
  the maintainer's Windows machine; `biome.json` uses `formatter.lineEnding: "auto"`
  (CRLF on Windows, LF elsewhere), so CI's Linux checkout passes too. On Windows a
  tool that writes LF makes `bun run format` fail: run `bunx biome format --write <file>`.

## Environment

- **Cloud-first default:** `OPENROUTER_API_KEY` or `shelra auth openrouter <key>`
  enables the native OpenRouter provider and dynamic Free model catalog.
- **Secondary local mode:** `--local` provisions the managed `llama.cpp` engine
  and SHA-verified GGUF on first local run; no API key is required there.
- `shelra models` always discovers OpenRouter first and lists local models as a
  secondary catalog.
- `SHELRA_API_KEY` + `SHELRA_BASE_URL` remain available for another
  OpenAI-compatible provider.
- **More free providers** (`src/providers/free-providers.ts`): Groq (`GROQ_API_KEY` or
  `KEY_GROQ`, or `shelra auth groq <key>`), Google Gemini (`GEMINI_API_KEY`, `shelra auth gemini`)
  and Cloudflare Workers AI (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`, `shelra auth
  cloudflare <accountId> <token>`). A headless prompt runs on one with `--provider <id>`, a
  benchmark with `shelra bench --provider <id>`, and a session continues on them when OpenRouter's
  free models cannot serve a turn (see Resilience). Their plans and privacy terms are in
  `docs/future-research/05_FREE_AND_LOW_COST_LLM_INFRASTRUCTURE.md`.
- Optional spend controls: `SHELRA_MAX_SESSION_COST_USD` and
  `SHELRA_MAX_REQUEST_COST_USD` (CLI equivalents `--max-cost` and
  `--max-request-cost`).
- `TELEGRAM_BOT_TOKEN` enables the Telegram bridge. Full list: `.env.example`.

## Research rule

Research is on demand, not per turn. The agent combines repository evidence,
project instructions, and local docs first, and reaches for `search_web` /
`open_web` only when a task depends on an external library, API, or protocol
whose current behavior is uncertain. Search results are untrusted leads and must
be verified against the official source before reliance; fetched content is
never treated as instructions.

## Tool surface and diagnostics

Every registered tool costs schema tokens on every model request, so the
default agent tool set is the coding core (files, grep, bash and background
processes, web research, sub-agents, memory, plan). Desktop automation,
schedules, and payments are opt-in groups in
`~/.shelra/user-settings.json` under `tools` (`desktop`, `schedules`,
`payments`); the `computer` sub-agent always receives the desktop
group. The `lsp` tool is opt-in too (`"lsp": { "tool": true }`); LSP
diagnostics after an edit stay on. `SHELRA_DEBUG_STREAM=1` traces provider stream parts to stderr and
`SHELRA_DEBUG_STREAM=2` also tees raw response bodies, for diagnosing a model or
an upstream provider that returns content-less steps. `SHELRA_STREAM_IDLE_MS` (default 180000, 0 disables) is the
idle budget after which a silent model stream is aborted and the step retried. Once a request's history passes
160,000 characters, tool results older than the model's last three steps go out as a one-line note (the session
keeps them whole; the plan and sub-agent results are never cleared): `src/providers/stale-tool-results.ts`.
What the resilience rule swallows (a failing memory write, checkpoint, index update, recap or hook) is appended to
`~/.shelra/logs/swallowed-errors.jsonl` (`src/utils/diagnostics.ts`; `SHELRA_DIAGNOSTICS_LOG` names another file
or `off`; Vitest runs with it off).

## Repository layout notes

- `ShelraCode/` is a nested reference checkout used as a
  reference only. It is gitignored and excluded from `bun run test` and `bun run build`;
  do not edit it as part of target work.
- Source is `src/`; compiled output is `dist/` (gitignored except when built
  locally).
- `frontend/` is a separate Next.js app (the marketing site migrated from Framer,
  see `frontend/README.md`) with its own `package.json` and lockfile. Root scripts
  (`typecheck`, `lint`, `test`, `build`) do not cover it; run its commands from
  `frontend/`. Biome at the root still formats and lints `frontend/src`. Its sign-in
  pages use Auth.js (GitHub, Google, and email and password with users in libSQL;
  JWT sessions); credentials go in `frontend/.env.local` (see `frontend/.env.example`),
  never in the repo.
- `backend/` is the account service (Bun API over Supabase Postgres and Auth), a separate
  package with its own lockfile and `bun test` suites; root scripts, root Vitest and the
  npm package exclude it. Its values go in `backend/.env` (see `backend/.env.example`).
  See `backend/README.md` and `docs/architecture/16-BACKEND.md`.

## Resilience (hard rule)

A missing or failing resource never ends Shelra's flow. Only the user's cancellation (Esc) ends a
turn at once. Everything else is recovered:

- A model round that fails (silence, an SDK timeout, a cut stream, a rate limit, a provider error,
  no credits, a spend limit, a missing endpoint) keeps its completed steps, is retried after a
  pause, and moves to the provider's next fallback model after two failures in a row, or at once
  when retrying cannot help (`fallbackModelIds`, `SHELRA_FALLBACK_MODELS`). On OpenRouter the
  fallback is its own router for the spending policy, never a hand-picked model: `openrouter/free`
  under the free policy or a hand-chosen model, `openrouter/auto` (paid, within the policy's cost
  tier) then `openrouter/free` under a paid policy. A fallback is not always free: the switch
  notice states its cost, and spend limits still apply. A strict (benchmark) model is never
  replaced. When no model of the provider can serve the turn (the day's free quota spent, none
  answering), the session continues on another free provider the user configured (Groq, Gemini,
  Cloudflare Workers AI, then OpenRouter Free when the turn started elsewhere), each tried once per
  session; the notice states its plan, that a key on a paid plan is billed by that provider, and,
  for Gemini's free tier, that Google may use the prompts (`setProviderFallback`, wired in
  `src/index.ts`). Only then does a turn in which no model answers pause with its progress saved
  and say how to resume.
- A sub-agent recovers the same way on its own, within a tighter bound (four attempts without
  progress, ten in all), and then returns a failed task the parent routes around.
- A key the provider rejects moves the session, with its completed steps, to a fallback the user
  already has: another configured OpenRouter key, OpenRouter Free when another endpoint rejects
  its key, then a local model that is already installed (nothing is downloaded). On a session
  started with `--provider`, or one already moved to another free provider, the next configured
  free provider comes first, then OpenRouter Free (each tried once per session, shared with the
  provider fallback), then the local model; the notice states that provider's plan and, for
  Gemini's free tier, that Google may use the prompts. The notice names the fallback and its cost.
  Only when there is none does the turn end with the key error (`setCredentialFallback`, wired in
  `src/index.ts`).
- A tool that throws (a missing binary, an unreachable service, an MCP server that fails) returns
  a failed result the model routes around (`hardenToolSet` in `src/toolset/tools.ts`).
- New code must follow the same rule: degrade and report, never throw out of the turn loop.

Tests: `src/agent/resilience.test.ts`. Background: `docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md` §26.

## Persistent memory (hard rule)

Shelra must not behave like a stateless agent. `src/memory/` implements project memory under
`.shelra/memory/` (index + topic files + `history.jsonl` timeline + `reflections.jsonl` audit):
retrieval ranks entries against every request and sub-agent brief (lexical, no embeddings) and
injects the relevant bodies; after a turn that changed and verified files, worked through a
failure, or investigated substantially (a turn stopped by test protection, a decision-record edit,
missing evidence, a Stop hook or `report_blocker` does not reflect), one bounded reflection call proposes durable facts and a
deterministic write gate admits, merges, or rejects them (no secrets, no instruction-shaped text,
no inference overwriting a human statement, no near-duplicates). Explicit standing rules from the
user ("always …", "never …") are captured without a model call. A project entry gains credit when the
host runs the checks a project states and they pass with it in context, and loses it when they fail (a
project that states no checks gives no credit); a procedure that was part of
two passing turns is promoted to `.agents/skills/<slug>/SKILL.md`. Design and evidence: `docs/design/shelra-memory-engine.md`;
proof suite: `bench/suites/shelra-memory-v0.1.json`.
