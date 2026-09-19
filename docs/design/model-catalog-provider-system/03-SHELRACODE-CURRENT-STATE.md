# 03 — Audit: ShelraCode's current model / provider / catalog code

**Repository:** `D:\PROYECTS\shelra` (product `ShelraCode`, package `shelra`).
**Observed at:** 2026-09-06 ~19:37 local.
**Working tree:** dirty. 44 tracked files modified, `src/toolset/models.ts` and
`src/toolset/models.test.ts` deleted, and the following directories **untracked**
(i.e. new, never committed): `docs/`, `scripts/`, `src/cli/`, `src/context/`,
`src/hardware/`, `src/models/`, `src/product/`, `src/providers/`, `src/router/`,
`src/runtimes/`, `src/security/`, `src/setup/`, `src/startup/`, plus
`src/agent/kernel.ts`, `src/ui/startup.tsx`, `src/ui/startup-input.ts`.

> **Concurrency note (per instructions):** another interactive session is
> intermittently editing `src/runtimes/*` and `src/models/*`. Everything below
> was read at the timestamp above and only read — no file in `src/` was
> modified, created or deleted by this task. Line numbers may drift if that
> session has since edited those files.

---

## 1. `src/models/catalog.ts` — every export is a stub

**FACT — the whole file is 32 lines and returns constants** (`src/models/catalog.ts:1-32`):

| Export | Line | Behaviour |
| --- | --- | --- |
| `MODELS: ModelInfo[]` | `:4` | `[]` |
| `DEFAULT_MODEL` | `:5` | `""` |
| `normalizeModelId(id)` | `:7-9` | `id.trim()` — **the only export with behaviour** |
| `getModelInfo(_)` | `:11-13` | always `undefined` |
| `getModelIds()` | `:15-17` | `[]` |
| `isKnownModelId(_)` | `:19-21` | always `false` |
| `getSupportedReasoningEfforts(_)` | `:23-25` | `[]` |
| `getEffectiveReasoningEffort(_, _)` | `:27-32` | always `undefined` |

Header comment at `:3`: *"The active runtime supplies model metadata; no
provider models are bundled."*

**FACT — the test asserts the emptiness** (`src/models/catalog.test.ts:4-17`):
`expect(MODELS).toEqual([])`, `expect(DEFAULT_MODEL).toBe("")`,
`expect(getModelIds()).toEqual([])`, `expect(getModelInfo("test-model-a")).toBeUndefined()`.
It also pins the normalisation contract: a padded
`hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M` must round-trip unchanged
apart from trimming (`:12-16`). **Any real catalog must keep that property** —
model ids are opaque and must not be aliased or lower-cased.

### 1.1 Consumers — six, not four

**FACT — `grep -rn "models/catalog|from \"./catalog\"" src/`:**

| Consumer | Line | Imports | What breaks today |
| --- | --- | --- | --- |
| `src/agent/agent.ts` | `:36` | `getModelInfo`, `normalizeModelId` | `applyModelConstraints` at `:566` reads `getModelInfo(modelId)` → always `undefined`; `agent.getModelInfo()` at `:655-657` falls back to `undefined` when no provider is set |
| `src/toolset/client.ts` | `:5` | `getEffectiveReasoningEffort`, `getModelInfo`, `normalizeModelId` | `:60-62` computes a `modelInfo` that is always `undefined` and a reasoning effort that is always `undefined` |
| `src/index.ts` | `:17` | `normalizeModelId` | fine (trim only) — `:702`, `:748`, `:766` |
| `src/storage/usage.ts` | `:1` | `getModelInfo` | `:95` — token→cost accounting has no prices, so **cost is always unknown** |
| `src/ui/app.tsx` | `:11-15` | `getEffectiveReasoningEffort`, `getModelInfo`, `getSupportedReasoningEfforts`, `normalizeModelId` | `:806` context gauge disappears when there is no provider; `ModelPickerModal`'s reasoning-effort column (`:5399`, `:5434-5437`) is permanently empty |
| `src/utils/settings.ts` | `:11` | `DEFAULT_MODEL`, `getEffectiveReasoningEffort`, `normalizeModelId` | `resolveCurrentModel` (`:369-372`) returns `""` when no `defaultModel` is stored; `getReasoningEffortForModel` (`:626-633`) always `undefined` |
| *(test)* `src/models/catalog.test.ts` | `:2` | all of the above | pins the stubs |

