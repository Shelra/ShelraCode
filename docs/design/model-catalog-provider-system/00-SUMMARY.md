# 00 — Summary

**Question:** can ShelraCode get a real, provider-agnostic model catalog with
**Local** and **Cloud** categories — starting with free OpenRouter models — by
evolving what already exists?

**Answer: yes.** The hard parts are already built and correct. The
`ProviderAdapter` seam (`src/providers/types.ts:76-86`) is genuinely
provider-neutral, and `createOpenAICompatibleProvider`
(`src/runtimes/local-provider.ts:133-152`) **already speaks to any
OpenAI-compatible cloud endpoint today** — it is just handed a synthetic
`contextWindow: 128_000` and no headers. The gap is not the transport. It is
the *catalog*: aggregation, caching, commands, auth, and a picker that knows
about two categories.

Read order: `03` (what exists) → `04` (the design) → `06` (how to build it) →
`07` (what needs your sign-off). `01` and `02` are the research behind the
choices.

---

## The three biggest reuse wins

1. **The provider seam and the OpenAI-compatible adapter.**
   `LocalProviderAdapter` (`local-provider.ts:40-125`) already wraps
   `@ai-sdk/openai-compatible` and normalises streams, tools and usage.
   `createOpenAICompatibleProvider` needs **one additive options argument**
   (headers, retries, real context window) — no new adapter, no SDK zoo, no
   change to `ProviderAdapter`, and `src/providers/architecture.test.ts` stays
   green.

2. **The entire local model lifecycle.** `HUGGING_FACE_MODELS`, resumable
   SHA-256-verified downloads (`huggingface.ts:163-245`), the filesystem scan
   (`:269-332`), the reviewed-catalog allowlist (`managed-llama.ts:375-376`),
   `installLocalModel` (`manager.ts:28-53`), and the runtime discovery/health
   machinery. `LocalSource` is a **mapper over existing functions**, not new
   logic. OpenCode has nothing comparable — its "local models" are hand-written
   config entries with hand-typed context limits (`01 §4`).

3. **Provider-swap safety.** `agent.setProvider` mutates one field
   (`agent.ts:714-719`), `getModelInfo()` re-derives per call (`:655-657`), and
   `getContextStats` takes `contextWindow` as a *parameter* (`:753`) rather than
   caching it. Mid-session model switching is therefore already safe with
   respect to metadata (audit `14` §4, re-verified in `03 §7`). The picker
   (`app.tsx:5367`), the `/models` slash command (`slash-menu.ts:17`) and the
   `onSelectLocalModel` seam (`app.tsx:575`) all exist.

## The three biggest new pieces

1. **`CatalogEntry` + `CatalogProvider` + the aggregator** (`04 §2-§4`) — the
   layer that answers "what models *could* I use", independent of what is
   running. It is what `catalog.ts` was always a placeholder for.

2. **The OpenRouter source**: an unauthenticated `GET /api/v1/models`, a
   normaliser (string prices, `top_provider` nulls, capability flags from
   `supported_parameters`), a `~/.shelra/catalog/openrouter.json` cache with a
   TTL, and a bundled offline fallback (`04 §4.2`, `§8`).

3. **The command surface and auth**: `shelra models` / `list` / `use` /
   `add` / `download` / `remove` / `refresh`, `shelra auth openrouter`, a
   `~/.shelra/auth.json` credential store, and Local/Cloud sections in the TUI
   picker (`05`).

---

## Recommended catalog shape and id convention

* **One flat type, `CatalogEntry`**, with a discriminated `state` union: the
  common fields are `id`, `category`, `provider`, `name`, **`contextWindow`
  (always a real number)**, `maxOutputTokens`, `contextConfidence`,
  `capabilities {tools, reasoning, vision}` and `cost {prompt, completion, free}`;
  `state.kind === "local"` carries `install`/`path`/`sizeBytes`/`quantization`/
  `runtimeId`, and `state.kind === "cloud"` carries `providerModelId`/
  `apiKeyConfigured`/`moderated`/`notes`/`expiresAt`.
* **Ids split on the first `/`** — OpenCode's `parseModel`
  (`provider.ts:2054-2060`), adopted verbatim: `local/hf:Qwen/…:Q4_K_M` and
  `openrouter/google/gemma-4-31b-it:free`. Everything after the first slash is
  opaque, so slashes and `:free` suffixes are safe.
* **Existing local ids are never rewritten.** Resolution accepts the canonical
  id, the bare legacy id already stored in `defaultModel`, the cloud
  `providerModelId`, and an unambiguous suffix — which makes this a
  zero-migration change to `~/.shelra/user-settings.json`.
