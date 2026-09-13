# 06 — Implementation phases

Nine phases. Each is independently shippable, independently verifiable, and
leaves `bun test` green and `tsc` clean. Phases 1–2 are the recommended first
slice; 3–5 make it usable; 6–9 are polish and integration.

**Global invariants for every phase**

* No change to `src/providers/types.ts` (`ProviderAdapter` is frozen).
* `src/providers/architecture.test.ts` keeps passing — never import a provider
  SDK into `agent.ts`, `grok/tools.ts` or `agent/compaction.ts`.
* `normalizeModelId` stays `trim()`.
* `DEFAULT_MODEL` stays `""` (rationale: `04 §10.1`).
* No network call on any path that did not previously make one, unless the user
  asked for it.
* No test in the suite may perform real network I/O.

---

## Phase 1 — `CatalogEntry`, `CatalogProvider`, `LocalSource`

**Objective.** Replace the `catalog.ts` stubs with a real, local-only catalog.
**Zero user-visible behaviour change.**

**Existing code to reuse (unmodified).**
`HUGGING_FACE_MODELS` and `discoverInstalledHuggingFaceModels`
(`src/models/huggingface.ts:43-70`, `:269-332`); `discoverLocalRuntimes`
(`src/runtimes/discovery.ts:87-113`); `LocalModelCandidate`
(`src/runtimes/types.ts:11-33`); `ModelInfo` (`src/types/index.ts:227-247`);
`normalizeModelId` (`src/models/catalog.ts:7-9`).

**New modules.**
`src/models/types.ts` — `CatalogEntry`, `CatalogCategory`,
`CatalogCapabilities`, `CatalogCost`, `LocalCatalogState`, `CloudCatalogState`,
`MetadataConfidence`, `CatalogProvider`, `CatalogSourceContext/Result`.
*Types only — no `node:fs`, no SDK import.*
`src/models/id.ts` — `parseCatalogId`, `toCatalogId`, `resolveCatalogId`.
`src/models/sources/local.ts` — `LocalSource implements CatalogProvider`.
`src/models/catalog-store.ts` — `primeCatalog()`, `listCatalog()`,
`getEntry(id)`, and the in-memory snapshot backing the synchronous facade.
`src/models/adapters.ts` — `catalogEntryToModelInfo`,
`catalogEntryToLocalModelCandidate`.

**Files to modify.**
`src/models/catalog.ts` — becomes a facade (`04 §10.1`); every signature
unchanged. `src/types/index.ts` — add optional `maxOutputTokens?: number` and
`category?: "local" | "cloud"` to `ModelInfo`.
`src/models/catalog.test.ts` — rewrite (`04 §10.3`).

**Tests required.**
`src/models/id.test.ts` — first-slash split; `hf:` ids with slashes and colons
survive; `local:` prefix is not doubled; legacy bare-id resolution;
ambiguity is an error, not a guess.
`src/models/sources/local.test.ts` — installed + available merge, no duplicates,
`install` state correct, `contextWindow` from spec, `cost.free === true`.
`src/models/adapters.test.ts` — round-trip `CatalogEntry ↔ ModelInfo`.
`src/models/catalog.test.ts` — rewritten as above.
Every test uses fixtures and a temp model directory; **no runtime is spawned**.

**UX impact.** None.

**Risks.** (a) `getModelInfo` must stay synchronous — mitigated by the primed
snapshot; before priming it returns `undefined`, exactly as today.
(b) `HUGGING_FACE_MODELS` is indexed positionally by
`recommendBootstrapModel` (`recommendation.ts:35,41,46-52`) — do not reorder or
extend the array in this phase.

**Acceptance.** `tsc` clean; full suite green; `shelra models` byte-identical
output to before; `getModelInfo(<installed id>)` returns a real `ModelInfo`
after `primeCatalog()`, and `undefined` before it.

---

## Phase 2 — OpenRouter `CloudSource`

**Objective.** Fetch, normalise, cache and fall back for OpenRouter's free
models. Still not selectable, still not shown by default.

