# Lane 09 — Economics of intelligence and the role of models

Research lane 09 (compute-economics-analyst). Written 2026-09-08. All prices, benchmark scores and
hardware figures below were fetched on 2026-09-08 from the sources listed in
`research/sources/09-economics.md`. Nothing here is recalled from model memory.

**Method note.** The session's WebSearch budget was already exhausted before this lane started
(200/200), and `export.arxiv.org` returned HTTP 429 for every attempt across ~50 minutes. All
evidence was therefore gathered by direct WebFetch of known primary URLs, by `curl` against public
JSON APIs (OpenRouter), and by downloading and analysing Epoch AI's published CSV datasets locally.
Three quantitative analyses below (the capability–price frontier, the provider price-dispersion
table, the open-weights training-compute frontier) are **my own computations over primary data**,
not restatements of someone's chart; the inputs are cited and the transformations are stated.

---

## 1. Summary (10 lines)

1. Inference price per unit of *fixed capability* is collapsing at 40–100× per year; the price of
   *the frontier* has risen 5–8× since mid-2025 (gpt-5 $1.25/$10 → gpt-6-astra $10/$50).
2. Running the identical Artificial Analysis Intelligence Index suite cost **$13,128.86 on Claude
   Fable 5.1** and **$280.28 on GLM-5.3-Flash** — 46.8× the price for 26% more index score.
3. Open weights are 8.5 index points behind the frontier (44.9 vs 53.4) but the *coding* gap is
   6.8 points (74.8 vs 81.6) and the *agentic* gap 4.6 (53.4 vs 58) — coding compresses fastest.
4. Open weights no longer mean local: 20 of 26 notable 2026 open-weight models need >128 GB at
   4-bit. The best locally-runnable coder is Qwen3.8-27B (Terminal-Bench 2.1 = 73.0, Apache 2.0).
5. Hardware price-performance improves only 1.49×/yr (Epoch) — two orders of magnitude slower than
   the price-at-capability curve. The curve is algorithmic and competitive, not silicon-driven.
6. Small dense models are **not** the cheap option in the cloud: Qwen3.8-27B costs $1,170 to run the
   index; the 320B-total/18B-active GLM-5.3-Flash costs $280. Sparsity plus batching beat smallness.
7. Local inference costs ~$0.14–0.17/M output tokens in US residential electricity alone — at parity
   with the cheapest cloud open-model output price. Local hardware never pays back against that tier.
8. Epoch (May 2026): inference capacity grows 3.4×/yr, demand ~10×/yr, so "the price of tokens from
   large models will rise." Hyperscaler capex overtakes operating cash flow around Q3 2026.
9. The open-model inference market shows 8.8× price dispersion for byte-identical weights, undeclared
   quantisation across much of supply, and no enforcement — a lemons market, not a clean commodity.
10. Scaffolding depreciates fast: for 37–63% of ICSE 2026 LLM-technique papers, a newer model with a
    single plain prompt beats the tooling proposed a year earlier. Intent survives; workarounds do not.

---

## 2. Price curve table

All rows fetched 2026-09-08. Dates are model-release dates where the model ID encodes one, otherwise
the date the model first appeared on OpenRouter (marked *OR*). "—" = not published on that page.

### 2a. OpenAI (source: developers.openai.com/api/docs/pricing, accessed 2026-09-08)

| Approx. date | Model | $/M input | $/M cached in | $/M output |
|---|---|---:|---:|---:|
| 2022 legacy | `davinci-002` | 2.00 | — | 2.00 |
| 2023-03 | `gpt-4-0613` | 30.00 | — | 60.00 |
| 2023-11 | `gpt-3.5-turbo-1106` | 1.00 | — | 2.00 |
| 2024-01 | `gpt-3.5-turbo-0125` | 0.50 | — | 1.50 |
| 2024-04 | `gpt-4-turbo-2024-04-09` | 10.00 | — | 30.00 |
| 2024-05 | `gpt-4o-2024-05-13` | 5.00 | — | 15.00 |
| 2024-07 | `gpt-4o-mini` | 0.15 | 0.075 | 0.60 |
| 2024-08 | `gpt-4o` (current alias) | 2.50 | 1.25 | 10.00 |
| 2024-12 | `o1` | 15.00 | 7.50 | 60.00 |
| 2025-04 | `gpt-4.1` | 2.00 | 0.50 | 8.00 |
| 2025-04 | `gpt-4.1-nano` | 0.10 | 0.025 | 0.40 |
| 2025-08 | `gpt-5` | 1.25 | 0.125 | 10.00 |
| 2025-08 | `gpt-5-nano` | 0.05 | 0.005 | 0.40 |
| 2026-03 (*OR*) | `gpt-5.4` | 2.50 | 0.25 | 15.00 |
| 2026-04 (*OR*) | `gpt-5.5` | 5.00 | 0.50 | 30.00 |
| 2026-07 (*OR*) | `gpt-5.6-sol` | 4.00 \* | 0.40 | 20.00 \* |
| 2026-07 (*OR*) | `gpt-5.6-terra` | 2.00 | 0.20 | 12.00 |
| 2026-07 (*OR*) | `gpt-5.6-luna` | 0.20 | 0.02 | 1.20 |
| 2026-09-04 (*OR*) | `gpt-6-astra` | 10.00 | 1.00 | 50.00 |
| 2026-02 (*OR*) | `gpt-5.3-codex` | 1.75 | 0.175 | 14.00 |

\* The OpenAI docs page lists `gpt-5.6-sol` at $4.00/$20.00; OpenRouter lists $2.00/$10.00 for the
same slug, both fetched 2026-09-08. **Discrepancy recorded, not resolved.**

### 2b. Anthropic (source: claude.com/pricing, accessed 2026-09-08)

| Tier | Model | $/M input | $/M output | Cache read | Cache write |
|---|---|---:|---:|---:|---:|
| current | Fable 5.1 | 10.00 | 50.00 | 0.25 | 12.50 |
| current | Opus 5 | 5.00 | 25.00 | 0.50 | 6.25 |
| current | Sonnet 5 | 2.00 | 10.00 | 0.20 | 2.50 |
| current | Haiku 4.5 | 1.00 | 5.00 | 0.10 | 1.25 |
| legacy | Fable 5 | 10.00 | 50.00 | 1.00 | 12.50 |
| legacy | Opus 4.5 – 4.8 | 5.00 | 25.00 | 0.50 | 6.25 |
| legacy | Opus 4.1 | 15.00 | 75.00 | 1.50 | 18.75 |
| legacy | Sonnet 4.5 / 4.6 | 3.00 | 15.00 | 0.30 | 3.75 |

"Batch processing saves 50% on input/output token costs."

### 2c. Google (source: ai.google.dev/gemini-api/docs/pricing, accessed 2026-09-08)

| Model | $/M input (paid) | $/M output (paid) | Batch in / out | Free tier |
|---|---:|---:|---|---|
| `gemini-2.5-flash-lite` | 0.10 | 0.40 | 0.05 / 0.20 | yes |
| `gemini-2.5-flash` | 0.30 | 2.50 | 0.15 / 1.25 | yes |
| `gemini-2.5-pro` (≤200k) | 1.25 | 10.00 | 0.625 / 5.00 | yes |
| `gemini-3.1-flash-lite` | 0.25 | 1.50 | 0.125 / 0.75 | yes |
| `gemini-3.1-pro-preview` (≤200k) | 2.00 | 12.00 | 1.00 / 6.00 | yes |
| `gemini-3.5-flash` | 1.50 | 9.00 | 0.75 / 4.50 | yes |
| `gemini-3.5-flash-lite` | 0.30 | 2.50 | 0.15 / 1.25 | yes |
| `gemini-3.6 / 3.7 / 3.8-flash` | 0.75 (through 12/31/26) | 3.75 | 0.375 / 1.875 | yes |

**Note the direction of travel inside one vendor's own current price list:** the flash tier went
$0.30/$2.50 (2.5) → $1.50/$9.00 (3.5) → $0.75/$3.75 (3.6–3.8). Input at the flash tier is 2.5×
higher in September 2026 than for Gemini 2.5 Flash.

### 2d. Open-weight and other (accessed 2026-09-08)

| Model | Host | $/M input | $/M output | Notes |
|---|---|---:|---:|---|
| DeepSeek V4 Flash | DeepSeek (first party) | 0.44 peak / 0.22 off-peak | 1.32 / 0.66 | cache hit $0.014 / $0.007 |
| DeepSeek V4 Pro | DeepSeek | 1.32 / 0.66 | 3.96 / 1.98 | cache hit $0.044 / $0.022 |
| DeepSeek V4 Flash 0731 | cheapest of 29 OpenRouter hosts | **0.050** | **0.160** | OpenInference, fp8, status −2 |
| GLM-5.3-Flash | Z.AI (first party) | **0.075** | **0.250** | MIT, 320B total / 18B active |
| GLM-5.3 | Z.AI / Together / Baseten | 1.40 | 4.40 | open weights |
| Qwen3.8-27B | 13 OpenRouter hosts | 0.15 – 0.45 | 2.00 – 3.20 | Apache 2.0, 27B dense |
| Qwen3-Coder-Next | Alibaba | 0.35 | 1.20 | Apache 2.0, 80B / 3B active |
| Kimi K3 | Together / Baseten | 3.00 | 15.00 | open weights, **non-commercial** |
| Grok 4.6 (<200k) | xAI | 2.00 | 6.00 | cached $0.50 |
| Grok 4.3 (<200k) | xAI | 1.25 | 2.50 | 1M context |
| GPT-OSS-120B | Groq | 0.15 | 0.60 | 500 tok/s |
| GPT-OSS-20B | Groq | 0.075 | 0.30 | 1000 tok/s |
| Qwen3.8-27B | Groq (preview) | 0.80 | 4.00 | 450 tok/s — 5.3× premium for speed |
| Mercury 2 | Inception | 0.25 | 0.75 | 925 tok/s, Intelligence Index 12 |
| Llama 3.3 70B | Together | 1.04 | 1.04 | 2024-era open weights |