* **Schema borrowed from models.dev, data fetched from OpenRouter.** models.dev
  is 4.5 MB and one hop stale; OpenRouter's own endpoint is 709 KB, carries
  `top_provider.max_completion_tokens`, `is_moderated` and `expiration_date`,
  and is authoritative for free pricing. models.dev stays documented as a future
  `ModelsDevSource` — it drops in behind the same interface.

## Recommended local-first gating policy

**Listed always, selected never — activation is always an explicit act.**

1. Cloud entries appear in `shelra models` and `/models`, in a `CLOUD` section,
   marked `✗ no API key` when none resolves.
2. Startup auto-selection stays local-only: `runStartup`
   (`orchestrator.ts:64-259`) and `selectLocalRoute` are untouched, and there is
   **no automatic cloud fallback** — audit `18` §7 forbids it, and this design
   honours that.
3. A cloud model becomes active only via `shelra models use`, the picker, or
   `--model openrouter/…`.
4. `--remote`, `SHELRA_API_KEY` and `SHELRA_BASE_URL` keep working unchanged.
5. The privacy boundary at `index.ts:108-115` is preserved: the Agent is still
   constructed with `undefined` credentials on the local path.
6. A persistent `☁` status marker while cloud is active, plus a one-time
   first-turn notice.

**What leaves the machine (`04 §9`):** exactly two things. An
**unauthenticated, bodiless `GET /api/v1/models`** carrying only a User-Agent —
no key, no hardware profile, no model list, no workspace path. And, only while a
cloud model is active, the conversation itself to `/chat/completions`.

**The honest disclosure that must ship with it:** free OpenRouter models are
served only to accounts that have enabled "free endpoints that may train on
inputs" (`02 §4`; otherwise: `404 No endpoints found matching your data
policy`). Choosing a free cloud model means the conversation may be used to
train a third-party model. That sentence belongs in the UI, not just in these
docs.

---

## Recommended first two phases

**Phase 1 — `CatalogEntry` + `CatalogProvider` + `LocalSource`.**
Replaces the `catalog.ts` stubs with a real, local-only catalog.
**Zero user-visible change.** Pure de-risking: it settles the type, the id
convention and the synchronous-`getModelInfo` facade before any network code
exists.

**Phase 2 — the OpenRouter `CloudSource`.**
Client, normaliser, disk cache with TTL, bundled fallback. Still not rendered,
still not selectable — but fully fixture-tested and offline-safe.

Together they are the whole architectural bet, with **no** behaviour change to
ship or roll back. Everything after (`models` output, auth, `models use`, the
picker, download/remove, the context hand-off, onboarding) is incremental on top.

---

## The context-window hand-off

The catalog is the single source of truth for per-model `contextWindow` and
`maxOutputTokens`, so the queued **model-aware context budget** work consumes
real numbers. Today four sites are wrong (`04 §7.1`), and the worst is this:

> `ManagedLlamaRuntime` starts llama-server with `--ctx-size` clamped to
> `CUDA_CONTEXT_HEADROOM = 16_384` on CUDA (`managed-llama.ts:227-237`), but the
> agent is told the model's window is **32 768** (the spec value). **The
> advertised window is up to 2× the served one.**

Phase 8 fixes the source of those numbers (read llama-server's `/props`, else
emit the `--ctx-size` actually passed; for cloud, use
`top_provider.context_length` / `max_completion_tokens`) and threads them
through `resolveModelRuntime` → `modelInfo`. **Designing the compaction
thresholds, `--ctx-size` bounding and overflow recovery is explicitly NOT part
of this project** — that is the queued fix, and its interface is
`modelInfo.contextWindow` / `.maxOutputTokens` / `.contextConfidence`.

---

## Open questions needing sign-off

Full list with assumed answers in `07 §12`. The five that actually change the
product:

| | Question | Assumed |
| --- | --- | --- |
| **Q1** | List cloud models even with no API key? | **Yes** — listed, marked, never auto-selected. *The core values call.* |
| **Q2** | Keys in a new `~/.shelra/auth.json`, or in `user-settings.json`? | **New `auth.json`**, `0o600`, OpenCode-style. |
| **Q3** | Cloud cache TTL? | **6 hours.** |
| **Q8** | Fix the mid-stream `finish_reason: "error"` gap now or later? | **Later** — but note that without it, rate-limited cloud turns fail *silently* (`07 §6`). |
| **Q13** | Add a `catalog.cloud: false` hard kill switch? | **Recommended, not assumed.** |

Also worth a decision early: **Q10 — the real `HTTP-Referer` value** (currently
a placeholder), since it is sent on every cloud request.