**Existing code to reuse.** Phase 1's types; `getProductUserDir`
(`src/product/identity.ts:21`); the atomic-write and `0o600` patterns from
`src/utils/settings.ts:222-225` and `huggingface.ts:148-156`.

**New modules.**
`src/models/sources/openrouter.ts` — the client (`GET /api/v1/models`, 10 s
timeout, 2 jittered retries, `User-Agent: ShelraCode/<version>`, **no auth
header**), the normaliser (`04 §4.2`), and the free/text-output filter.
`src/models/cache.ts` — `~/.shelra/catalog/<provider>.json`, envelope
`{version, provider, fetchedAt, source, entries}`, 6 h TTL, atomic tmp+rename,
corrupt-file recovery, `SHELRA_OFFLINE`, `SHELRA_OPENROUTER_MODELS_URL`.
`src/models/openrouter-fallback.ts` — ~8 bundled entries,
`contextConfidence: "fallback"` (list in `04 §8`).

**Files to modify.** `src/models/catalog-store.ts` — register the second source
and implement the aggregator (concat, de-dup by id, sort local→cloud).

**Tests required.**
`openrouter.test.ts` against a **checked-in fixture** trimmed from the real
2026-09-06 response (a handful of entries: one free+tools, one free without
tools, one paid, `openrouter/free` with `top_provider: null`, one with a past
`expiration_date`). Assert: string `"0"` pricing → `free: true`;
`top_provider.context_length` preferred over `context_length`; `null`
`top_provider` handled; `tools`/`reasoning`/`vision` flags; audio-output models
excluded; expired entries dropped; prices parse as numbers.
`cache.test.ts` — fresh cache short-circuits the fetch; stale cache triggers a
fetch; **network failure prefers a stale cache over the bundled list**;
corrupt JSON is deleted and falls through; `SHELRA_OFFLINE` never fetches;
writes are atomic and `0o600`.
`fallback.test.ts` — every bundled entry validates against the schema and has
`tools: true`.
**Injected `fetch`**, like `discovery.ts` and `managed-llama.ts` already do.
Zero real network calls.

**UX impact.** None yet (nothing renders cloud).

**Risks.** The fixture goes stale; label it with its fetch date and treat it as
a *schema* fixture, not a *data* fixture. A slow fetch must never block a local
start — the 10 s timeout plus cache-first ordering covers it.

**Acceptance.** With network: `listCatalog()` returns ~17–18 free entries with
real context windows. Airplane mode, warm cache: the same entries, `origin:
"cache"`. Airplane mode, cold cache: the bundled entries, `origin: "bundled"`.
No test touches the network.

---

## Phase 3 — `shelra models` grouped output, `--json`, `list` filters

**Objective.** Make the catalog visible.

**Existing code to reuse.** `formatContext` (`index.ts:1067-1070`),
`formatDownloadSize` (`huggingface.ts:334`), the ANSI style already used at
`index.ts:942`.

**New modules.** `src/cli/models-command.ts` — the whole subcommand tree and a
**pure** `renderCatalog(entries, options): string` so output is unit-testable
without Commander.

**Files to modify.** `src/index.ts:931-952` — replace the flagless command;
delete `formatBytes` (`:467-471`) in favour of `formatDownloadSize`.

**Tests required.** `models-command.test.ts` on `renderCatalog` with a fixture
catalog: grouping order, `●` marker, truncation at 5 cloud rows, key-state
header, rate-limit line, cache-age footer, every empty state from `05 §4`.
`--json` shape is asserted key-by-key and **asserted not to contain the key
material**. `--local`+`--cloud` is an error.

**UX impact.** `shelra models` output changes substantially (`05 §1.1`), and —
per `04 §4.1` — becomes fast: it must **not** call `discoverLocalRuntimes` with
a 60-second budget or spawn a llama-server.

**Risks.** Regressing the "no local model" message that onboarding docs point
at. Keep the `Run \`shelra\` to start automatic onboarding.` wording.

**Acceptance.** `shelra models` returns in well under a second on a cold
machine with a warm cache and starts no child process (verify with a process
listing). `shelra models --json | jq .entries[0].contextWindow` prints a real
number.

---

## Phase 4 — Auth store, `shelra auth openrouter`, missing-key errors