### 2e. The capability–price frontier over time (own computation)

Computed from `openrouter.ai/api/v1/models` (429 models; 128 carry Artificial Analysis benchmark
fields), fetched 2026-09-08. Blended price = (3 × input + 1 × output) / 4. Each row is a new record
low for the blended price at or above that Intelligence Index threshold.

| II ≥ 35 | date | model | blended $/M | II |
|---|---|---|---:|---:|
| | 2026-04-24 | `openai/gpt-5.5` | 11.250 | 38.6 |
| | 2026-05-27 | `anthropic/claude-opus-4.8` | 10.000 | 42.0 |
| | 2026-06-30 | `anthropic/claude-sonnet-5` | 4.000 | 38.4 |
| | 2026-07-08 | `x-ai/grok-4.5` | 3.000 | 39.1 |
| | 2026-07-09 | `openai/gpt-5.6-luna` | 0.450 | 37.5 |
| | 2026-08-26 | `z-ai/glm-5.3-flash` | **0.119** | 41.9 |

**$11.25 → $0.119 in four months = 94.5×.** The same computation at other thresholds:

| Threshold | First record in window | Last record (2026-09-08) | Fall | Open weights at the floor? |
|---|---|---|---:|---|
| II ≥ 20 | $6.00 (Sonnet 4.5, 2025-09-29) | $0.094 (DeepSeek V4 Flash 0731) | 64× | yes |
| II ≥ 30 | $6.00 (Sonnet 4.6, 2026-02-17) | $0.094 (DeepSeek V4 Flash 0731) | 64× | yes |
| II ≥ 35 | $11.25 (gpt-5.5, 2026-04-24) | $0.119 (GLM-5.3-Flash) | 95× | yes |
| II ≥ 40 | $10.00 (Opus 4.8, 2026-05-27) | $0.119 (GLM-5.3-Flash) | 84× | yes |
| II ≥ 45 | $20.00 (Fable 5, 2026-06-09) | $4.00 (gpt-5.6-sol) | 5× | **no** |
| II ≥ 50 | $10.00 (Opus 5, 2026-07-24) | $10.00 (Opus 5) | 1× | **no** |

The shape is the whole story: below index 45 the floor is open-weight and falling ~two orders of
magnitude a year; at index 45+ there is no open substitute and the floor barely moves.

### 2f. Cost per *unit of capability* — the number that matters

Artificial Analysis publishes the dollar cost of running its 10-benchmark Intelligence Index v4.3
suite against each model. Same questions, same harness, so the totals are directly comparable.

| Model | Intelligence Index | Cost to run the index | $/index task | Output tokens | TTFT | Weights |
|---|---:|---:|---:|---:|---:|---|
| Claude Fable 5.1 | 53 | **$13,128.86** | 7.63 | 190M | 277.5 s | closed |
| Claude Opus 5 | 51 | $7,274.74 | 5.86 | 140M | 69.9 s | closed |
| GPT-6 Astra (max) | 53 | $5,324.10 | 3.26 | 60M | 322.5 s | closed |
| Qwen3.8-27B (xhigh) | 34 | $1,170.48 | 0.82 | 200M | 3.8 s | Apache 2.0 |
| Qwen3-Coder-Next | 10 | $476.03 | 0.55 | — | — | Apache 2.0 |
| DeepSeek V4 Flash 0731 | 35 | $474.19 | 0.22 | 240M | 0.9 s | MIT |
| GPT-5.6 Luna (max) | 38 | $319.93 | 0.18 | 150M | 171.7 s | closed |
| GLM-5.3-Flash | 42 | **$280.28** | ~0.16 | 180M | 1.6 s | MIT |

```
CLAIM: In September 2026 the price of intelligence spans 47x between the top of the frontier and
the best open-weight near-frontier model, for a capability difference of 11 index points (21%).
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Running the identical Artificial Analysis Intelligence Index v4.3 suite cost $13,128.86
on Claude Fable 5.1 (index 53) and $280.28 on GLM-5.3-Flash (index 42) - a ratio of 46.8x. Output
token counts were comparable (190M vs 180M), so the gap is price per token, not verbosity. Fable 5.1
lists at $10/$50 per M; GLM-5.3-Flash at $0.075/$0.25 from Z.AI and $0.15/$0.50 from 14 other hosts.
SOURCE: artificialanalysis.ai/models/claude-fable-5-1 and /glm-5-3-flash - Artificial Analysis -
Intelligence Index v4.3, page updated 2026-09-07 - accessed 2026-09-08
COUNTEREVIDENCE: The index weights agents 30%, coding 20%, science 20%, general 30%; it is not a
software-production metric. On AA's separate coding index the gap is Fable 5.1 81.6 vs GLM-5.3-Flash
71.5 - 12%, not 21%. Fable 5.1's cost also includes a 277 s time-to-first-token: part of the 47x
buys latency you may not want. And GLM-5.3-Flash's $0.075 first-party price may be strategic rather
than cost-reflective, given 14 independent hosts settle at exactly twice that.
OPEN QUESTION: What is the ratio on a task suite resembling real software maintenance (multi-repo,
stateful, long-horizon) rather than benchmark questions?
```

```
CLAIM: The price of the frontier tier has risen, not fallen, over the last 13 months.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: OpenAI's own current price list shows gpt-5 (Aug 2025) at $1.25/$10.00 and gpt-6-astra
(Sep 2026) at $10.00/$50.00 - 8x input, 5x output. Intermediate steps: gpt-5.2 $1.75/$14,
gpt-5.4 $2.50/$15, gpt-5.5 $5.00/$30. Google's flash tier went from gemini-2.5-flash $0.30/$2.50 to
gemini-3.5-flash $1.50/$9.00, settling at $0.75/$3.75 for 3.6-3.8 - still 2.5x the 2.5-flash input
price. Anthropic cut Opus from $15/$75 (4.1) to $5/$25 (4.5+) but introduced Fable at $10/$50 above
it, so the top-of-line list price is $10/$50.
SOURCE: developers.openai.com/api/docs/pricing; ai.google.dev/gemini-api/docs/pricing;
claude.com/pricing - all accessed 2026-09-08
COUNTEREVIDENCE: These are different products, not one product repriced - gpt-6-astra is far more
capable than gpt-5, so price per unit of capability may still have fallen. Anthropic's Fable cache
read fell from $1.00 to $0.25 over the same window. And gpt-5.6-luna at $0.20/$1.20 with index 38
shows the cheap tier moved down while the top moved up. The honest statement is that the price band
widened in both directions.
OPEN QUESTION: Is the top-tier rise a capability-mix effect, a compute-scarcity effect (Epoch's
compute crunch), or price discrimination now that agentic buyers are less price-sensitive than chat
buyers?
```

---

## 3. Open-model gap to frontier

### 3a. Capability gap, September 2026

| Metric | Best closed | Best open weights | Gap | Open model |
|---|---:|---:|---:|---|
| AA Intelligence Index v4.3 | 53.4 (Fable 5.1) | 44.9 | −8.5 (−16%) | GLM-5.3 |
| AA Coding Index | 81.6 (Fable 5.1) | 74.8 | −6.8 (−8%) | GLM-5.3 |
| AA Agentic Index | 58.0 (Fable 5.1) | 53.4 | −4.6 (−8%) | GLM-5.3 / Qwen3.8-2.4T |
| Epoch Capabilities Index | 161.59 (Opus 5) | 155.18 | −6.4 (−4%) | DeepSeek V4 Pro 0813 |
| Blended $/M at that level | 20.00 | 2.15 | 9.3× cheaper | GLM-5.3 |

Rows 1–3 and 5 computed from the OpenRouter models payload, 2026-09-08. Row 4 from Epoch AI's
`eci-frontier-trend` insight, 2026-09-01.

### 3b. Historical baseline

| Date | Finding | Source |
|---|---|---|
| 2024-11-04 | Best open models lag closed by **5–22 months**, central estimate ~1 year; ~13 months average across four benchmarks; training-compute lag ~15 months (90% CI 6–22). Top open and closed both scaling 4.6×/yr, so "the gap remains relatively constant" | Epoch AI, *Open models report* (Cottier, You, Martemianova, Owen) |
| 2024-07-23 | Open-weight training-compute record set at 3.8e25 FLOP (Llama 3.1-405B) | Epoch AI notable-models DB |
| 2025-07-09 | Closed record 5.0e26 FLOP (Grok 4, est. cost $387.8M) — 13× the open record | Epoch AI notable-models DB |
| 2026-08-13 | Open DeepSeek V4 Pro 0813 reaches ECI 155.18 vs Opus 5's 161.59, from a family trained at ~9.7e24 FLOP — ~50× less than Grok 4 | Epoch AI ECI insight + DB |
| 2026-09-01 | ECI frontier advancing **14 points/year** since reasoning models (Sept 2024) vs 6 pts/yr before | Epoch AI, `eci-frontier-trend` |

