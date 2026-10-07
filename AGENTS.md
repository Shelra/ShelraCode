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
  benchmark with `shelra bench --provider <id>`. They are providers of the routing layer like any
  other (see "Providers and routing"); their free plans stop at a quota and bill a key on a billed
  account, so Free mode uses them only after `shelra providers allow-free <id>`.
  Their plans and privacy terms are in `docs/future-research/05_FREE_AND_LOW_COST_LLM_INFRASTRUCTURE.md`.
- **OmniRoute** (`shelra auth omniroute <key>`, or `/config`): OmniRoute has no public hosted API, so the default is
  Shelra's own instance (`OMNIROUTE_PRODUCTION_URL` in `src/product/identity.ts`, Railway service `omniroute`, a key
  required on every call) and the person gives only the key. A gateway the user runs themselves is reached with
  `OMNIROUTE_BASE_URL` or `--url`, and wins over the default; Shelra never installs, starts or probes one. Its aliases are never Free candidates (its free filters
  fail open); a concrete model is, once the user vouches for it by name. Design: doc 22.
- Optional spend controls: `SHELRA_MAX_SESSION_COST_USD` and
  `SHELRA_MAX_REQUEST_COST_USD` (CLI equivalents `--max-cost` and
  `--max-request-cost`).
- `TELEGRAM_BOT_TOKEN` enables the Telegram bridge. Full list: `.env.example`.

## Research rule

