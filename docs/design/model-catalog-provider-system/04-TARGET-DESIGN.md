# 04 — Target design: a provider-agnostic catalog with Local + Cloud categories

Everything here is a **proposal**. Nothing in `src/` was changed.
Prerequisites: `01` (OpenCode research), `02` (OpenRouter research),
`03` (current state).

---

## 1. The one idea

Today ShelraCode has a *runtime discovery* layer (`discoverLocalRuntimes` →
`LocalModelCandidate[]`) and a *stub metadata* layer (`catalog.ts`). It has no
layer that answers **"what models could I use, and what are they like?"**
independently of whether a process is running.

The catalog is that layer. It sits **above** runtimes and **below** the
provider seam:

```
                 ┌───────────────────────────────────────────────┐
   CLI / TUI ───▶│  Catalog        listCatalog(), getEntry(id)   │
                 │  CatalogEntry[] — Local ∪ Cloud               │
                 └──────┬──────────────────────────────┬─────────┘
                        │                              │
              ┌─────────▼─────────┐          ┌─────────▼──────────┐
              │  LocalSource      │          │  OpenRouterSource  │
              │  (CatalogProvider)│          │  (CatalogProvider) │
              └─────────┬─────────┘          └─────────┬──────────┘
     discoverLocalRuntimes()                  GET /api/v1/models
     discoverInstalledHuggingFaceModels()      + disk cache + TTL
     HUGGING_FACE_MODELS                       + bundled fallback
                        │                              │
                        └────────── resolveProvider ───┘
                                        │
                        ┌───────────────▼──────────────┐
                        │  ProviderAdapter (unchanged) │
                        │  createLocalProvider(...)    │
                        │  createOpenAICompatible...() │
                        └──────────────────────────────┘
```

Consumers (CLI, picker, startup, agent) only ever see `CatalogEntry`. Adding a
third source must require **zero** consumer changes.

---

## 2. `CatalogEntry`

Proposed new module `src/models/types.ts` (types only, no I/O — keeps it
importable from `agent.ts` without dragging in `node:fs` or an SDK, which is
what protects `src/providers/architecture.test.ts`).

```ts
export type CatalogCategory = "local" | "cloud";

/** How much we trust the numbers in this entry. */
export type MetadataConfidence =
  | "measured"   // read from the live serving endpoint (llama-server /props)
  | "declared"   // stated by an authoritative API (OpenRouter /models, GGUF header)
  | "catalog"    // from our reviewed HUGGING_FACE_MODELS list
  | "fallback"   // from the bundled offline list
  | "assumed";   // a hardcoded default; display with a warning

export interface CatalogCapabilities {
  tools: boolean;
  reasoning: boolean;
  vision: boolean;
  /** Optional; absent means unknown rather than false. */
  structuredOutput?: boolean;
}

export interface CatalogCost {
  /** USD per token, as a number. 0 for local and for free cloud models. */
  prompt: number;
  completion: number;
  free: boolean;
}

export interface LocalCatalogState {
  kind: "local";
  install: "installed" | "available";
  /** Absolute path to the GGUF. Present only when install === "installed". */
  path?: string;
  /** Bytes on disk (installed) or download size (available). */
  sizeBytes?: number;
  quantization?: string;
  parameters?: number;
  estimatedMemoryGb?: number;
  /** The runtime that can serve it, e.g. "shelra-llama". */
  runtimeId?: string;
  runtimeKind?: LocalRuntimeKind;
  /** Present when the model is loaded and the served n_ctx is known. */
  servedContextWindow?: number;
}

export interface CloudCatalogState {
  kind: "cloud";
  /** The id to put on the wire, e.g. "google/gemma-4-31b-it:free". */
  providerModelId: string;
  /** Whether a credential for this provider resolves right now. */
  apiKeyConfigured: boolean;
  /** Human notes: rate limits, moderation, data policy. Shown in the picker. */
  notes: string[];
  moderated?: boolean;
  /** Unix seconds; when in the past the entry is hidden. */
  expiresAt?: number;
}

export interface CatalogEntry {
  /** Stable, addressable id. See §3. */
  id: string;
  category: CatalogCategory;
  /** Provider id: "local" | "openrouter" | … */
  provider: string;
  name: string;
  description?: string;

  /** SINGLE SOURCE OF TRUTH for the context budget. Always a real number. */
  contextWindow: number;
  /** Max tokens the model may emit in one response. */
  maxOutputTokens?: number;
  contextConfidence: MetadataConfidence;

  capabilities: CatalogCapabilities;
  cost: CatalogCost;

  state: LocalCatalogState | CloudCatalogState;

  /** When this entry was produced, for staleness display. */
  fetchedAt?: string;   // ISO-8601
}
```

