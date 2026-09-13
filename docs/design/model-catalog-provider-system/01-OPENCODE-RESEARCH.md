# 01 — Research: how OpenCode does provider/model management

**Research window:** 2026-09-06, ~19:37–19:55 local (Europe/Madrid).
**Method:** raw source downloaded from GitHub (`raw.githubusercontent.com`) plus
the docs site and live API probes. Every claim below is either **FACT** (traced
to a downloaded source line or a cited URL) or **INFERENCE** (with confidence).

> **FACT — the repository moved.** `https://api.github.com/repos/sst/opencode`
> answers **HTTP 301** and redirects to `anomalyco/opencode`
> (`full_name: anomalyco/opencode`, `default_branch: dev`,
> `pushed_at: 2026-09-06T23:26:58Z`, observed 2026-09-06).
> All source citations below are against
> `https://raw.githubusercontent.com/anomalyco/opencode/dev/…` at that commit
> state. Line numbers are from the files as downloaded on 2026-09-06 and will
> drift.

Files pulled and cited (sizes as fetched):

| Path in repo | Bytes |
| --- | --- |
| `packages/core/src/models-dev.ts` | 9 062 |
| `packages/core/src/global.ts` | 2 162 |
| `packages/core/src/catalog.ts` | 12 184 |
| `packages/opencode/src/provider/provider.ts` | 80 841 |
| `packages/opencode/src/provider/transform.ts` | 69 944 |
| `packages/opencode/src/auth/index.ts` | 3 451 |
| `packages/opencode/src/config/config.ts` | 27 747 |
| `packages/app/src/components/dialog-select-model.tsx` | 21 202 |

---

## 1. The Provider / Model abstraction

### 1.1 Two schemas, one pipeline

OpenCode has **two** model shapes and converts between them:

1. **The upstream catalog shape** — `ModelsDev.Model` /
   `ModelsDev.Provider`, defined in `packages/core/src/models-dev.ts:67-132`.
   This is the wire schema of `api.json`.
2. **The internal runtime shape** — `Provider.Model` / `Provider.Info`,
   defined in `packages/opencode/src/provider/provider.ts:1074-1100`.

The converter is `fromModelsDevModel(provider, model)` at
`provider/provider.ts:1261` and `fromModelsDevProvider(provider)` at `:1318`.

**FACT — upstream catalog model schema** (`core/models-dev.ts:67-120`):

```ts
export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  family: Schema.optional(Schema.String),
  release_date: Schema.String,
  attachment: Schema.Boolean,          // can accept file/image attachments
  reasoning: Schema.Boolean,
  temperature: Schema.Boolean,         // honours a temperature parameter
  tool_call: Schema.Boolean,
  reasoning_options: Schema.optional(Schema.Array(ReasoningOption)),
  interleaved: Schema.optional(...),
  cost: Schema.optional(Cost),
  limit: Schema.Struct({
    context: Schema.Finite,
    input: Schema.optional(Schema.Finite),
    output: Schema.Finite,
  }),
  modalities: Schema.optional(Schema.Struct({
    input:  Schema.Array(Schema.Literals(["text","audio","image","video","pdf"])),
    output: Schema.Array(Schema.Literals(["text","audio","image","video","pdf"])),
  })),
  experimental: Schema.optional(...),
  status: Schema.optional(CatalogModelStatus),   // "alpha" | "beta" | "deprecated"
  provider: Schema.optional(Schema.Struct({ npm: ..., api: ... })),
})
```

`Cost` (`:36-50`) is `{ input, output, cache_read?, cache_write?, tiers?,
context_over_200k? }` — **plain numbers, USD per million tokens**, not strings.
`CostTier` (`:25-34`) supports context-size-banded pricing.
`ReasoningOption` (`:52-65`) is a tagged union: `{type:"effort", values:[…]}`,
`{type:"toggle"}`, `{type:"budget_tokens", min?, max?}`.

**FACT — upstream provider schema** (`core/models-dev.ts:123-130`):

```ts
export const Provider = Schema.Struct({
  api: Schema.optional(Schema.String),      // base URL
  name: Schema.String,
  env: Schema.Array(Schema.String),         // env var names holding the API key
  id: Schema.String,
  npm: Schema.optional(Schema.String),      // AI-SDK package to load
  models: Schema.Record(Schema.String, Model),
})
```

**FACT — internal runtime model shape** (`provider/provider.ts:1074-1088`):

