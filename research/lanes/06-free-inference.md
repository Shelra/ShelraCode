# Lane 06 — Free and low-cost cloud intelligence

**Date:** 2026-09-08. **Analyst stance:** terms-of-service pages over marketing pages, live API responses
over both. Every provider fact below was fetched from that provider's own documentation today, or
produced by a live call made today. Sources: `research/sources/06-free-inference.md`.

**Method caveat stated up front.** WebSearch was unavailable to this lane (the session's 200-call budget
was exhausted by earlier lanes). Every provider claim therefore rests on a direct fetch of the provider's
own docs/terms/pricing URL or on a live API call — the stronger evidence class. Candidate URLs were found
by HTTP probing and by reading `sitemap.xml`. Where a summarising fetch might have dropped a table, the
page was re-fetched raw with `curl` and parsed locally.

**Spending caveat stated up front.** The repo's `KEY_GROQ` is on Groq's **paid Developer plan**, not the
free plan — proven by the rate-limit headers on the first call (`x-ratelimit-limit-requests: 500000`,
`x-ratelimit-limit-tokens: 250000`, against a documented free-plan ceiling of 1 000 RPD / 8 000 TPM for
the same model). One 99-token call had already completed when this was discovered. **All further Groq
inference was stopped**, per the mission rule against spending. Groq capabilities below are therefore
documentation-derived and labelled `NOT TESTED`, not live-verified. All OpenRouter testing used only
models whose id ends in `:free` and whose response `usage.cost` was `0`.

---

## 1. Summary (10 lines)

1. Zero-cost cloud inference in September 2026 is **real, capable, and shrinking** — the capability per
   free token has risen while the number of durable free doors has fallen.
2. Two significant free tiers died this year: **GitHub Models was fully retired on 2026-07-30**, and
   **Cerebras replaced its free tier with a $5 credit that expires in 30 days**, stating plainly that it
   offers no always-free allowance.
3. OpenRouter lists 429 models; exactly **16 carry the `:free` suffix** — 3.7% — and every one is a
   vendor launch vehicle (NVIDIA ×5, Google ×2, Poolside ×2, Thinking Machines ×2, inclusionAI ×2, Cohere,
   Liquid, Dots Studio). This is a marketing surface, not a commons.
4. Measured availability across 3 sweeps × 16 models = **29/48 successes (60.4%)**; only 7 of 16 models
   worked on all three passes and **5 of 16 never worked at all**.
5. A new gating mechanism has appeared that nobody is discussing: the two strongest free models are
   **restricted to "agentic harnesses"** — free frontier capacity now flows to incumbent distribution,
   not to new builders.
6. **At least 8 of the 16 free models are paid for with your prompts**: requiring `data_collection: deny`
   removes them with the message "No endpoints found matching your data policy (Free model training)".
7. **A strict JSON schema was accepted with HTTP 200 and silently ignored** (3/3 trials, prose returned),
   directly contradicting OpenRouter's own structured-outputs documentation.
8. What *is* genuinely commodity at zero cost: **tool calling (6/6 models)**, the OpenAI-compatible
   protocol, and **long context — 146 466 prompt tokens, correct needle retrieval, 10.9 s, $0**.
9. Throughput across free endpoints spans **6.2 to 218.3 tok/s — a 35× spread at an identical price of
   zero**, and one endpoint named "Lightning" timed out at 120 s.
10. The strategic finding: **paid open-weight inference is now so cheap (~$0.09/M input) that the
    engineering cost of harvesting free tiers likely exceeds the money saved** for anything past a demo.

---

## 2. Provider matrix

Legend: `LIVE` = tested by this lane today. `DOC` = from the provider's own documentation today.
`UNVERIFIED` = could not be confirmed.

| Provider | Endpoint / auth | Free mechanism | Free status today | Models available free | Rate limits (free) | Context | Tool calling | JSON schema | Vision | Embeddings | Latency (measured) | Privacy / training on free | Commercial use | OpenAI-compatible | Failure behaviour | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Groq** | `api.groq.com/openai/v1`, bearer key | Free plan tier | Alive, narrowed | 14 total; `gpt-oss-120b`, `gpt-oss-20b`, `gpt-oss-safeguard-20b`, `qwen3.6-27b`, `qwen3.8-27b`, `groq/compound(-mini)`, Whisper ×2, Prompt-Guard ×2, Orpheus TTS ×2, `allam-2-7b` | 30 RPM / **1K RPD** / 8K TPM / 200K TPD (gpt-oss); compound 250 RPD | 131 072 (gpt-oss, qwen, compound); 4 096 allam | Yes `DOC` | Strict schema on `gpt-oss-20b/120b`, `qwen3.8-27b`; **"Streaming and tool use are not currently supported with Structured Outputs"** `DOC` | No | No | 0.343 s for 99 tokens (paid tier) `LIVE` | **Contractually no training**: "Groq is not permitted to use Inputs or Outputs for training or fine-tuning" | Permitted | Yes | Documented `x-ratelimit-*` headers + `retry-after` | A1, A2, B1, B2, B3 |
| **OpenRouter (`:free`)** | `openrouter.ai/api/v1`, bearer key | Vendor-sponsored zero-price endpoints | Alive, volatile | **16 of 429** (see §2b) | **20 RPM**; **50 RPD** under $10 lifetime credits, **1 000 RPD** at/above | 65 536 – 1 048 576 | **6/6 tested** `LIVE` | 4/6 conformant; 1 hard 400; **1 silent ignore** `LIVE` | 5 of 16 accept images | No | 0.98 s – 120 s timeout `LIVE` | **≥8 of 16 train on your prompts**; default `data_collection: "allow"` | Permitted, but §7 forbids **reselling API access** | Yes | **No `x-ratelimit-*` headers at all**; HTTP 200 can carry a 502 body | A3–A16, B6–B13 |
| **Google AI Studio / Gemini** | `ai.google.dev`, API key | Free usage tier | Alive, **limits now unpublished** | Gemini 3.x / 2.x families | **No longer published** — "can be viewed in Google AI Studio"; "Specified rate limits are not guaranteed" | Model-dependent | Yes | Yes | Yes | Yes | `UNVERIFIED` (no key) | **Trains + human review**: "Google uses the content you submit… to provide, improve, and develop Google products" and "human reviewers may read, annotate, and process your API input and output" | Business use permitted; **may not build competing models** | Partial | 429 `RESOURCE_EXHAUSTED` | B15, B16 |
| **Cloudflare Workers AI** | Workers binding / REST | **10 000 Neurons/day** free | Alive | Most catalogue models, **but frontier open-weights are paid-only**: Kimi K2.6/K2.7-code, GLM 5.2/5.3/5.3-flash, DeepSeek V4 flash/pro | 10K Neurons/day + per-model rate limits | Model-dependent | Model-dependent | Model-dependent | Yes | Yes | `UNVERIFIED` | Not stated on pricing page | Permitted | Partial | "further operations will fail with an error" | B20, B21 |
| **Cerebras** | `api.cerebras.ai` | **$5 credits, expire in 30 days** | **FREE TIER ENDED** | `gpt-oss-120b`, `qwen-3.8-27b` during trial | Trial: 5 RPM / 30K uncached TPM / 1M TPD | 131 072 (via OR endpoint) | Yes | Yes | No | No | `UNVERIFIED` | Not stated | Permitted | Yes | Credits exhaust, access stops | B17, B18 |
| **GitHub Models** | — | — | **RETIRED 2026-07-30** | **None** | — | — | — | — | — | — | — | — | — | — | "no longer available to any customer" | B19 |
| **Hugging Face Inference Providers** | `router.huggingface.co/v1` | Monthly credits | Alive, token-sized | Routed providers | **$0.10/month, "subject to change"** (free users); $2 PRO | Model-dependent | Yes | Yes | Yes | Yes | `UNVERIFIED` | Per underlying provider | Permitted | Yes | Credits exhaust → must purchase | B22 |
| **Mistral La Plateforme** | `api.mistral.ai` | Free plan credits | Alive | Mistral family | **$10/month in API credits**; concrete RPS/TPM `NOT FOUND` | Model-dependent | Yes | Yes | Yes | Yes | `UNVERIFIED` | Opt-out of training offered on all tiers | Permitted | Yes | `UNVERIFIED` | B23, B24, B25 |
| **Together AI** | `api.together.xyz/v1` | None documented | No free tier documented | One model at $0.00 (Ternary Bonsai 27B) `UNVERIFIED` | Paid dynamic rate limiting only | — | Yes | Yes | Yes | Yes | `UNVERIFIED` | — | Permitted | Yes | — | B26, B27 |
| **Fireworks AI** | `api.fireworks.ai` | None | **No free tier** | — | "No payment method or no credits" → **10 RPM** | — | Yes | Yes | Yes | Yes | `UNVERIFIED` | — | Permitted | Yes | — | B28 |
| **SambaNova Cloud** | `api.sambanova.ai` | `UNVERIFIED` | `UNVERIFIED` | — | — | — | Yes (via OR) | Partial (via OR) | — | — | `UNVERIFIED` | — | — | Yes | — | B29 |
| **NVIDIA build.nvidia.com** | `integrate.api.nvidia.com` | `NOT FOUND` | `NOT FOUND` | — | — | — | Yes | Partial | Yes | Yes | — | NVIDIA free models on OpenRouter **all train on your data** `LIVE` | — | Yes | — | A15, B30, B31 |