**Objective.** A user can supply and store an OpenRouter key.

**Existing code to reuse.** `getProductUserDir`; the `0o700`/`0o600`
`ensureDir`/`writeJson` helpers (`settings.ts:207-225`) — extract or mirror
them.

**New modules.** `src/models/auth-store.ts` — `~/.shelra/auth.json`,
`{provider: {type:"api", key}}`, `0o600`, `readAuth`, `writeAuth`, `removeAuth`,
plus `resolveProviderKey(providerId): {key?, source: "flag"|"env"|"file"|"none"}`
implementing the `04 §6.2` precedence.
`src/cli/auth-command.ts` — `shelra auth openrouter [--key|--show|--remove]`,
`shelra auth list`, and key validation via `GET /api/v1/key`.

**Files to modify.** `src/index.ts` — register `auth`; **do not** change
`getApiKey`/`getBaseURL` (`settings.ts:341-347`).

**Tests required.** Precedence (flag > env > file > none) with a temp HOME;
file mode is `0o600`; `--show` and `auth list` never emit key material; a 401
from `/key` does not write the file; `--remove` deletes only that provider's
entry. `fetch` injected.

**UX impact.** New commands. Missing-key errors become actionable.

**Risks.** **Secret handling.** Two specific hazards:
(a) the key must never be logged, never printed by `--json`, never included in
an error message;
(b) `llamaServerEnvironment` (`managed-llama.ts:50-56`) is a *denylist* that
strips `*API_KEY*`, `*TOKEN*`, `*SECRET*` and an explicit `BLOCKED_ENV_NAMES`
set (`:31-43`). `OPENROUTER_API_KEY` matches the `API_?KEY` regex at `:30` and
is therefore **already stripped** — but this should be asserted by a test and
`OPENROUTER_API_KEY` added to the explicit `BLOCKED_ENV_NAMES` list belt-and-braces.

**Acceptance.** `shelra auth openrouter --key sk-…` writes `0o600` and reports
the real tier; `shelra models` then shows `✓ API key set`;
`grep -r "sk-or" ~/.shelra/user-settings.json` finds nothing.

---

## Phase 5 — `shelra models use` and cloud provider resolution

**Objective.** A cloud model can actually run a turn.

**Existing code to reuse.** `createOpenAICompatibleProvider`
(`local-provider.ts:133-152`) and `LocalProviderAdapter`;
`agent.setProvider` (`agent.ts:714-719`); `saveUserSettings`
(`settings.ts:231`); `configureLocalProvider` (`index.ts:480-530`).

**Files to modify.**
`src/runtimes/local-provider.ts` — **the only change to an existing runtime
file**, and it is additive:
* add an optional 4th `options` parameter to `createOpenAICompatibleProvider`
  (`headers`, `maxRetries`, `contextWindow`, `maxOutputTokens`, `capabilities`,
  `cost`); the existing 3-arg call at `discovery.ts:69` is untouched;
* thread `headers` into `createOpenAICompatible` (`:52-58`);
* replace the hardcoded `contextWindow: 128_000` (`:141`) with the supplied
  value, defaulting to 128 000 when absent;
* parameterise `maxRetries` (`:88`) — default `0`, cloud passes `2`; apply the
  same value in `generateText` (`:111-118`), which currently sets none.

`src/models/sources/openrouter.ts` — implement `resolveProvider(entry)`.
`src/index.ts` — `models use`; extend `configureLocalProvider` with a cloud
branch when the resolved model id is a cloud entry; extend
`getRemoteConfigurationError` (`:474-478`) to recognise "cloud entry selected,
no key".

**Tests required.** `resolveProvider` builds an adapter with `baseURL ===
"https://openrouter.ai/api/v1"`, the exact `HTTP-Referer` /
`X-OpenRouter-Title` headers, `maxRetries: 2`, and `resolveModelRuntime()
.modelInfo.contextWindow` equal to the entry's — **not 128 000**.
`models use` validation: not installed / no key / no tools / expired / ambiguous
each produce the exact `05 §4` text.
`local-provider.test.ts` gains a regression: the 3-arg call still yields
`maxRetries: 0` and a 128 000 default.
**Plus one manual smoke test with a real key** — the one open assumption in
`02 §5`: confirm streaming tool-call deltas work end-to-end against a free
model. Record the result in this file.