**This corrects the task brief's "4 consumers" to 6 production consumers plus
one test.** `storage/usage.ts` and `index.ts` are the two extra ones, and
`usage.ts` is the reason a real catalog immediately fixes cost accounting.

**Cross-reference:** audit `07-MODEL-CATALOG.md` §1 reached the same conclusion
independently ("PLACEHOLDER — deliberately emptied", "the only function with
behaviour is `normalizeModelId`") and enumerates the same four downstream
consequences. **Verified against current code: still accurate.**

---

## 2. `src/models/huggingface.ts` — the *real* local catalog (343 lines)

**FACT — the installable list is a 2-entry frozen array**
(`src/models/huggingface.ts:43-70`):

| id | file | quant | params | ctx | est. GB | sizeBytes | sha256 |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| `hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M` | `qwen2.5-coder-1.5b-instruct-q4_k_m.gguf` | Q4_K_M | 1.5 B | 32 768 | 2.2 | 1 117 320 768 | `cc324af0…` |
| `hf:Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M` | `qwen2.5-coder-7b-instruct-q4_k_m.gguf` | Q4_K_M | 7 B | 32 768 | 5.3 | 5 025 000 000 | `509287f7…` |

`HuggingFaceModelSpec` (`:7-20`) = `{ id, displayName, repoId, filename,
revision, quantization, parameters, contextWindow, estimatedMemoryGb, sha256?,
sizeBytes? }`.

**FACT — the id format is `hf:<repoId>:<quant>`** (`:45`, `:58`) and the doc
comment at `:9` says *"Stable Shelra identity. The value is never sent to a
third-party runtime."*

**Other exports, all reusable as-is:**

| Symbol | Line | Notes |
| --- | --- | --- |
| `getHuggingFaceModelSpec(id)` | `:74-77` | exact-match lookup over the array |
| `huggingFaceResolveUrl(spec)` | `:79-83` | `https://huggingface.co/<repo>/resolve/<rev>/<file>?download=true` |
| `defaultModelDirectory()` | `:85-87` | `path.join(getProductUserDir(), "models")` → `~/.shelra/models` |
| `modelArtifactPath(spec, dir)` | `:89-91` | |
| `downloadHuggingFaceModel(spec, opts)` | `:163-245` | Range-resume, `.part` retained across interruption, 416 handling with hash proof (`:189-203`), SHA-256 verify (`:235-241`), atomic `rename` + `0o600` sidecar (`:148-156`), progress with speed/ETA |
| `discoverInstalledHuggingFaceModels(dir)` | `:269-332` | **the local filesystem scan.** Reads `*.gguf`, prefers the `<file>.json` sidecar, falls back to filename→catalog match (`:304`), finally to an anonymous `local:<filename>` spec with **`contextWindow: 32_768` hardcoded** (`:326`) |
| `formatDownloadSize(bytes)` | `:334-338` | `"1.0 GB"` / `"512 MB"` / `"size unknown"` |
| `formatDownloadSpeed(bytes)` | `:340-343` | `"… /s"` / `"calculating speed"` |

**FACT — `installModel` is *not* in this file.** The install entry point is
`ManagedLlamaRuntime.installModel` (`src/runtimes/managed-llama.ts:364-387`),
which resolves the spec via `getHuggingFaceModelSpec` and **refuses anything not
in the array** (`:376`): *"That Hugging Face model is not in Shelra's reviewed
local catalog."* Audit `18` §1 calls this "catalog-as-allowlist … a genuine
supply-chain control. Keep it."

**FACT — `installLocalModel`** (`src/models/manager.ts:28-53`) is the
orchestration wrapper: finds a runtime with `installModel` (`:20-22`), enforces
a disk-space floor of `max(4, expectedSizeGb * 1.25)` GB (`:42-45`), and
forwards progress annotated with `{runtime, modelId}` (`:50`).

**FACT — `recommendBootstrapModel`** (`src/models/recommendation.ts:17-70`)
picks between exactly those two entries by GPU VRAM / RAM, honours
`SHELRA_ONBOARDING_MODEL` (`:21-31`), and returns
`{id, name, estimatedMemoryGb, reason, alternatives[]}`.
It indexes `HUGGING_FACE_MODELS[0]` / `[1]` **positionally** (`:35`, `:41`,
`:46-52`, `:56-68`) — adding a third entry silently changes its behaviour.
Audit `18` §2 flags this as a duplicate of `localModelFitScore`.

---

## 3. Runtimes

### 3.1 `src/runtimes/types.ts` — `LocalModelCandidate`

**FACT** (`:11-33`): `{ id, name, runtimeId, runtimeKind, baseURL,
contextWindow, tools, structuredOutput, reasoning, loaded?, parameters?,
quantization?, source: "local"|"remote", capabilityConfidence?, supportsVision?,
memoryRequiredGb?, estimatedTokensPerSecond?, capabilityClass? }`.

`LocalRuntimeKind = "managed-llama" | "openai-compatible"` (`:3`).
`LocalRuntimeAdapter` (`:35-66`) is the runtime contract:
`detect`, `health(signal, modelId?)`, `listModels`, `prepareModel?`,
`dispose?`, `hasRuntimeBinary?`, `installModel?`, `provider(model)`.

**Observation:** `source: "local" | "remote"` already exists on the candidate
type — the local/cloud axis is half-present in the data model, but it is not
surfaced anywhere in the UI or CLI.

### 3.2 `src/runtimes/local-provider.ts` — the provider adapter (152 lines)

**FACT — `LocalProviderAdapter`** (`:40-125`) implements `ProviderAdapter` over
`createOpenAICompatible` from `@ai-sdk/openai-compatible` (`:52-58`):

```ts
this.provider = createOpenAICompatible({
  name: this.id,
  baseURL: model.baseURL,
  ...(apiKey ? { apiKey } : {}),
  includeUsage: true,
  supportsStructuredOutputs: model.structuredOutput,
});
```

`resolveModelRuntime(modelId)` (`:61-79`) synthesises `ModelInfo` **entirely
from the candidate**: `contextWindow: this.model.contextWindow`,
`inputPrice: 0`, `outputPrice: 0` (`:67-68` — hardcoded zero, correct for local,
**wrong for cloud**), `supportsClientTools: this.model.tools`,
`capabilityConfidence`, `runtimeKind`, `supportsVision`.

**FACT — `createLocalProvider(model)`** (`:127-129`) is a one-liner over the
class.

**FACT — `createOpenAICompatibleProvider(apiKey, baseURL, modelId = "default")`**
(`:133-152`) builds a **synthetic** `LocalModelCandidate` and reuses the same
class:

```ts
{
  id: modelId, name: modelId,
  runtimeId: "openai-compatible", runtimeKind: "openai-compatible",
  baseURL: baseURL.replace(/\/$/, ""),
  contextWindow: 128_000,     // ← :141  SYNTHETIC, identical for every model
  tools: true,                // ← :142  ASSUMED
  structuredOutput: true,     // ← :143  ASSUMED
  reasoning: false,           // ← :144  ASSUMED
  source: "remote",
  capabilityConfidence: "unknown",
  supportsVision: false,      // ← :147  ASSUMED
}
```

**This function is the cloud path, and it already works.** What it lacks is
*data*: a real `contextWindow`, real capability flags, real prices, and custom
headers. Every one of those comes from the catalog in `04`.

**FACT — `maxRetries: 0`** is hardcoded in the streaming call
(`src/runtimes/local-provider.ts:88`). For a loopback llama-server that is
correct (a failure is deterministic and retrying wastes seconds). For a
rate-limited internet endpoint it is **wrong**: a single 429 kills the turn.
`generateText` (`:111-118`) does not set `maxRetries` at all, so it inherits the
AI-SDK default. That inconsistency is itself a finding.

### 3.3 `src/runtimes/discovery.ts` (119 lines)

**FACT — `explicitEndpointRuntime(endpoint, fetchImpl)`** (`:7-72`) is a
compatibility escape hatch. `listModels` (`:37-67`) calls `GET <base>/models`,
maps each `data[].id` to a candidate with
**`contextWindow: 32_768` hardcoded** (`:53`), `tools: true`,
`structuredOutput: true`, `reasoning: false`, `capabilityConfidence: "unknown"`
(`:54-60`). Its `provider(model)` (`:68-70`) calls
`createOpenAICompatibleProvider("local", baseURL, model.id)` — note the literal
`"local"` as the API key.

**FACT — it is only created when an env var is set** (`:82-83`):
`SHELRA_LOCAL_ENDPOINT` or `OPENAI_BASE_URL`. The comment at `:79-81` states the
product stance: *"Shelra never installs or starts a third-party runtime and
never probes vendor apps by default."*

**FACT — `discoverLocalRuntimes(adapters, signal)`** (`:87-113`) runs
`detect`/`health`/`listModels` concurrently per adapter (`:93-97`) and keeps an
adapter if it is detected, has models, **or can install models** (`:105-107`) —
so the managed runtime stays visible before its binary exists.
`disposeLocalRuntimes` (`:116-119`) stops managed children.

**This shape — an array of sources, each producing candidates, merged into one
list — is exactly the `CatalogProvider` interface `04` needs.** The catalog
generalises `discoverLocalRuntimes` rather than replacing it.

### 3.4 `src/runtimes/managed-llama.ts` (456 lines)

**FACT — `DEFAULT_CONTEXT = 32_768`** (`:21`) and
`CUDA_CONTEXT_HEADROOM = 16_384` (`:24`, comment: tool schemas + host context
already occupy ~9 K tokens; 16 K keeps a 4 GiB GTX 1650 stable).

**FACT — `modelCandidate(installed, baseURL)`** (`:74-97`) is the
`InstalledHuggingFaceModel` → `LocalModelCandidate` mapper:
`contextWindow: installed.spec.contextWindow || DEFAULT_CONTEXT` (`:84`),
`tools: true`, `structuredOutput: true`, `reasoning: false` (`:85-87` — all
declared, not probed), `capabilityConfidence: "declared"` (`:92`),
`capabilityClass: "agent"` (`:95`), `memoryRequiredGb` from the spec (`:94`).

**FACT — the server is launched with `--ctx-size` taken from the spec**
(`:227-237`):

```ts
"--ctx-size",
String(backend === "cuda"
  ? Math.min(installed.spec.contextWindow || DEFAULT_CONTEXT,
             Number(process.env.SHELRA_GPU_CONTEXT) > 0 ? Number(process.env.SHELRA_GPU_CONTEXT) : CUDA_CONTEXT_HEADROOM)
  : installed.spec.contextWindow || DEFAULT_CONTEXT)
```

**This is the single most important fact for the context hand-off.** On a CUDA
machine the *served* context is capped at 16 384 (or `SHELRA_GPU_CONTEXT`), but
the `LocalModelCandidate.contextWindow` the agent sees is still the spec's
32 768. **The advertised window is up to 2× the real one.** `ManagedLlamaRuntime`
never reads llama-server's `/props` to learn the actual `n_ctx`; it only polls
`/health` (`:167`, `:181`). See `04 §7`.

Other facts: env denylist for the child process (`:29-56` — strips
`*API_KEY*`, `*SECRET*`, `*TOKEN*`, `SHELRA_API_KEY`, `HF_TOKEN`, wallet
mnemonics …); loopback-only port allocation (`:58-72`); `--jinja` always passed
(`:238`); Windows `taskkill /T /F` fallback on shutdown (`:427-431`);
`installModel` gated on the reviewed catalog (`:375-376`).

---

## 4. The provider seam

**FACT — `src/providers/types.ts`** defines the entire contract in 86 lines:

* `ProviderUsage` (`:7-12`) — `{inputTokens?, outputTokens?, totalTokens?, costUsdTicks?}`
* `ProviderModelRuntime` (`:14-19`) — `{modelId, modelInfo?, reasoningEffort?, prefersResponses?}`
* `ProviderStreamRequest` (`:21-34`) — messages and tools are **`unknown`** at
  the boundary (`:24-26`: *"opaque at this boundary and owned by the adapter"*)
* `ProviderEvent` (`:36-43`) — `text-delta | reasoning-delta | tool-call |
  tool-result | tool-approval-request | error | abort`
* `ProviderAdapter` (`:76-86`) — `id`, `defaultModelId?`, `supportsBatch?`,
  `resolveModelRuntime`, `stream`, `generateText`, `getToolContext`

**FACT — `src/providers/stream.ts`** (68 lines) exports
`normalizeProviderEvents`, consumed by `LocalProviderAdapter.stream`
(`local-provider.ts:105`).
**FACT — `src/providers/fake.ts`** (56 lines) is a test double implementing
`ProviderAdapter`.

**FACT — `src/providers/architecture.test.ts` is a text-grep boundary test**
(19 lines). It asserts that `src/agent/agent.ts`, `src/toolset/tools.ts` and
`src/agent/compaction.ts` do **not** contain the string `"XaiProvider"`, and
that `agent.ts` does not contain `"@ai-sdk/xai"`. **Nothing in the catalog
design touches those files' provider imports**, so this test is not at risk —
provided the catalog module never imports an SDK into `agent.ts`. (Design
constraint recorded in `04 §5`.)

---

## 5. `src/index.ts` — the CLI surface

| Concern | Line(s) | Fact |
| --- | --- | --- |
| `normalizeModelId` import | `:17` | from `./models/catalog` |
| `installLocalModel` import | `:18` | from `./models/manager` |
| `discoverLocalRuntimes`, `disposeLocalRuntimes` | `:23` | from `./runtimes/discovery` |
| `startInteractive(..., preferLocal = true)` | `:96-106` | signature |
| **Local-first privacy boundary** | `:108-115` | `new Agent(preferLocal ? undefined : apiKey, preferLocal ? undefined : baseURL, …)` with the comment *"Local-first is also a privacy boundary: do not even initialize a remote adapter in the normal startup path when credentials happen to exist."* |
| `prepareLocalModel(modelId)` | `:193-215` | picks the candidate from `startupDiscovery.models`, calls `runtime.prepareModel`, builds `runtime.provider(candidate)`, `probeLocalModel`, then `agent.setProvider(provider, candidate.id)` and persists `{defaultModel, localRuntimeId, lastLocalHealthCheck}` |
| `renderApp(localModels)` | `:217-240` | passes `localModels: preferLocal ? localModels.map(toModelInfo) : []` (`:229`) and `onSelectLocalModel: preferLocal ? prepareLocalModel : undefined` (`:230`) — **the `--remote` path hands the TUI an empty model list and no picker callback** |
| `installRecommended` | `:242-…` | installs the managed runtime binary then the recommended GGUF |
| `toModelInfo(model)` | `:451-471` | `LocalModelCandidate → ModelInfo`, with `inputPrice: 0, outputPrice: 0` hardcoded (`:456-457`) |
| `formatBytes` | `:467-471` | duplicate of `formatDownloadSize` in `huggingface.ts:334` |
| `getRemoteConfigurationError(apiKey, baseURL)` | `:474-478` | requires **both** `SHELRA_API_KEY` and `SHELRA_BASE_URL`; message: *"--remote needs a remote provider, but … not set. Set … (or pass --api-key/--base-url), or drop --remote to run locally."* |
| `configureLocalProvider(agent, requestedModel, activate, requireReady)` | `:480-530` | `if (!activate) return {models: [], …}` (`:488`) — `--remote` never touches a runtime; `requireReady` path runs `runStartup` and throws *"No usable local model is available. Run `shelra` to start onboarding."* (`:493`); fast path uses a **750 ms** discovery timeout (`:506`) and `selectLocalRoute({requiresTools: true})` (`:509-513`) |
| `runHeadless` | `:532-597` | same `preferLocal` gating (`:545`), remote-config check at `:552` |
| `runBackgroundDelegation` | `:692-742` | `preferLocal = options.remote !== true` (`:707`) |
| `resolveConfig(options)` | `:744-769` | `apiKey = --api-key \|\| getApiKey()`, `baseURL = --base-url \|\| getBaseURL()`, model normalised (`:748`); **side effect:** `--api-key` and `--model` are persisted to user settings immediately (`:765-766`) |
| Root options | `:795-798` | `-k/--api-key`, `-u/--base-url`, `-m/--model`, `--remote` ("Prefer the configured remote provider over local runtimes") |
| `setup` command | `:886-896` | `--non-interactive`, `-m/--model`; calls `runOnboarding` |
| **`models` command** | `:931-952` | prints `"<PRODUCT> local model catalog:"`, calls `discoverLocalRuntimes(undefined, AbortSignal.timeout(60_000))` (`:936`), prints `id — name (runtimeKind, <ctx> context, free)` per model (`:941-943`), else *"No Shelra-managed local model is ready yet. Run `shelra` to start automatic onboarding."* (`:946`), and always disposes runtimes (`:949`) |
| `formatContext(tokens)` | `:1067-1070` | `≥1M → "<n>M"`, else `"<n>K"` |

**FACT — `shelra models` has no subcommands, no flags, no `--json`, and shows
only *discovered* local models.** Models that are *installable but not
installed* are invisible; cloud models do not exist.

---

## 6. Settings & identity

**FACT — `src/product/identity.ts`** (28 lines): `PRODUCT_NAME = "ShelraCode"`,
`CLI_NAME = "shelra"`, `CONFIG_DIR_NAME = ".shelra"`,
`API_KEY_ENV = "SHELRA_API_KEY"`, `BASE_URL_ENV = "SHELRA_BASE_URL"`,
`MODEL_ENV = "SHELRA_MODEL"`, `MAX_TOKENS_ENV = "SHELRA_MAX_TOKENS"`,
`BACKGROUND_CHILD_ENV`, `HOOK_EVENT_ENV`; `getProductUserDir()` → `~/.shelra`
(`:21-23`).

**FACT — `UserSettings`** (`src/utils/settings.ts:176-193`):

```ts
{ apiKey?, defaultModel?, localRuntimeId?, lastLocalHealthCheck?, recapsEnabled?,
  sandboxMode?, sandbox?, lsp?, reasoningEffortByModel?, telegram?, mcp?,
  subAgents?, hooks?, payments?, modeModels? }
```

**There is no `providers` key and no per-provider credential storage today.**
`apiKey` is a single flat string — implicitly "the one remote provider".

**FACT — `ProjectSettings`** (`:195-200`): `{model?, sandboxMode?, sandbox?, lsp?}`,
read from `<cwd>/.shelra/settings.json`
(`:316-320`).

**FACT — paths.** `USER_SETTINGS_PATH = ~/.shelra/user-settings.json`
(`:204`); `loadUserSettings` reads that path only and `saveUserSettings` writes
it only; there is no legacy-path fallback and no migration marker. Directory mode `0o700` (`:209`), file mode `0o600` (`:224`).

**FACT — credential accessors:**

```ts
getApiKey()  = process.env.SHELRA_API_KEY || loadUserSettings().apiKey   // :341-343
getBaseURL() = process.env.SHELRA_BASE_URL || ""                        // :345-347
```

**FACT — model precedence** (`getCurrentModel(mode)`, `:349-365`):
`SHELRA_MODEL` env → project `settings.json` `model` → user `modeModels[mode]`
→ user `defaultModel` → `DEFAULT_MODEL` (= `""`).
`resolveCurrentModel(modeModel, defaultModel)` (`:369-372`) is the pure,
testable core. `getModeSpecificModel(mode)` (`:379-385`) — only `SHELRA_MODEL`
suppresses a mode-specific model.

**FACT — `saveUserSettings` normalises `defaultModel`** through
`normalizeModelId` (`:239`) and likewise every key of `reasoningEffortByModel`
(`:241-250`) and every subagent `model` (`:276-283`). A new id scheme must
survive `trim()` — it does.

---

## 7. Startup, onboarding and UI

**FACT — `src/startup/orchestrator.ts`** (259 lines):
`runStartup(options)` (`:64-259`) is the state machine
`booting → detecting-runtime → detecting-hardware → detecting-models →
recommending-model → (onboarding | validating-model → preparing-runtime →
loading-model → health-check → ready | recoverable-error)`.

* Discovery budget is **60 s** (`:77`) — the comment at `:73-76` explains a
  managed model needs seconds to load.
* `selectLocalRoute(discovery.models, {preferredModel, requiresTools: true, hardware})`
  (`:97-101`) chooses the model.
* **No model → `state: "onboarding"` with `recommendBootstrapModel(hardware)`**
  (`:103-112`). *This is the branch where a free cloud model should be offered
  (`06`, Phase 9).*
* `probeLocalModel(provider, model)` (`:27-52`) sends
  `system: "Reply with the single word READY."` with a 60 s budget.
* OOM-driven fallback to a smaller model (`:162-207`), matched on
  `/out.?of.?memory|oom|memory|load|resource/i` (`:163`).
* On success it persists `{defaultModel, localRuntimeId, lastLocalHealthCheck}`
  (`:242-248`) unless `persistSelection === false`.

**FACT — `src/router/local-first.ts`** — `selectLocalRoute(models, request)`
filters on `requiresTools` and `contextTokens`, ranks by
`localModelFitScore(model, hardware)`, then `loaded`, then `contextWindow`, and
returns `{kind: "local"|"unavailable", model?, reasons[]}`.
`PrivacyPolicy = "local-only" | "local-first"` already exists in the type
(`:4`) but only `local-first` is ever passed. **This is the natural home for a
cloud-gating policy.**

**FACT — `src/setup/onboarding.ts`** (140 lines) — `collectOnboardingState`
(`:22-30`) = hardware + discovery + route; `modelLabel` (`:33-41`) renders
`name (runtimeId, NNK context, quant, NB)`; `renderOnboarding` prints hardware,
GPU, storage and runtimes. Purely local.

**FACT — the TUI model picker** (`src/ui/app.tsx`):

| Piece | Line | Detail |
| --- | --- | --- |
| catalog imports | `:11-15` | `getEffectiveReasoningEffort`, `getModelInfo`, `getSupportedReasoningEfforts`, `normalizeModelId` |
| `startupConfig.localModels?: ModelInfo[]` | `:574` | the entire picker data source |
| `startupConfig.onSelectLocalModel?` | `:575` | `(modelId) => Promise<{success, error?}>` |
| picker state | `:606`, `:609`, `:611-613` | `model`, `showModelPicker`, `modelSwitchError`, `modelPickerIndex`, `modelSearchQuery` |
| `modelInfo` / `contextStats` | `:806-807` | `agent.getModelInfo() ?? getModelInfo(model)`; context gauge is `null` without it |
| `modelCatalog` | `:808` | `startupConfig.localModels ?? []` |
| `filteredModels` | `:809-815` | substring match on `name` **or** `id`, case-insensitive. **Flat list, no grouping** |
| `selectLocalModel(modelId)` | `:816-838` | calls `onSelectLocalModel`, then `agent.setModel`, `setModel`, **`saveProjectSettings({model})` and `saveUserSettings({defaultModel})`** (`:829-832`) |
| key handling | `:2978-3019` | esc closes, ↑/↓ move, enter selects (`:2993`, `:3000-3008`), backspace/typing edits the query |
| `ModelPickerModal` | `:5367-…` | title `"Select model"`, `"esc"` hint, `"Search..."` placeholder, per-row reasoning-effort column (`:5399`, `:5434-5437`) that is dead today |

**FACT — `src/ui/slash-menu.ts:17`**:
`{ id: "models", label: "models", description: "Select a model", aliases: ["model", "mode"] }`
— the `/models` slash command already exists and opens this picker.

**FACT — `ModelInfo`** (`src/types/index.ts:227-247`):

```ts
{ id, name, contextWindow, inputPrice, outputPrice, reasoning, description,
  aliases?, responsesOnly?, multiAgent?, supportsClientTools?,
  supportsMaxOutputTokens?, defaultReasoningEffort?, supportsReasoningEffort?,
  capabilityConfidence?, runtimeKind?, supportsVision? }
```

**FACT — runtime concepts leak into the shared UI type:**
`capabilityConfidence` (`:245`) and `runtimeKind?: string` (`:244`) are
runtime-layer notions living in `src/types/index.ts`, which the UI imports
directly. Audit `14` §3 covers this. There is **no `maxOutputTokens` field** —
`04` must add one.

**FACT — provider swap safety** (audit `14` §4, re-verified):
`agent.setProvider` (`src/agent/agent.ts:714-719`) sets one mutable field and
calls `setModel`; `getModelInfo()` (`:655-657`) re-derives from the live
provider on every call; `getContextStats` takes `contextWindow` as a *parameter*
(`:753-…`), so nothing stale is cached. An in-flight turn captures
`requireProvider()` locally, so a mid-turn swap cannot corrupt a running stream.
**But** `this.messages` is *not* re-validated against the new model's context
window, and `this.batchApi` is only ever turned off, never restored.
The model id is duplicated in **four** places: `agent.modelId`, SQLite
`session.model`, React `model` state, and `defaultModel` in settings.

---

## 8. Existing tests in scope

| File | Guards |
| --- | --- |
| `src/models/catalog.test.ts` | the stubs; the id round-trip |
| `src/models/huggingface.test.ts` | download/resume/sidecar/discovery |
| `src/models/manager.test.ts` | install orchestration + disk floor |
| `src/models/recommendation.test.ts` | hardware→model choice |
| `src/providers/architecture.test.ts` | no `XaiProvider` / `@ai-sdk/xai` in agent/tools/compaction |
| `src/providers/fake.test.ts`, `stream.test.ts` | the adapter double and event normalisation |
| `src/router/local-first.test.ts` | route selection |
| `src/runtimes/bootstrap.test.ts`, `discovery.test.ts`, `local-provider.test.ts`, `managed-llama.test.ts` | runtime layer |
| `src/setup/onboarding.test.ts`, `src/startup/orchestrator.test.ts` | onboarding + state machine |

**`src/models/catalog.test.ts` is the only test that must be rewritten** by this
work; everything else should keep passing untouched.

---

## 9. Reuse vs replace

| Symbol / file | Verdict | Rationale |
| --- | --- | --- |
| `catalog.ts:normalizeModelId` | **REUSE** | trim-only, and the test pins it |
| `catalog.ts:MODELS`, `DEFAULT_MODEL`, `getModelIds`, `isKnownModelId` | **REPLACE** | become real catalog queries |
| `catalog.ts:getModelInfo` | **REPLACE (shim first)** | must keep the same signature; back it with catalog lookup |
| `catalog.ts:getSupportedReasoningEfforts` / `getEffectiveReasoningEffort` | **REPLACE (later)** | drive from `capabilities.reasoning` + OpenRouter `reasoning_options`; out of scope until Phase 8 |
| `huggingface.ts:HUGGING_FACE_MODELS` | **REUSE as-is** | becomes `LocalSource`'s "available to download" list |
| `huggingface.ts:discoverInstalledHuggingFaceModels` | **REUSE as-is** | becomes `LocalSource`'s "installed" scan |
| `huggingface.ts:downloadHuggingFaceModel` | **REUSE as-is** | powers `models add/download` |
| `huggingface.ts:formatDownloadSize/Speed` | **REUSE** | delete `index.ts:formatBytes` duplicate |
| `manager.ts:installLocalModel` | **REUSE** | already the right seam |
| `recommendation.ts:recommendBootstrapModel` | **REUSE, refactor later** | positional `[0]`/`[1]` indexing is fragile; audit `18` §2 wants it merged with `localModelFitScore` — **not this project** |
| `runtimes/types.ts:LocalModelCandidate` | **REUSE** | stays the runtime-layer type; the catalog maps *to* it |
| `runtimes/types.ts:LocalRuntimeAdapter` | **REUSE untouched** | |
| `discovery.ts:discoverLocalRuntimes` | **REUSE** | `LocalSource` calls it |
| `discovery.ts` `contextWindow: 32_768` (`:53`) | **REPLACE** | should come from the endpoint or be marked low-confidence |
| `managed-llama.ts:modelCandidate` | **REUSE, extend** | must learn the real served `n_ctx` (`04 §7`) |
| `managed-llama.ts` `--ctx-size` clamp (`:227-237`) | **KEEP, but expose** | the clamped value must reach `modelInfo.contextWindow` |
| `local-provider.ts:LocalProviderAdapter` | **REUSE** | already generic |
| `local-provider.ts:createLocalProvider` | **REUSE** | |
| `local-provider.ts:createOpenAICompatibleProvider` | **REUSE, extend signature** | needs `headers` and `maxRetries`; keep the 3-arg form working |
| `local-provider.ts:88` `maxRetries: 0` | **REPLACE (parameterise)** | 0 for local, >0 for cloud |
| `local-provider.ts:141` `contextWindow: 128_000` | **REPLACE** | comes from the catalog entry |
| `providers/types.ts:ProviderAdapter` | **REUSE untouched** | the seam is correct |
| `providers/architecture.test.ts` | **REUSE untouched** | do not import an SDK into `agent.ts` |
| `index.ts:models` command (`:931-952`) | **REPLACE** | becomes the grouped command tree in `05` |
| `index.ts:toModelInfo` (`:451`) | **REPLACE** | superseded by `catalogEntryToModelInfo` |
| `index.ts:formatContext` (`:1067`) | **REUSE** | move to a shared formatter |
| `index.ts:getRemoteConfigurationError` (`:474`) | **REUSE, extend** | must also know about a cloud catalog entry with no key |
| `index.ts:configureLocalProvider` (`:480`) | **REUSE, extend** | gains a cloud branch |
| `settings.ts:getApiKey/getBaseURL` | **REUSE** | keep working for `--remote` |
| `settings.ts:UserSettings` | **EXTEND** | add `providers?` (or a sibling `auth.json` — see `04 §6`) |
| `settings.ts:getCurrentModel` precedence | **REUSE untouched** | already correct |
| `startup/orchestrator.ts:runStartup` | **REUSE, extend at `:103-112`** | the "no local model" branch offers cloud |
| `router/local-first.ts:selectLocalRoute` | **REUSE untouched** | stays local-only; cloud is never auto-routed |
| `ui/app.tsx:ModelPickerModal` (`:5367`) | **REUSE, extend** | add section headers |
| `ui/app.tsx:filteredModels` (`:809`) | **EXTEND** | group by category before filtering |
| `types/index.ts:ModelInfo` | **EXTEND** | add `maxOutputTokens?`, `category?`, `provider?` |
| `models/catalog.test.ts` | **REWRITE** | the only test that must change |