```
CLAIM: The open-weight training-compute record has not moved in 26 months, yet open-weight
capability has continued to close on the frontier - so open catch-up is now driven by algorithmic
efficiency and distillation, not by anyone spending more.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: Own running-maximum computation over Epoch AI's notable_ai_models.csv (3,600+ models, last
updated 2026-09-07, downloaded and parsed locally 2026-09-08). The open-weights training-compute
record is still Llama 3.1-405B at 3.80e25 FLOP, set 2024-07-23. No 2025 or 2026 open-weight row in
the dataset exceeds it (best 2025 open: Ling-1T 6.0e24; best 2026 open: Kimi K3 2.0e25). Over the
same window the closed record rose to 5.00e26 (Grok 4, 2025-07-09). Yet DeepSeek-V4-Pro (2026-04-24,
9.70e24 FLOP, open weights unrestricted) reaches ECI 155.18 against Opus 5's 161.59.
SOURCE: epoch.ai/data/epochdb/notable_ai_models.csv - Epoch AI - updated 2026-09-07 - accessed
2026-09-08; epoch.ai/data-insights/eci-frontier-trend - 2026-09-01
COUNTEREVIDENCE: Epoch's compute estimates are incomplete for recent models - 2026 rows for Claude
Fable, GPT-6 Astra and several trillion-parameter open MoEs have blank compute fields, so the record
may be unmeasured rather than unbroken. Qwen3.8-2.4T-A95B (2.4T params), LongCat-2.0 (1.6T) and
Kimi K3 (2.8T) plausibly exceed 3.8e25 but carry no published estimate. Epoch itself warns the
explorer shows only models with sufficient estimation data.
OPEN QUESTION: Do the 2026 trillion-parameter Chinese MoEs actually exceed Llama 3.1-405B in
training compute? One confirmed estimate would flip this claim.
```

```
CLAIM: Open weights in 2026 no longer imply local execution: 20 of 26 notable open-weight models
released in 2026 cannot fit in 128 GB even at 4-bit.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Computed from Epoch AI's notable-models CSV, filtering to Model accessibility beginning
"Open weights" with a 2026 publication date (n = 26), parameter count x 0.5 bytes for 4-bit:
Kimi K3 2,800B -> 1,400 GB; Qwen3.8-2.4T-A95B 2,400B -> 1,200 GB; DeepSeek-V4-Pro and LongCat-2.0
1,600B -> 800 GB; Kimi K2.5/K2.6 1,040B -> 520 GB; Inkling 975B -> 488 GB; GLM-5.1 754B -> 377 GB;
K-EXAONE 2.0 750B -> 375 GB; GLM-5.3-Flash 320B -> 160 GB; DeepSeek-V4-Flash 284B -> 142 GB. Only
six fit in 128 GB: Qwen3-Coder-Next (80B -> 40 GB), Nemotron 3 Super (120B -> 60 GB),
Qwen3.5-122B-A10B (61 GB), EXAONE 4.5 (33B -> 17 GB), MolmoAct 2 (5B -> 3 GB), and Solar Open2 250B
only marginally (125 GB). Qwen3.8-27B (27B dense, Apache 2.0, ~14 GB at 4-bit) is not in Epoch's
notable set but is the strongest small local coder found: SWE-bench Pro 61.7, Terminal Bench 2.1
73.0, LiveCodeBench v6 90.3, GPQA Diamond 89.2.
SOURCE: epoch.ai/data/epochdb/notable_ai_models.csv - accessed 2026-09-08;
huggingface.co/Qwen/Qwen3.8-27B model card - accessed 2026-09-08
COUNTEREVIDENCE: Sparse MoE means active, not total, parameters drive compute - a 320B/18B model
runs at 18B speed once resident, and Apple's Mac Studio M5 Ultra configures to 512 GB of unified
memory at 1.2 TB/s, which would hold GLM-5.3-Flash at 4-bit with room to spare. Aggressive 2-bit and
mixed-precision GGUF quants (ISTA-DASLab, unsloth builds are already on Hugging Face for
Qwen3.8-27B) halve these numbers again. The ceiling is money and quantisation tolerance, not a wall.
OPEN QUESTION: What is the measured capability loss of GLM-5.3-Flash at 2-bit versus fp8? Nobody
publishes capability-versus-quantisation curves for the 2026 MoEs.
```

```
CLAIM: A locally-runnable 27B open model reaches roughly 87% of the near-frontier open cloud model's
agentic-terminal score, and vendor-reports parity with the top of an independent SWE-bench Pro
leaderboard.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: Qwen3.8-27B model card (Aug 2026, Apache 2.0, 27B dense, 262,144 native context, 64
layers, hybrid Gated DeltaNet / Gated Attention): SWE-bench Pro 61.7, Terminal Bench 2.1 73.0,
LiveCodeBench v6 90.3, CoWorkBench 70.7, GPQA Diamond 89.2. GLM-5.3-Flash card (320B/18B, MIT):
Terminal Bench 2.1 84.3 - so 73.0/84.3 = 87%. Scale's public SWE-bench Pro leaderboard, accessed the
same day, is topped by Muse Spark 1.1 at 61.50 +/- 3.10 and gpt-5.4 (xHigh) at 59.10 +/- 3.56;
Qwen's self-reported 61.7 would sit at #1.
SOURCE: huggingface.co/Qwen/Qwen3.8-27B; huggingface.co/zai-org/GLM-5.3-Flash;
labs.scale.com/leaderboard/swe_bench_pro_public - all accessed 2026-09-08
COUNTEREVIDENCE: These are vendor-reported card numbers, evaluated by the vendor at
reasoning_effort=xhigh with unstated harness, turn limits and cost caps. Scale's leaderboard notes
results differ by harness ("run with mini-swe-agent harness", "uncapped cost and with a turn limit
of 250"). Independently, Artificial Analysis scores Qwen3.8-27B at Intelligence Index 34 against
GLM-5.3-Flash's 42 (a 19% gap, not 13%) and coding index 68.1 against 71.5. The independent
measurement is consistently less flattering than the card.
OPEN QUESTION: An independent Terminal-Bench 2.1 run of Qwen3.8-27B at 4-bit on consumer hardware.
Every published number is either vendor-reported or measured against a cloud fp8 endpoint.
```

### 3c. What a 2026 local model can and cannot do for software work

| Capability | Local (Qwen3.8-27B / Qwen3-Coder-Next class) | Evidence |
|---|---|---|
| Single-file code generation | Yes — LiveCodeBench v6 90.3 | Qwen3.8-27B card |
| Repository-scale bug fixing | Partial — SWE-bench Verified 70.6 (Qwen3-Coder-Next) | Qwen3-Coder-Next card |
| Hard repo tasks | Weak — SWE-bench Pro 44.3 (Coder-Next); 61.7 (27B, vendor) | model cards |
| Terminal / agentic loops | Partial — TB 2.0 36.2 (Coder-Next); TB 2.1 73.0 (27B, vendor) | model cards |
| Long-context work over a large codebase | Bounded by prompt-processing throughput, not context length (§5) | llama.cpp bench |
| Frontier general reasoning | No — AA Intelligence Index 34 vs 53 | Artificial Analysis |
| Solving open research problems | No evidence; the six FrontierMath open problems solved to date credit frontier models with humans | Epoch FrontierMath |

### 3d. Where the open supply comes from

Computed from Epoch's notable-models CSV, 2026-09-08:

| Year | Notable models | Open weights | Open from China | Open from USA |
|---|---:|---:|---:|---:|
| 2024 | 98 | 39 (40%) | 12 | 10 |
| 2025 | 107 | 45 (42%) | 24 | 7 |
| 2026 | 64 | 26 (41%) | **17 (65%)** | **3 (12%)** |

---

## 4. Hardware and efficiency

```
CLAIM: Hardware price-performance is improving roughly 1.49x per year - two orders of magnitude
slower than the fall in price-at-fixed-capability, so the inference price curve is not silicon-driven.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Epoch AI's trends dashboard (updated 2026-02-05): chip price-performance 1.49x/yr since
2023 (doubling 1.7 years); GPU energy efficiency 1.34x/yr (2.4 years); memory bandwidth 1.28x/yr
since 2008 (2.8 years); algorithmic efficiency 3x/yr. Epoch's dedicated insight (2026-08-13,
Venkat Somala) puts the dollar-weighted chip figure at 49%/yr (90% CI 36-66%), from 5.6e11
bit-operations/s/$ in Q1 2023 to ~1.4e12 in Q4 2025, "nearly flat at 6% per year from 2023 to
mid-2024, then grew to roughly double per year"; 2024 purchases were 23% better than 2023, 2025 were
91% better than 2024. Against this, my frontier computation shows the cheapest blended price at AA
Intelligence Index >= 35 falling from $11.25/M (2026-04-24) to $0.119/M (2026-08-26) - 94.5x in four
months. 1.49 x 3 = 4.5x/yr from hardware and algorithms combined; the residual is distillation, MoE
sparsity, competition and margin compression.
SOURCE: epoch.ai/trends (2026-02-05); epoch.ai/data-insights/chip-performance-per-dollar
(2026-08-13); openrouter.ai/api/v1/models (fetched 2026-09-08, own computation)
COUNTEREVIDENCE: NVIDIA reported 75.0% GAAP gross margin on $96.2B of Q2 FY2027 revenue (2026-08-26)
and guides 74.0% for Q3, so a large part of the "hardware improvement" a buyer sees is a pricing
decision, not physics; a competitive shock to that margin would produce a one-off step larger than
two years of the 1.49x trend. Conversely NVIDIA claims GB300 NVL72 delivers "65X more AI compute
than Hopper systems" and Blackwell Ultra "up to 50x Better Performance and 35x Lower Cost for
Agentic AI" - vendor figures far above Epoch's measured trend, on workload-specific,
sparsity-enabled comparisons.
OPEN QUESTION: How much of the 95x-in-four-months price-at-capability drop is durable cost decline
versus land-grab pricing by labs with state-adjacent capital?
```