**Design notes**

* `contextWindow` is **non-optional and always a number**. Sources are
  responsible for producing one; `contextConfidence` says how good it is. This
  is the whole point of the hand-off in §7.
* `maxOutputTokens` is separate, because on the free roster the two are
  uncorrelated (`02 §2.4`: 262 144 ctx / 32 768 out, but also 196 608 ctx /
  176 947 out).
* `cost` is a **number** (converted from OpenRouter's decimal strings — `02
  §1.2`), plus an explicit `free` boolean so the UI never has to compare floats.
* The category-specific data lives in a discriminated union on `state.kind`, so
  `entry.state.path` cannot be read on a cloud entry.
* `capabilities.structuredOutput` is optional-tri-state on purpose: `undefined`
  means "we don't know", which is different from "no".

**Adapters (small, pure, testable):**

```ts
catalogEntryToModelInfo(entry: CatalogEntry): ModelInfo
catalogEntryToLocalModelCandidate(entry: CatalogEntry, baseURL: string): LocalModelCandidate
```

`ModelInfo` (`src/types/index.ts:227`) gains two optional fields:
`maxOutputTokens?: number` and `category?: CatalogCategory`. Both optional, so
nothing that constructs a `ModelInfo` today breaks.

---

## 3. The id convention

```
local/<name>
openrouter/<vendor>/<model>[:free]
<provider>/<rest…>
```

**Rule: split on the FIRST `/`. The first segment is the provider id; everything
after it is the provider-scoped model id.** This is OpenCode's `parseModel`
(`01 §1.2`), and it is adopted verbatim because it is the only convention that
survives model ids containing slashes and colons.

```ts
export function parseCatalogId(id: string): { provider: string; model: string } {
  const trimmed = id.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return { provider: "", model: trimmed };
  return { provider: trimmed.slice(0, slash), model: trimmed.slice(slash + 1) };
}
```

### 3.1 Local ids and the legacy problem

**FACT (`03 §2`)** — today's installed-model ids are already
`hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M` or `local:<filename>.gguf`,
they are persisted into `~/.shelra/user-settings.json` as `defaultModel`
(`orchestrator.ts:243-247`, `index.ts:206-210`, `app.tsx:829-832`), and
`catalog.test.ts:12-16` pins them round-tripping unchanged.

**Therefore: do NOT rewrite local ids.** The catalog id for a local model is:

```
local/hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M
local/qwen2.5-coder-7b-instruct-q4_k_m.gguf     (for a sidecar-less file)
```

i.e. the literal prefix `local/` + the existing `LocalModelCandidate.id`, with
the `local:` prefix stripped when present (so we never produce `local/local:x`).

Resolution must accept **both** forms:

```ts
resolveCatalogId(input) →
  1. exact match on entry.id
  2. exact match on the bare LocalModelCandidate.id      ← legacy settings
  3. exact match on a cloud entry's providerModelId       ← "google/gemma-4-31b-it:free"
  4. unambiguous case-insensitive suffix match            ← "gemma-4-31b-it:free"
  5. otherwise: ambiguous / not found error
```

Rule 2 is the migration shim: an existing `defaultModel` keeps working with no
settings rewrite. Rule 3 means `--model google/gemma-4-31b-it:free` works even
though the canonical id is `openrouter/google/gemma-4-31b-it:free` — *provided
it is unambiguous*, which it is while `openrouter` is the only cloud provider.

**Collision hazard (INFERENCE, medium confidence):** rule 3 becomes ambiguous
the moment a second cloud provider carries the same upstream model id (very
likely — models.dev lists the same model under many providers). Rule 3 must
therefore fail loudly on ambiguity rather than pick one. Decision recorded in
`07`.

### 3.2 Cloud ids

`openrouter/` + the OpenRouter `id` verbatim, `:free` suffix included:

```
openrouter/google/gemma-4-31b-it:free
openrouter/minimax/minimax-m2.7:free
openrouter/free                            ← the free router pseudo-model
```

`providerModelId` is the part after `openrouter/` and is what goes on the wire.

---

## 4. Sources and aggregation

```ts
export interface CatalogSourceContext {
  signal?: AbortSignal;
  /** Force a network refetch, ignoring a fresh cache. */
  refresh?: boolean;
  /** Never touch the network. Set by SHELRA_OFFLINE or --offline. */
  offline?: boolean;
}

export interface CatalogSourceResult {
  entries: CatalogEntry[];
  /** "network" | "cache" | "bundled" | "live" — for the staleness footer. */
  origin: "live" | "network" | "cache" | "bundled";
  fetchedAt?: string;
  /** Non-fatal problems to show the user; never thrown. */
  warnings: string[];
}

export interface CatalogProvider {
  readonly id: string;                 // "local" | "openrouter"
  readonly category: CatalogCategory;
  readonly displayName: string;
  /** Env var names that can hold this provider's key. [] for local. */
  readonly envKeys: readonly string[];
  list(ctx: CatalogSourceContext): Promise<CatalogSourceResult>;
  /** Build a live adapter for one of this source's entries. */
  resolveProvider(entry: CatalogEntry, ctx: ResolveContext): Promise<ResolvedProvider>;
}
```

**A source never throws.** A network failure returns
`{entries: <from cache or bundled>, origin, warnings: [...]}`. The aggregator
concatenates, de-duplicates by `id`, and sorts: local-installed → local-available
→ cloud-free-with-key → cloud-free-without-key → cloud-paid.

### 4.1 `LocalSource`

Composes three existing, unmodified functions (`03 §2`, `§3.3`):

| Input | Produces |
| --- | --- |
| `discoverLocalRuntimes()` → `discovery.models` | `install: "installed"`, `runtimeId`, `runtimeKind`, `contextWindow` from the candidate, confidence `catalog` (or `measured` once §7 lands) |
| `discoverInstalledHuggingFaceModels()` | on-disk `path`, `sizeBytes`, `quantization`, `parameters` |
| `HUGGING_FACE_MODELS` minus the installed set | `install: "available"`, `sizeBytes` = `spec.sizeBytes`, `contextWindow` = `spec.contextWindow`, confidence `catalog` |

`cost` is always `{prompt: 0, completion: 0, free: true}`.
`capabilities` comes from the candidate (`tools`, `reasoning`, `supportsVision`).

**Important:** `LocalSource.list()` must be able to run *without* starting a
llama-server. `discoverInstalledHuggingFaceModels` is a pure directory read and
`ManagedLlamaRuntime.listModels` is documented as side-effect free
(`managed-llama.ts:296-300`: *"Detection is a filesystem question only.
Enumerating runtimes must never load a model"*). So `shelra models` can list
without spawning anything — **an improvement on today**, where the command does
a full 60-second `discoverLocalRuntimes` (`index.ts:936`).

### 4.2 `OpenRouterSource`

1. `GET https://openrouter.ai/api/v1/models` — **no auth header** (`02 §3`).
   10 s timeout, 2 retries with jittered backoff (copying `01 §2.2`).
2. Normalise each entry:
   * `contextWindow = top_provider.context_length ?? context_length` — and if
     both are null (the `openrouter/free` router), use `context_length`, else
     32 768 with confidence `assumed`.
   * `maxOutputTokens = top_provider.max_completion_tokens ?? undefined`.
   * `cost.prompt = Number(pricing.prompt)`, likewise `completion`;
     `free = pricing.prompt === "0" && pricing.completion === "0"`
     (**string comparison**, per `02 §2.1`).
   * `capabilities.tools = supported_parameters.includes("tools")`
   * `capabilities.reasoning = supported_parameters.includes("reasoning")`
   * `capabilities.vision = architecture.input_modalities.includes("image")`
   * `capabilities.structuredOutput = supported_parameters.includes("response_format")`
   * `moderated = top_provider.is_moderated`
   * `expiresAt` from `expiration_date`; entries already expired are dropped.
3. **Filter for v1:** keep only `cost.free === true`
   **and** `architecture.output_modalities` is exactly `["text"]`
   (this drops the two Lyria audio models — `02 §2.1`).
   Keep non-tool models in the catalog but mark them; `models use` refuses them
   with an explicit error (`05 §4`).
4. `apiKeyConfigured` is filled by the aggregator, not the source (it is a
   property of the environment, not of the model).

**Why OpenRouter's own endpoint and not models.dev (decision, with the
counter-argument stated):**