Initial web research is requested, not mandatory (owner, 2026-10-05, replacing the 2026-09-25 rule): ordinary
messages start with local context. Only an explicit request to search the web or consult external documentation
runs a host search before the first model round (`src/research/pre-task.ts`). Local file searches, project checks,
and inspecting Revit or an add-in do not trigger it. The search is bounded to 10 s and a failed search leaves the
turn as it was. Results are JSON-encoded data in a tool result, never in the system prompt; instruction-shaped
results are withheld. `SHELRA_RESEARCH=off` or `--ablate research` turns initial research off.
The model still reaches for `search_web` / `open_web` on its own when a task depends on an external
library, API, or protocol. Search results are untrusted leads and must be verified against the official source before
reliance; fetched content is never treated as instructions.
A request to check, fix, continue or test a project that states its checks has them run by the
host on the code as the turn found it (`src/agent/pre-work.ts`), handed to the model as the result of its own `bash`
run and counted as the runs before the turn's first change. A failed check does not force a web search;
when research was explicitly requested, the search can use the error the checks report.
`--ablate diagnose` turns the check run off; the
benchmark does not count the host's calls as the model's (`isHostCall`).

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
160,000 characters, tool results older than the model's last three steps go out as a one-line note, and so does
the text of an older file write or edit, since the file is on disk (the session keeps them whole; the plan and
sub-agent results are never cleared): `src/providers/stale-tool-results.ts`.
A generation that stops making progress is ended: six steps that only repeat earlier calls with the same results
(`isRepeatingToolLoop`), or twelve that only read, search or run commands and return no word the generation had not
seen (`createStallDetector`, `src/providers/stream.ts`). So is a turn going in circles, counted across its rounds:
edits that flip a file between the same two versions twice (whitespace aside), or a check that fails the same way
four runs in a row while files change between them (`createCircleDetector`, `src/agent/circles.ts`, passed to the
provider as `hostStops`). Once per turn the model is told why, naming the file and versions or the check and its
error, and may take another way or report; a second stop goes on to the completion gate. The step in which the model
calls `report_blocker` ends the generation too, and the turn ends `[Stopped — reason]` (seen 2026-10-03: a model
reported that a request broke the user's offline rule, then installed a dependency in the same generation).
Three kinds of project rule hold whatever the model does, when an active decision (within its scope), one of the
user's standing rules or a standing rule the request states ("from now on…", "that is a rule for the whole project")
says so in words the host recognizes (English or Spanish; `src/contract/rule-guards.ts`): no new dependencies (a name
the manifests, root and workspace packages, did not declare when the turn started; `src/contract/dependency-guard.ts`),
nothing sensitive in logs (a log call newly passing a value named for an email, password, token, secret or phone,
outside string literals and masking calls) and no hard deletes (a new `DELETE FROM` outside comments). The raw request
is never a rule: a bug report would block the fix it asks for. A turn that broke one is sent back once, then reported
`[Not verified — …]` naming the rule and where it comes from, as test protection does. The request wins only when it
asks in so many words ("install date-fns", "log the new email", "permanently delete"), or approves what the previous
answer proposed; naming a package as a suggestion is not permission. A file whose state before the turn is unknown
(uncommitted edits, no git) is not judged.
A request that states three or more behaviors gets an independent check once the turn's checks pass
(`src/agent/behavior-verifier.ts`): a sub-agent on the same model, given only the request and the names of the changed
files, writes one test file under `.shelra/verify/` from the request alone, and the host runs it itself (a known
runner on exactly that file, nothing chained). A pass joins the `[Checked by Shelra …]` verdict; a failure goes back
with the test once, the host runs its own copy again on the repair, and a check that still fails ends the turn
`[Not verified — …]`. The file is on disk only while it runs, since Vitest also discovers tests under `.shelra/`.
With no runner a test outside the package can use (Go, Rust, JVM, plain HTML), a checker that changed project files,
or no report the host can run, the turn audits itself requirement by requirement as before. `--ablate verifier`
turns the check off; `--ablate audit` turns off both.
The project's checks hold in a large or unfamiliar project too (2026-10-03, SWE-bench Pro's task images): a check that
cannot run there is said once and never sent back for repair, read narrowly so no failure hides behind it (its own
program is missing and no test ran, it was never seen to finish, or running it would do damage); one that fails only
the way it failed in the host's run before the work (`failuresWithin`, by name, file and message, in full) is never a
pass: it is sent back once, then the turn ends unverified "as before this turn", while a new failure gets the usual
rounds; and a full run that outlasts `SHELRA_CHECK_TIMEOUT_MS` (default 10 minutes) runs again on the packages or tests
the change touched (`src/contract/scope.ts`: Go packages, pytest files named for the changed modules,
`jest --findRelatedTests`, `vitest related`), which the session then runs directly; a scoped run that finds no test is
no run.
A turn that changed a web app's files (html, css, js/ts, vue, svelte, package.json) has the app opened by the host
before it may end (`src/agent/runtime-smoke.ts`): through the server the session runs, else by serving the folder a
static-server script names or a plain site's index.html in-process, else by starting Vite on a free port with no
browser window (other dev servers are not started yet, and a bundler project is never served from its source). A
headless browser loads it, clicks the first button and presses Enter, Space and ArrowUp; an uncaught error, a console
error, a request the app's own server fails or a one-color screen sends the findings back to the model (twice), then
ends the turn `[Not verified — …]`. A pass is host evidence and joins the `[Checked by Shelra …]` verdict; an app that
could not be opened (no browser, dependencies not installed) is said once and counts neither way. `--ablate smoke`
turns it off.
A local page the final answer names (`http://localhost…`, `127.0.0.1`), in a turn that changed files or a session
running a server of its own, is requested by the host when the turn ends and, when it answers with HTML, loaded in a
headless browser (`observePage`) for uncaught errors, console errors and requests that fail or answer 4xx/5xx; while
a server the session started is running a failing page goes back to the model once, and a page that still fails
makes the verdict `[Not verified — …]` and the episode unverified, whatever checks passed (`src/agent/local-urls.ts`).
A `curl`/`Invoke-WebRequest` GET against a local page counts as a check only when the host's own request to it
succeeds too, since `curl` exits 0 on a page that answers 500 (`localRequestUrls`); a check the turn ran that fails
on the final code is named in the verdict. Each turn's context lists the
background processes the session left running (seen live 2026-09-25: a model kept killing and restarting its own
server on the port the user reported busy, and answered "the game works" over a page that answered 500).
What the resilience rule swallows (a failing memory write, checkpoint, index update, recap or hook) is appended to
`~/.shelra/logs/swallowed-errors.jsonl` (`src/utils/diagnostics.ts`; `SHELRA_DIAGNOSTICS_LOG` names another file
or `off`; Vitest runs with it off). Every turn, in the terminal UI or headless, is recorded in
`~/.shelra/logs/sessions/<session>.jsonl`: the request, the model that answered (a fallback, the model a router
picked), host notes, tool calls and results, text and the verdict, with keys redacted, kept 14 days
(`src/utils/session-trace.ts`; `SHELRA_TRACE=off` turns it off, `SHELRA_TRACE_DIR` names another folder; off under
test runners). `SHELRA_TRACE=verbose` also records the text and reasoning as they stream, each model step with its
tokens, the turn's stages and what the user does in the terminal UI (mode or model switch, Esc, approvals).
`shelra trace` prints the latest session (`--follow` live, `--list`, `--full`, `--json`, `--last <n>`), and
`shelra trace --watch` prints every session's events live, including sessions started later.