```
CLAIM: Demand for inference is growing about 3x faster than the capacity to serve it, and Epoch AI
concludes that token prices from large models will rise.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: Epoch AI, "Is a compute crunch coming?" (2026-05-25, Luke Emberson and Jaime Sevilla):
inference capacity growing 3.4x/yr; demand "between 200 million and 4 billion tokens per second ...
growing by roughly 10x per year - plausibly outpacing supply growth in the near future, if not
already." Installed base as of Q4 2025: 1.9M GB200 plus 1.5M GB300 = 3.4M Blackwell chips in ~48,000
racks, roughly 40% of aggregate FLOP/s supply. Global serving ~5 billion tokens/second across all
providers (40 quadrillion per quarter); Google alone 1.2 billion tok/s. The article also identifies
memory bandwidth (4.1x/yr) versus compute (3.4x/yr) as the pair of limiting factors. Verbatim
conclusion: "If the demand for AI is outpacing the capacity to serve large models, the predictable
consequence is that the price of tokens from large models will rise. This suggests a 'compute
crunch' is near, if not already here." Corroborating: Epoch (2026-01-09) puts global AI computing
capacity growth at 3.3x/yr since 2022, doubling every 7 months (90% CI 6-8 months), with NVIDIA
above 60% of total compute.
SOURCE: epoch.ai/gradient-updates/is-a-compute-crunch-coming - 2026-05-25 - accessed 2026-09-08;
epoch.ai/data-insights/ai-chip-production - 2026-01-09
COUNTEREVIDENCE: Observed prices at the cheap tier have kept falling since May 2026, not risen -
GLM-5.3-Flash launched at $0.075/$0.25 in August, a new record low at index 42. Epoch's own demand
range spans a factor of 20 (200M-4B tok/s), so "10x per year" is a wide estimate. NVIDIA guides Q3
FY2027 revenue of $108.0B (+12% QoQ) explicitly excluding China, implying substantial supply still
arriving, and announced with AWS "2 Million Additional GPUs" on 2026-08-26. The crunch may bind only
above some model size - which is exactly the observed pattern of frontier prices rising while
sub-frontier prices fall.
OPEN QUESTION: Are the top-tier price rises scarcity or willingness-to-pay? Provider utilisation
data would settle it and none is published.
```

```
CLAIM: Energy is becoming a binding constraint on the largest facilities, and the current doubling
rate is arithmetically impossible to sustain to 2030.
LABEL: STRONG TREND (the observation) / REASONABLE EXTRAPOLATION (the break)
CONFIDENCE: high on the data, medium on when it breaks
EVIDENCE: Epoch AI (2026-09-04): "Since mid-2024, the record for the largest AI data center by IT
power capacity has doubled every ten months", with dated points 237 MW (Google Papillion,
2024-08-03) -> 278 MW (Colossus 1, 2025-02-17) -> 398 MW (Anthropic-Amazon New Carlisle, 2025-06-23)
-> 626 MW (2025-12-23) -> 910 MW (2026-03-23) -> 946 MW (Colossus 2, 2026-06-15), record ~950 MW.
IEA (2025-04-10): data centres consumed 415 TWh in 2024, "around 1.5% of the world's electricity
consumption", projected to "more than double to around 945 TWh by 2030" and "around 1 200 TWh by
2035" (case range 700-1,700 TWh), with "around 20% of planned data centre projects ... at risk of
delays" from grid constraints, and "more than 20% of demand growth to 2030" in advanced economies.
ARITHMETIC: 950 MW doubling every 10 months gives ~26.5 GW for a single facility by Sep 2030, i.e.
~232 TWh/yr - roughly a quarter of the IEA's entire global data-centre projection for 2030, in one
building. The trend must break. Meanwhile US retail electricity rose to 18.34 c/kWh residential and
14.19 c/kWh commercial in June 2026, from 17.47 and 13.54 in June 2025.
SOURCE: epoch.ai/data-insights/frontier-data-center-power (2026-09-04);
iea.org/reports/energy-and-ai executive summary (2025-04-10); eia.gov Electric Power Monthly table
5.6.A (June 2026 data) - all accessed 2026-09-08
COUNTEREVIDENCE: Epoch's own financing analysis (2026-08-12) concludes "financing is unlikely to be
the binding constraint on frontier compute growth", citing ~$50B of assembled debt for Anthropic
alone and "more than 20 GW of deployments for frontier labs, including Anthropic and OpenAI,
through 2028" - 20 GW is well above what the doubling curve needs before 2028, so the constraint may
be later than the arithmetic suggests. Epoch's 2024 scaling analysis put a single campus at 1-5 GW
and geographically distributed training at 2-45 GW by 2030, with roughly 90 GW of US data-centre
capacity, consistent with several more doublings before physics bites.
OPEN QUESTION: Does the doubling break at ~2 GW (single-campus interconnect limits) or at 10+ GW
(distributed training across campuses)? The two answers differ by about three years.
```

```
CLAIM: Algorithmic efficiency gains are not evenly available: the large ones require large compute
budgets to discover, so small and open players get only the small ones.
LABEL: STRONG TREND
CONFIDENCE: medium
EVIDENCE: Epoch AI (2025-05-16) separates compute-independent advances (LayerNorm, RoPE,
FlashAttention combined: "an experimental CEG of about 3.5x, even on our small-scale model") from
compute-dependent advances ("10-50x or more" but "only for those with the compute budget to unlock
them"), noting these "only appear with high amounts of compute, and the algorithmic advance provides
little benefit (or even hurts performance) at low compute levels", and that nearly all documented
compute-dependent advances amount to "the transformer and some of its derivatives". Epoch's trends
dashboard puts overall algorithmic progress at 3x/yr.
SOURCE: epoch.ai/gradient-updates/how-fast-can-algorithms-advance-capabilities - 2025-05-16;
epoch.ai/trends - 2026-02-05 - accessed 2026-09-08
COUNTEREVIDENCE: The 2026 record contradicts the pessimistic reading. DeepSeek V4 Pro reached ECI
155.18 from a family trained at ~9.7e24 FLOP against Opus 5's 161.59; Epoch's own open-models report
found DeepSeek V2 matching PaLM 2 with ~7x less compute. Chinese open labs have repeatedly extracted
compute-dependent-scale results at compute-independent-scale budgets, which is exactly what this
analysis says should be hard.
OPEN QUESTION: Is that a sustainable research capability, or a one-off transfer (distillation from
frontier API outputs) that closes if frontier labs tighten output terms?
```

### 4a. Hardware reference points (all accessed 2026-09-08)

| Item | Figure | Source |
|---|---|---|
| NVIDIA DGX Spark | 128 GB LPDDR5x coherent, **273 GB/s**, up to 1 PFLOP FP4 (sparse), GB10 TDP 140 W, 240 W PSU; inference to 200B params, fine-tune to 70B; orderable 2025-10-15 | nvidia.com product page + NVIDIA newsroom |
| Mac Studio M5 Max | 460 GB/s (32-core GPU) or 614 GB/s (40-core), up to 128 GB | apple.com specs |
| Mac Studio M5 Ultra | **1.2 TB/s**, up to **512 GB** unified memory; pre-order from 9.22 | apple.com specs |
| GeForce RTX 5090 | 32 GB GDDR7, 512-bit, 575 W TGP, 1000 W system, 21,760 CUDA cores | nvidia.com product page |
| NVIDIA Blackwell | 208B transistors (TSMC 4NP), 10 TB/s chip-to-chip, NVLink 5 to 576 GPUs, 130 TB/s in a 72-GPU domain | nvidia.com architecture page |
| NVIDIA Q2 FY2027 | revenue $96.2B (+106% YoY), data centre $89.0B (+117%), **GAAP gross margin 75.0%**, Q3 guide $108.0B at 74.0% | nvidianews 2026-08-26 |
| US electricity, June 2026 | residential 18.34 c/kWh; commercial 14.19 c/kWh (from 17.47 / 13.54 a year earlier) | EIA EPM 5.6.A |
| Prices NOT FOUND | Mac Studio M5 (all configs), DGX Spark, RTX 5090 MSRP — every primary page either omitted price or showed a placeholder | see sources file |

### 4b. Measured local inference throughput (llama.cpp, accessed 2026-09-08)

| Hardware | Model / quant | Prompt processing | Text generation | Date |
|---|---|---:|---:|---|
| DGX Spark (GB10) | GPT-OSS-120B MXFP4 MoE | 1,956.03 ± 9.28 t/s | 60.57 ± 0.25 t/s | 2025-10-14 |
| DGX Spark (GB10) | Qwen3-Coder-30B-A3B Q8_0 | 1,654.25 ± 1.80 t/s | 44.26 ± 0.11 t/s | 2025-10-14 |
| NVIDIA Thor (Jetson) | GPT-OSS-120B MXFP4 | 967.20 ± 6.04 t/s | 42.00 ± 0.09 t/s | 2025-10-15 |
| Apple M5 Max (40 GPU) | LLaMA-7B F16 / Q4_0 | 3,158.49 ± 37.11 t/s (F16) | 119.92 t/s (Q4_0) | 2026-08 |
| Apple M5 Pro (20 GPU) | LLaMA-7B F16 / Q4_0 | 1,588.78 ± 21.55 t/s | 66.33 t/s | 2026-08 |
| Apple M2 Ultra (76 GPU) | LLaMA-7B F16 / Q4_0 | 1,401.85 ± 1.75 t/s | 94.27 ± 0.05 t/s | 2023-11 |
| **RTX 5090** | Llama-2-7B Q4_0 | **14,073.41 ± 115.16 t/s** | **290.02 ± 1.10 t/s** | 2025-08 |
| **H100 80GB** | Llama-2-7B Q4_0 | 9,918.34 ± 176.97 t/s | 267.81 ± 1.54 t/s | 2025-08 |

---

## 5. Local vs cloud TCO

### 5a. Stated assumptions