**UX impact.** Cloud models become usable.

**Risks.** `maxRetries: 2` retries a *streaming* request; confirm the AI SDK's
retry semantics do not replay a partially consumed stream. The mid-stream
`finish_reason: "error"` case (`02 §4`) is **not** covered by retries — see
`07 §6`.

**Acceptance.** `shelra auth openrouter --key … && shelra models use
openrouter/google/gemma-4-31b-it:free && shelra -p "list the files here"`
completes a tool-using turn. Local-only runs are byte-identical to before.

---

## Phase 6 — `/models` picker with Local/Cloud sections

**Objective.** Switch models mid-session from the TUI.

**Existing code to reuse.** `ModelPickerModal` (`app.tsx:5367`), the key
handling (`:2978-3019`), `selectLocalModel` (`:816-838`), `prepareLocalModel`
(`index.ts:193-215`), the `/models` slash item (`slash-menu.ts:17`).

**Files to modify.** `src/ui/app.tsx` — feed the picker catalog rows; add
`LOCAL` / `CLOUD` sticky headers; generalise `selectLocalModel` → `selectModel`;
add `startupConfig.onSelectCloudModel?` next to `onSelectLocalModel` (`:575`);
add the post-switch context re-check (`05 §2.3`).
`src/index.ts` — supply `onSelectCloudModel` and pass catalog rows instead of
`localModels.map(toModelInfo)` (`:229`).

**New module.** `src/ui/model-picker-rows.ts` — a **pure** function
`(entries, activeId, query) → PickerRow[]` (headers + rows, flattened for
keyboard navigation), unit-tested without a TUI, exactly as OpenCode extracts
`dialog-select-model-search.ts` (`01 §6`).

**Tests required.** `model-picker-rows.test.ts`: section order is always
LOCAL-then-CLOUD; search filters within sections; empty sections are hidden;
headers are never selectable; the active row is marked.
A switch test asserting the context re-check fires and that the warning text
matches `05 §4`.

**UX impact.** The picker gains cloud models and section headers.

**Risks.** `--remote` runs pass `localModels: []` and `onSelectLocalModel:
undefined` (`index.ts:229-230`); the new code must tolerate both being absent.
Do not dispose the local runtime on switching to cloud (`05 §2.3`).

**Acceptance.** `/models` shows both sections; selecting a cloud model switches
mid-conversation without losing history; the status line shows `☁`; switching
back to a smaller local model triggers the context warning.

---

## Phase 7 — `models add` / `download` / `remove`

**Objective.** Manage local GGUFs from the CLI.

**Existing code to reuse.** `installLocalModel` (`manager.ts:28-53`),
`ManagedLlamaRuntime.installModel` (`managed-llama.ts:364-387`) and its
allowlist check (`:375-376`), `downloadHuggingFaceModel`
(`huggingface.ts:163-245`), `formatDownloadSize`/`Speed` (`:334-343`),
`defaultModelDirectory` (`:85-87`), `inspectHardware` for the disk floor.

**Files to modify.** `src/cli/models-command.ts` — the three subcommands.

**New module.** `src/models/remove.ts` — delete a GGUF plus its `.json`
sidecar, refusing anything outside `defaultModelDirectory()` and anything
currently loaded.

**Tests required.** `add`'s `<repo>:<quant>` → `hf:<repo>:<quant>` mapping;
an unlisted repo produces the exact allowlist error (`05 §4`);
`remove` refuses a path outside the model directory (**path-traversal
regression test**); `remove` refuses the loaded model; `--yes` skips the prompt;
progress rendering with a fake progress stream.

**UX impact.** New commands; download progress in the terminal.

**Risks.** Deleting user data. Require confirmation, restrict the path, and
never follow symlinks out of the model directory.

**Acceptance.** Round trip: `models download` → appears as `installed` →
`models remove --yes` → returns to `available`.

---

## Phase 8 — Populate `modelInfo.contextWindow` from the catalog