```ts
export const Model = Schema.Struct({
  id, providerID, api, name, family,
  capabilities: { temperature, reasoning, attachment, toolcall, input, output, interleaved },
  cost:  { input, output, cache: {read, write}, tiers?, experimentalOver200K? },
  limit: { context, input?, output },
  status, options, headers, release_date, variants?,
})
```

Note the rename: upstream `tool_call` → internal `capabilities.toolcall`
(`:1289`, defaulting to **`true`** when absent), upstream `attachment` →
`capabilities.attachment` (`:1288`, defaulting to `false`).

**FACT — provider record** (`provider/provider.ts:1091-1099`):

```ts
export const Info = Schema.Struct({
  id, name,
  source: Schema.Literals(["env", "config", "custom", "api"]),
  env: Schema.Array(Schema.String),
  key: optional(Schema.String),
  options: Schema.Record(Schema.String, Schema.Any),
  models: Schema.Record(Schema.String, Model),
})
```

`source` is the provenance of the credential — this is what lets the UI say
"connected via env" vs "connected via `auth.json`".

### 1.2 Model addressing — the `provider/model` convention

**FACT** (`provider/provider.ts:2054-2060`):

```ts
export function parseModel(model: string) {
  const [providerID, ...rest] = model.split("/")
  return { providerID: ProviderV2.ID.make(providerID), modelID: ModelV2.ID.make(rest.join("/")) }
}
```

The split is on the **first** `/` only; everything after it is the model id.
That is what makes `openrouter/google/gemma-4-31b-it:free` unambiguous:
provider `openrouter`, model `google/gemma-4-31b-it:free`.

