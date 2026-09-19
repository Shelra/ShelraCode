# 07 — Model catalog

## 1. Where model options come from

There are **two things called a catalog** in this repository, and only one is a
catalog.

| | `src/models/huggingface.ts` `HUGGING_FACE_MODELS` | `src/models/catalog.ts` |
| --- | --- | --- |
| Contents | 2 fully-specified GGUF entries (`:43-70`) | `MODELS: ModelInfo[] = []` (`:4`) |
| Purpose | Installable seed catalog | Legacy provider-model registry |
| Status | **ACTIVE** | **PLACEHOLDER — deliberately emptied** |

### `src/models/catalog.ts` in full (32 lines, all stubs)

```ts
export const MODELS: ModelInfo[] = [];                                  // :4
export const DEFAULT_MODEL = "";                                        // :5
export function normalizeModelId(modelId: string): string { return modelId.trim(); }   // :7-9
export function getModelInfo(_modelId: string): ModelInfo | undefined { return undefined; }   // :11-13
export function getModelIds(): string[] { return []; }                  // :15-17
export function isKnownModelId(_modelId: string): boolean { return false; }   // :19-21
export function getSupportedReasoningEfforts(_modelId): ReasoningEffort[] { return []; }  // :23-25
export function getEffectiveReasoningEffort(_modelId, _override) { return undefined; }    // :27-32
```

Header comment (`:3`): *"The active runtime supplies model metadata; no provider
models are bundled."*

**FACT — the only function with behaviour is `normalizeModelId` (a `trim()`).**
It is imported in 6 places (`src/index.ts:17`, `src/agent/agent.ts:36`,
`src/ui/app.tsx`, `src/toolset/client.ts:5`, `src/utils/settings.ts`,
`src/models/catalog.test.ts`).

**FACT — consequences of the stubs, traced:**

1. **`applyModelConstraints` is dead.** `src/agent/agent.ts:565-579` reads
   `getModelInfo(modelId)?.supportsClientTools !== false`. `getModelInfo`
   always returns `undefined`, so the condition is `undefined !== false` →
   `true` → the function **always returns the system prompt unchanged**. The
   "MODEL CONSTRAINTS: do not call bash/read_file/…" block at `:571-578` can
   never be emitted.
2. **`DEFAULT_MODEL = ""`** flows through `resolveCurrentModel`
   (`src/utils/settings.ts:369-372`) → `getCurrentModel` (`:349-365`) → the
   `Agent` constructor's `this.modelId` (`src/agent/agent.ts:614`). On a machine
   with no `defaultModel` setting, **`agent.getModel()` is the empty string**
   until `setProvider(provider, id)` overwrites it (`src/index.ts:377`).
3. **`agent.getModelInfo()`** (`src/agent/agent.ts:655-657`) falls back to
   `getModelInfo(this.modelId)` = `undefined` whenever no provider is installed,
   so `src/ui/app.tsx:804-805` gets `modelInfo === null` and `contextStats ===
   null` — the context gauge silently disappears.
4. **`getSupportedReasoningEfforts` / `getEffectiveReasoningEffort` return
   empty/undefined**, so the model-picker's reasoning-effort adjuster
   (`src/ui/app.tsx:2990-2995` → `adjustModelReasoningEffort`) is a no-op UI
   affordance.

**Classification: `src/models/catalog.ts` is a PLACEHOLDER shim kept for import
compatibility.** It is not dead (imported and executed), but every non-trivial
answer it gives is a constant.

## 2. The real catalog — `HUGGING_FACE_MODELS`

```ts
// src/models/huggingface.ts:43-70   (readonly, exactly 2 entries)
[
 { id: "hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M",
   displayName: "Qwen2.5 Coder 1.5B · Q4_K_M",
   repoId: "Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF",
   filename: "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
   revision: "main", quantization: "Q4_K_M",
   parameters: 1_500_000_000, contextWindow: 32_768, estimatedMemoryGb: 2.2,
   sha256: "cc324af0…bb046", sizeBytes: 1_117_320_768 },

 { id: "hf:Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M",
   displayName: "Qwen2.5 Coder 7B · Q4_K_M",
   repoId: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
   filename: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
   revision: "main", quantization: "Q4_K_M",
   parameters: 7_000_000_000, contextWindow: 32_768, estimatedMemoryGb: 5.3,
   sha256: "509287f7…94d3c", sizeBytes: 5_025_000_000 },
]
```

### Metadata coverage