**Objective.** Close the hand-off to the queued context-budget work
(`04 §7`).

**Existing code to reuse.** `ManagedLlamaRuntime.ensureServer`'s `--ctx-size`
computation (`managed-llama.ts:227-237`), its health poll
(`:161-176`, which already talks HTTP to `serverURL`), `modelCandidate`
(`:74-97`), `LocalProviderAdapter.resolveModelRuntime`
(`local-provider.ts:61-79`).

**Files to modify.**
`src/runtimes/managed-llama.ts` — after a successful start, `GET
<serverURL>/props` and record the effective `n_ctx`; expose it on the candidate
(`servedContextWindow`, confidence `measured`). Failing that, emit the
`--ctx-size` value that was actually passed rather than the spec's number.
`src/runtimes/local-provider.ts` — carry `maxOutputTokens` through
`resolveModelRuntime`.
`src/runtimes/discovery.ts:53` — replace the hardcoded `32_768` with the
endpoint's value when it reports one, marking confidence.
`src/types/index.ts` — `maxOutputTokens` already added in Phase 1.

**Tests required.** A CUDA-style start with `SHELRA_GPU_CONTEXT=8192` produces
`modelInfo.contextWindow === 8192`, **not** 32 768 — this is the exact bug in
`04 §7.1`. `/props` unavailable → falls back to the passed `--ctx-size`, marked
`declared`. A cloud entry with `top_provider.max_completion_tokens: 32768`
surfaces `maxOutputTokens: 32768`.

**UX impact.** The context gauge (`app.tsx:806-807`) finally shows the true
window. On CUDA machines it will show a *smaller* number than before — that is
the fix, and it should be called out in release notes.

**Risks.** The `/props` shape is llama.cpp-version-dependent; treat a parse
failure as "no measurement" and fall back, never throw.
**Scope discipline:** do not change compaction thresholds here. Producing
correct numbers is this phase; consuming them is the queued work.

**Acceptance.** On a CUDA machine, `shelra models --json` and the TUI gauge
agree with llama-server's actual `n_ctx`.

---

## Phase 9 — Startup / onboarding offers a free cloud model

**Objective.** The "no local model" dead end gains a second exit.

**Existing code to reuse.** `runStartup`'s onboarding branch
(`orchestrator.ts:103-112`), `recommendBootstrapModel`
(`recommendation.ts:17-70`), `StartupScreen` (`src/ui/startup.tsx`), the
`onInstall`/`canInstall` wiring (`index.ts:182-188`).

**Files to modify.** `src/ui/startup.tsx` — the third option and its key
binding; `src/index.ts` — the handler; `src/startup/orchestrator.ts` — include
"a free cloud model is available" in the onboarding result **without** selecting
it.

**Tests required.** The onboarding branch still defaults to local; the cloud
option appears only when the cloud catalog is non-empty; choosing it with no key
shows the `04 §6.3` text and does **not** switch;
`selectLocalRoute` is unchanged and never returns a cloud model.

**UX impact.** First-run users with no local model get a working path in
seconds instead of a 1 GB download — at an explicitly stated privacy cost.

**Risks.** **Local-first identity drift** — the biggest product risk in the
whole plan (`07 §1`). Mitigations: local stays bound to Enter; the cloud option
is a secondary key; the trade-off sentence is inline, not in a tooltip; nothing
is ever auto-selected.

**Acceptance.** On a machine with no local model and no key, the startup screen
offers both, defaults to local, and the cloud path stops at the key prompt.

---

## Recommended slicing

| Slice | Phases | Ships |
| --- | --- | --- |
| **1 (recommended first)** | 1 + 2 | A real catalog with local + cloud entries, cached and offline-safe. No user-visible change — pure de-risking. |
| 2 | 3 + 4 | The catalog becomes visible and a key can be stored. |
| 3 | 5 + 6 | Cloud models actually run, from CLI and TUI. |
| 4 | 7 + 8 | Local model management, and the context hand-off. |
| 5 | 9 | Onboarding integration. |

Phase 8 can be pulled forward if the queued context-budget work starts first —
it depends only on Phase 1's types, not on anything cloud.
