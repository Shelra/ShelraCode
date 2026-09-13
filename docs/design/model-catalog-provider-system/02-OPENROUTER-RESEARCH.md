# 02 — Research: the OpenRouter API and its free models

**Fetch timestamp for all live data in this document: 2026-09-06, ~19:38–19:50
local (Europe/Madrid).** The free roster changes weekly; every number below is
a snapshot, and the design in `04` treats it as such.

Method: `curl` against the public API, then exact JSON analysis (no
summarisation). Raw document: `GET https://openrouter.ai/api/v1/models` →
**HTTP 200, 708 673 bytes**.

---

## 1. `GET /api/v1/models`

### 1.1 Envelope

**FACT** — top-level keys: `data`, `total_count`, `links`.
`data.length === 430`, `total_count === 430`.

### 1.2 Model object — full key union across all 430 entries

**FACT:**

```
alias_target, architecture, benchmarks, canonical_slug, context_length,
created, default_parameters, description, expiration_date, hugging_face_id,
id, knowledge_cutoff, links, name, per_request_limits, pricing, reasoning,
supported_parameters, supported_voices, top_provider
```

Nested key unions (again, across all 430):

| Object | Keys observed |
| --- | --- |
| `architecture` | `input_modalities`, `instruct_type`, `modality`, `output_modalities`, `tokenizer` |
| `pricing` | `audio`, `audio_output`, `completion`, `image`, `image_output`, `input_audio_cache`, `input_cache_read`, `input_cache_write`, `input_cache_write_1h`, `internal_reasoning`, `overrides`, `prompt`, `web_search` |
| `top_provider` | `context_length`, `is_moderated`, `max_completion_tokens` |
| `per_request_limits` | *(empty — the field is present but always `null` in this snapshot)* |

> **FACT — `pricing` is sparse.** On free models the object contains **only**
> `prompt` and `completion`. A normaliser must not assume the other keys exist.
> All pricing values are **strings holding decimal USD-per-token**, e.g.
> `"0"`, `"0.0000006"` — never numbers. (Contrast models.dev, which uses
> numbers per *million* tokens.)

> **FACT — `top_provider.context_length` and `max_completion_tokens` can be
> `null`** (observed on `openrouter/free`). Any consumer must handle null.

### 1.3 A real, verbatim entry (trimmed description only)

```json
{
  "id": "inclusionai/ling-3.0-flash-sante:free",
  "canonical_slug": "inclusionai/ling-3.0-flash-sante-20260904",
  "hugging_face_id": null,
  "name": "inclusionAI: Ling 3.0 Flash Sante (free)",
  "created": 1788545946,
  "description": "Ling 3.0 Flash Sante is a health and medicine-focused mixture-of-experts model …",
  "context_length": 262144,
  "architecture": {
    "modality": "text->text",
    "input_modalities": ["text"],
    "output_modalities": ["text"],
    "tokenizer": "Other",
    "instruct_type": null
  },
  "pricing": { "prompt": "0", "completion": "0" },
  "top_provider": {
    "context_length": 262144,
    "max_completion_tokens": 32768,
    "is_moderated": false
  },
  "per_request_limits": null,
  "supported_parameters": [
    "frequency_penalty", "include_reasoning", "logprobs", "max_tokens",
    "presence_penalty", "reasoning", "repetition_penalty", "seed", "stop",
    "temperature", "tool_choice", "tools", "top_k", "top_logprobs", "top_p"
  ],
  "default_parameters": {},
  "supported_voices": null,
  "knowledge_cutoff": null,
  "expiration_date": null,
  "links": { "details": "/api/v1/models/inclusionai/ling-3.0-flash-sante-20260904/endpoints" },
  "reasoning": { "mandatory": false, "default_enabled": true }
}
```

Fields that matter to us, mapped:

| OpenRouter field | Meaning | Our `CatalogEntry` field |
| --- | --- | --- |
| `id` | provider-scoped model id, may contain `/` and `:free` | tail of our id |
| `name` | human label, already suffixed "(free)" | `name` |
| `context_length` | model-level context | fallback for `contextWindow` |
| `top_provider.context_length` | **what the serving endpoint actually gives** | `contextWindow` (preferred) |
| `top_provider.max_completion_tokens` | max output tokens | `maxOutputTokens` |
| `top_provider.is_moderated` | upstream moderation layer present | `notes` |
| `pricing.prompt` / `.completion` | string decimals, per token | `cost.prompt` / `cost.completion`, `cost.free` |
| `supported_parameters` includes `tools` | function calling | `capabilities.tools` |
| `supported_parameters` includes `reasoning` | thinking tokens | `capabilities.reasoning` |
| `architecture.input_modalities` includes `image` | vision | `capabilities.vision` |
| `architecture.modality` | e.g. `text+image->text` | display |
| `expiration_date` | model sunset | `notes` / hide when past |
| `links.details` | per-endpoint detail path | future per-endpoint limits |