| Field | Present? | Notes |
| --- | --- | --- |
| Stable id | **Yes** — `hf:<repo>:<quant>` | Shelra-owned identity (`:8-9` comment) |
| Display name | Yes | |
| Repo + filename + revision | Yes | Resolve URL built at `:79-83` |
| Quantization | Yes — `"Q4_K_M"` both | Only one quant level exists in the catalog |
| Parameter count | Yes | |
| Context window | Yes — 32 768 both | |
| Estimated memory | Yes — hand-written `2.2` / `5.3` | Not derived; no formula shown |
| **SHA-256** | **Yes** — both entries | Enforced at `:169-175` |
| **Byte size** | **Yes** — both entries | Used for progress totals (`:135,145`) |
| Architecture / family | **No** | Implicit in the name |
| Licence | **No** | |
| Coding benchmark score | **No** | |
| Tool-calling capability | **No** | Asserted `true` downstream (`src/runtimes/managed-llama.ts:47`) |
| Vision | **No** | Asserted `false` (`:54`) |
| Minimum VRAM / RAM | **No** | Only the single `estimatedMemoryGb` number |
| Chat template | **No** | Delegated to `--jinja` (`src/runtimes/managed-llama.ts:147`) |

### Freshness

**FACT — the catalog is a compile-time constant.** `readonly
HuggingFaceModelSpec[]`, no loader, no fetch, no cache file, no refresh, no
version. Adding a model requires a code change and a new release. The `revision`
field is `"main"` for both entries — a **mutable Hugging Face ref**. Combined
with a pinned `sha256`, this means an upstream re-upload to `main` turns into a
hard integrity failure (`:171-174`) rather than a silent change — fail-closed,
which is correct, but it also means the catalog **rots**: it will break rather
than update.

**FACT — quantization is not a dimension of the catalog.** Both entries are
`Q4_K_M`. There is no Q5/Q6/Q8 variant, no way to prefer a different quant for
the same model, and no representation of a model *family* with multiple
artifacts. Every downstream "quantization" decision therefore has exactly one
possible answer.

## 3. Catalog lookup

```ts
// src/models/huggingface.ts:74-77
export function getHuggingFaceModelSpec(id: string): HuggingFaceModelSpec | undefined {
  return HUGGING_FACE_MODELS.find((model) => model.id === id.trim());
}
```

Exact-match only. Called from `ManagedLlamaRuntime.installModel:224` (the
authoritative gate that rejects anything not in the catalog, `:225`) and from
`recommendBootstrapModel:23`.

**FACT — the catalog doubles as the installation allowlist.** `installModel`
refuses any id not present, which is a genuine and deliberate supply-chain
control: *"That Hugging Face model is not in Shelra's reviewed local catalog."*

## 4. Is catalog logic coupled to the UI?

**FACT — partially, and in a way worth noting.** `src/ui/startup.tsx:5` imports
`formatDownloadSize` / `formatDownloadSpeed` **from `src/models/huggingface.ts`**
— i.e. the UI layer imports byte-formatting helpers from the model/download
module. The dependency direction is UI→model (acceptable) but the helpers
(`:239-248`) are pure presentation code living in a domain module.

Otherwise the coupling is clean: `StartupScreen` receives
`recommendation?: ModelRecommendation` as a prop (`src/ui/startup.tsx:19`) and
never touches `HUGGING_FACE_MODELS`.

## 5. The *installed* catalog (per-machine)

The second "catalog" is the filesystem: `~/.shelra/models/*.gguf` plus
`*.gguf.json` sidecars. See `04-LOCAL-MODEL-DISCOVERY.md` §2/§5. Its metadata
quality is entirely dependent on sidecar validity, and a corrupt sidecar
degrades an entry to `{parameters: 0, quantization: "unknown"}`
(`src/models/huggingface.ts:221-233`) with no diagnostic — **observed live on
this machine**.

## 6. Not found

Verified absent from `src/` by grep: Hugging Face Hub **search/list** API
(`/api/models`), any remote catalog endpoint, any bundled JSON catalog file, any
Ollama/LM Studio library listing, model-card fetching, licence checking, quant
enumeration for a repo, or a catalog schema version.

## 7. Verdict

| Aspect | Status |
| --- | --- |
| Source of truth for installable models | **IMPLEMENTED** — `HUGGING_FACE_MODELS`, hard-coded, 2 entries |
| Integrity metadata (SHA-256 + size) | **IMPLEMENTED** — both entries, enforced |
| Installation allowlist | **IMPLEMENTED** |
| Freshness / refresh mechanism | **NOT FOUND** |
| Quantization as a catalog dimension | **NOT FOUND** — single quant level |
| Architecture / licence / benchmark metadata | **NOT FOUND** |
| Model-family grouping | **NOT FOUND** |
| Remote catalog / HF search | **NOT FOUND** |
| `src/models/catalog.ts` | **PLACEHOLDER** — all stubs; silently disables `applyModelConstraints` and the reasoning-effort UI |
| UI coupling | **Minor** — UI imports formatters from the model module |
</content>
</invoke>