| # | Assumption | Basis |
|---|---|---|
| A1 | Solo builder does agentic coding ~6 h/day, 21 days/month | **assumption, not sourced** |
| A2 | Heavy agentic use ≈ 20M output tokens/month; moderate ≈ 5M | **assumption**, calibrated against AA's 180–240M output tokens to run one benchmark index |
| A3 | US residential electricity 18.34 ¢/kWh; commercial 14.19 ¢/kWh | EIA Electric Power Monthly, June 2026 — **sourced** |
| A4 | Local box draws ~200 W sustained under inference load | DGX Spark GB10 TDP 140 W / 240 W PSU (NVIDIA) — spec sourced, **200 W is my estimate** |
| A5 | Local decode ≈ 60 tok/s for a 120B-class MoE at 4-bit | llama.cpp DGX Spark bench, GPT-OSS-120B MXFP4: 60.57 ± 0.25 tok/s — **sourced** |
| A6 | Local prompt processing ≈ 1,956 tok/s | same bench — **sourced** |
| A7 | Hardware acquisition cost `C` left symbolic | Mac Studio M5, DGX Spark and RTX 5090 MSRPs were **NOT FOUND** on primary pages |
| A8 | One H100 sustains `T` aggregate output tok/s at production batch size | **NOT FOUND — no provider publishes it**; treated as a free variable in §5d |

### 5b. Local marginal cost of a token

At A4/A5: 1M output tokens = 1,000,000 / 60 = 16,667 s = 4.63 h × 0.2 kW = 0.926 kWh.
At A3 residential: **$0.170 per million output tokens.** At commercial rates: $0.131/M.
On an Apple M5 Max (119.9 tok/s TG on a 7B Q4_0; ~30 tok/s scaled to a 27B dense) at ~80 W:
9.26 h × 0.08 kW = 0.74 kWh = **$0.136/M**.

Prefill matters more than people assume: at 1,956 tok/s, filling a 200k-token context costs 102
seconds of wall clock and 0.0057 kWh; filling a 1M-token context costs 8.5 minutes. Local KV-cache
reuse is free, but the first fill is not, and the local machine has no prefix-cache pricing to hide
behind. Cloud cache reads are $0.007–0.25/M.

### 5c. Solo developer, September 2026

| Route | Capability proxy | $/M output | 5M tok/mo | 20M tok/mo |
|---|---|---:|---:|---:|
| Local, energy only | TB 2.1 ≈ 73 (Qwen3.8-27B, vendor) | 0.17 | $0.85 + `C` amortised | $3.40 + `C` amortised |
| Cheapest cloud open (DeepInfra, DeepSeek V4 Flash 0731) | AA index 35 | 0.18 | $0.90 | $3.60 |
| Z.AI GLM-5.3-Flash | AA index 42, TB 2.1 84.3 | 0.25 | $1.25 | $5.00 |
| GLM-5.3-Flash, 14-host reference price | AA index 42 | 0.50 | $2.50 | $10.00 |
| GPT-5.6 Luna | AA index 38 | 1.20 | $6.00 | $24.00 |
| Sonnet 5 | AA index 38.4, coding 71.5 | 10.00 | $50 | $200 |
| Opus 5 | AA index 50.7, coding 78.0 | 25.00 | $125 | $500 |
| Fable 5.1 / GPT-6 Astra | AA index 53, coding 81.6 | 50.00 | $250 | $1,000 |
| Claude Pro subscription | Claude Code included | flat | $17–20/mo | $17–20/mo until limits bind |
| Claude Max | "Choose 5x or 20x more usage than Pro" | flat | from $100/mo | from $100/mo |
| Cursor Individual | frontier model access, "extended limits on Agent" | flat | $20/mo | $20/mo |
| GitHub Copilot Pro / Pro+ / Max | $15 / $70 / $200 monthly credits | flat | $10 / $39 / $100 | $10 / $39 / $100 |

```
CLAIM: For a solo developer in 2026, local inference hardware never pays back against the cheap open
cloud tier, and pays back against the frontier tier only by accepting a large capability drop.
LABEL: OBSERVED TODAY (inputs) / REASONABLE EXTRAPOLATION (the payback conclusion)
CONFIDENCE: medium
EVIDENCE: Local marginal cost computed above is $0.170/M output tokens (A3-A5; every input sourced
except the 200 W estimate). The cheapest cloud endpoint for a comparable open model is $0.160/M
output (OpenInference serving DeepSeek V4 Flash 0731 at fp8) and the reference tier is $0.250-0.500/M.
The saving against the $0.25/M tier is $0.08/M; at 20M output tokens/month that is $1.60/month, so
any hardware cost C above ~$100 has a payback beyond five years. Against Fable 5.1 at $50/M the
saving is $49.83/M - $997/month at 20M tokens, so a $4,000 machine pays back in four months - but
the local model scores AA Intelligence Index 34 against Fable 5.1's 53, and AA coding index 68.1
against 81.6.
SOURCE: eia.gov EPM 5.6.A (June 2026); github.com/ggml-org/llama.cpp discussions 16578 and 4167;
openrouter.ai endpoints API for deepseek/deepseek-v4-flash-0731 (29 providers); claude.com/pricing -
all accessed 2026-09-08
COUNTEREVIDENCE: Three unpriced drivers can dominate. (1) Privacy and IP: no token leaves the
machine - for regulated or contractual work that is an enabling condition, not a saving.
(2) Availability: OpenRouter's own telemetry shows 30-minute uptime as low as 55.9% (GMICloud) and
19.8% (Wafer) for a single model, and subscription plans reset "on a rolling five-hour session
window"; local has neither failure mode. (3) Fixed-price subscriptions break the comparison
entirely: Claude Pro at $17-20/month with Claude Code included, or Copilot Pro at $10/month, cost
less than the electricity for 20M local tokens plus any hardware at all - as long as limits do not
bind. And C itself is unverified: no primary price was obtainable for Mac Studio M5, DGX Spark or
RTX 5090.
OPEN QUESTION: What token volume does a Claude Pro or Copilot Pro subscription actually deliver
before limits bind? No vendor publishes it, and it is the single number that decides this comparison.
```

```
CLAIM: The cloud's cost advantage for inference is batching, which a solo developer cannot access -
a consumer GPU already beats a datacentre GPU at batch size 1.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: llama.cpp CUDA benchmark thread (Llama-2-7B Q4_0, -ngl 99): RTX 5090 achieves
14,073.41 +/- 115.16 tok/s prompt processing and 290.02 +/- 1.10 tok/s single-stream generation;
H100 80GB achieves 9,918.34 +/- 176.97 and 267.81 +/- 1.54 on the identical benchmark. The consumer
card is faster on both metrics at batch 1. The datacentre part's advantage is HBM capacity and
throughput under concurrency, realised only when many requests share the resident weights.
SOURCE: github.com/ggml-org/llama.cpp/discussions/15013 - llama.cpp CUDA performance thread -
August 2025 entries - accessed 2026-09-08
COUNTEREVIDENCE: The benchmark is a 7B dense model that fits comfortably in 32 GB; the comparison
inverts entirely for a 320B MoE that fits on neither card. And an H100 at production batch sizes
serves orders of magnitude more aggregate tokens per second than an RTX 5090 at batch 1, which is
exactly why cloud price per token is competitive with local electricity despite the provider's
margin. The claim is about who captures the batching economy, not about which chip is better.
OPEN QUESTION: Actual aggregate output throughput per H100 for a 13-18B-active MoE at production
batch size. No provider publishes it, and it determines the true cost floor.
```

### 5d. Enterprise, September 2026

Rented compute (sourced): Together on-demand **HGX H100 $3.99/hour** (promotional, from $5.49) and
**HGX B200 $8.99/hour**.

```
self-host  $/M output  =  3.99 / (T x 3.6)              [T = aggregate output tok/s on one H100]
serverless $/M output  =  0.28   (Together's own price for DeepSeek V4 Flash 0731)
break-even              T = 3.99 / (0.28 x 3.6) ~= 3,958 tok/s sustained, 24/7
                          ~= 10.3 billion output tokens per month
```

```
CLAIM: For an enterprise in 2026, self-hosting an open model on rented GPUs beats serverless only
above roughly 10 billion output tokens per month of sustained, saturating load.
LABEL: REASONABLE EXTRAPOLATION
CONFIDENCE: low
EVIDENCE: Together lists HGX H100 at $3.99/hour on-demand and its own serverless DeepSeek V4 Flash
0731 at $0.14 input / $0.28 output per M for the identical weights; the cheapest of 29 OpenRouter
endpoints for those weights is $0.050/$0.160. Solving $3.99/hour against $0.28/M output gives
break-even at ~3,958 aggregate output tok/s, i.e. ~10.3B output tokens/month at full saturation.
Below that, the serverless provider's batching across many tenants beats your own.
SOURCE: together.ai/pricing - accessed 2026-09-08; openrouter.ai endpoints API - accessed 2026-09-08
COUNTEREVIDENCE: Assumption A8 is doing all the work and I could not source it - no provider
publishes tokens/second/GPU for a 13B-active MoE at production batch size. If one H100 sustains
10,000 tok/s the break-even falls sharply and self-hosting wins much earlier; at 1,500 tok/s it
essentially never wins. Baseten's price page lists H100 at "$0.10833", which is almost certainly per
minute ($6.50/hour) - the ambiguity in a published price page is itself evidence that this market is
not transparent. Enterprises also self-host for data residency and model pinning, where the
break-even calculation is beside the point.
OPEN QUESTION: Published tokens/second/GPU at a stated batch size for one 2026 MoE. Everything
downstream of it is currently guesswork.
```

---

## 6. Marketplaces and edge: commoditisation verdict

### 6a. Measured price dispersion for byte-identical weights

Fetched from `openrouter.ai/api/v1/models/{id}/endpoints`, 2026-09-08. Uptime figures are
OpenRouter's own telemetry. Status −2 / −5 indicate degraded endpoints.

**DeepSeek V4 Flash 0731 — 29 endpoints, one set of weights (selected rows):**