| | OpenRouter `/api/v1/models` | models.dev `api.json` |
| --- | --- | --- |
| Size | 709 KB | **4.5 MB** |
| OpenRouter model count | **430** | 360 |
| Free-set agreement (2026-09-06) | — | exact (21 = 21) |
| Free flag | `pricing.prompt === "0"` — authoritative | `cost.input === 0` — derived, one hop stale |
| `max_completion_tokens` per serving endpoint | **yes** (`top_provider`) | `limit.output` only |
| `is_moderated`, `expiration_date`, `supported_parameters` | **yes** | partly |
| Multi-provider | no | **yes, 213 providers** |

**Decision: adopt a models.dev-*style* metadata schema (§2 borrows
`limit`/capability-flag thinking directly from `01 §1.1`), but fetch
OpenRouter's own endpoint for the OpenRouter provider.** Keep models.dev
documented as the future `ModelsDevSource` for a second/third cloud provider —
it slots in as another `CatalogProvider` with no consumer change, which is the
whole point of the interface.

---

## 5. Provider resolution

```ts
export interface ResolvedProvider {
  provider: ProviderAdapter;
  /** The id to pass to provider.stream({modelId}). */
  modelId: string;
  entry: CatalogEntry;
  /** Cleanup for a managed local runtime; a no-op for cloud. */
  dispose: () => Promise<void>;
}
```