---

## 2. Identifying FREE models

### 2.1 The two signals disagree — use pricing, keep the suffix as a hint

**FACT (2026-09-06):**

* `id.endsWith(":free")` → **18** models.
* `pricing.prompt === "0" && pricing.completion === "0"` → **21** models.
* `:free` suffix but non-zero price → **0** models (the suffix never lies).
* Zero price but no `:free` suffix → **3**:
  `google/lyria-3-pro-preview`, `google/lyria-3-clip-preview`,
  `openrouter/free`.

**RECOMMENDATION:** the free predicate is
`pricing.prompt === "0" && pricing.completion === "0"`, with `id.endsWith(":free")`
recorded as a separate boolean for display. The two Lyria entries are
audio-output models (`text+image->text+audio`) and should be excluded by a
*modality* filter, not by a pricing one.

### 2.2 `openrouter/free` — the free router

**FACT** — a distinct pseudo-model:

```json
{
  "id": "openrouter/free",
  "name": "Free Models Router",
  "description": "The simplest way to get free inference. openrouter/free is a router that selects free models at random from the models available on OpenRouter…",
  "context_length": 200000,
  "architecture": { "modality": "text+image->text", "tokenizer": "Router" },
  "pricing": { "prompt": "0", "completion": "0" },
  "top_provider": { "context_length": null, "max_completion_tokens": null, "is_moderated": false },
  "supported_parameters": [ …, "tools", "tool_choice", "structured_outputs", "response_format", … ]
}
```

**INFERENCE (high confidence)** — this is a *tempting but wrong* default for a
coding agent: it "selects free models at random", so context window, tool
fidelity and instruction-following change per request, and `top_provider` limits
are `null`. Offer it, label it clearly, never auto-select it.

### 2.3 Server-side filter parameters — they exist

**FACT (live probes, all HTTP 200):**

| Query | `data.length` |
| --- | --- |
| *(none)* | 430 |
| `?max_price=0` | **20** |
| `?supported_parameters=tools` | 347 |
| `?max_price=0&supported_parameters=tools` | **17** |
| `?category=programming` | 20 |
| `?input_modalities=text` | 430 |

`?max_price=0` returns the 18 `:free` + the 2 Lyria entries — it **excludes**
`openrouter/free`. Combining `max_price=0&supported_parameters=tools` yields
exactly the 17 free, tool-capable models.

**RECOMMENDATION:** still fetch the **unfiltered** document once and filter
client-side. Reasons: (a) one cached artifact serves every filter the UI needs
(`--free`, `--all`, tools-only) without extra round trips; (b) the filter
parameters are undocumented in the pages I read and could change; (c) 709 KB
once per TTL is cheap. Keep `?max_price=0&supported_parameters=tools` documented
as a fast path for a future `--refresh --free-only`.

### 2.4 The free roster, 2026-09-06

All 18 `:free` models plus `openrouter/free`. `ctx` = `top_provider.context_length`,
`out` = `top_provider.max_completion_tokens`, `T` = `tools` in
`supported_parameters`, `TC` = `tool_choice`, `RF` = `response_format`,
`Mod` = `top_provider.is_moderated`.

