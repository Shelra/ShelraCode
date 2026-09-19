# 04 — Local model discovery

## 1. Inventory of every discovery mechanism in `src/`

Found by exhaustive grep for filesystem scans, `/models` endpoints, registries,
and model-id sources. **Nothing was assumed from filenames.**

| # | Mechanism | File / symbol | Input | Output | Called from | Status |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | **GGUF filesystem scan** | `discoverInstalledHuggingFaceModels` `src/models/huggingface.ts:193-237` | `modelDirectory` (default `~/.shelra/models`, `:85-87`) | `{spec, path}[]` | `ManagedLlamaRuntime.installedModels()` `src/runtimes/managed-llama.ts:105-107` | **ACTIVE** — the only real model source |
| D2 | **Managed runtime `listModels`** | `ManagedLlamaRuntime.listModels` `src/runtimes/managed-llama.ts:208-211` | D1 output + `this.baseURL` | `LocalModelCandidate[]` | `discoverLocalRuntimes` `src/runtimes/discovery.ts:96` | **ACTIVE** |
| D3 | **Explicit OpenAI-compatible endpoint `/models`** | `explicitEndpointRuntime.listModels` `src/runtimes/discovery.ts:37-67` | `GET {baseURL}/models` | `LocalModelCandidate[]` prefixed `local-openai/` | `discoverLocalRuntimes` | **ACTIVE but opt-in** — adapter only created when `SHELRA_LOCAL_ENDPOINT` or `OPENAI_BASE_URL` is set (`:82-83`) |
| D4 | **Discovery aggregator** | `discoverLocalRuntimes` `src/runtimes/discovery.ts:87-113` | adapters, signal | `{runtimes, health, models}` | `runStartup:73`, `configureLocalProvider:460`, `collectOnboardingState:24`, `models` cmd `src/index.ts:880` | **ACTIVE — the single entry point** |
| D5 | **Reviewed HF seed catalog** | `HUGGING_FACE_MODELS` `src/models/huggingface.ts:43-70` | — | 2 hard-coded specs | `getHuggingFaceModelSpec:74-77`, `recommendBootstrapModel:23,35,41,…` | **ACTIVE** — *installable* catalog, not a discovery source |
| D6 | **Provider model catalog** | `src/models/catalog.ts:4-32` | — | `MODELS = []`, `DEFAULT_MODEL = ""`, `getModelInfo → undefined`, `getModelIds → []`, `isKnownModelId → false` | `src/agent/agent.ts:36,566,656`, `src/ui/app.tsx:804`, `src/index.ts:17`, `src/toolset/client.ts:5`, `src/utils/settings.ts` | **PLACEHOLDER — deliberately emptied stub.** Every consumer gets `undefined`/`[]`. |
| D7 | **Persisted `defaultModel`** | `~/.shelra/user-settings.json` via `getCurrentModel` `src/utils/settings.ts:349-365` | settings file | model id string | `new Agent(...)` `src/agent/agent.ts:614`; `runStartup({requestedModel})` `src/index.ts:369` | **ACTIVE but advisory only** — see §4 |
| D8 | **Project `model` setting** | `loadProjectSettings().model` `src/utils/settings.ts:316-320`; written by the picker `src/ui/app.tsx:830` | `./.shelra/settings.json` | model id | `getCurrentModel` `settings.ts:349-365` | **ACTIVE (write) / partially read** |
| D9 | **`--model` CLI flag** | `src/index.ts:741,692,710` | argv | model id | `resolveConfig` → `startInteractive` → `runStartup({requestedModel})` | **ACTIVE, advisory only** |
| D10 | **`SHELRA_ONBOARDING_MODEL`** | `src/models/recommendation.ts:21-31` | env | forces a recommendation id | `recommendBootstrapModel` | **ACTIVE** (escape hatch) |
| D11 | **Model sidecar metadata** | `<file>.gguf.json` written `src/models/huggingface.ts:177-181`, read `:208-217` | JSON | `HuggingFaceModelSpec` | D1 | **ACTIVE — fragile, see §5** |
| D12 | **Legacy `src/toolset/models.ts`** | — | — | — | — | **DELETED** (git status: ` D src/toolset/models.ts`, ` D src/toolset/models.test.ts`) |
| D13 | **xAI remote model resolution** | `resolveModelRuntime` / the xAI-only adapter `src/toolset/client.ts:79,120,234` | model id | xAI runtime | **nothing** — only `src/toolset/media.ts:5` takes a `type`-only import, plus `client.test.ts` | **DEAD** (since removed) |

**Not found anywhere in `src/` (verified by grep):** Ollama (`11434`,
`/api/tags`), LM Studio (`1234`), MLX, vLLM, llamafile, koboldcpp, GPT4All,
Jan, text-generation-webui, `~/.cache/huggingface` scanning, HF Hub search API,
any remote model catalog. This is intentional and documented at
`src/runtimes/discovery.ts:79-81`:

> "Explicit endpoints remain a compatibility escape hatch. Shelra never
> installs or starts a third-party runtime and never probes vendor apps by
> default."

## 2. D1 in detail — the only real discovery

```ts
// src/models/huggingface.ts:193-237
export async function discoverInstalledHuggingFaceModels(modelDirectory = defaultModelDirectory())
  readdir(modelDirectory)                                    // :199  (catch → [])
  for (entry of entries.filter(name => name.toLowerCase().endsWith(".gguf")))   // :204
    try   { spec = JSON.parse(readFile(`${filePath}.json`)) }                   // :208-210
          // accepted only if id/repoId/filename are all strings               // :211-217
    catch { /* silently ignored */ }                                            // :218-220
    if (!spec) spec = {                                                         // :221-233
      id: `local:${entry}`, displayName: entry.replace(/\.gguf$/i,""),
      repoId: "local", filename: entry, revision: "local",
      quantization: "unknown", parameters: 0, contextWindow: 32_768,
      estimatedMemoryGb: max(1, statSync(filePath).size / 1024**3 * 1.12),
    }
```

**FACT — properties of this scan:**
* Non-recursive (`readdir` without `withFileTypes`/recursion) — a GGUF in a
  subdirectory is invisible.
* Extension-only filter — **no GGUF magic-byte check**, no header parse. A
  0-byte or truncated `foo.gguf` is reported as an installed model.
* No dedup against the `.part` naming — a `foo.gguf.part` is not `.gguf` so it
  is correctly skipped, but a *renamed* partial would not be.
* Runs on **every** `detect()` (`src/runtimes/managed-llama.ts:190`),
  `health()` (`:196`), `listModels()` (`:209`), and **twice** inside
  `ensureServer` (`:127` and `:135`). One `discoverLocalRuntimes` pass therefore
  hits the directory ~5 times.

## 3. D2 — the `LocalModelCandidate` produced

```ts
// src/runtimes/managed-llama.ts:35-58
{
  id: spec.id, name: spec.displayName,
  runtimeId: "shelra-llama", runtimeKind: "managed-llama",
  baseURL,                                   // ← this.baseURL AT LIST TIME
  contextWindow: spec.contextWindow || 32_768,
  tools: true,                               // ← ASSERTED, never probed
  structuredOutput: true,                    // ← ASSERTED
  reasoning: false, loaded: false,
  parameters: spec.parameters || undefined,
  quantization: spec.quantization,
  source: "local",
  capabilityConfidence: "declared",
  supportsVision: false,
  memoryRequiredGb: spec.estimatedMemoryGb,
  capabilityClass: "agent",                  // ← ASSERTED for every GGUF
}
```

**FACT — `tools: true`, `structuredOutput: true` and `capabilityClass:
"agent"` are hard-coded for every discovered GGUF**, regardless of what the
model actually is. A 0-byte `random.gguf` is declared a tool-capable agent-class
model. `capabilityConfidence: "declared"` is the only honest signal, and
`selectLocalRoute` only *logs* a note about unprobed capability when confidence
is `"unknown"` — `"declared"` slips through silently
(`src/router/local-first.ts:29-31`).

**FACT — `baseURL` can be `http://127.0.0.1:0/v1`.** `this.baseURL`
(`src/runtimes/managed-llama.ts:92-94`) returns `port ?? 0`, and
`discoverLocalRuntimes` runs `listModels` **in parallel** with `detect`/`health`
(`src/runtimes/discovery.ts:93-97`), so `listModels` frequently completes before
the port is allocated. This is harmless for inference because
`ManagedLlamaRuntime.provider()` re-reads the live `this.baseURL` (`:239`), but
the `baseURL` stored on `discovery.models[]` is unreliable and must not be used
directly by any future consumer.

## 4. How discovery results reach a decision

```
discoverLocalRuntimes → discovery.models
  └─ selectLocalRoute(models, {preferredModel, requiresTools:true, hardware})
     src/router/local-first.ts:21-59
     ├─ :24-37 filter: drop !model.tools; drop contextWindow < contextTokens
     │          (note: requiresTools is always true from every caller)
     ├─ :39-43 if preferredModel matches, MOVE IT TO FRONT
     └─ :45-50 sort by localModelFitScore DESC, then loaded, then contextWindow
                ↑↑↑ THIS SORT DISCARDS THE PREFERENCE ORDERING
```

**FACT — the persisted/requested model is only a tiebreaker.** The
`preferredModel` prepend at `:41` is immediately re-sorted at `:45`. Because
`Array.prototype.sort` is stable, the preferred model wins **only when its fit
score ties the top score**. A saved selection with a lower fit score is silently
overridden with no message to the user (the `reasons[]` array records the
selection but nothing surfaces it).