| Provider | $/M in | $/M out | Quant | Status | Uptime 30 m | Uptime 1 d |
|---|---:|---:|---|---:|---:|---:|
| OpenInference | 0.050 | 0.160 | fp8 | −2 | 95.0 | 97.6 |
| DeepInfra | 0.060 | 0.180 | fp8 | 0 | 99.3 | 99.4 |
| Sail Research | 0.065 | 0.180 | **fp4** | 0 | 99.9 | 99.8 |
| Relace | 0.065 | 0.180 | **fp4** | 0 | 96.6 | 96.9 |
| DigitalOcean | 0.080 | 0.252 | **unknown** | 0 | 99.8 | 99.8 |
| Wafer | 0.100 | 0.250 | **unknown** | −5 | **19.8** | 97.4 |
| Morph | 0.123 | 0.348 | bf16 | 0 | 99.9 | 99.7 |
| CoreWeave | 0.130 | 0.280 | fp8 | 0 | 100.0 | 99.9 |
| Together | 0.140 | 0.280 | **unknown** | 0 | 99.8 | 99.7 |
| Fireworks | 0.220 | 0.660 | **unknown** | 0 | 98.9 | 98.6 |
| **DeepSeek (the model's author)** | 0.220 | 0.660 | **unknown** | 0 | 100.0 | 100.0 |
| GMICloud | 0.286 | 0.858 | fp8 | −5 | **55.9** | 69.0 |
| Novita | 0.409 | 1.228 | fp8 | 0 | 99.7 | 100.0 |
| Cloudflare | 0.440 | 1.320 | **unknown** | 0 | 100.0 | 99.9 |
| AtlasCloud | 0.440 | 1.320 | **fp4** | −2 | 93.8 | 99.8 |

Range: **8.8× on input, 8.25× on output.** Comparable dispersion elsewhere: GLM-5.3-Flash, 23
endpoints, 5.2× spread, with 14 providers clustered at exactly $0.150/$0.500 and the model's author
(Z.AI) undercutting all of them at $0.075/$0.250. Qwen3.8-27B, 13 endpoints, 3.0× spread.

*Cross-lane corroboration (read-only, from `research/sources/06-free-inference.md`, written the same
day): lane 06 independently probed `/models/{slug}/endpoints` on the **free** tier and found the same
structure — free endpoints "separately provisioned, frequently low-bit quantized, and sometimes
context-reduced against the paid endpoint of the same model", with quantisation values `fp4` /
`nvfp4` / `fp8` / `bf16`, and a 35× throughput spread across endpoints "that all cost exactly $0".
Two lanes reached the undeclared-numerics finding from opposite ends of the price scale.*

```
CLAIM: Fungible cognition is a commodity market in form but a lemons market in substance: price
dispersion for identical weights reaches 8.8x, is not explained by reliability, and the numeric
precision that determines output quality is undeclared across much of supply and unenforced.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: The table above (own computation over the OpenRouter endpoints API, 2026-09-08). Price
does not track quality: Sail Research serves fp4 at $0.065 with 99.9% 30-minute uptime while Phala
serves at $0.440 with 89.4%, and the model's own author sits mid-table at $0.220 with 100% uptime.
Quantisation is declared "unknown" by Together, Fireworks, DigitalOcean, Cloudflare, Wafer, Makora,
Venice and Alibaba on this one model. OpenRouter's routing docs state the default is to "Prioritize
providers that have not seen significant outages in the last 30 seconds. For the stable providers,
look at the lowest-cost candidates and select one weighted by inverse square of the price", with
quantisation available only as a filter preference: "The system does not enforce specific numeric
precision requirements", and the warning "Quantized models may exhibit degraded performance for
certain prompts, depending on the method used." Independent confirmation that this is not cosmetic:
arXiv:2609.00363 (2026-08-25) finds that with standard INT8 scales, CUTLASS and Triton kernels agree
bitwise at only 8/196 and 10/252 linear layers, and that "a tolerance of one spacing is therefore
blind to the entire class by construction: four of the five faults are detected by no check";
switching to power-of-two requantisation restores 196/196 and 252/252 bitwise agreement and
byte-identical generated token sequences at 1.7B, 8B and 14B (8/8 prompts, against 0/8).
SOURCE: openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints and
/z-ai/glm-5.3-flash/endpoints (accessed 2026-09-08, own computation);
openrouter.ai/docs/features/provider-routing (accessed 2026-09-08); arxiv.org/abs/2609.00363 -
Teng-Ruei Chen - 2026-08-25
COUNTEREVIDENCE: The dispersion may be rational rather than adverse selection: cheap endpoints
differ in context cap (Io Net at 262,144 vs 1,048,576 elsewhere), concurrency, data retention and
supported parameters - all of which OpenRouter exposes. Buyers who care can pin a provider
(allow_fallbacks: false) and filter quantisation. And 14 providers converging on exactly
$0.150/$0.500 for GLM-5.3-Flash is evidence of a working reference price, which is what a functioning
commodity market looks like.
OPEN QUESTION: Does an fp4 endpoint measurably underperform an fp8 endpoint of the same weights on
an agentic coding benchmark? No public evaluation runs one benchmark across providers of one model.
That single experiment would establish or dissolve the lemons claim.
```

### 6b. Speed and edge as a separately priced good

| Provider / model | tok/s | $/M in | $/M out | AA Intelligence Index |
|---|---:|---:|---:|---:|
| Celeris-1 | 1,275.2 | — | — | — |
| Groq GPT-OSS-20B | 1,000 | 0.075 | 0.30 | — |
| Inception Mercury 2 | 925.1 | 0.25 | 0.75 | 12 |
| Groq GPT-OSS-120B | 500 | 0.15 | 0.60 | — |
| Groq Qwen3.8-27B | 450 | 0.80 | 4.00 | 34 |
| DeepSeek V4 Flash 0731 (typical) | 127.8 | 0.05–0.44 | 0.16–1.32 | 35 |
| GLM-5.3-Flash (typical) | 60.7 | 0.075–0.39 | 0.25–1.36 | 42 |
| Claude Fable 5.1 | 69.9 | 10.00 | 50.00 | 53 |

Groq charges $0.80/$4.00 for Qwen3.8-27B where OpenRouter's cheapest host charges $0.15/$2.00 — a
5.3× premium purely for 450 tok/s. **Speed is a separately priced good and is not converging on the
token price.** Mercury 2 shows the other pole: 925 tok/s at Intelligence Index 12 — speed has not
bought capability.

**Verdict.** Sub-frontier cognition *is* a commodity market: 429 catalogued models, 29 sellers of
one SKU, a price-sorting aggregator, and a visible reference price. It is an *inefficient* one —
8.8× dispersion, undeclared and unverifiable numerics, no conformance standard, and the author of
the weights neither the cheapest nor the dearest seller. Frontier cognition is **not** a commodity:
two sellers at index ≥ 51, both at $10/$50 or $5/$25, no substitute, and a rising price. **The
commodity boundary in September 2026 sits at Artificial Analysis Intelligence Index ≈ 45.**

---

## 7. Role of models in 2056: competing possibilities

| Possibility | 2026 evidence for | 2026 evidence against | Label |
|---|---|---|---|
| **A. One giant frontier model does everything** | Frontier holds an 8.5-point index lead and a 47× price premium buyers still pay; ECI frontier advancing 14 pts/yr since reasoning models | GPT-4.5 (3.8e26 FLOP, est. $366M) was superseded by GPT-5 at 6.6e25 — 5.8× *less* training compute; the deployed frontier moved down in compute | SPECULATIVE |
| **B. Sparse giant MoE with tiny active params is the default** | GLM-5.3-Flash 320B/18B runs the AA index for $280 vs $1,170 for a dense 27B; Qwen3-Coder-Next 80B/3B; DeepSeek V4 Flash 284B/13B | 4-bit footprints of 142–1,400 GB keep these off consumer hardware entirely | STRONG TREND |
| **C. Specialised small models win** | NVIDIA SLM paper: "Serving a 7bn SLM is 10–30× cheaper (in latency, energy consumption, and FLOPs) than a 70–175bn LLM"; LoRA/DoRA fine-tunes "require only a few GPU-hours"; "10k-100k examples… sufficient"; Qwen3.8-27B at TB 2.1 73.0 | Directly contradicted for cloud serving: the dense 27B costs 4.2× *more* per index run than the 320B/18B MoE and scores 8 points lower. SLM economics hold only where you own the hardware or need low latency | REASONABLE EXTRAPOLATION, scoped to edge and owned hardware |
| **D. Neurosymbolic: model proposes, verifier disposes** | Vericoding: 82% Dafny, 44% Verus/Rust, 27% Lean verified synthesis over 12,504 specs; "LLM progress has improved progress on pure Dafny verification from 68% to 96% over the past year"; SpecOps 2026 workshop forming | "Adding natural-language descriptions does not significantly improve performance" — the model is not getting the spec from prose. Lean stuck at 27% | STRONG TREND for the mechanism; SPECULATIVE for dominance |
| **E. Theorem provers and search do the hard derivation** | FrontierMath Open Problems: 6 of 50 genuine research problems solved by AI as of 2026-08-12, including a Hadamard matrix result credited to "a team of three humans and Claude" | Six problems in ~13 months, every one with humans in the loop; no evidence of unsupervised derivation | SPECULATIVE |
| **F. Retrieval and deterministic compute displace parameters** | RETRO "achieving performance comparable to GPT-3 (175B)… while using 25× fewer parameters" (cited in NVIDIA SLM paper); Epoch: context windows growing 30×/yr, doubling every 2.4 months | Prompt-processing throughput is the real local limit: 1,956 tok/s on DGX Spark means a 1M-token context takes 8.5 minutes just to prefill | REASONABLE EXTRAPOLATION |
| **G. Diffusion / non-autoregressive decoding for speed** | Mercury 2 at 925.1 tok/s; Celeris-1 at 1,275.2 tok/s | Mercury 2 scores 12 on the Intelligence Index — 23% of frontier. Speed has not bought capability | SPECULATIVE |
| **H. Judgement-shaped models (verify, don't generate)** | "Judging Is Not Enumerating" (2026-08-02): judging F1 0.74–0.90 on code while authored test suites accept only 19–42% of oracle-correct solutions; emitting *predicates* instead reaches F1 ≈ 0.99 | Self-consistent errors "remain stable or even increase" with scale (arXiv:2505.17656), so a judge from the same family inherits the blind spot; cross-family verifier correlation ρ = 0.54 vs within-family 0.77 | STRONG TREND |

```
CLAIM: The 2056 stack is more likely to be a heterogeneous portfolio - sparse giant generators,
owned small models at the edge, deterministic verifiers, and provers - than a single model, because
the 2026 cost structure already prices these as four separate goods.
LABEL: REASONABLE EXTRAPOLATION
CONFIDENCE: low
EVIDENCE: Generation at index 42 costs $280 per index run; generation at index 53 costs $13,129;
speed at 925 tok/s costs $0.25/$0.75 with index 12; verification is nearly free per unit (an SMT
solver run) but caps at 82% even in Dafny and 27% in Lean; judging is +0.29 to +0.34 F1 better than
enumerating on the same model. Four different price-capability curves for four different jobs is the
signature of a portfolio, not a monolith.
SOURCE: artificialanalysis.ai model pages (accessed 2026-09-08); arxiv.org/abs/2509.22908;
arxiv.org/abs/2608.01000; artificialanalysis.ai/models/mercury-2
COUNTEREVIDENCE: Every previous "specialised models will win" prediction in this field has been
absorbed by a larger general model within about 18 months, and arXiv:2609.00468 measures exactly
that: "for between 37% and 63% papers, a newer model with a single prompt natively outperforms the
heavily engineered tooling proposed just a year prior". A portfolio architecture is precisely the
kind of engineered scaffold that gets absorbed.
OPEN QUESTION: Is the verification layer absorbable? It is the one component with a non-LLM
correctness guarantee, which is the argument that it is not.
```

---

## 8. Scenarios and value migration

| | **S1 — Continued collapse** | **S2 — Plateau at a floor** | **S3 — Supply / energy constrained** |
|---|---|---|---|
| **Assumption** | Price-at-capability keeps falling 10–100×/yr through 2030 | Price-at-capability falls to a hardware-plus-energy floor by ~2028, then tracks 1.49×/yr | Demand (~10×/yr) outruns capacity (3.4×/yr); token prices for large models rise |
| **2026 evidence for** | Cheapest blended $/M at index ≥ 35 fell $11.25 → $0.119 in four months (own computation); Epoch: rate of decline "ranging from 9x to 900x per year" across milestones | Chip price-performance only 1.49×/yr; NVIDIA 75.0% gross margin; local energy floor $0.17/M; Google repriced its flash tier *upward* | Epoch: "the price of tokens from large models will rise… a compute crunch is near, if not already here"; frontier price up 5–8× since gpt-5; hyperscaler capex overtakes CFO ~Q3 2026 ($185.7B vs $187.1B) |
| **2026 evidence against** | Frontier prices rose; capex exceeds cash flow; Epoch's own crunch conclusion | Chinese open labs kept breaking the floor (GLM-5.3-Flash at $0.075/M, Aug 2026) | Supply still arriving: NVIDIA guides $108B for Q3 FY2027 excluding China; ~$50B debt raised for Anthropic alone; 20+ GW planned through 2028 |
| **Where value migrates** | **Away from generation entirely.** If tokens are free, the scarce goods are knowing what to build (intent), knowing the domain constraints, having real-world evidence it works, and being accountable when it doesn't | **To the arbitrage layer and to owned context.** With a floor, routing, caching and context assets have durable value; whoever owns the cheapest correct route captures today's 8.8× spread | **To whoever needs the fewest tokens per correct outcome.** Specifications, constraints and verifiers become cost-reduction technology, not only quality technology. Frontier access becomes rationed; subscriptions tighten |
| **What a solo builder should own** | Intent capture, domain constraints, and the reality-feedback loop — none of which are token-priced | A model-agnostic routing and context layer; never a scaffold that patches a model deficit | Token efficiency: spec-first workflows that cut retries; local fallback for the work a 27B can do |
| **What gets destroyed** | Anything charging for generation volume | Anything assuming prices keep falling underneath it | Anything whose unit economics assume cheap frontier tokens |
| **Probability (my judgement, not sourced)** | 25% | 45% | 30% |

```
CLAIM: In all three scenarios value migrates to the same place - the parts of the pipeline that are
not token-priced: what the human wants, what constrains it, and whether reality still matches intent.
LABEL: REASONABLE EXTRAPOLATION
CONFIDENCE: medium
EVIDENCE: The three scenarios differ only in the price of generation. The evidence that the
non-generation parts stay scarce is independent of price: there is "no oracle for specification
correctness other than the user" (Lahiri, arXiv:2603.17150, open problem #4); models converge
unanimously on one wrong reading in over 10% of MBPP, 3% of HumanEval and 32% of LiveCodeBench
tasks, rising over 5x under injected underspecification (Richter and Papadakis, arXiv:2607.01953),
which no amount of cheap sampling detects; self-consistent errors "remain stable or even increase"
with scale (arXiv:2505.17656); and cheap generation has already produced a bottleneck relocation
rather than a throughput gain - +98% pull requests merged, +91% PR review time, +154% PR size, +9%
bugs across 10,000+ developers and 1,255 teams, with flat delivery, and a 19% slowdown in the most
rigorous RCT (Productivity-Reliability Paradox, arXiv:2605.01160). That paper also records the
economic half directly: "Token pricing collapsed dramatically: reduction exceeding 90% from GPT-4
launch (March 2023) through 2025, though agentic workflows consume significantly more tokens per
task than traditional AI use."
SOURCE: arxiv.org/html/2603.17150; arxiv.org/abs/2607.01953; arxiv.org/abs/2505.17656;
arxiv.org/html/2605.01160 - all accessed 2026-09-08
COUNTEREVIDENCE: These are all current model limitations, and arXiv:2609.00468 shows 37-63% of last
year's technique papers were made redundant by the next model with a plain prompt. If the same
happens to specification tooling, value migrates back to the model. The distinction that survives is
between tooling that works around a model deficit (absorbed) and tooling that supplies information
the model cannot have - the user's actual intent, the domain's real constraints, production
evidence. The paper's own finding is consistent with that: the surviving cohort "provide additional
insights to the model where newer LLMs will amplify the proposed technique."
OPEN QUESTION: Is intent capture information-supply or deficit-workaround? Judging-versus-enumerating
(F1 ~0.99 for predicates, 0.26-0.48 for enumeration) suggests the model can check intent but not
originate it, which is the argument that it is information-supply and therefore safe.
```

---

## 9. Contradictions with common belief

**C1. "Inference prices fall ~10× a year, so frontier intelligence will be near-free soon."**
False as stated. Price at *fixed capability* is collapsing — I measured 94.5× in four months at
Intelligence Index ≥ 35. Price of the *frontier* has risen: gpt-5 $1.25/$10 (Aug 2025) →
gpt-6-astra $10/$50 (Sep 2026); Google's flash tier is 2.5× its 2.5-generation input price. Two
different curves are being conflated by almost everyone who cites the first one. A builder planning
on frontier tokens getting cheaper is planning against the observed direction of travel.
*Sources: OpenAI, Google and Anthropic price pages, all accessed 2026-09-08; Epoch AI compute-crunch
analysis 2026-05-25.*

**C2. "Small models are the cheap option."**
False in the cloud. Running the identical AA Intelligence Index cost $1,170.48 on the dense 27B
Qwen3.8-27B and $280.28 on the 320B-total/18B-active GLM-5.3-Flash — the model 12× larger by
parameter count is 4.2× cheaper to run *and* 8 index points better. Serving cost tracks *active*
parameters and batch amortisation, not model size. NVIDIA's own SLM paper argues a 7B model is
"10–30× cheaper… than a 70–175bn LLM" in latency, energy and FLOPs — all true, and all irrelevant to
the price a cloud buyer pays. Small models are cheap only when you own the hardware.

**C3. "Open weights mean you can run it yourself."**
False for 20 of the 26 notable open-weight models released in 2026. The open frontier moved to
trillion-parameter MoEs: Kimi K3 at 2.8T (1,400 GB at 4-bit) and *non-commercially licensed*;
Qwen3.8-2.4T-A95B at 1,200 GB; DeepSeek V4 Pro at 800 GB. "Open" in 2026 means *many parties may
host it* — a supply-side property — not *you may run it*, a sovereignty property. Those were the
same thing in 2024 and are not now.

**C4. "The token price is what you pay."**
Retail prices are sticky and have not moved in four years. GitHub Copilot went generally available
on 2022-06-21 at "$10 USD/month or $100 USD/year"; Copilot Pro is $10/month on 2026-09-08, while the
model behind it went from Codex to Haiku 4.5 / GPT-5 mini class. Cursor Individual is $20/month;
Claude Pro $17–20/month. The consumer surplus from a 90%+ collapse in token prices went into more
capability per dollar, not fewer dollars — and into vendor margin. A solo builder pricing per token
is competing against incumbents pricing per seat who are not passing the decline through.

**C5. "Cheap tokens make software cheap."**
The one telemetry study at scale says otherwise: +98% pull requests merged, +91% review time, +154%
PR size, +9% bugs, flat delivery, across 10,000+ developers and 1,255 teams — and the most rigorous
RCT shows a 19% *slowdown* for experienced developers. Generation got cheap; review, integration and
correctness costs did not, and they moved onto the human. That is Jevons plus bottleneck relocation,
not a cost reduction.

**C6. "The open ecosystem is a Western hedge against closed labs."**
Of 26 notable open-weight models published in 2026, 17 (65%) are Chinese and 3 (12%) American — down
from 10 American in 2024. The cheap tier that the entire "inference is nearly free" thesis rests on
is supplied by GLM, DeepSeek, Qwen, Kimi, MiniMax, Tencent, Meituan and Xiaomi.

---

## 10. Problems nobody is talking about

**P1. Undeclared numerics is a lemons market with no conformance standard.**
Eight of 29 endpoints serving DeepSeek V4 Flash 0731 declare quantisation "unknown"; three serve fp4
and one bf16 at overlapping prices; OpenRouter's default routes by inverse square of price and
explicitly "does not enforce specific numeric precision requirements". arXiv:2609.00363 (2026-08-25)
shows tolerance-based conformance is structurally blind: with standard INT8 scales, CUTLASS and
Triton agree bitwise at 8/196 layers, and "four of the five faults are detected by no check". A
buyer cannot verify what they bought, and the obvious check does not work. There is no assay
certificate for a token. Every reproducibility, evaluation and regression claim in agentic software
is built on that sand.

**P2. Scaffolding depreciates at 37–63% per year and nobody amortises it.**
arXiv:2609.00468 (2026-08-31) evaluated 35 LLM-technique papers from ICSE 2026 and found "for
between 37% and 63% papers, a newer model with a single prompt natively outperforms the heavily
engineered tooling proposed just a year prior". No cost model in this field carries a depreciation
schedule for agent scaffolds. ACEM (arXiv:2608.02582, 2026-08-03) — the only agentic-SE cost model I
could locate — decomposes cost into LLM tokens, human-in-the-loop oversight and infrastructure, with
a Revision Factor for retries and a Context Factor for context growth, and ships with "symbolic
constants pending empirical calibration". As of September 2026 there is **no calibrated cost model
for agentic software engineering**, so a solo builder cannot compute payback on any scaffold.

**P3. The cheap tier's supply is geopolitically concentrated and the American share collapsed.**
65% of 2026's notable open-weight models are Chinese; the US count fell from 10 (2024) to 3 (2026).
One export-control change, one licence change, or one lab closing its weights removes the $0.075/M
tier. Kimi K3 — the largest 2026 open model — is already "Open weights (non-commercial)", so a
commercial solo builder cannot legally use the top of the open stack today.

**P4. Nobody prices time-to-first-token, and it is now measured in minutes.**
Claude Fable 5.1: 277.5 s TTFT. GPT-6 Astra: 322.5 s. GPT-5.6 Luna: 171.7 s. Against GLM-5.3-Flash
at 1.58 s and DeepSeek V4 Flash at 0.92 s. For an interactive agentic loop with a human in it, a
five-minute first token is not the same product at any price — yet no pricing page mentions latency
and no cost model includes the human's waiting time. Part of the frontier premium buys a *worse*
interaction.

**P5. Local inference has no economic case at the margin, only a sovereignty case — and the
sovereignty case is never costed.**
Local marginal cost is ~$0.17/M output tokens at US residential electricity, *above* the cheapest
cloud open-model output price ($0.16/M). Every "run it locally to save money" argument I could check
fails on arithmetic. What survives is privacy, offline operation, rate-limit immunity and the right
not to be repriced — real goods nobody puts a number on. The correct question is not "is local
cheaper" but "what is the option value of not being a tenant", and there is no literature on it.

**P6. Frontier labs now carry multi-year lease obligations that make price cuts structurally hard.**
Anthropic assembled ~$50B of debt against a $50B compute commitment — ~$35B for 1+ GW of TPU systems
and ~$15.2B across five datacentre sites (1.43 GW) — secured by five-year lease commitments and
vendor backstops from Broadcom (~$30B) and Google, through SPVs isolating risk. A firm with
five-year fixed obligations and 70%/yr capex growth against 23%/yr operating-cash-flow growth does
not cut the price of its highest-margin product. The "prices always fall" prior assumes variable-cost
sellers; the sellers are now fixed-cost sellers.

**P7. Nobody publishes throughput per GPU, so nobody outside the providers can compute the cost floor.**
Assumption A8 above is unsourceable. Provider marketing quotes tokens/second per *stream* (Groq's
450–1,000 t/s) and price per token, never aggregate tokens/second/GPU at a stated batch size. That
single number determines whether self-hosting ever makes sense, what the true margin on a token is,
and whether the compute crunch is real. Its absence is not an oversight; it is the market's main
information asymmetry.

---

## 11. What becomes commodity / what stays hard

### Commodity (price → marginal cost; no defensible position)

| Item | Label | Evidence |
|---|---|---|
| Sub-frontier token generation (AA index < 45) | OBSERVED TODAY | 29 sellers of one SKU, reference price $0.15/$0.50, author neither cheapest nor dearest |
| Code completion and single-file synthesis | OBSERVED TODAY | LiveCodeBench v6 90.3 on a 27B Apache-2.0 model; Copilot Free gives "2,000 completions per month" at $0 |
| Model hosting and serving infrastructure | OBSERVED TODAY | Together H100 $3.99/h; 14 providers converge on $0.150/$0.500 for identical weights |
| Agent scaffolds that patch model deficits | STRONG TREND | 37–63% of ICSE 2026 technique papers beaten by next model plus a plain prompt |
| Benchmark-shaped reasoning | STRONG TREND | AA index cost fell 47× for 79% of frontier capability within one product cycle |
| Raw output speed | OBSERVED TODAY | 925–1,275 tok/s available at $0.25/M; fully decoupled from capability (index 12) |
| Long context as a raw attribute | STRONG TREND | Epoch: context windows 30×/yr; 1M context standard across the cheap open tier |
| Distillation and quantisation know-how | STRONG TREND | Open labs reach ECI 155 at ~50× less training compute; GGUF quant repos appear within days of a release |

### Stays hard (scarce, not token-priced)

| Item | Label | Evidence |
|---|---|---|
| Knowing what the human actually wants | OBSERVED TODAY | "no oracle for specification correctness other than the user" (Lahiri 2026, open problem #4) |
| Detecting that every model read it the same wrong way | OBSERVED TODAY | Semantic collapse in >10% MBPP / 32% LiveCodeBench; invisible to disagreement-based detectors |
| Enumerating the acceptable set | OBSERVED TODAY | Judging F1 0.74–0.90 vs authored suites accepting only 19–42% of correct solutions |
| Errors that survive scale | OBSERVED TODAY | Self-consistent error frequency "remains stable or even increases" with scale |
| Formal verification beyond Dafny | OBSERVED TODAY | Vericoding: 82% Dafny, 44% Verus, **27% Lean**; NL descriptions did not help |
| Evidence that software works in reality | STRONG TREND | +98% PRs, +91% review time, flat delivery — generation scaled, evidence did not |
| Review capacity | OBSERVED TODAY | Same telemetry; review time is the measured bottleneck |
| Accountability | REASONABLE EXTRAPOLATION | No source found pricing it; it is the residual after everything derivable is derived |
| Energy and grid interconnect | STRONG TREND | 950 MW record doubling every 10 months; IEA: ~20% of planned projects at delay risk |
| Frontier-class capability itself | OBSERVED TODAY | Two sellers at index ≥ 51 ($10/$50 and $5/$25); no open substitute above 44.9 |
| Trust in numerics | OBSERVED TODAY | Quantisation undeclared and unenforced; tolerance checks structurally blind |
| Memory bandwidth | STRONG TREND | 1.28×/yr since 2008, doubling every 2.8 years — the slowest curve in the stack |

---

## 12. Open questions for the second wave

1. **Token volume per subscription.** What do Claude Pro, Claude Max, Cursor and Copilot actually
   deliver in tokens before limits bind? This number decides the entire solo-developer TCO and no
   vendor publishes it. Measurable empirically in a day.
2. **Cross-provider capability variance for identical weights.** Run one agentic coding benchmark
   against fp4, fp8 and bf16 endpoints of the same open model. Establishes or dissolves the lemons
   claim in §6. Nobody has done it.
3. **Tokens/second/GPU at production batch size for a 2026 MoE.** Every cloud-vs-self-host and
   cloud-vs-local number in §5 rests on it, and it is unpublished by every provider.
4. **Independent, local, quantised evaluation of Qwen3.8-27B.** Every figure for the best local
   coding model is vendor-reported at unstated effort, measured against a cloud fp8 endpoint, or both.
5. **Is the compute crunch real?** Epoch's May 2026 conclusion (prices will rise) is directly
   contradicted by August 2026 launch prices at the cheap tier. Provider utilisation data would settle it.
6. **Capability-versus-quantisation curves for trillion-parameter MoEs.** Determines whether the 2026
   open frontier ever becomes locally runnable, or whether openness and locality stay divorced.
7. **Depreciation schedule for specification and intent tooling specifically.** arXiv:2609.00468
   measured 37–63%/yr for generic LLM techniques. Nobody has separated tools that *supply
   information* from tools that *patch deficits* — the distinction on which the whole
   intent-formalisation thesis rests.
8. **Cost per verified outcome, not cost per token.** ACEM proposes the decomposition and ships
   uncalibrated. A calibrated model — tokens + retries + context growth + human oversight per
   *accepted, deployed, still-correct* change — does not exist and is the number a solo builder needs.
9. **The option value of not being a tenant.** Local loses on price and wins on sovereignty. Nobody
   has priced the sovereignty.
10. **Does the 2026 open-weight supply survive a geopolitical shock?** 65% of notable 2026 open
    models are Chinese and the US share fell from 10 to 3. What is the fallback if the $0.075/M tier
    disappears? Both lane 06's free-tier work and this lane's price work would need re-running.
11. **Where exactly is the commodity boundary, and does it move?** I place it at AA Intelligence
    Index ≈ 45 in September 2026. Tracking that boundary quarterly is the single most decision-relevant
    time series for a bootstrapped builder, and nobody publishes it.
12. **The frontier price direction.** Two more product cycles will show whether gpt-5 → gpt-6-astra
    (8× input) was a capability-mix artefact or the start of a durable re-inflation at the top.

---

*Lane 09 ends. Sources: `research/sources/09-economics.md`.*