| id | ctx | out | T | TC | RF | modality | Mod |
| --- | ---: | ---: | :-: | :-: | :-: | --- | :-: |
| `thinkingmachines/inkling:free` | 1 048 576 | 262 144 | ✓ | – | – | text+image+audio→text | no |
| `thinkingmachines/inkling-small:free` | 1 048 576 | 262 144 | ✓ | – | – | text+image+audio→text | no |
| `minimax/minimax-m3:free` | 1 048 576 | 943 718 | ✓ | ✓ | ✓ | text+image+video→text | no |
| `nvidia/nemotron-3.5-lightning:free` | 1 000 000 | 65 536 | ✓ | ✓ | – | text→text | no |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | 1 000 000 | 65 536 | ✓ | ✓ | – | text→text | no |
| `dots-studio/dots-3-note-preview:free` | 512 000 | 460 800 | ✓ | ✓ | ✓ | text+image→text | no |
| `cohere/north-mini-code:free` | 256 000 | 64 000 | ✓ | ✓ | – | text→text | **yes** |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | 256 000 | 65 536 | ✓ | ✓ | – | text+image+audio+video→text | no |
| `google/gemma-4-31b-it:free` | 262 144 | 32 768 | ✓ | ✓ | ✓ | text+image+video→text | no |
| `google/gemma-4-26b-a4b-it:free` | 262 144 | 32 768 | ✓ | ✓ | ✓ | text+image+video→text | no |
| `nvidia/nemotron-3-super-120b-a12b:free` | 262 144 | 235 929 | ✓ | ✓ | ✓ | text→text | no |
| `poolside/laguna-s-2.1:free` | 262 144 | 32 768 | ✓ | ✓ | – | text→text | no |
| `poolside/laguna-xs-2.1:free` | 262 144 | 32 768 | ✓ | ✓ | – | text→text | no |
| `inclusionai/ling-3.0-flash-fin:free` | 262 144 | 32 768 | ✓ | ✓ | – | text→text | no |
| `inclusionai/ling-3.0-flash-sante:free` | 262 144 | 32 768 | ✓ | ✓ | – | text→text | no |
| `minimax/minimax-m2.7:free` | 196 608 | 176 947 | ✓ | ✓ | ✓ | text→text | no |
| `nvidia/nemotron-3.5-content-safety:free` | 128 000 | 8 192 | **✗** | ✗ | – | text+image→text | no |
| `liquid/lfm-2.5-2.6b:free` | 65 536 | 8 192 | ✓ | ✓ | ✓ | text→text | no |
| `openrouter/free` *(router)* | `null` | `null` | ✓ | ✓ | ✓ | text+image→text | no |

**FACT — 17 of the 18 `:free` models support `tools`.** The single exception is
`nvidia/nemotron-3.5-content-safety:free` (a moderation classifier, not a chat
model).

**FACT — the smallest free context is 65 536 tokens** (`liquid/lfm-2.5-2.6b:free`);
the smallest free *output* budget is 8 192.

**FACT — every free model except the content-safety one advertises `reasoning`
in `supported_parameters`**, and the sample entry shows
`reasoning: {mandatory: false, default_enabled: true}` — i.e. reasoning tokens
are **on by default** on at least some free models. That has cost-free but
latency- and token-budget-relevant consequences.

**Coding-agent shortlist (INFERENCE, medium confidence — judged on name/vendor
positioning and limits, not on benchmarks I ran):**
`cohere/north-mini-code:free` (explicitly a code model, but *moderated*),
`poolside/laguna-s-2.1:free` (Poolside is a coding-model vendor),
`minimax/minimax-m2.7:free` and `nvidia/nemotron-3-super-120b-a12b:free`
(large context *and* large output budget, tools + structured outputs),
`google/gemma-4-31b-it:free` (general, well-known family, tools + response_format).
The two `inclusionai/ling-3.0-flash-*` entries are domain models (finance,
health) and should not be defaults despite good limits.

**Note the `expiration_date` field exists** — free preview models are expected
to disappear. The design must survive an id vanishing between two runs.

---

## 3. Auth and headers