### 5.1 Local

Unchanged from today (`index.ts:193-215`, `orchestrator.ts:114-152`): find the
runtime by `state.runtimeId`, `runtime.prepareModel(id)`, `runtime.provider(candidate)`,
`probeLocalModel`, `agent.setProvider(provider, id)`.
The catalog only supplies the candidate; it does not take over the lifecycle.

### 5.2 Cloud

```ts
createOpenAICompatibleProvider(
  apiKey,                              // resolved per §6
  "https://openrouter.ai/api/v1",
  entry.state.providerModelId,         // "google/gemma-4-31b-it:free"
  {
    headers: {
      "HTTP-Referer": "https://shelra.dev/",     // ← confirm the real URL
      "X-OpenRouter-Title": "ShelraCode",
    },
    maxRetries: 2,
    contextWindow: entry.contextWindow,
    maxOutputTokens: entry.maxOutputTokens,
    capabilities: entry.capabilities,
    cost: entry.cost,
  },
)
```

**Three concrete changes to `createOpenAICompatibleProvider`
(`src/runtimes/local-provider.ts:133-152`), all backwards compatible:**

1. **Add an optional 4th options argument.** The 3-arg call in
   `discovery.ts:69` keeps working unchanged.
2. **Kill the synthetic `contextWindow: 128_000` (`:141`)** when the caller
   supplies one. Today *every* remote model claims 128 K regardless of truth —
   for `liquid/lfm-2.5-2.6b:free` (65 536) that over-reports by 2×, and for
   `minimax/minimax-m3:free` (1 048 576) it under-reports by 8×.
3. **Parameterise `maxRetries` (`:88`).**
   **Call-out, as instructed:** `LocalProviderAdapter.stream` hardcodes
   `maxRetries: 0`. Correct for a loopback server; **wrong for a rate-limited
   internet endpoint** where a single 429 (20 RPM — `02 §4`) currently kills the
   whole turn. Recommendation: `maxRetries: 0` for `category === "local"`,
   `maxRetries: 2` for `"cloud"`. Note the existing inconsistency: `generateText`
   (`:111-118`) sets no `maxRetries` and thus already retries by SDK default.
   Both should be driven by the same option.

`maxRetries` alone does **not** solve the streaming failure mode described in
`02 §4` (a mid-stream `finish_reason: "error"` arrives over an HTTP 200). That
needs `normalizeProviderEvents` to emit `{type: "error"}` — flagged in `07 §6`,
out of scope here.