## Repository layout notes

- `ShelraCode/` is a nested reference checkout used as a
  reference only. It is gitignored and excluded from `bun run test` and `bun run build`;
  do not edit it as part of target work.
- Source is `src/`; compiled output is `dist/` (gitignored except when built
  locally).
- The website and the account service are not in this repository (owner, 2026-10-07). The website (Next.js on
  Vercel, sign-in with Supabase Auth, the `/cli/login` page `shelra login` opens, the install script
  `public/install.ps1`) is `Shelra/Shelracode-frontend`; the account service (Bun API over Supabase Postgres and
  Auth, on Railway) is `Shelra/Shelracode-backend`. Each has its own CI, lockfile and `CLAUDE.md`. Their design
  stays documented here: `docs/architecture/16-BACKEND.md`, `23-ONBOARDING-AND-CONFIG.md`. A checkout of either
  placed inside this repository is ignored by git.

## Providers and routing (hard rule: Free mode never reaches paid inference)

Design, evidence and risks: `docs/architecture/22-PROVIDER-ROUTING.md`. Models are `provider/providerModelId`
(`groq/openai/gpt-oss-120b`, `omniroute/auto/coding`; a bare id still means OpenRouter). Providers are
`ProviderDefinition`s in `src/providers/registry.ts` (listed in `default-registry.ts`); one `RoutingProvider`
(`src/providers/routing-provider.ts`) serves every cloud session, dispatches by the id's provider, plans Free routes
over the unified catalog (`src/routing/`), and refuses, before any provider is contacted, a model that
`classifyFreeEligibility` does not prove free. **Unknown cost is not free**; a routing alias or combo is never free;
a free plan counts only when the user declared the key has no billing. `Agent.setProvider` guards any adapter that
bypassed routing, and `src/providers/architecture.test.ts` pins every place a provider is built or a model called:
adding one means reviewing it against Free mode. To add a provider, write its definition; do not add an `if` for it.
`shelra providers` shows what is configured and what Free mode may run.

## Resilience (hard rule)

A missing or failing resource never ends Shelra's flow. Only the user's cancellation (Esc) ends a
turn at once. Everything else is recovered:

- A model round that fails (silence, an SDK timeout, a cut stream, a rate limit, a provider error,
  no credits, a spend limit, a missing endpoint) keeps its completed steps, is retried after a
  pause, and moves to the provider's next fallback model after two failures in a row, or at once
  when retrying cannot help (`fallbackModelIds`, `SHELRA_FALLBACK_MODELS`). On OpenRouter the
  fallback is never a hand-picked model. In Free mode (the default, which never runs a paid model,
  not even one the user names) the session runs on `shelra/free` ("Auto Free"): each request is planned
  over the eligible free routes of every configured provider (`src/routing/free-router.ts`), a route that
  fails before producing output moves the same call to the next one, and a failed route cools down
  (`src/routing/health.ts`); when every free route is cooling down, the ones that failed only in passing (a server
  error, an overloaded model; never a spent quota, a rate limit or a refused key) are tried again at once, soonest back
  first, at most four (`probeCooling`, a `probe` routing event), with eligibility untouched, so the turn does not
  wait out a cooldown while a free model may answer; `openrouter/free`, which answers with any free model, tiny ones included, is the
  last resort (seen live 2026-09-24). A model the user pins in Free mode is checked first, and a
  fallback id is only ever an eligible one. For a model
  chosen with the `custom` policy it is `openrouter/free`; in Mixed mode (`ctrl+f` in the terminal
  UI, `--model-policy mixed`) or a paid tier, `openrouter/auto` (paid, within the policy's cost
  tier) then `openrouter/free`. A fallback is not always free: the switch notice states its cost,
  and spend limits still apply. A strict (benchmark) model is never
  replaced. When no model of the provider can serve the turn (the day's free quota spent, none
  answering), a session in Mixed mode continues on another free provider the user configured (Groq,
  Gemini, Cloudflare Workers AI, then OpenRouter Free when the turn started elsewhere), each tried
  once per session; the notice states its plan, that a key on a paid plan is billed by that provider,
  and, for Gemini's free tier, that Google may use the prompts (`setProviderFallback`, wired in
  `src/index.ts`; Mixed also continues on Auto Free when its picked model cannot be served). A session in
  Free mode never reaches a provider whose billing Shelra cannot show (owner, 2026-09-24): the router
  admits another provider's models only when its prices prove them free, or when the user declared the
  key has no billing (`shelra providers allow-free`); an installed local model remains the fallback for a
  rejected key. Only when nothing eligible is left does a
  turn in which no model answers pause with its progress saved and say how to resume; when the
  provider's free allowance is what ran out, it ends `[Limited — …]` with the time the allowance
  comes back, as the provider reports it or as its documentation schedules it
  (`src/providers/limits.ts`), and the terminal UI's footer shows "● Limited" until then.
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