### 2b. The 16 OpenRouter `:free` models, measured

Availability = successes across 3 sweeps (16:38Z, 16:42Z, 17:03Z). Data policy from the
`data_collection: "deny"` probe. Quantization and context from the endpoints API.

| Model | Sponsor | Ctx | Quant | Avail 3 passes | Latency observed | Tools | Struct out | Trains on your data? |
|---|---|---|---|---|---|---|---|---|
| `cohere/north-mini-code:free` | Cohere | 256 000 | unknown | **3/3** | 1.1 – 3.8 s; 17.7 tok/s | ✅ tested | ❌ **silently ignores schema** | **No** |
| `dots-studio/dots-3-note-preview:free` | Dots Studio | 512 000 | fp8 | **3/3** | 2.2 – 2.7 s | ✅ tested | ✅ tested | **No** |
| `inclusionai/ling-3.0-flash-fin:free` | inclusionAI | 262 144 | unknown | **3/3** | 1.0 – 1.1 s | ✅ tested | ❌ hard 400 | **No** |
| `inclusionai/ling-3.0-flash-sante:free` | inclusionAI | 262 144 | unknown | **3/3** | 0.97 – 0.99 s; **218 tok/s** | ✅ | not tested | **No** |
| `liquid/lfm-2.5-2.6b:free` | Liquid AI | 65 536 | fp8 | **3/3** | 1.7 – 2.4 s; 75.7 tok/s | ✅ tested | ✅ tested | **Yes** |
| `nvidia/nemotron-3.5-content-safety:free` | NVIDIA | 128 000 | unknown | **3/3** | 1.6 – 2.5 s | ❌ none | ❌ | **Yes** |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | NVIDIA | 1 000 000 | unknown | **3/3** | **80 – 87 s** (TTFB 10.2 s) | ✅ | ❌ | **Yes** |
| `nvidia/nemotron-3-super-120b-a12b:free` | NVIDIA | 262 144 | unknown | 2/3 (one 502) | 0.5 – 6.5 s | ✅ tested | ✅ tested | **Yes** |
| `nvidia/nemotron-3-nano-omni-...:free` | NVIDIA | 256 000 | unknown | 2/3 (one 502) | 1.5 – 38 s | ✅ tested | ✅ (undeclared but works) | **Yes** |
| `nvidia/nemotron-3.5-lightning:free` | NVIDIA | 1 000 000 | nvfp4 | 2/3 (**one 120 s timeout**) | **109 – 144 s; 6.2 tok/s** | ✅ | ❌ | **Yes** |
| `poolside/laguna-xs-2.1:free` | Poolside | 262 144 | fp8 | 2/3 (one 429) | 17 – 19 s | ✅ | ❌ | **Yes** |
| `poolside/laguna-s-2.1:free` | Poolside | 262 144 | fp4 | **0/3** (429 ×3) | — | ✅ | ❌ | **Yes** |
| `google/gemma-4-31b-it:free` | Google | 262 144 | unknown | **0/3** (429 ×3) | — | ✅ | ❌ | inconclusive |
| `google/gemma-4-26b-a4b-it:free` | Google | 262 144 | unknown | **0/3** (429 ×3) | — | ✅ | ❌ | inconclusive |
| `thinkingmachines/inkling:free` | Thinking Machines | 1 048 576 | nvfp4 | **0/3** (**403 gate**) | — | ✅ | ❌ | inconclusive |
| `thinkingmachines/inkling-small:free` | Thinking Machines | 1 048 576 | nvfp4 | **0/3** (**403 gate**) | — | ✅ | ❌ | inconclusive |

---

## 3. Durability classification

| Provider / offering | Classification | The sentence that justifies it (verbatim, accessed 2026-09-08) |
|---|---|---|
| **GitHub Models** | **DEAD** | "As of July 30, 2026, GitHub Models has been fully retired. The playground, model catalog, inference API, and bring your own key (BYOK) are no longer available to any customer." |
| **Cerebras free tier** | **DEAD → TRIAL** | "No. The Free Trial is time- and credit-bounded: $5 in credits that expire 30 days after they're granted." … "Cerebras doesn't currently offer a no-cost tier that renews automatically or a per-model always-free allowance." |
| **Groq free plan** | **RATE-LIMITED FREE TIER, explicitly revocable** | "Certain Cloud Services and AI Model Services may be designated as fee-free or otherwise available without triggering a payment **for a limited time** or based on usage limits." + "Groq may deprecate the AI Model Services at any time." |
| **OpenRouter `:free` models** | **COMMUNITY-/VENDOR-FUNDED, RATE-LIMITED, NO GUARANTEE** | "OpenRouter does not guarantee availability of any Model and provides you with access to the Models only on an 'as-available' basis." + "We also reserve the right to modify or discontinue the Service at any time … without notice to you." |
| **OpenRouter `:free` volume above 50/day** | **PAID GATE ON A FREE PRODUCT** | Free models are limited to "50" requests/day; "If you have purchased at least 10 credits, the free models will be limited to 1000 requests per day." |
| **`thinkingmachines/inkling*:free`** | **DISTRIBUTION-GATED FREE MODEL** (new category) | "The free Inkling endpoint is only available for use with agentic harnesses." |
| **Google Gemini free tier** | **PERMANENT-ISH FREE TIER, OPAQUE, DATA-PRICED** | "Specified rate limits are not guaranteed and actual capacity may vary." + "Google uses the content you submit to the Services and any generated responses to provide, improve, and develop Google products and services." |
| **Cloudflare Workers AI** | **PERMANENT FREE ALLOCATION, CAPABILITY-CAPPED** | 10 000 Neurons/day free; frontier models (Kimi K2.6/2.7, GLM 5.2/5.3, DeepSeek V4) "require a paid billing method"; "If you exceed any one of the above limits, further operations will fail with an error." |
| **Hugging Face free credits** | **TOKEN CREDIT, EXPLICITLY MUTABLE** | Free Users monthly credits: "$0.10, **subject to change**". |
| **Mistral Free plan** | **RECURRING CREDIT** | "$10 /mo in API credits"; "Free mode is the default state for new accounts." |
| **Together AI** | **NO FREE TIER DOCUMENTED** | Rate-limit page covers paid serverless only; one $0.00 model `UNVERIFIED`. |
| **Fireworks AI** | **PAID** | "No payment method or no credits" → 10 RPM; Tier 1 requires "a valid payment method and billing profile". |
| **SambaNova** | **UNKNOWN** | Static page shows paid rates only; JS-rendered. |
| **NVIDIA build.nvidia.com** | **UNKNOWN** | Free-credit terms `NOT FOUND` on two official pages. |