**The `ProviderAdapter` seam is untouched.** No new method, no changed
signature. `src/providers/architecture.test.ts` (`03 §4`) greps `agent.ts`,
`tools.ts` and `compaction.ts` for `XaiProvider` / `@ai-sdk/xai`; the catalog
introduces neither, and the catalog *types* module deliberately has no I/O so
`agent.ts` can import it safely.

---

## 6. Auth

### 6.1 Where the key lives — recommendation

**Recommend the OpenCode pattern: a sibling `~/.shelra/auth.json`, mode `0o600`,
keyed by provider id** (`01 §3`).

```json
{
  "openrouter": { "type": "api", "key": "sk-or-v1-…" }
}
```

Rationale (in order of weight):

1. `~/.shelra/user-settings.json` is the file a user pastes into a bug report.
   It already holds `telegram.botToken` and `apiKey`, which is a pre-existing
   problem this design should not deepen.
2. A separate file can be `.gitignore`d, backed up and permission-audited as one
   unit.
3. The `{type: "api" | "oauth"}` union leaves room for an OAuth provider later
   without a settings-schema migration.
4. `saveUserSettings` merges the *entire* settings object on every write
   (`settings.ts:231-314`); keeping credentials out of that merge path removes a
   class of accidental-overwrite bug.

**Alternative if a second file is unwanted:** `UserSettings.providers?:
Record<string, {apiKey?: string}>`. Simpler, one fewer file, reuses the existing
`0o600` writer — but co-locates secrets with shareable config. **Needs user
sign-off (`07`).**

Either way, `settings.ts:getApiKey()` and `getBaseURL()` keep their current
meaning ("the single legacy remote provider, used by `--remote`") and are **not**
repurposed.

### 6.2 Precedence

For provider `openrouter`, first non-empty wins:

1. `--api-key` on the command line *(session only — see below)*
2. `OPENROUTER_API_KEY` environment variable
3. `~/.shelra/auth.json` → `openrouter.key`
4. *(nothing)* → the entry is listed but marked "needs API key"

**Note on 1:** `resolveConfig` currently *persists* `--api-key` to settings
immediately (`index.ts:765`). For a per-provider key that side effect is
surprising. Recommendation: `--api-key` stays session-only; persisting is what
`shelra auth openrouter --key …` is for. **Needs user sign-off (`07`).**

Env-var names are declared per provider (`CatalogProvider.envKeys`), copying
OpenCode's data-driven `provider.env` (`01 §3`), so a second provider needs no
new `if`.

### 6.3 The missing-key error — exact text

When a cloud entry is selected with no resolvable key:

```
openrouter/google/gemma-4-31b-it:free needs an OpenRouter API key.

  Set one with:   shelra auth openrouter --key <key>
  Or export:      OPENROUTER_API_KEY=<key>

  Get a key at https://openrouter.ai/keys
  Free models also require enabling free training endpoints at
  https://openrouter.ai/settings/privacy — otherwise requests fail with
  "404 No endpoints found matching your data policy".
```

The last paragraph is not optional. `02 §4` establishes that free models are
served only to accounts that have opted into training on their inputs; a
privacy-first CLI must say so before the first cloud call, not after a confusing
404.

---

## 7. `contextWindow` — the hand-off to the queued context-budget fix

> **Scope boundary.** This section defines *where the numbers come from* and
> *how they reach `modelInfo`*. It deliberately does **not** design compaction
> thresholds, `--ctx-size` bounding, or overflow recovery. Those belong to the
> queued "model-aware context budget" work. The hand-off point is exactly:
> **`ProviderModelRuntime.modelInfo.contextWindow` and `.maxOutputTokens` are
> populated from `CatalogEntry`, and are real.**

### 7.1 Today's numbers are wrong in four distinct places

| Site | Value | Why it's wrong |
| --- | --- | --- |
| `local-provider.ts:141` | `contextWindow: 128_000` | synthetic; identical for every remote model |
| `discovery.ts:53` | `contextWindow: 32_768` | guessed for every model an explicit endpoint reports |
| `huggingface.ts:326` | `contextWindow: 32_768` | fallback for a sidecar-less GGUF |
| `managed-llama.ts:227-237` | server started with `--ctx-size` clamped to `CUDA_CONTEXT_HEADROOM` (16 384) on CUDA | **the advertised 32 768 is up to 2× the served window** |