**FACT** — base URL `https://openrouter.ai/api/v1`; chat endpoint
`https://openrouter.ai/api/v1/chat/completions`; required header
`Authorization: Bearer <OPENROUTER_API_KEY>`
(<https://openrouter.ai/docs/api-reference/overview>).

**FACT — `/api/v1/models` needs no auth.** The 708 KB fetch above was
unauthenticated. This matters: ShelraCode can populate the cloud catalog and
show it to a user who has **no key at all**.

**FACT — attribution headers** (<https://openrouter.ai/docs/app-attribution>):

* `HTTP-Referer` — "identifies your app's URL and is used as the primary
  identifier for rankings". Required *for attribution to work*; not required for
  the request to succeed.
* `X-OpenRouter-Title` — "sets or modifies your app's display name in rankings
  and analytics". **`X-Title` remains supported for backward compatibility** —
  which is what OpenCode still sends (`provider.ts:480`).
* `X-OpenRouter-Categories` — marketplace categories, ≤2 per request.

Documented example:

```bash
curl https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "HTTP-Referer: https://myapp.com" \
  -H "X-OpenRouter-Title: My AI Assistant" \
  -H "X-OpenRouter-Categories: cli-agent,cloud-agent"
```

**RECOMMENDATION for ShelraCode:** send `HTTP-Referer` and the modern
`X-OpenRouter-Title`, and *document them as attribution-only*. They contain no
user data. Because a local-first product must be explicit about egress, they
belong in `04 §6` ("exactly what leaves the machine"). A settings flag to
suppress them is a reasonable courtesy but not required.

**Getting a key:** the user creates one at openrouter.ai and pastes it. There is
no device/OAuth flow we need to implement for v1.

---

## 4. Free-tier reality

**FACT** (<https://openrouter.ai/docs/api-reference/limits>) — verbatim
constants:

| Limit | Value | Constant name in docs |
| --- | --- | --- |
| Requests per minute, free models | **20** | `FREE_MODEL_RATE_LIMIT_RPM` |
| Requests per day, no credits ever purchased | **50** | `FREE_MODEL_NO_CREDITS_RPD` |
| Requests per day, after purchasing credits | **1000** | `FREE_MODEL_HAS_CREDITS_RPD` |
| Credit threshold that unlocks the higher cap | **10** credits, *historically* purchased | `FREE_MODEL_CREDITS_THRESHOLD` |

**This is the single most important operational fact for the design.** A coding
agent burns requests fast: one user turn with tool calls is *N* requests, not
one. At 50 requests/day a free-tier user gets roughly **5–15 real agent turns
per day**. The UI must say so up front (`05 §4`).

**FACT — 429 behaviour.** Rate-limit responses carry error metadata with code
429; when OpenRouter itself enforces the limit, `X-RateLimit-Limit`,
`X-RateLimit-Remaining` and `X-RateLimit-Reset` headers are present. When an
upstream provider's limit trips *after streaming has begun*, the failure arrives
**as an SSE event with `finish_reason: "error"`**, not as an HTTP status.

**INFERENCE (high confidence)** — that second case is exactly the one that
breaks naive clients: the HTTP response is 200, the stream opens, and the turn
dies mid-token. Our stream normaliser must surface a
`finish_reason: "error"` as a `{type:"error"}` provider event, not as a clean
finish. See `07 §6`.

**FACT — negative balance.** "If your account has a negative credit balance, you
may see **402 Payment Required** errors, *including for free models*." Adding
credits above zero restores access.

**FACT — data policy gates free models.** Free endpoints are served by providers
that may train on inputs. If the account's privacy settings disallow that, the
request fails with **`404 No endpoints found matching your data policy`**. The
fix is to enable the relevant option at
<https://openrouter.ai/settings/privacy>, which offers separate switches for
paid and free endpoints ("Enable free endpoints that may train on inputs",
"Enable free endpoints that may publish prompts").
Sources: <https://openrouter.ai/docs/features/privacy-and-logging>,
<https://www.answeroverflow.com/m/1471171680138166433>,
<https://www.answeroverflow.com/m/1471158008448028823>.

**This is a hard requirement to surface in a privacy-first product.** Using a
free OpenRouter model means the user has *opted in* to their prompts being used
for training. `05 §4` specifies the exact confirmation text.

**FACT — models silently 404.** A `:free` id present in yesterday's cache can be
gone today (`expiration_date` exists for exactly this). The catalog must treat a
404 on a cloud model as "refresh the catalog and tell the user", not as a crash.

---

## 5. The chat-completions surface

**FACT** (<https://openrouter.ai/docs/api-reference/overview>) — "OpenRouter's
request and response schemas are very similar to the OpenAI Chat API, with a few
small differences", and OpenRouter "normalizes the schema across models and
providers so you only need to learn one." That is the OpenAI-compatible
guarantee `createOpenAICompatible` needs.

**FACT — supported parameters** (<https://openrouter.ai/docs/api-reference/parameters>)
include `tools`, `tool_choice`, `parallel_tool_calls`, `response_format`,
`structured_outputs`, `reasoning`, `reasoning_effort`, `max_tokens` /
`max_completion_tokens`, `stop`, `seed`, `temperature`, `top_p`, `top_k`,
`min_p`, `top_a`, `frequency_penalty`, `presence_penalty`,
`repetition_penalty`, `logit_bias`, `logprobs`, `top_logprobs`,
`web_search_options`, `verbosity`.

**FACT — OpenRouter-specific request fields**
(<https://openrouter.ai/docs/api-reference/overview>):

* `models: string[]` — a fallback array; combined with `route: "fallback"`.
* `provider: {…}` — provider routing preferences (`order`, `allow_fallbacks`, …).
* `user` — stable end-user identifier for abuse prevention.
* Plugins (web search, PDF handling, response healing, context compression).
* Token usage accounting including cached and reasoning tokens and costs.

**Streaming / tool_calls deltas:** the parameters page I fetched does **not**
state SSE `tool_calls` delta behaviour explicitly (recorded as a gap). However
**INFERENCE (high confidence)**: OpenRouter is documented as OpenAI-schema
compatible, `tools`/`tool_choice` are first-class supported parameters, and
OpenCode drives OpenRouter through an AI-SDK OpenAI-compatible client
(`@openrouter/ai-sdk-provider`, `provider.ts:124`) that requires streaming
tool-call deltas to work at all. ShelraCode's `createOpenAICompatibleProvider`
uses `@ai-sdk/openai-compatible`, the same wire contract.
**This should still be validated by a manual smoke test in Phase 5** — it is the
one assumption in this dossier that a cheap experiment can settle and I could
not settle without a key.

**`models` fallback array is attractive for the free tier**
(INFERENCE, medium confidence): sending
`{"model": "<chosen>", "models": ["<chosen>", "<runner-up>"], "route": "fallback"}`
would route around a 429/404 on a specific free model. It is *not* in the v1
scope of `04` because it changes which model the user is actually talking to
without telling them — an explicit anti-goal for this product. Documented as an
open question in `07`.

---

## 6. Key / credit inspection

**FACT (live probe, unauthenticated):**

| Endpoint | Response |
| --- | --- |
| `GET /api/v1/key` | `{"error":{"message":"No cookie auth credentials found","code":401}}`, HTTP 401 |
| `GET /api/v1/credits` | same, HTTP 401 |
| `POST /api/v1/chat/completions` (no key) | same, HTTP 401 |

**FACT** (<https://openrouter.ai/docs/api-reference/limits>) — `GET /api/v1/key`
returns a Key object with `label`, `limit` (credit cap or `null`),
`limit_reset`, `limit_remaining`, `include_byok_in_limit`, usage metrics across
all-time/daily/weekly/monthly for standard and BYOK usage, and an
**`is_free_tier` boolean**.

**RECOMMENDATION:** `shelra models` should *not* call `/key` on every listing.
Call it only from `shelra auth openrouter` (to validate a freshly entered key
and immediately tell the user their real daily cap) and from an explicit
`shelra models refresh`. `is_free_tier` + `limit_remaining` is exactly what
turns "50 or 1000 requests/day?" into a fact instead of a guess.

---

## 7. Gotchas for a coding agent — the checklist

1. **Requests/day, not tokens/day, is the binding constraint.** 20 RPM / 50 RPD
   (or 1000 RPD after ≥10 credits). One agent turn ≠ one request.
2. **One free model has no tool support**
   (`nvidia/nemotron-3.5-content-safety:free`) — filter on
   `supported_parameters.includes("tools")` before offering a model to an agent
   that cannot work without tools. Our router already requires tools
   (`selectLocalRoute({requiresTools: true})`).
3. **Free tier implies opting into training.** Without it: `404 No endpoints
   found matching your data policy`. Must be stated *before* the first cloud
   call in a privacy-first CLI.
4. **Context varies 16× across the free roster** (65 536 → 1 048 576). A single
   hardcoded context constant is wrong for every model. This is precisely the
   hand-off to the queued context-budget fix.
5. **Output budgets vary 115×** (8 192 → 943 718) and are *not* implied by the
   context window. Carry `maxOutputTokens` separately.
6. **`top_provider.*` can be `null`** (`openrouter/free`). Fall back to
   `context_length`, then to a conservative default, and mark confidence.
7. **Free models disappear.** `expiration_date` exists; a cached id can 404.
   Treat "model not found" as a catalog-refresh trigger.
8. **Mid-stream failures return HTTP 200.** `finish_reason: "error"` inside SSE.
9. **`is_moderated: true`** on `cohere/north-mini-code:free` — an upstream
   moderation layer can reject code content. Show it in the picker.
10. **Reasoning is default-enabled on some free models**
    (`reasoning.default_enabled: true`), inflating latency and output tokens
    unless `reasoning` is explicitly configured.
11. **Prices are strings.** `"0"` is free; `parseFloat` before comparing, and
    never `=== 0`.
12. **402 on a negative balance affects free models too.**

---

## Sources

- <https://openrouter.ai/api/v1/models> (live, unauthenticated, 2026-09-06)
- <https://openrouter.ai/api/v1/models?max_price=0> (live)
- <https://openrouter.ai/api/v1/models?max_price=0&supported_parameters=tools> (live)
- <https://openrouter.ai/api/v1/key> (live, 401 unauthenticated)
- <https://openrouter.ai/api/v1/credits> (live, 401 unauthenticated)
- <https://openrouter.ai/docs/api-reference/limits>
- <https://openrouter.ai/docs/api-reference/overview>
- <https://openrouter.ai/docs/api-reference/parameters>
- <https://openrouter.ai/docs/app-attribution>
- <https://openrouter.ai/docs/features/privacy-and-logging>
- <https://openrouter.ai/settings/privacy>
- <https://www.answeroverflow.com/m/1471171680138166433>
- <https://www.answeroverflow.com/m/1471158008448028823>