---

## 4. Live test log

All timestamps UTC, 2026-09-08. All OpenRouter calls returned `usage.cost: 0`.

| # | Time | Provider / model | Call type | Result | Latency | Rate-limit headers |
|---|---|---|---|---|---|---|
| 1 | 16:35:17 | Groq `/models` | GET | 200, 14 models | 0.482 s | — |
| 2 | 16:36:10 | Groq `openai/gpt-oss-20b` | chat, 99 tok | 200 | 0.343 s total / 0.341 TTFB | `x-ratelimit-limit-requests: 500000`, `-limit-tokens: 250000`, `-remaining-requests: 499999`, `-remaining-tokens: 249901`, `-reset-requests: 172ms`, `-reset-tokens: 23ms`, `x-groq-region: yul` → **paid Developer plan; Groq testing halted here** |
| 3 | 16:35:31 | OpenRouter `/models` | GET | 200, 429 models, 16 `:free` | 0.578 s | — |
| 4 | 16:36:43 | OpenRouter `/key` | GET | 200, `is_free_tier: false` | — | — |
| 5 | 16:36:43 | OpenRouter `/credits` | GET | 200, credits 30 / usage 20.18 | — | — |
| 6 | 16:37:24–29 | 5 free models | chat | **404 (NVIDIA), 429 ×2 (shared pool), 403 (harness gate), 200 ×2** | 0.23 – 3.0 s | **none returned** |
| 7 | 16:38:04–16:41:56 | Sweep pass 1, 16 models | chat | **9 OK / 7 fail** | 0.38 – 109.4 s | none |
| 8 | 16:42:11–16:45:53 | Sweep pass 2, 16 models | chat | **10 OK / 6 fail** | 0.29 – 114.8 s | none |
| 9 | 17:03:37–17:07:44 | Sweep pass 3, 16 models | chat | **10 OK / 6 fail, incl. 1 client timeout at 120 s** | 0.24 – 120 s | none |
| 10 | 16:46:19 | 6 free models | **tool calling** | **6/6 correct `tool_calls`**, `finish_reason: tool_calls` | 0.95 – 3.3 s | none |
| 11 | 16:48:xx | 3 free models | **tool round-trip** (turn 2 with result) | **3/3 correct answers** | 1.3 – 4.6 s | none |
| 12 | 16:46:50 | 6 free models | **strict `json_schema`** | 4 conformant, 1 × HTTP 400, **1 × HTTP 200 prose** | 4.9 – 38.1 s | none |
| 13 | 16:48:28 | `cohere/north-mini-code:free` ×3 | strict `json_schema` | **3/3 HTTP 200 prose, schema ignored**, format varied between trials | — | none |
| 14 | 16:55:25 | `cohere/north-mini-code:free` | `require_parameters: true` + schema | **404 "No endpoints found that can handle the requested parameters"**, `failed_routing_step: "Filter by Parameters"` | 0.24 s | — |
| 15 | 16:55:xx | 4 free models | streaming throughput, 900 tok | **6.2 / 17.7 / 75.7 / 218.3 tok/s** | 4.1 – 144.0 s | none |
| 16 | 16:59:28 | `inclusionai/ling-3.0-flash-sante:free` | **146 466-token needle test** | **200, needle retrieved exactly, cost 0** | **10.9 s** | none |
| 17 | 16:59:xx | same | 294 528-token overflow | 400, names 262 144 ceiling + "context-compression plugin" | 1.3 s | — |
| 18 | 17:02:00 / 17:03:15 | 16 free models | `data_collection: "deny"` | **8 × 404 "Filter by Data Policy … (Free model training)"**, 4 allowed, 4 inconclusive | 0.2 – 3 s | — |
| 19 | 16:59:10 | OpenRouter `/key` after ~60 free calls | GET | **all usage counters still `0`** | — | — |