The fourth is the dangerous one: the agent budgets against 32 768 while
llama-server will hard-fail past 16 384.

### 7.2 Where the truth comes from

**Local:**

1. **Best — the live server.** After `prepareModel` succeeds, `GET
   <serverURL>/props` on llama-server returns the model metadata including the
   effective `n_ctx`. `ManagedLlamaRuntime` already polls `<serverURL>/health`
   (`managed-llama.ts:167`), so the plumbing exists. Record it as
   `state.servedContextWindow` with confidence `measured` and let it override
   `contextWindow`.
2. **Next — the value we passed.** `ManagedLlamaRuntime` computed the
   `--ctx-size` argument itself (`:227-237`); even without `/props`, emitting
   *that* number instead of the spec's is strictly better. Confidence `declared`.
3. **Next — the GGUF header** `n_ctx_train`, read from the file. Confidence
   `declared`.
4. **Fallback — `HUGGING_FACE_MODELS[].contextWindow`.** Confidence `catalog`.
5. **Last — `DEFAULT_CONTEXT` (32 768).** Confidence `assumed`.

**Cloud:** `top_provider.context_length` (confidence `declared`), falling back
to `context_length`, then `assumed`. `maxOutputTokens` from
`top_provider.max_completion_tokens`.

### 7.3 The wiring

```
CatalogEntry.contextWindow / .maxOutputTokens / .contextConfidence
   │
   ├─ local  → LocalModelCandidate.contextWindow
   │            → LocalProviderAdapter.resolveModelRuntime()   (local-provider.ts:61-79)
   │            → ProviderModelRuntime.modelInfo.contextWindow
   │
   └─ cloud  → createOpenAICompatibleProvider(..., {contextWindow, maxOutputTokens})
                → the same resolveModelRuntime(), no longer synthesising 128_000
   │
   └────────▶ agent.getModelInfo()          (agent.ts:655-657)
              agent.getContextStats(info.contextWindow, …)   (agent.ts:753)
              ui/app.tsx:806-807 context gauge
              [queued work] compaction thresholds, --ctx-size bounding, overflow recovery
```

`agent.getContextStats` already takes `contextWindow` as a **parameter** rather
than caching it (`03 §7`, audit `14` §4), so a mid-session model switch picks up
the new number on the next call with no invalidation step. That is a genuine
piece of luck and should be preserved.

**Minimum this project owes the queued fix:**
`modelInfo.contextWindow` is a real per-model number, `modelInfo.maxOutputTokens`
exists, and `contextConfidence` says whether to trust it. Anything the queued
fix wants to do with headroom ratios is then arithmetic on correct inputs.

---

## 8. Caching and freshness

| Concern | Decision |
| --- | --- |
| Cache path | `~/.shelra/catalog/<provider>.json` (e.g. `catalog/openrouter.json`) |
| Cached payload | the **normalised `CatalogEntry[]`**, not the raw 709 KB response — ~20 KB for the free set, and it makes the schema explicit |
| Envelope | `{ version: 1, provider: "openrouter", fetchedAt: "…", source: "https://…", entries: [...] }` |
| **TTL — proposed 6 hours** | see below |
| Write | atomic: `<file>.tmp` → `rename` (copying `01 §2.2`), mode `0o600` |
| Read failure | delete the corrupt file, fall through to bundled (copying `models-dev.ts:185-194`) |
| Force refresh | `--refresh` on `models`/`models list`, or `shelra models refresh` |
| Background refresh | **none in v1.** OpenCode forks a 60-minute refresher; a CLI that runs for 30 seconds should not. Refresh on demand, and opportunistically when the cache is older than the TTL *and* a fetch is already happening. |
| Offline | `SHELRA_OFFLINE=1` (and/or `--offline`) → never fetch; serve cache, then bundled. Mirrors `OPENCODE_DISABLE_MODELS_FETCH`. |
| Source override | `SHELRA_OPENROUTER_MODELS_URL` for tests/mirrors (mirrors `OPENCODE_MODELS_URL`) |