## Account and first-run setup (owner, 2026-10-06)

A ShelraCode account is required to start Shelra: `shelra login` (browser, local callback or a pasted code) or, for
headless and CI runs, a token in `SHELRA_TOKEN`; a login is re-verified daily and works offline for 7 days
(`src/account/session.ts`). A turn never calls the account service. `SHELRA_NO_BROWSER=1` stops the CLI opening a
browser. The first start and the start after `/logout` run the setup (providers and keys, mode, default provider and
model); `/config` changes the same settings and saves each one at once; `/login` shows who is signed in.
Design: `docs/architecture/23-ONBOARDING-AND-CONFIG.md`. A test that starts the CLI needs a seeded signed-in account.

## Extensions: instructions, skills, agents, hooks, custom prompt (hard rules)

Design, precedence, compatibility matrix, security model and the measured state: `docs/architecture/24-EXTENSIONS.md`. Code:
`src/extend/`, `src/hooks/`. In short: `SHELRA.md` (and rules, a local file, `AGENTS.md`) is rebuilt from its files at every turn;
skills are `.shelra/skills/<name>/SKILL.md` (the open Agent Skills format), loaded on demand through the `skill` tool or `/<name>`;
agents are `.shelra/agents/<name>.md`, resolved into a snapshot at launch and run through `Agent.runTaskRequest`; hooks are
commands on events. The model has three tools (`skill`, `extensions`, `extension_write`) and the person has the same services as
`/skills /agents /hooks /instructions /prompt /doctor` and `shelra <same>`.

- A file never grants a permission. `allowed-tools` is informational; an agent's `tools` only narrow; a read-only agent gets no
  file tools and a shell the host proves read-only (`src/extend/readonly-shell.ts`); a custom prompt cannot reach any of this.
- Project and local hooks are proposals. What runs is the snapshot the person approved (`~/.shelra/trust.json`); no tool offered to
  a model approves, changes, disables or removes an approved hook, and the file tools and any command or path that names `trust.json`, `user-settings.json` or `auth.json` are refused (a text match: an unsandboxed
  shell can still build such a path indirectly, so `--sandbox` is what keeps a shell away from them). A hook defined in the repository does not get
  `SHELRA_TOKEN`, `*_API_KEY`, `*_TOKEN` or `*_SECRET` variables in its environment.
  `disableAllHooks` counts only in the user's own settings.
- A model writes a user-wide skill, agent or instruction file only when the person's request asks for that scope.
- Free mode: nothing in `src/extend` or `src/hooks` calls a model (pinned by `src/extend/architecture.test.ts`); a delegated agent
  runs the session's model in Free mode whatever its file names. A new module there must not import a provider.
- Every write goes through `src/extend/store.ts` (atomic, locked, versioned, read back); every name is validated before it is a path.
- Tests that run a delegated agent must not leave run records in the real home: `SHELRA_AGENT_RUNS=off` is set in `vitest.config.ts`;
  a test that reads them back sets it to `on` with a scratch `HOME`. A scripted test provider must validate tool input against the
  tool's schema, as the SDK does (a schema that refused a valid call hid for a day behind one that did not).