**FACT** — config field is a single string, e.g.
`{"model": "lmstudio/google/gemma-3n-e4b"}`
(source: <https://opencode.ai/docs/models/>). There is also a `small_model`
field for cheap auxiliary calls, parsed the same way
(`provider/provider.ts:1939`).

**Adopt this verbatim.** It is the single most reusable idea in the whole
design: one flat string, first segment is the provider, the rest is opaque.

---

## 2. models.dev — the shared catalog

### 2.1 What it is

**FACT** — models.dev is an open-source database of AI models, maintained
alongside OpenCode, exposing a machine-readable `api.json`
(<https://models.dev/>). It records per model: context and output limits,
pricing, capability flags (reasoning / tool calling / structured output),
modalities, release dates and provider availability.

**FACT (live probe, 2026-09-06):**

| Endpoint | HTTP | Bytes |
| --- | --- | --- |
| `https://models.dev/api.json` | 200 | **4 495 092** |
| `https://models.opencode.ai/api.json` | 200 | **4 495 092** |

Identical byte counts — `models.opencode.ai` is OpenCode's own mirror/CDN of
models.dev. **213 providers** in the document. The `openrouter` provider entry
carries `{ id, env, npm, api, name, doc, models }` with **360 models**.

A real models.dev entry (verbatim, 2026-09-06):

```json
{
  "id": "dots-studio/dots-3-note-preview:free",
  "name": "Dots3-Note Preview (free)",
  "description": "Multimodal reasoning model for visual analysis, planning, and tool use",
  "attachment": true,
  "reasoning": true,
  "reasoning_options": [{ "type": "toggle" }],
  "tool_call": true,
  "structured_output": true,
  "temperature": true,
  "release_date": "2026-08-14",
  "last_updated": "2026-08-14",
  "modalities": { "input": ["text", "image"], "output": ["text"] },
  "open_weights": false,
  "limit": { "context": 512000, "output": 460800 },
  "cost": { "input": 0, "output": 0 }
}
```

### 2.2 How OpenCode fetches, caches and falls back

All of this is `packages/core/src/models-dev.ts:145-261`. **FACT**, line by line:

| Behaviour | Line | Detail |
| --- | --- | --- |
| Source URL | `:160` | `Flag.OPENCODE_MODELS_URL \|\| "https://models.opencode.ai"` |
| Fetched path | `:176` | `GET ${source}/api.json` |
| User-Agent | `:23`, `:177` | `opencode/${channel}/${version}/${client}` |
| Timeout | `:180` | `Effect.timeout("10 seconds")` |
| Retries | `:152-156` | 2 retries, exponential(200 ms) + jitter, on errors **and** bad responses |
| Cache file | `:161-164` | `${Global.Path.cache}/models.json` (or `models-<hash>.json` for a custom URL) |
| Freshness TTL | `:165`, `:168-173` | **5 minutes**, measured on file `mtime` |
| Background refresh | `:255-258` | forked fiber, `Schedule.spaced("60 minutes")` |
| Atomic write | `:202-215` | write `${filepath}.${pid}.${ts}.tmp`, then `rename` |
| Cross-process lock | `:226`, `:242` | `Flock.effect(lockKey)`, re-checks freshness **under** the lock |
| Bundled fallback | `:136`, `:198-200` | `declare const OPENCODE_MODELS_DEV` — a build-time-injected snapshot |
| Full offline switch | `:222`, `:255` | `Flag.OPENCODE_DISABLE_MODELS_FETCH` → returns `{}` and never forks the refresher |
| Local file override | `:184-196` | `Flag.OPENCODE_MODELS_PATH` reads a user-supplied catalog file |
| Corrupt-cache recovery | `:185-194` | a `readJson` failure deletes the cache file and continues |

**FACT — the load order in `populate` (`:217-231`) is: disk cache → bundled
snapshot → network.** Staleness does *not* block a start: a stale
`models.json` is used immediately and the 5-minute/60-minute refresher fixes it
in the background.

**FACT — OpenCode can run fully offline.** With
`OPENCODE_DISABLE_MODELS_FETCH` set, or simply with a previously written
`models.json`, no network call is made on the model path.
**INFERENCE (high confidence)** — a *first* run with no cache, no bundled
snapshot and no network yields `{}` providers, i.e. `NoProvidersError`; the
bundled snapshot exists precisely to prevent that.

### 2.3 What to copy vs skip

* **Copy:** disk-cache → bundled-snapshot → network order; atomic tmp+rename;
  TTL on mtime; background refresh; an env flag that disables all fetching.
* **Skip:** the 4.5 MB single-document catalog, `Flock`, the Effect
  service/layer machinery, and the build-time snapshot injection. For a
  single-binary local-first CLI, a per-provider cache file of a few hundred KB
  and a hand-maintained ~10-entry fallback array are the right size.

---

## 3. Auth

**FACT — location and shape** (`packages/opencode/src/auth/index.ts`):

```ts
const file = path.join(Global.Path.data, "auth.json")            // :10
```

`Global.Path.data` is XDG (`core/global.ts:11`): `xdgData/opencode`, i.e.
`~/.local/share/opencode/auth.json` on Linux. The docs confirm the same path:
"when you add a provider's API keys with the `/connect` command, they are stored
in `~/.local/share/opencode/auth.json`" (<https://opencode.ai/docs/providers/>).

**FACT — the record is a map `providerID → Info`** where `Info` is a
discriminated union on `type` (`:14-36`):

```ts
Oauth     = { type: "oauth",     refresh, access, expires, accountId?, enterpriseUrl? }
Api       = { type: "api",       key, metadata?: Record<string,string> }
WellKnown = { type: "wellknown", key, token }
```

So `auth.json` looks like:

```json
{
  "openrouter": { "type": "api", "key": "sk-or-v1-…" },
  "anthropic":  { "type": "oauth", "refresh": "…", "access": "…", "expires": 1788… }
}
```

**FACT — file mode is `0o600`** on every write (`:79`, `:88`).
**FACT — keys are normalised by stripping trailing slashes** (`:74-77`,
`:84-86`) so `myprovider/` and `myprovider` cannot both exist.
**FACT — `OPENCODE_AUTH_CONTENT` env var** (`:59-64`) supplies the whole
`auth.json` as inline JSON, for CI/containers, bypassing the file entirely.

**FACT — env-var fallback.** Each provider declares `env: string[]` in the
catalog (`core/models-dev.ts:126`). At load, OpenCode walks every provider and
takes the first non-empty of those env names as the key
(`provider/provider.ts:1583`):

```ts
const apiKey = provider.env.map((item) => envs[item]).find(Boolean)
if (!apiKey) continue
mergeProvider(providerID, { source: "env", key: provider.env.length === 1 ? apiKey : undefined })
```

**FACT — precedence order of credential sources** (`provider/provider.ts`,
applied in file order, later merges win):

1. `:1578-1589` — **env vars** (`source: "env"`)
2. `:1591-1602` — **`auth.json` API keys** (`source: "api"`)
3. `:1604-1623` — **plugin auth loaders** (OAuth refresh etc.)
4. `:1625-1641` — **built-in `custom(dep)` provider hooks** (`source: "custom"`)
5. `:1643-1651` — **config file `provider` block** (`source: "config"`) — last, so
   explicit config beats everything.

For a provider with several token sources, the per-provider resolution is
explicit; e.g. Snowflake (`:910-915`):
`envToken ?? apiKeyToken ?? oauthToken ?? configToken`.

**OAuth vs API key** — OAuth providers store `{type:"oauth", access, refresh,
expires}` and register a *plugin auth loader* that supplies a custom `fetch`
performing refresh before each call (`:933-953` describes exactly this split;
`OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"` at `auth/index.ts:8` is the
placeholder API key handed to SDKs that insist on one).

---

## 4. Provider loading — SDK vs OpenAI-compatible base URL

**FACT — providers name an npm package.** The catalog's `npm` field
(`core/models-dev.ts:128`) is dynamically imported from a static map at
`provider/provider.ts:124` and neighbours, e.g.:

```ts
"@openrouter/ai-sdk-provider": () => import("@openrouter/ai-sdk-provider").then((m) => m.createOpenRouter),
```

`provider/transform.ts:75-86` maps npm package → provider id in the reverse
direction.

**FACT — custom / local providers are pure config**, using
`@ai-sdk/openai-compatible` plus a `baseURL`. Verbatim from
<https://opencode.ai/docs/providers/>:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama (local)",
      "options": { "baseURL": "http://localhost:11434/v1" },
      "models": { "llama2": { "name": "Llama 2" } }
    }
  }
}
```

```json
{
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio (local)",
      "options": { "baseURL": "http://127.0.0.1:1234/v1" },
      "models": { "google/gemma-3n-e4b": { "name": "Gemma 3n-e4b (local)" } }
    }
  }
}
```

```json
{
  "provider": {
    "llama.cpp": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "llama-server (local)",
      "options": { "baseURL": "http://127.0.0.1:8080/v1" },
      "models": {
        "qwen3-coder:a3b": {
          "name": "Qwen3-Coder: a3b-30b (local)",
          "limit": { "context": 128000, "output": 65536 }
        }
      }
    }
  }
}
```

```json
{
  "provider": {
    "myprovider": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "My AI Provider Display Name",
      "options": {
        "baseURL": "https://api.myprovider.com/v1",
        "apiKey": "{env:ANTHROPIC_API_KEY}",
        "headers": { "Authorization": "Bearer custom-token" }
      },
      "models": {
        "my-model-name": { "name": "My Model Display Name", "limit": { "context": 200000, "output": 65536 } }
      }
    }
  }
}
```

**Key observation for us:** a *local* model in OpenCode is not a first-class
category. It is an ordinary provider that happens to point at `127.0.0.1`, with
the user hand-writing `limit.context`/`limit.output`. There is **no discovery,
no download, no lifecycle**. This is exactly the axis on which ShelraCode is
already ahead, and exactly why we should not copy OpenCode's model here — see
§8.

---

## 5. OpenRouter in OpenCode specifically

**FACT** (`provider/provider.ts:474-483`) — the entire OpenRouter-specific
customisation is 10 lines:

```ts
openrouter: () =>
  Effect.succeed({
    autoload: false,
    options: {
      headers: {
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      },
    },
  }),