**Why 6 hours (INFERENCE, medium confidence):** OpenCode uses 5 minutes with a
60-minute background refresher — appropriate for a long-lived server watching a
213-provider catalog. Our data changes on the order of *days* (models are added
and expire), the payload is a full HTTP round trip on a possibly-metered
connection, and a stale free-model list has a cheap failure mode (a 404 that
triggers a refresh — `02 §7.7`). 6 hours means at most one fetch per working
session. **1 hour and 24 hours are both defensible; needs sign-off (`07`).**

**Bundled offline fallback:** a checked-in
`src/models/openrouter-fallback.ts` holding ~8 `CatalogEntry` objects for
well-known free, tool-capable models, each carrying
`contextConfidence: "fallback"`. Candidates from the 2026-09-06 snapshot
(`02 §2.4`): `google/gemma-4-31b-it:free`, `minimax/minimax-m2.7:free`,
`nvidia/nemotron-3-super-120b-a12b:free`, `poolside/laguna-s-2.1:free`,
`cohere/north-mini-code:free`, `liquid/lfm-2.5-2.6b:free`,
`dots-studio/dots-3-note-preview:free`, `nvidia/nemotron-3.5-lightning:free`.

**Warning to record in the code comment:** every one of those ids can expire
(`expiration_date` exists — `02 §1.2`). The fallback list is a *starting point
for a first run with no network*, not a source of truth. The UI must label
fallback-origin entries (`05 §4`).

**Load order (copying `01 §2.2` exactly): fresh cache → network → stale cache →
bundled fallback.** Note the deliberate difference from OpenCode: OpenCode uses
*any* disk cache before the network; we prefer the network over a **stale**
cache, because a stale free-model list produces 404s that a fresh one would not.

---

## 9. Local-first stance — recommended policy

### Baseline recommendation (matches the brief, with the reasoning made explicit)

1. **Cloud entries always appear in `shelra models` and the `/models` picker**,
   in a `CLOUD` section, marked `needs API key` when no key resolves. Listing is
   not using.
2. **Startup auto-selection remains local-only.** `runStartup`
   (`orchestrator.ts:64-259`) and `selectLocalRoute`
   (`router/local-first.ts`) are untouched: a ready local model is always
   preferred and a cloud model is **never** auto-selected.
3. **A cloud model becomes active only on an explicit act:**
   `shelra models use openrouter/…`, selecting it in the picker, or
   `--model openrouter/…` on the command line.
4. **`--remote`, `SHELRA_API_KEY` and `SHELRA_BASE_URL` keep working exactly as
   today** (`index.ts:474-478`, `settings.ts:341-347`). They are the "one
   generic OpenAI-compatible endpoint" path and are orthogonal to the catalog.
5. **The privacy boundary at `index.ts:108-115` is preserved.** The Agent is
   constructed with `undefined` credentials on the local path. A cloud adapter
   is built *only* after an explicit selection resolves to a cloud entry.
6. **First cloud use in a session prints a one-time notice** naming the endpoint
   and the data-policy requirement (`05 §4`).

### Alternatives considered

| Option | Description | Verdict |
| --- | --- | --- |
| **A. Hidden until authenticated** | Cloud section appears only once a key exists | Strongest local-first signal, but creates a discovery dead end: the user cannot find out that free models exist. **Rejected** — the `needs API key` marker gets the same protection with none of the opacity. |
| **B. Baseline (recommended)** | Always listed, never auto-selected, explicit activation | Recommended. |
| **C. Opt-in flag** | Cloud hidden behind `SHELRA_CLOUD=1` / a settings toggle | Reasonable for an enterprise posture. Suggest shipping B and adding a `catalog.cloud: false` settings escape hatch for users who want the guarantee. |
| **D. Automatic fallback** | Fall back to a free cloud model when no local model is ready | **Reject.** Audit `18` §7 already states: *"Do not add remote-provider fallbacks into the local path."* It would silently ship a user's code to a third party that trains on it. |

**Additional recommended guard:** when the active model is cloud, the status
line must say so continuously — not just at switch time. A user who forgets
which model is active is exactly the failure mode this product exists to
prevent.

### What actually leaves the machine

**With no cloud model selected — unchanged from today:**

| Destination | When | Payload |
| --- | --- | --- |
| `huggingface.co` | model download only | a GGUF `GET` (`huggingface.ts:79-83`) |
| *(nothing else)* | | |

**With the catalog enabled — exactly two additions:**