## Persistent memory (hard rule)

Shelra must not behave like a stateless agent. `src/memory/` implements project memory under
`.shelra/memory/` in the session's root folder, whatever folder the shell moved to (index + topic files +
`history.jsonl` timeline + `reflections.jsonl` audit + `episodes.jsonl` + `pending-reflections.jsonl`):
the user's standing rules, facts and corrections reach every request; the rest is ranked against every request and
sub-agent brief (lexical, no embeddings: rare words weigh more, Spanish and English meet through `src/memory/terms.ts`,
a short follow-up is read with the request before it) and the relevant bodies are injected, the next ones as
pointers. What a turn was given, and why, is in its session trace (`recall`); `bench/memory/` measures retrieval. Every turn that did work records an episode (outcome, files, what failed and what got
past it), however it ended. Memory stays fresh while a turn works (doc 18 §4.2a): a failure lesson is written when
the turn gets past the failure (the same check passing later, or another program doing the job; never a failure that
never passed), the turn in progress is saved under `.shelra/memory/live/` and removed when it ends, a save left by a
process that died becomes an `interrupted` episode on the next turn, and `memory_list` shows recent work and turns in
progress in other sessions. After a turn that changed and verified files, worked through a
failure, or investigated substantially, one bounded reflection call proposes durable facts and a
deterministic write gate admits, merges, or rejects them (no secrets, no instruction-shaped text,
no inference overwriting a human statement, no near-duplicates). A turn no model could finish (Limited, Paused)
keeps its host-observed lessons at once and queues its reflection for the next turn a model answers; a turn held by
test protection whose checks passed reflects, and what it keeps is tagged `held`; a turn stopped by a check or
decision-record edit, missing evidence, a Stop hook or `report_blocker` keeps its episode and host-observed lessons,
and no model reflects on it (`docs/architecture/18-MEMORY-V2.md`, doc 21). A reflection item may quote the user: when
the host finds the quote word for word in what the user typed this session, the quote becomes the record, human-sourced
and tagged `intent`, and reaches every request with the standing rules; a lesson a turn paid for (a check that failed,
then passed) does not fade. Explicit
standing rules, facts and corrections from the user ("always …", "never …", "remember that …", "no, we use …") are
captured without a model call; a preference about how Shelra talks to the person goes to the user-wide store. A project entry gains credit when the
host runs the checks a project states and they pass with it in context, and loses it when they fail (a
project that states no checks gives no credit); a procedure that was part of
two passing turns is proposed as a skill and written to `.agents/skills/<slug>/SKILL.md` only on the user's yes
(`shelra memory promote`). A fact a correction or a newer fact replaced leaves the index as superseded, its file kept,
and the newer entry says what it replaced; a full store archives its least useful inference instead of refusing.
Memory behaves like a person's (doc 18 §4.6, `src/memory/dynamics.ts`): an entry used often and lately (read with
`memory_read`, or its command run and passed; being shown is not use) ranks above an equal one, and an unused inference
fades; once a day a consolidation pass turns a failure repeated across
turns into one lesson and archives what faded (never the user's words, an important or a credited entry), and a
request that matches an archived entry is offered it back; "recuérdame X cuando Y" keeps a reminder given once, on
the request that names its cue. `shelra memory` lists, shows, explains (`why "<request>"`) and counts it.
Where work stands and what the project documents say (doc 21): each episode keeps a snapshot of the session's plan,
every request sees the project's open plans, and a request to continue in a new session adopts the newest one, so
`update_plan_step` goes on from there; every request gets the README's description of the project, up to three
documents it is about, each flagged when it still states what a superseded decision or entry replaced
(`src/memory/docs-index.ts`), and a pointer to an instruction file written for another agent; a session's first
request also gets the most important lessons and the latest turns. Design and evidence:
`docs/architecture/18-MEMORY-V2.md`, `docs/architecture/21-PROJECT-MEMORY-V2.md` (current) and
`docs/design/shelra-memory-engine.md`; proof suites: `bench/suites/shelra-memory-v0.1.json`,
`bench/long-horizon/memory-evals.ts`, `bench/long-horizon/year-in-a-box.ts`; retrieval benchmark: `bench/memory/`.