```

* `autoload: false` — the provider is **not** activated merely because it exists
  in the catalog; it activates only when a credential is found (env or
  `auth.json`) or it is named in config (`:1633`:
  `if (result && (result.autoload || providers[providerID]))`).
* The same two attribution headers appear for `llmgateway` (`:463-472`),
  `nvidia` (`:484-494`, plus `X-BILLING-INVOKE-ORIGIN`), `vercel` (`:495-504`,
  lower-cased), and two more sites (`:605`, `:895`).

**FACT — models are surfaced from models.dev, not from OpenRouter's own
`/models`.** There is no OpenRouter `/api/v1/models` call anywhere in
`provider.ts`; the 360 OpenRouter models come out of `api.json`. Per-model
routing options are passed through config (`docs/providers`):

```json
{
  "provider": {
    "openrouter": {
      "models": {
        "moonshotai/kimi-k2": {
          "options": { "provider": { "order": ["baseten"], "allow_fallbacks": false } }
        }
      }
    }
  }
}
```

**INFERENCE (high confidence)** — because OpenCode reads OpenRouter models from
models.dev, its free-model view is only as fresh as models.dev. Measured on
2026-09-06 the two agreed *exactly* on the free set (21 vs 21, zero symmetric
difference) but models.dev carried only **360 of 430** OpenRouter models. For a
product whose *headline* feature is "free OpenRouter models", the 70-model gap
and the extra hop are a real argument for calling OpenRouter's own endpoint.

---

## 6. The `/models` picker

**FACT** (`packages/app/src/components/dialog-select-model.tsx`):

* **Grouping is by provider display name**, not by local/remote:
  `groupBy={(x) => x.provider.name}` (`:74`); the controller builds
  `Array.from(byProvider, ([category, items]) => ({category, items})).sort(sortModelGroups)`
  (`:276-281`).
* **Sorting** — models alphabetically inside a group
  (`sortBy={(a,b) => a.name.localeCompare(b.name)}`, `:73`; also `:274`);
  groups by `a.items[0].provider.name.localeCompare(...)` (`:44`).
* **Group headers are sticky** (`:452-455`).
* **Search** is a separate, unit-tested module:
  `dialog-select-model-search.ts` (+ `.test.ts`).
* **Selection records a recent**: `model.set({ modelID: item.id, providerID:
  item.provider.id }, { recent: true })` (`:288`, also `:95`).
* Sibling dialogs show the surrounding surface: `dialog-connect-provider.tsx`,
  `dialog-custom-provider.tsx`, `dialog-manage-models.tsx`,
  `settings-models.tsx`, `dialog-select-model-unpaid.tsx`.

**FACT — "recents" are persisted outside the config**
(`provider/provider.ts:2009-2020`): `${Global.Path.state}/model.json` holding
`{ recent: [{ providerID, modelID }, …] }`.

**FACT — mid-session switching.** The picker writes provider+model ids into
app state; the provider registry (`Provider.getLanguage` / `getModel`) resolves
lazily per call. There is no explicit "tear down the old provider" step in
`provider.ts` — the SDK instance is looked up from the loaded provider map on
demand. **INFERENCE (medium-high confidence)** — switching model does *not*
reset the conversation; OpenCode simply sends the same message history to the
new model, and does not re-validate history length against the new model's
`limit.context` at switch time. (I found no such re-check in `provider.ts`;
absence-of-evidence, so medium confidence on the negative.)

---

## 7. Config precedence

**FACT — default-model resolution** (`provider/provider.ts:2004-2037`):

1. `cfg.model` from config → `parseModel(cfg.model)` (`:2006`)
2. the first entry of `${Global.Path.state}/model.json`'s `recent` array that
   still resolves to a loaded provider+model (`:2009-2026`)
3. otherwise the first provider (restricted to configured ones if any) and its
   highest-priority model via `sort()` (`:2028-2036`)

**FACT — documented precedence** (<https://opencode.ai/docs/models/>) puts the
CLI flag on top: `--model`/`-m` → config `model` → previously used → first by
internal priority.

**FACT — the "internal priority"** is a hardcoded family list
(`provider/provider.ts:2043-2052`):

```ts
const priority = ["gpt-5", "claude-sonnet-4", "big-pickle", "gemini-3-pro"]
const smallModelFamilyPriority = ["gemini-flash", "gpt-nano", "claude-haiku"]
```

**FACT — small/auxiliary model** has its own config key `small_model`, parsed
with `parseModel` (`:1939`) and falling back to the family priority list
(`:1967-1977`).

**FACT — global paths are XDG** (`core/global.ts:10-29`): `data`, `cache`,
`config`, `state`, `tmp`, `bin`, `log`, `repos` — with `OPENCODE_CONFIG_DIR`
overriding `config` (`:64`) and `OPENCODE_TEST_HOME` overriding `home` (`:19`).

Model-level `options` can be set globally in config
(<https://opencode.ai/docs/models/>):

```jsonc
{ "provider": { "openai": { "models": { "gpt-5": { "options": {
  "reasoningEffort": "high", "textVerbosity": "low" } } } } } }