**Observed failure taxonomy (five distinct modes in one 8-second window):**
`404` provider-not-serving · `429 upstream_provider_shared_pool` · `403 Gate Free Endpoints by Agentic
Harness` · **`HTTP 200` carrying an `error.code 502` body** ("Worker local total request limit reached
(16/16)") · client-side timeout at 120 s.

---

## 5. Claims

```
CLAIM: Free frontier inference is now gated by who you are, not only by how much you ask for — the two
       highest-capability free models on OpenRouter refuse ordinary API callers and serve only recognised
       "agentic harnesses".
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: thinkingmachines/inkling:free and inkling-small:free (1 048 576-token context, 975B/276B MoE)
  returned HTTP 403 on all 3 sweep passes plus 2 ad-hoc calls, with metadata
  failed_routing_step: "Gate Free Endpoints by Agentic Harness" and the message "is only available on
  agentic harnesses. Try plugging it into a coding agent or productivity app listed on
  https://openrouter.ai/apps". The model page confirms it as policy: "The free Inkling endpoint is only
  available for use with agentic harnesses." OpenRouter's central FAQ and limits docs never mention this.
SOURCE: Live calls A6/A15 — this lane — 2026-09-08 17:03Z; Inkling (free) model page — OpenRouter/Thinking
  Machines — https://openrouter.ai/thinkingmachines/inkling:free — accessed 2026-09-08
COUNTEREVIDENCE: The gate is disclosed on the individual model page, so it is not concealed; and a solo
  builder's app could in principle be listed in the apps directory. 12 of 16 free models remain
  un-gated. Only Thinking Machines applies this gate today, so it may be one vendor's choice rather than
  a platform trend.
OPEN QUESTION: What are the criteria and latency for getting an app recognised as an "agentic harness",
  and is the set of gated models growing? Re-run this exact probe monthly.
```

```
CLAIM: Two significant zero-cost inference doors closed in 2026 — GitHub Models was fully retired and
       Cerebras replaced its free tier with an expiring trial — while no comparable new permanent free
       tier appeared.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: GitHub docs, verbatim: "As of July 30, 2026, GitHub Models has been fully retired. The
  playground, model catalog, inference API, and bring your own key (BYOK) are no longer available to any
  customer." Cerebras docs, verbatim: "No. The Free Trial is time- and credit-bounded: $5 in credits that
  expire 30 days after they're granted." and "Cerebras doesn't currently offer a no-cost tier that renews
  automatically or a per-model always-free allowance." Both confirmed by raw HTML fetch, not summary.
SOURCE: GitHub Models — GitHub — retired 2026-07-30 — https://docs.github.com/en/github-models — accessed
  2026-09-08; Rate Limits — Cerebras — https://inference-docs.cerebras.ai/support/rate-limits — accessed
  2026-09-08
COUNTEREVIDENCE: Cloudflare's 10 000 Neurons/day and Groq's free plan both persist, and Mistral's Free
  plan grants $10/month in API credits — a larger recurring allowance than most 2025 free tiers. So the
  door count fell but the best remaining doors did not narrow. Neither closure was of a
  never-charged-for-inference product: GitHub Models was folded toward Azure AI Foundry, a paid product.
OPEN QUESTION: Is the 2026 pattern "free tiers die" or "free tiers consolidate into fewer, larger
  vendors"? Track Groq, Cloudflare and Mistral free terms quarterly through 2027.
```

```
CLAIM: A strict JSON-schema specification can be accepted with HTTP 200 and silently ignored, producing
       prose — and this contradicts the platform's own documentation.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: cohere/north-mini-code:free was sent response_format {type: json_schema, strict: true} with a
  4-field schema. Result: HTTP 200, no error object, Markdown prose ("**Bug Report** …"), 3/3 trials, and
  the prose shape differed between trials (paragraph, then table, then table). OpenRouter's
  structured-outputs page states a non-supporting model request "will fail with an error indicating lack
  of support". Its provider-routing page states the opposite and matches observation: parameters such as
  tools and response_format "function as soft preferences rather than hard requirements—if no provider
  supports them, the request still routes normally rather than failing." The parameters page confirms the
  mechanism: "OpenRouter omits it upstream rather than substituting a hardcoded value."
SOURCE: Live tests A9/A10 — this lane — 2026-09-08 16:46Z and 16:48Z; Structured Outputs — OpenRouter —
  https://openrouter.ai/docs/features/structured-outputs — accessed 2026-09-08; Provider Selection —
  OpenRouter — https://openrouter.ai/docs/guides/routing/provider-selection — accessed 2026-09-08
COUNTEREVIDENCE: The documented mitigation genuinely works — provider.require_parameters: true produced a
  clean HTTP 404 "No endpoints found that can handle the requested parameters". And one model
  (inclusionai/ling-3.0-flash-fin:free) failed loudly with HTTP 400 rather than silently, so the silent
  path is not universal. 4 of 6 models honoured the schema correctly.
OPEN QUESTION: Do paid endpoints exhibit the same silent-drop behaviour, or is this specific to
  single-endpoint free models where no compliant fallback exists?
```

```
CLAIM: At least half of OpenRouter's free models are barter — the price of the tokens is the prompt, and
       the data-sharing default is on.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Sending provider.data_collection: "deny" removed 8 of 16 free models with HTTP 404,
  failed_routing_step: "Filter by Data Policy", message "No endpoints found matching your data policy
  (Free model training)". The 8: all five NVIDIA Nemotron free models, both Poolside Laguna free models,
  and liquid/lfm-2.5-2.6b. Four were unaffected (Cohere North Mini Code, Dots3-Note, both inclusionAI
  Ling). Four were inconclusive (a 429 or 403 fired first). OpenRouter's routing doc states the default
  is "allow": "allow providers which store user data non-transiently and may train on it".
SOURCE: Live test A15 — this lane — 2026-09-08 17:02Z and 17:03Z; Provider Selection — OpenRouter —
  https://openrouter.ai/docs/guides/routing/provider-selection — accessed 2026-09-08; Privacy and Logging
  — OpenRouter — https://openrouter.ai/docs/features/privacy-and-logging — accessed 2026-09-08
COUNTEREVIDENCE: The control exists, is documented, is per-request, and is free to use — a builder who
  sets data_collection: "deny" keeps 4 free models including the best long-context one tested. Groq's
  Services Agreement goes further and forbids training outright. So the barter is opt-out, not compulsory.
OPEN QUESTION: What do NVIDIA and Poolside actually retain and for how long? Their own retention terms
  were not located; only OpenRouter's classification of them was.
```

```
CLAIM: Published uptime does not predict whether a free model will answer you.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: OpenRouter's own telemetry reports uptime_last_30m of 99.7% for google/gemma-4-31b-it:free and
  100.0% for poolside/laguna-s-2.1:free and thinkingmachines/inkling:free. Those three models failed
  every single attempt this lane made — 3/3, 3/3 and 5/5 respectively — with 429 (shared pool) or 403
  (harness gate). Aggregate measured success across 3 sweeps × 16 models was 29/48 = 60.4%, against
  published uptimes of 86.2–100%.
SOURCE: Live tests A6/A16 — this lane — 2026-09-08 16:38Z–17:07Z
COUNTEREVIDENCE: The metric is named "uptime", not "availability to you"; it plausibly measures whether
  the upstream endpoint is serving anyone, which is a legitimate different question. Rate-limit refusals
  and policy gates are arguably not downtime. The gap is a naming and expectation problem more than a
  false number.
OPEN QUESTION: Does OpenRouter publish, anywhere, a per-model *admission* rate for free endpoints — the
  number a capacity planner would actually need?
```

```
CLAIM: Tool calling is fully commoditised at zero cost; structured output is not.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: 6 of 6 free models tested emitted a correct tool_calls object with correct arguments and
  finish_reason "tool_calls" (Cohere, Dots Studio, inclusionAI, Liquid, and two NVIDIA models), latency
  0.95–3.3 s. A second turn feeding the tool result back produced a correct natural-language answer on
  3/3 tested. By contrast the same cohort achieved only 4/6 on strict json_schema, with one silent
  failure and one hard 400. 15 of the 16 free models declare `tools` in supported_parameters; only 3
  declare `structured_outputs`.
SOURCE: Live tests A7/A8/A9 — this lane — 2026-09-08 16:46Z–16:48Z; OpenRouter /models — accessed
  2026-09-08 16:35Z
COUNTEREVIDENCE: The tool-calling test used one simple two-parameter function with an explicit "Use the
  tool" instruction — an easy case. It does not establish reliability on multi-tool selection, parallel
  calls, or long agent loops, where arXiv 2608.23651 shows small models degrade badly. Groq documents
  that tool use and structured outputs cannot be combined at all on its platform.
OPEN QUESTION: What is the free-tier tool-selection accuracy over a 10-tool catalogue and a 20-turn loop?
```

```
CLAIM: Long-context retrieval is genuinely free today — a 146 000-token prompt was processed correctly at
       zero cost in eleven seconds.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: A 772 KB request to inclusionai/ling-3.0-flash-sante:free reported prompt_tokens 146 466,
  completion_tokens 80, usage.cost 0, HTTP 200 in 10.94 s, and returned the planted needle
  "ZEPHYR-4471-QK" exactly. A deliberate overflow at 294 528 tokens returned a clean HTTP 400 naming the
  endpoint's real 262 144 ceiling. Free endpoint contexts range to 1 048 576 tokens.
SOURCE: Live tests A13/A14 — this lane — 2026-09-08 16:59Z
COUNTEREVIDENCE: A single-needle retrieval in homogeneous filler is the easiest possible long-context
  task and says nothing about multi-hop reasoning over 146K tokens. The model is a health/medicine
  specialisation of Ling 3.0 Flash, not a general model. Free endpoints are frequently low-bit quantized
  (fp4/nvfp4/fp8), and quantization degrades long-context recall more than short-context accuracy.
OPEN QUESTION: How do free fp4/nvfp4 endpoints score on a real multi-hop long-context benchmark versus
  the bf16 numbers published on the model cards?
```

```
CLAIM: At identical zero price, free-endpoint throughput varies by a factor of 35, and the variance is
       not disclosed anywhere the caller can see before calling.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Streaming a 900-token target: inclusionai/ling-3.0-flash-sante:free 218.3 tok/s;
  liquid/lfm-2.5-2.6b:free 75.7 tok/s; cohere/north-mini-code:free 17.7 tok/s;
  nvidia/nemotron-3.5-lightning:free 6.2 tok/s. The NVIDIA endpoints showed a consistent ~10.2 s
  time-to-first-byte across passes, then very slow emission: nemotron-3-ultra took 80–87 s for ~20–30
  tokens across three passes, and nemotron-3.5-lightning took 109 s, 115 s, 144 s and then exceeded a
  120 s client timeout. OpenRouter's endpoints API returned null for latency_last_30m and
  throughput_last_30m on all 16 free endpoints.
SOURCE: Live tests A6/A12/A16 — this lane — 2026-09-08 16:38Z–17:07Z
COUNTEREVIDENCE: The 10.2 s TTFB is stable enough to look like deliberate queue admission rather than
  instability, which is at least predictable. NVIDIA's slow models are also the largest (550B and 1M
  context), so some of the gap is model size, not throttling. Throughput telemetry is populated for paid
  endpoints, so the nulls may be a free-tier reporting gap rather than concealment.
OPEN QUESTION: Is the ~10 s TTFB a fixed free-tier admission delay? Measure at several times of day.
```

```
CLAIM: "Free" on OpenRouter has a $10 paywall — the difference between 50 and 1 000 requests a day is a
       lifetime credit purchase, which is exactly the threshold a bootstrapped builder has not crossed.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: OpenRouter docs: free models are limited to "50" requests per day; "If you have purchased at
  least 10 credits, the free models will be limited to 1000 requests per day." A negative balance yields
  402 errors "including for free models". This lane's key showed total_credits 30, total_usage 20.18 —
  above the threshold — so every measurement here reflects the *privileged* free tier, not the
  never-paid one. A genuinely zero-spend account would have hit 50 requests/day around sweep pass 3.
SOURCE: Rate Limits — OpenRouter — https://openrouter.ai/docs/api-reference/limits — accessed 2026-09-08;
  Live test A5 — this lane — 2026-09-08 16:36Z
COUNTEREVIDENCE: $10 once, not recurring, is a trivial barrier for most builders and buys a 20× lift. And
  50 requests/day is still enough for development and demos, which is what a free tier is for.
OPEN QUESTION: Does the 1 000/day cap apply per key, per account, or per model? Not stated in the docs.
```

```
CLAIM: Combining heterogeneous free capacity is technically possible but a naive fallback silently
       destroys conversation state — the failure is invisible, not loud.
LABEL: OBSERVED TODAY (paper) + REASONABLE EXTRAPOLATION (to free tiers specifically)
CONFIDENCE: medium
EVIDENCE: ContinuityBench measured 750 failover events across multi-provider LLM routing: stateless
  architectures preserved "near-0%" of conversation history, while a stateful proxy using
  History-Forwarding achieved 99.20% Continuity Preservation Rate [95% CI 98.27–99.63]. The authors note
  naive failover maintains uptime but "silently discard[s] conversation history". Free tiers are the
  highest-failover-rate environment measurable — this lane observed a 39.6% refusal rate — so they
  trigger this failure mode more than any paid configuration.
SOURCE: ContinuityBench — arXiv 2607.15899 — 2026-07-17 — https://arxiv.org/abs/2607.15899 — accessed
  2026-09-08; Live test A6 — this lane — 2026-09-08
COUNTEREVIDENCE: The paper studies provider failover generally, not free tiers, and the extrapolation is
  mine. A stateful proxy is a well-understood ~200-line component, so the problem is solved in principle;
  the paper's own solution reaches 99.2%. Single-turn workloads (extraction, classification) are immune.
OPEN QUESTION: What is the CPR of the common off-the-shelf gateways (LiteLLM, OpenRouter's own
  allow_fallbacks) under free-tier 429 storms?
```

```
CLAIM: Cheap paid inference has undercut the economic case for engineering around free tiers — near-
       frontier agentic coding is available at roughly nine cents per million input tokens.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: OpenRouter endpoint pricing fetched today: poolside/laguna-s-2.1 (118B total / 8B active,
  described on its model card as scoring 70.2% on Terminal-Bench 2.1) at $0.00000009/token input and
  $0.00000018/token output — $0.09/M in, $0.18/M out. google/gemma-4-31b-it from DeepInfra at $0.09/M in,
  $0.34/M out. nvidia/nemotron-3-super-120b-a12b from DeepInfra at $0.085/M in, $0.40/M out. At those
  rates, 10M input + 2M output tokens on a strong coding model costs about $1.26.
SOURCE: Live test A16 — this lane — https://openrouter.ai/api/v1/models/{slug}/endpoints — accessed
  2026-09-08 16:54Z
COUNTEREVIDENCE: The 70.2% Terminal-Bench figure comes from the vendor's own model-card text carried in
  OpenRouter's catalogue description, not from an independent evaluation this lane verified — treat the
  capability claim as vendor-asserted. Prices are per-endpoint and can change without notice. And for a
  builder with literally zero budget, $1.26 and $0 are still categorically different numbers. Long-term
  price direction is lane 09's question, not settled here.
OPEN QUESTION: What is the true all-in cost per completed coding task, not per token, on these cheap
  endpoints versus a frontier model that needs fewer retries?
```

```
CLAIM: Routing across models is already commoditised, and the sophisticated version of it is not worth
       building — a static task-type table beat the best single model at less than half the cost.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: "Most of the LLM Routing Gap Is Task Type" evaluated 14 models over 294 questions, 7 task types
  and 3 languages. Task-type assignment alone captured 21 of the 29 improvable questions (~72%); adding
  language splits captured 2 more; only ~2% of the set remained, below the measured 5.37% run-to-run
  noise. A static task-type table scored 262/294 at $3.33 per run against the best single model's 245/294
  at $7.69. Independently, OpenRouter itself demonstrates the commodity layer: 429 models behind one
  OpenAI-compatible endpoint, with per-endpoint price, quantization, context and uptime exposed as an API.
SOURCE: Most of the LLM Routing Gap Is Task Type — arXiv 2608.23023 — 2026-08-24 —
  https://arxiv.org/abs/2608.23023 — accessed 2026-09-08; Live test A3/A16 — this lane — 2026-09-08
COUNTEREVIDENCE: The study's 294-question set is small and its 5.37% run-to-run variance is large
  relative to the effects it dismisses. A cost-optimal static table depends on prices that change weekly.
  And the active 2026 routing literature (Drift-Aware Routing 2609.00662, WISERouter 2607.23765,
  LLMRouter 2608.06867) exists precisely because practitioners disagree that the problem is closed.
OPEN QUESTION: Does the task-type result hold for agentic, multi-turn, tool-using workloads, or only for
  single-shot question answering?
```

```
CLAIM: Small free-tier-sized models get worse, not better, when an agent harness shows them their own
       failures verbatim — which is exactly what most agent loops do.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: Across 6 instruction-tuned checkpoints from 4 families at 135M–1.7B parameters, the probability
  of repeating a failed tool call rose from 6% to 54% after the failure was shown; under greedy decoding
  the failed call was reproduced token-for-token in 19% of cases versus 0% before. The failed call's
  surface form accounted for 83% of the effect, and replacing verbatim replays with runtime-generated
  descriptions removed 76% of it. The authors: "the problem is in the harness, not the model's grasp of
  error messages."
SOURCE: Feedback That Backfires — arXiv 2608.23651 — 2026-08-24 — https://arxiv.org/abs/2608.23651 —
  accessed 2026-09-08
COUNTEREVIDENCE: 135M–1.7B is smaller than every general-purpose free model measured here — the smallest
  is liquid/lfm-2.5-2.6b at 2.6B, and most free models are 26B–550B. The effect may vanish at those
  sizes; the paper does not test them. The fix is cheap and harness-side.
OPEN QUESTION: At what parameter count does the repeat-the-failure effect disappear? If it persists at
  26B, every free-tier agent loop needs the describe-don't-replay fix.
```

```
CLAIM: Free-tier capacity cannot be planned, because no free provider tested exposes how much of your
       free quota remains.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Not one of the ~60 OpenRouter free-model responses carried any x-ratelimit-* header. After
  those ~60 calls, GET /api/v1/key still reported usage, usage_daily, usage_weekly and usage_monthly all
  at 0 — free consumption is not counted in the usage API. Google removed its published free-tier
  RPM/TPM/RPD from the docs entirely, replacing them with "can be viewed in Google AI Studio" plus
  "Specified rate limits are not guaranteed and actual capacity may vary". By contrast Groq documents a
  full x-ratelimit-* header set and returned live remaining-request and remaining-token counters.
SOURCE: Live tests A2/A4/A6 — this lane — 2026-09-08; Rate limits — Google — last updated 2026-09-02 —
  https://ai.google.dev/gemini-api/docs/rate-limits — accessed 2026-09-08
COUNTEREVIDENCE: OpenRouter's account UI may show free-request counts even though the API does not; this
  lane did not log in to check. Groq's headers prove the problem is solvable and solved by at least one
  provider, so this is a vendor choice rather than a technical limit.
OPEN QUESTION: Is there any documented endpoint on OpenRouter that returns remaining free requests for
  the day? None was found.
```

---

## 6. Scenario analysis

**Scenario A — a provider disappears.** Not hypothetical: it happened twice in 2026. GitHub Models went
from a full product (playground, catalog, inference API, BYOK) to "no longer available to any customer"
on 2026-07-30. Cerebras's always-free allowance became a 30-day $5 trial. Neither gave a migration path
that preserved zero cost — GitHub pointed at Azure AI Foundry, a paid product.
*Consequence:* any architecture whose viability depends on one named free provider has a demonstrated
annual mortality rate above zero. The mitigation is not redundancy of *models* but redundancy of
*capability classes*, since a replacement model will differ in schema conformance, tool-call format and
quantization even when it nominally does the same job.

**Scenario B — limits are cut 90%.** OpenRouter's terms reserve the right to "modify or discontinue the
Service at any time … without notice to you" and disclaim any availability guarantee. Google states
outright that "Specified rate limits are not guaranteed and actual capacity may vary" and has stopped
publishing free-tier numbers, which makes a 90% cut *undetectable from the documentation* — you would
learn about it from 429s. This lane already observed the practical version: `google/gemma-4-*:free`
returned `429 upstream_provider_shared_pool` on 3/3 passes. The word `shared_pool` is the important part —
free capacity is one global pool, so your effective limit is set by everyone else's traffic, not by your
own quota.

**Scenario C — a model is removed.** The free roster's composition makes this near-certain rather than
possible: all 16 free models are recent vendor launches (created timestamps cluster in 2026), and free
status is the launch-promotion phase. Groq's Services Agreement is explicit — "Groq may deprecate the AI
Model Services at any time", with only "commercially reasonable efforts" at notice. The `:free` suffix is
part of the model id, so a removal is a hard 404, not a silent downgrade — which is at least loud.

**Scenario D — privacy terms change.** The barter is already itemised and already default-on: OpenRouter's
`data_collection` defaults to `"allow"`, and 8 of 16 free models vanish under `"deny"` with the message
"Free model training". Google's unpaid tier already states that submitted content is used "to provide,
improve, and develop Google products" and that "human reviewers may read, annotate, and process your API
input and output". A tightening here does not require a terms change at all — it only requires more
vendors choosing the training-funded model, which is the direction all five NVIDIA and both Poolside free
endpoints already point.

**Can heterogeneous free capacity be combined responsibly?**
*Technically:* yes, but not naively. ContinuityBench measured stateless multi-provider failover preserving
near-0% of conversation history against 99.20% for a stateful proxy — and free tiers, at a measured 39.6%
refusal rate, are the environment that triggers failover most. Multi-turn or agentic work over free
capacity needs a state-forwarding proxy and backoff with jitter, not an `allow_fallbacks` flag.
*Contractually:* with one sharp limit. OpenRouter's §7 prohibits accessing the service "for purposes of
reselling API access to Models or otherwise developing a competing service". A product that aggregates
free endpoints and hands that access to *its own end users* is close to that line; a product that consumes
free inference to deliver its own distinct feature is not. Google's terms add that free-tier output may not
be used "to develop models that compete with the Services". Groq is the cleanest counterparty found: its
Services Agreement affirmatively forbids Groq from training on inputs or outputs.

---

## 7. Best zero-cost options by capability (2026-09-08), with caveats

| Capability | Best zero-cost option today | Measured basis | Caveat |
|---|---|---|---|
| **Reasoning (large)** | `nvidia/nemotron-3-super-120b-a12b:free` | 2/3 availability, 0.5–6.5 s, declares + honours structured outputs | Trains on your prompts; 502s under load; free endpoint quantization undisclosed |
| **Reasoning (frontier-scale)** | `nvidia/nemotron-3-ultra-550b-a55b:free`, 1M context | 3/3 availability | **80–87 s per call**; unusable interactively; trains on your prompts |
| **Coding** | `cohere/north-mini-code:free` (256K ctx) | 3/3 availability, 17.7 tok/s, tool calls 1/1 | **Silently ignores JSON schema** — never give it a structured contract without `require_parameters` |
| **Coding (agentic)** | `poolside/laguna-xs-2.1:free` | 2/3 availability, 17–19 s | Sibling `laguna-s-2.1:free` was 429 on 3/3; trains on your prompts |
| **Tool use** | Any of 6 tested; fastest `inclusionai/ling-3.0-flash-*:free` | **6/6 correct tool calls**, round-trip 3/3 | Tested on a single easy 2-arg tool only |
| **Structured extraction** | `dots-studio/dots-3-note-preview:free` (512K ctx, vision) | 3/3 availability, schema-conformant, **no training** | Preview model — the least durable status label there is |
| **Long-context research** | `inclusionai/ling-3.0-flash-sante:free` | **146 466 tokens, correct needle, 10.9 s, $0**, 218 tok/s, no training | Domain-tuned for health; single-needle test only |
| **Vision** | `google/gemma-4-*:free` (image+video in) | Declared in catalogue | **429 on 3/3 passes — effectively unavailable** |
| **Guardrails / moderation** | `nvidia/nemotron-3.5-content-safety:free` | 3/3 availability, 1.6–2.5 s | No tool calling; trains on your prompts |
| **Speech-to-text** | Groq `whisper-large-v3-turbo` free plan | 20 RPM / 2K RPD `DOC` | `NOT TESTED` — repo key is on the paid plan |
| **Embeddings** | **No good zero-cost option found** | — | HF free credits are $0.10/month; Cloudflare's 10K Neurons/day is the only real free embedding budget found |
| **Privacy-preserving free** | **Groq free plan** | Contract forbids training on inputs/outputs | 8K TPM is very tight; `NOT TESTED` live |

**The honest recommendation for a solo bootstrapped builder.** Use free tiers for development,
evaluation, demos and genuinely bursty background work. Do not build a user-facing promise on them: the
measured availability is 60.4%, there is no quota telemetry, throughput varies 35×, and the strongest
models are gated to incumbents. When something must work, the fallback is not another free tier — it is
~$0.09/M input tokens, which for most bootstrapped workloads is single-digit dollars a month.

---

## 8. Marketplace / commoditisation verdict

```
CLAIM: Cognition is already consumed like cloud compute at the protocol and catalogue layers, but not at
       the reliability layer — the commodity that exists is "a model behind an OpenAI-compatible URL",
       not "capacity you can plan on".
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: One OpenRouter endpoint fronts 429 models from dozens of providers with a uniform schema, and
  exposes per-endpoint price, context, quantization, supported parameters, status and uptime as queryable
  API fields — including 16 endpoints priced at exactly zero. A single model (google/gemma-4-31b-it) is
  served by 11 distinct providers at prices from $0.09/M to $0.99/M input, differing in quantization
  (fp4/fp8/bf16), context (131K–262K) and 30-minute uptime (14.5%–99.5%) — a spot market with visible
  quality dispersion. Against that: no free endpoint returned a single rate-limit header, free usage did
  not appear in the usage API, throughput and latency telemetry were null for all 16 free endpoints, and
  measured availability was 60.4% against published uptimes of 86–100%.
SOURCE: Live tests A3/A6/A16 — this lane — 2026-09-08
COUNTEREVIDENCE: Real commodity markets (electricity, compute) also have spot volatility and quality
  tiers, so dispersion is not itself evidence against commoditisation. And the reliability layer is
  supplied commercially — paid endpoints do report latency, throughput and uptime — so what is missing is
  free-tier telemetry, not market structure.
OPEN QUESTION: Is a genuine capacity market forming — forward commitments, guaranteed admission — or does
  the market clear only on price and never on availability?
```

Three qualifications on the marketplace picture:

1. **Interchangeability is the unsolved part.** The protocol is uniform; behaviour is not. The same
   `response_format` field is a hard contract on one endpoint, a soft preference on the next, and a 400
   on a third — observed today across three models in one battery. Switching providers is a one-line
   change that silently alters your correctness guarantees.
2. **The differentiator has moved from routing to state.** ContinuityBench's near-0% vs 99.20% result says
   the value in a multi-model system is in the stateful proxy, not the model picker. And arXiv 2608.23023
   says the model picker itself is mostly a static task-type table.
3. **Free capacity is an acquisition channel, not a market.** All 16 free models are vendor launches, at
   least 8 are funded by training data, two are gated to incumbent harnesses, and OpenRouter's terms
   forbid reselling access. "Free inference" in September 2026 is best modelled as vendors buying
   evaluation, mindshare and training data — priced in your prompts and your benchmark attention.

---

## 9. Contradictions with common belief

**1. "Free inference keeps getting more abundant."** It is contracting and becoming conditional. GitHub
Models is fully retired (2026-07-30, verbatim). Cerebras states it "doesn't currently offer a no-cost tier
that renews automatically or a per-model always-free allowance". Of 429 OpenRouter models, 16 are free —
and 5 of those 16 never answered a single one of this lane's requests. Hugging Face's free allowance is
$0.10/month, "subject to change". What grew is *capability per free token* (1M contexts, 550B models), not
*access*.

**2. "OpenRouter's free models are the solo builder's on-ramp."** The two most capable free models
(`thinkingmachines/inkling:free` and `inkling-small:free`, 1M context) return HTTP 403 to ordinary API
callers with `failed_routing_step: "Gate Free Endpoints by Agentic Harness"`. Free frontier capacity is
being routed to *established distribution* — apps already in the OpenRouter directory. The builder with no
distribution is precisely the one excluded. This inverts the usual assumption that free tiers democratise
access; here the free tier is a channel-marketing budget.

**3. "Free means free."** Two hidden prices, both measured today. (a) Money: 50 requests/day becomes
1 000/day only after "at least 10 credits" purchased — a paywall inside the free tier. (b) Data: 8 of 16
free models disappear under `data_collection: "deny"` with the literal message "Free model training", and
the default setting is `"allow"`. Google's unpaid tier states plainly that submitted content is used to
"improve, and develop Google products" and that "human reviewers may read, annotate, and process your API
input and output".

**4. "Structured output means the output is structured."** A strict `json_schema` with `strict: true` was
accepted with HTTP 200 and answered in Markdown prose, three times out of three, with the prose format
varying between trials. OpenRouter's own structured-outputs page says such a request "will fail with an
error indicating lack of support"; its routing page says `response_format` is a "soft preference". The
documentation contradicts itself and the permissive branch is the default.

**5. "Published uptime tells you if a model is available."** Models reporting 99.7% and 100.0%
`uptime_last_30m` refused 100% of this lane's requests. Uptime measures the endpoint; it does not measure
admission. Aggregate measured success was 60.4%.

**6. "HTTP status codes tell you what happened."** Two NVIDIA free endpoints returned **HTTP 200 carrying
an `error.code: 502` body** ("Worker local total request limit reached (16/16)"). Retry logic keyed on
status codes will not fire; JSON-parsing logic will get a shape it did not expect.

---

## 10. Problems nobody is talking about

**1. Silent specification violation at the API boundary.** The industry discusses hallucination inside
outputs; almost nobody discusses the transport layer accepting a machine-readable contract and discarding
it with a success code. This is the mission's north-star hypothesis reproduced in one HTTP call: the
specification said "this JSON schema", the software did something else, reality did not match intent, and
**no signal was emitted anywhere**. It is worse than a wrong answer because it defeats the standard
defence — you cannot catch it by checking for errors, only by validating every response against the schema
you already sent. And the mitigation (`require_parameters: true`) is opt-in, undiscoverable from the
happy path, and absent from every quickstart.

**2. Free-tier capacity is unplannable by construction.** No free response carried a rate-limit header;
the usage API stayed at 0 after ~60 free calls; free endpoints reported null latency and throughput; and
Google has removed free-tier limits from its docs entirely. A builder cannot answer "how much free
capacity do I have left today?" for any provider tested except Groq. Every discussion of free tiers
compares *published limits*; none compares *observability of remaining quota*, which is what actually
determines whether you can build on them.

**3. Quantization drift between the model you read about and the model you are served.** Free endpoints
are served at `fp4`, `nvfp4` and `fp8` — `thinkingmachines/inkling:free` is nvfp4, `poolside/laguna-s-2.1:free`
is fp4 — while the capability claims on the model cards come from higher-precision evaluations. The model
*id* is identical; the artifact is not. Nothing in the id, the docs, or the response records which
precision answered you, so a benchmark result and a production result are not comparable and no one is
versioning the difference. The same model id also varies 131K–262K in context and 14.5%–99.5% in uptime
across providers.

**4. Failover is where state dies, and free tiers are where failover lives.** ContinuityBench measured
near-0% conversation-history preservation under stateless multi-provider failover. Free tiers refuse
roughly a third of requests, so they generate more failover events than any paid configuration. The
literature on free tiers is about cost; the literature on failover is about uptime; nobody has connected
them to say that *the cheaper your inference, the more conversational state you silently lose*.

**5. Cheap models plus naive harnesses burn the scarcest resource.** Small models shown their own failures
verbatim repeat them at 54% versus 6% — and each repeat consumes one of a strictly limited daily free
request allowance. The interaction is multiplicative: the models you can afford are the ones most prone to
loops, and loops are billed in exactly the currency that is capped. The fix (describe failures instead of
replaying them, removing 76% of the effect) is harness-side and free, and appears in no free-tier guide.

**6. Distribution-gated inference as an unexamined policy shift.** "Only available on agentic harnesses"
is a new category of access control — not price, not rate, but *identity of the calling application*. It
concentrates the best free capacity in incumbent tools and is disclosed only on individual model pages,
never in the central docs. If this pattern spreads, the free tier stops being an on-ramp and becomes a
moat maintained by the platforms that already have users.

**7. The "free vs cheap" decision is never actually costed.** Every comparison of free tiers is a table of
limits. None prices the engineering: multi-provider fallback, a stateful proxy, schema validation on every
response, quantization-aware evaluation, and quota guessing without telemetry. Against $0.09/M input
tokens, that work has a negative expected value for most bootstrapped projects — and yet "use free tiers"
is the default advice given to exactly those projects.

---

## 11. What becomes commodity / what stays hard

### Commodity now

| Item | Label | Basis |
|---|---|---|
| OpenAI-compatible chat protocol across every provider tested | OBSERVED TODAY | 429 models, one schema, one endpoint |
| Tool calling / function calling | OBSERVED TODAY | 6/6 free models correct, round-trip 3/3 |
| Long context (256K–1M) at zero price | OBSERVED TODAY | 146 466 tokens, correct retrieval, $0, 10.9 s |
| Model discovery, price and capability metadata as an API | OBSERVED TODAY | `/models`, `/endpoints` expose price, quant, ctx, uptime |
| Basic structured extraction on models that support it | OBSERVED TODAY | 4/6 schema-conformant |
| Guardrail / content-safety classification | OBSERVED TODAY | dedicated free model, 3/3 availability, ~2 s |
| Static task-type routing | OBSERVED TODAY | 262/294 at $3.33 vs 245/294 at $7.69 (arXiv 2608.23023) |
| Near-frontier coding tokens at ~$0.09/M input | OBSERVED TODAY | endpoint pricing fetched today |

### Stays hard

| Item | Label | Basis |
|---|---|---|
| Guaranteed schema conformance without per-response validation | OBSERVED TODAY | HTTP 200 + prose, 3/3 trials |
| Capacity you can plan on | OBSERVED TODAY | no headers, usage API at 0, Google's limits unpublished |
| Predictable latency at zero price | OBSERVED TODAY | 6.2–218 tok/s; a 120 s timeout on a model named "Lightning" |
| Conversational state across provider failover | OBSERVED TODAY (paper) | near-0% vs 99.20% CPR |
| Privacy without payment | OBSERVED TODAY | 8/16 free models require "Free model training"; Google unpaid tier trains + human review |
| Durable access to the *best* free capability | OBSERVED TODAY | 403 harness gate on the two 1M-context models |
| Knowing which artifact answered you (precision, context, provider) | OBSERVED TODAY | fp4/nvfp4/fp8 undisclosed in the model id |
| Free embeddings at any useful volume | OBSERVED TODAY | no good option found; HF free = $0.10/month |
| A free tier surviving 24 months | STRONG TREND | GitHub Models retired; Cerebras free tier ended; HF credits "subject to change"; Groq's own contract says "for a limited time" |
| Zero-cost inference as a *product* promise to end users | OBSERVED TODAY | OpenRouter §7 forbids reselling API access |

---

## 12. Open questions for the second wave

1. **Is the "agentic harness" gate spreading?** Re-run the 16-model probe monthly. If the count of
   403-gated free models rises, free inference has become a distribution instrument and the on-ramp
   thesis is dead. What are the listing criteria, and can a solo builder's app qualify?
2. **Does the silent-schema-drop occur on paid endpoints?** This lane only established it on a
   single-endpoint free model where no compliant fallback existed. If paid multi-endpoint models also
   drop `response_format` silently, it is a platform-wide correctness hazard, not a free-tier quirk.
3. **What is the real quality cost of fp4/nvfp4 free serving?** Run an identical benchmark against the
   free (quantized) and paid (bf16) endpoints of the same model id — `nvidia/nemotron-3-super-120b-a12b`
   is served both ways and is the natural test case.
4. **Is the ~10.2 s time-to-first-byte on NVIDIA free endpoints a fixed admission delay?** It was stable
   to within 0.1 s across three passes. If free tiers implement deterministic queue admission, that is a
   designable constraint rather than noise.
5. **What is the actual free-tier daily ceiling, per key or per account?** The docs say 1 000 requests/day
   for `:free` above $10 lifetime credits but do not say whether the cap is per key, per account, or per
   model — and no endpoint reports remaining quota.
6. **Does the small-model failure-repetition effect (6% → 54%) persist at 26B–120B?** The paper tested
   135M–1.7B. Every general-purpose free model measured here is 2.6B or larger. If it persists, every
   free-tier agent loop needs the describe-don't-replay fix.
7. **What is the Continuity Preservation Rate of off-the-shelf gateways under free-tier 429 storms?**
   Measure LiteLLM and OpenRouter's own `allow_fallbacks` against ContinuityBench's protocol.
8. **Where exactly is the line in OpenRouter §7?** "Reselling API access" versus "consuming inference to
   deliver a feature" is the difference between a legal and an illegal product for a bootstrapped builder,
   and no guidance was found.
9. **Unresolved provider facts:** NVIDIA's own free-credit allowance (`NOT FOUND`), SambaNova's free tier
   (`UNVERIFIED`), Mistral's concrete free rate limits (`NOT FOUND`), Together's $0.00 model
   (`UNVERIFIED`), and the data policy of the four free models blocked by 429/403 before the policy filter
   could be evaluated.
10. **Do free tiers correlate with the intent-fidelity failures other lanes found?** Semantic collapse
    (arXiv 2607.01953) predicts models converge unanimously on one wrong reading. Free rosters are
    narrow — 16 models, heavily NVIDIA-weighted — so a builder rotating across free capacity may be
    sampling *less* diversity than they think, defeating disagreement-based clarification detectors. This
    is testable with the free roster measured here and is the single most valuable cross-lane experiment.
```
CLAIM: The narrowness and vendor-concentration of the free roster may defeat disagreement-based
       ambiguity detection, because rotating across "different" free models samples less independence
       than it appears to.
LABEL: SPECULATIVE
CONFIDENCE: low
EVIDENCE: 5 of 16 free models are NVIDIA Nemotron variants and 2 more are the same inclusionAI Ling 3.0
  Flash base fine-tuned for finance and health — so 7 of 16 come from 2 base lineages. Richter &
  Papadakis (arXiv 2607.01953, established earlier in this mission) report "semantic collapse" in which
  models converge unanimously on one wrong reading of an underspecified task in 3–32% of cases, invisible
  to disagreement-based detectors.
SOURCE: Live test A3 — this lane — 2026-09-08; Underspecification does not imply Incoherence — Richter &
  Papadakis — arXiv 2607.01953 — 2026-07 (carried from mission brief, not re-fetched by this lane)
COUNTEREVIDENCE: Model diversity is not lineage diversity in either direction — fine-tunes can diverge
  sharply, and unrelated models can share pretraining corpora, so lineage counting may predict nothing.
  This lane ran no ambiguity experiment whatsoever; the connection is inference, not measurement.
OPEN QUESTION: Run a semantic-collapse probe across the 7 reliably-available free models and compare
  agreement rates against a lineage-diverse paid set.
```