| Destination | When | Payload | Contains user data? |
| --- | --- | --- | --- |
| `GET https://openrouter.ai/api/v1/models` | on `shelra models` / picker open with a stale cache, or `models refresh` | **no auth header, no body, no query.** Only a User-Agent (`ShelraCode/<version>`) | **No.** Not the API key, not hardware, not the workspace, not a model id. |
| `POST https://openrouter.ai/api/v1/chat/completions` | only while a cloud model is the active model | the conversation: system prompt, messages, tool schemas, tool results, file contents the agent has read | **Yes — this is the whole conversation.** |
| headers on that POST | | `Authorization: Bearer <key>`, `HTTP-Referer: https://shelra.dev/`, `X-OpenRouter-Title: ShelraCode` | the two attribution headers are static strings; they identify the *app*, never the user |

**Explicitly NOT sent, ever:** the hardware profile (`src/hardware/profile.ts`),
the list of installed local models, the workspace path, telemetry of any kind.
The catalog fetch is a plain unauthenticated GET — OpenRouter cannot correlate
it with an account.

**And the corollary the user must be told (`02 §4`):** free OpenRouter models
are served only to accounts that have enabled "free endpoints that may train on
inputs". Selecting a free cloud model therefore means **the conversation may be
used to train a third-party model.** That is the actual privacy cost, and it is
larger than anything in the table above.

---

## 10. Migration

**Invariant: after every phase, `bun test` passes and `tsc` is clean.**

### 10.1 `catalog.ts` — keep the module, change the backing

Every export keeps its exact signature. `src/models/catalog.ts` becomes a thin
facade over the catalog:

| Export | Before | After |
| --- | --- | --- |
| `normalizeModelId(id)` | `id.trim()` | **unchanged** — the test pins it |
| `getModelInfo(id)` | `undefined` | `catalogEntryToModelInfo(lookupCached(id))` or `undefined` |
| `MODELS` | `[]` | **deprecated**; keep exporting `[]` and add `listCachedModelInfo()` |
| `DEFAULT_MODEL` | `""` | **unchanged `""`** — see below |
| `getModelIds()` | `[]` | ids from the cached catalog |
| `isKnownModelId(id)` | `false` | resolves against the cached catalog |
| `getSupportedReasoningEfforts(id)` | `[]` | from `capabilities.reasoning` + OpenRouter `reasoning_options` — **Phase 8, not before** |
| `getEffectiveReasoningEffort(id, o)` | `undefined` | same |

**`getModelInfo` must stay synchronous.** It is called from
`agent.ts:566`, `client.ts:61`, `usage.ts:95` and `app.tsx:806` — none of which
can await. So the facade reads a **process-local in-memory snapshot** populated
by an explicit `await primeCatalog()` at CLI startup, and returns `undefined`
before priming. That is exactly today's behaviour, so nothing regresses if
priming is skipped (e.g. in a unit test).

**Do not change `DEFAULT_MODEL` from `""`.** Making it non-empty would change
`resolveCurrentModel` (`settings.ts:369-372`) → `getCurrentModel` → the `Agent`
constructor's `this.modelId` (`agent.ts:614`) on every machine with no
`defaultModel` — a behaviour change far outside this project's blast radius, and
one that would pick a model before discovery has run.

### 10.2 Nothing renamed without a shim

* `toModelInfo` (`index.ts:451`) is superseded by `catalogEntryToModelInfo`, but
  stays until the last caller moves.
* `LocalModelCandidate` keeps its shape; the catalog maps *to* it.
* `LocalRuntimeAdapter` is untouched.
* `formatBytes` (`index.ts:467`) is a duplicate of `formatDownloadSize`
  (`huggingface.ts:334`); consolidate opportunistically, not as a prerequisite.

### 10.3 The test that must change

`src/models/catalog.test.ts` asserts the stubs (`MODELS === []`,
`DEFAULT_MODEL === ""`, `getModelIds() === []`,
`getModelInfo("grok-4.3") === undefined`). Rewrite it to assert:

* `normalizeModelId` still round-trips `hf:…:Q4_K_M` (**keep verbatim**);
* `getModelInfo` returns `undefined` before priming;
* after priming with a fixture, `getModelInfo` returns a real `ModelInfo` with a
  real `contextWindow`;
* `DEFAULT_MODEL` is still `""`.