```

and **variants** (built-in for Anthropic thinking budgets / OpenAI reasoning
effort, plus user-defined) give named alternate configurations of one model,
cycled with a `variant_cycle` keybind.

---

## 8. Verdict — copy this, skip that

### Worth copying (high value, low cost)

| Idea | Why |
| --- | --- |
| **`provider/model` id, split on first `/`** (`:2054`) | One string is enough to address anything. Survives model ids containing slashes and `:free` suffixes. |
| **`limit: {context, output}` on every model** | Exactly the shape the queued context-budget fix needs. Adopt the field names. |
| **Boolean capability flags** (`tool_call`, `reasoning`, `attachment`, `temperature`) | Cheap, sufficient, and directly maps to OpenRouter's `supported_parameters`. |
| **`auth.json`, `0o600`, keyed by provider id, tagged union value** (`auth/index.ts:10-36`) | Keeps secrets out of the settings file that gets pasted into bug reports; leaves room for OAuth later without a schema change. |
| **Env-var-name-per-provider declared in the catalog** (`:126`, used at `:1583`) | Makes `OPENROUTER_API_KEY` a data-driven fact, not an `if`. |
| **Cache order disk → bundled snapshot → network**, atomic tmp+rename, TTL on mtime, background refresh (`models-dev.ts:202-258`) | Correct offline behaviour with ~40 lines. |
| **A kill switch env flag** (`OPENCODE_DISABLE_MODELS_FETCH`) | A local-first product needs "never touch the network" to be one variable. |
| **`autoload: false` + activate-on-credential** (`:476`, `:1633`) | The precise mechanism for "show cloud models, but never silently use one". |
| **Attribution headers** `HTTP-Referer` + `X-Title` (`:479-480`) | Two lines, and they are what OpenRouter's rankings key on. |
| **Recents persisted separately from config** (`state/model.json`, `:2009`) | Keeps a UX convenience out of the user's declarative settings. |
| **Search extracted into a pure, tested module** (`dialog-select-model-search.ts`) | Testable picker behaviour without a TUI harness. |

### Not worth copying for ShelraCode

| Thing | Why skip |
| --- | --- |
| **The whole models.dev document (4.5 MB, 213 providers)** | We need one provider. Fetching 4.5 MB to filter down to 21 free models is absurd on a laptop; OpenRouter's own `/models` is 709 KB and is authoritative for free flags. Keep models.dev as a *documented future* multi-provider source. |
| **Effect / Layer / Context service graph** | ShelraCode is plain async TypeScript. `Effect.cachedInvalidateWithTTL`, `Flock`, `LayerNode` would be a foreign runtime. |
| **`Flock` cross-process locking** | ShelraCode is one interactive process per machine in practice; atomic tmp+rename is enough. Revisit only if the daemon and TUI both refresh. |
| **Build-time snapshot injection (`declare const OPENCODE_MODELS_DEV`)** | A checked-in `const FALLBACK_FREE_MODELS: CatalogEntry[]` array is simpler and reviewable in a PR. |
| **75+ provider SDK map + per-provider quirk handling** (`provider.ts` is 80 KB, and `transform.ts` another 70 KB — mostly Bedrock region prefixes, Anthropic slug translation, Cloudflare gateway routing) | This is the bulk of OpenCode's provider code and buys nothing for local + OpenRouter. Our `createOpenAICompatibleProvider` already covers both. |
| **Variants / `variant_cycle`** | Nice, but orthogonal. Reasoning-effort UI in ShelraCode is currently a no-op anyway (`catalog.ts` stubs). |
| **Grouping the picker by provider name only** | We want the **Local / Cloud** axis to be the primary grouping — that *is* the product's stance. Group by category first, provider second. |
| **Treating local models as "a provider with a baseURL and hand-written limits"** | ShelraCode already has real discovery, download, health probing and process lifecycle (`ManagedLlamaRuntime`). Do not regress to config-file local models. |

**INFERENCE (high confidence)** — the *architecture* worth importing from
OpenCode is about 300 lines: an id convention, a metadata schema, a cache
policy, and an auth file. The remaining ~150 KB is provider-zoo maintenance
that a two-source catalog does not incur.

---

## Sources

- <https://opencode.ai/docs/models/>
- <https://opencode.ai/docs/providers/>
- <https://models.dev/>
- <https://models.dev/api.json> (live, 2026-09-06)
- <https://models.opencode.ai/api.json> (live, 2026-09-06)
- <https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/core/src/models-dev.ts>
- <https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/core/src/global.ts>
- <https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/provider/provider.ts>
- <https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/provider/transform.ts>
- <https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/auth/index.ts>
- <https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/app/src/components/dialog-select-model.tsx>
- <https://api.github.com/repos/sst/opencode> (301 → `anomalyco/opencode`)