Callers of `selectLocalRoute`, with the hardware they pass:

| Caller | Hardware argument | Consequence |
| --- | --- | --- |
| `runStartup` `src/startup/orchestrator.ts:93-97` | `detectHardware()` result — **has GPU** | GPU branch of `localModelFitScore` used |
| `configureLocalProvider` `src/index.ts:462-466` | `inspectHardware()` — **`gpu: []` always** (`src/hardware/profile.ts:42`) | RAM branch used; different ranking than startup |
| `collectOnboardingState` `src/setup/onboarding.ts:25-29` | `detectHardware()` | GPU branch |
| `chooseModel` `src/setup/onboarding.ts:105` | **none** → default `inspectHardware()` | RAM branch — the interactive chooser ranks differently from the summary it prints at `:76-83` |

**FACT — four call sites, three different effective hardware profiles.** The
same set of installed models can be ranked three different ways in one process.

## 5. D11 — sidecar fragility, confirmed in the field

**FACT.** `JSON.parse` failure at `src/models/huggingface.ts:208-210` is caught
and *silently* ignored (`:218-220`), degrading the model to the `local:` fallback
(`:221-233`) with `parameters: 0`, `quantization: "unknown"`,
`contextWindow: 32_768` (a guess), and `estimatedMemoryGb` derived from file
size.

**This is currently happening on the audited machine:**

```
~/.shelra/models/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf.json
  → declares "id": "hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M"
  → but the file ends with the two-byte sequence `\` `n` after the closing brace
  → node JSON.parse: "Unexpected non-whitespace character after JSON at position 591"

~/.shelra/user-settings.json
  → "defaultModel": "local:qwen2.5-coder-1.5b-instruct-q4_k_m.gguf"

$ bun run src/index.ts models
  local:qwen2.5-coder-1.5b-instruct-q4_k_m.gguf — qwen2.5-coder-1.5b-instruct-q4_k_m
    (managed-llama, 32.768K context, free)
```

The full chain is observable end to end. `downloadHuggingFaceModel` writes valid
JSON (`:177-181`), so **INFERENCE (medium):** this sidecar was corrupted by
something outside the download path (a shell smoke test, a manual edit). The
*code defect* is unconditional: there is no validation, no repair, no warning,
and no way for the user to learn that their catalogued 1.5B model is now an
unknown blob with `parameters: 0` — which materially changes
`estimateModelMemoryGb` (`src/hardware/profile.ts:154-168`) and every downstream
score.

## 6. Discovery is expensive because it starts inference

**FACT.** `discoverLocalRuntimes` calls `detect`, `health` and `listModels`
**concurrently** (`src/runtimes/discovery.ts:93-97`). For `ManagedLlamaRuntime`:

* `detect(signal)` (`:186-192`) → `hasBinary()` then, if any model exists,
  **`await this.ensureServer(signal)`** — spawns `llama-server` and loads the
  GGUF.
* `health(signal)` (`:194-206`) → also `await this.ensureServer(signal)`.
* `listModels` (`:208-211`) → filesystem only.

`ensureServer`'s single-flight lock (`:125`, `:178-183`) collapses the two into
one server — verified by `src/runtimes/managed-llama.test.ts:17` ("serializes
concurrent discovery health checks into one server").

**Measured on this machine:** `shelra models` — which does nothing but
enumerate names — took **2 817 / 3 475 / 5 380 ms** across three runs, and a
background PowerShell sampler observed a live `llama-server` PID (16488) during
one such run. A 1.1 GB Q4 GGUF is read into RAM to print two strings.

**FACT — this also determines the model that gets loaded.** `ensureServer` with
no `requestedModelId` picks `installedModels[0]` (`:128`) — the first
`readdir` entry. Discovery therefore *arbitrarily loads a model* as a side
effect.

## 7. Status summary

| Mechanism | Status |
| --- | --- |
| D1 GGUF scan | **ACTIVE** (only real source; no integrity check) |
| D2 managed `listModels` | **ACTIVE** (fabricates capability metadata) |
| D3 explicit endpoint | **ACTIVE, opt-in via env** |
| D4 aggregator | **ACTIVE** (authoritative) |
| D5 HF seed catalog | **ACTIVE** (2 entries; install-only) |
| D6 `src/models/catalog.ts` | **PLACEHOLDER** (all stubs; every caller gets `undefined`) |
| D7/D8/D9 persisted / project / flag model id | **ACTIVE but advisory** (outranked by fit score) |
| D10 `SHELRA_ONBOARDING_MODEL` | **ACTIVE** |
| D11 sidecar | **ACTIVE, FRAGILE** (silent degradation, observed live) |
| D12 `src/toolset/models.ts` | **DELETED** |
| D13 xAI model resolution | **DEAD** (no runtime importers) |
</content>
</invoke>
