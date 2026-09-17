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

---

## Second wave (2026-09-14)

Second-wave question: **what does it cost, in compute/storage/hardware terms, to give a coding agent
multi-year project memory and retrieval, and does that cost scale in a way compatible with a
local-first, cheap-hardware product?**

Work performed 2026-09-14 → 2026-09-15. Cutoff for external sources: 2026-09-15 (all fetch dates
recorded per source). Nothing below is recalled from model memory.

**Method note for this wave.** Published cost data for agent long-horizon memory barely exists: the
memory-systems literature reports *accuracy* and sometimes *token counts*, almost never bytes, RAM or
wall-clock on commodity hardware. So this wave is mostly **own measurement**, in two forms:

1. **A real running agent's memory store.** `~/.shelra/shelra.db` on this machine — 160 sessions, 864
   messages, 420 tool calls, 253 model calls accumulated 2026-09-06 → 2026-09-14 — read read-only and
   aggregated. Only counts and byte lengths are reported; no content.
2. **A synthetic scaling benchmark** at 10K / 100K / 1M memory items, run 2026-09-15 on this machine
   (AMD Ryzen 5 4600H, 6 cores / 12 threads, 31.4 GB RAM, NVMe, Windows 11) using Node 24.20.0's
   `node:sqlite` (SQLite **3.53.4**, FTS5 and rtree compiled in) and pure-JS vector scans. Scripts and
   raw JSON: `%TEMP%/claude/.../scratchpad/{memcost.mjs, memcost2.mjs, memcost3.mjs, veccost.mjs}` and
   `bench/{fts-results.json, fts2-results.json, vecdisk-results.json, vec-results.json}`.

The Ryzen 5 4600H is a 2020 mid-range mobile CPU — a fair proxy for the "cheap computer" profile on
CPU, but it has 31.4 GB of RAM, well above the 8–16 GB floor the product targets. Every RAM-limited
conclusion below is therefore stated against an **assumed** 8 GB budget, not against this machine.

Cross-lane: lane 13 owns retrieval *method* and *accuracy*; lane 11 owns the memory *taxonomy*; lane
12 owns harness durability; lane 06 owns the free-tier matrix. This section owns only the **money,
bytes, RAM and milliseconds**. Where lane 13's numbers are used they are cited as lane 13's.

---

### S1. Summary (10 lines)

1. At the scale the brief cares about — hundreds to thousands of items, months to years — long-horizon
   memory is **not a storage problem at all**: 10,000 items measured at **12.75 MB** on disk with a
   full-text index, queried in **0.64 ms**, at a constant **~50 MB RSS**.
2. In a real running agent, memory *maintenance* (session recaps + titles) consumed **237,534 of
   20,060,886 input tokens = 1.18%**; recaps alone **0.18%**. 130 of those 157 calls (83%) ran on a
   local 1.5B model or a free endpoint, at **$0**.
3. The dominant cost is not storage, indexing or consolidation — it is **re-sending context**. The same
   agent averaged **169,338 input tokens per main-loop call** against **440 per recap call**: 385×.
4. Storage cost is ~6 orders of magnitude below the cost of *showing* the stored content to a model. A
   10K-item store costs ~$0.0004 of SSD; one year of 10K-token context packs at Opus 5 input prices
   costs ~$1,037.
5. Measured scaling of SQLite + FTS5 is **exactly linear**: 1,275 → 1,289 → 1,268 bytes/item at 10K /
   100K / 1M, FTS index a flat **22.5%** of content, RSS flat at 50→58 MB. Disk never becomes the cliff.
6. The cliff is **RAM residency and scan latency of dense vectors**, not text. 1M × 768-d float32 =
   **3.07 GB** and **880 ms** per brute-force query in RAM; the same scan **from disk** takes
   **4,552 ms**. Disk-resident brute-force vector search crosses 100 ms at roughly **21,000 items**.
7. Second cliff: **query shape, not corpus size**. At 1M items a rare-term FTS query costs **0.02 ms**
   and a common-term one costs **839.55 ms** — a 42,000× spread on the same index.
8. Escapes are cheap and measured: binary quantisation cuts vector RAM **32×** and scan time **6.7×**;
   Matryoshka-256 cuts both ~3×; lexical-top-200-then-rerank costs **71.9 ms at 1M** against 880 ms for
   a full float32 scan, and needs only 614 KB of vectors resident at query time.
9. Embedding *inference* is not the constraint either: 1M items ≈ 200M tokens ≈ **$4.00** on OpenAI
   `text-embedding-3-small`, **$0** inside Voyage's 200M free-token allowance or Gemini's free tier.
   The constraint is that re-indexing costs **22 s** for FTS5 and ~**3.3 hours** for local embeddings.
10. Verdict: viable — but the headroom is not uniform. At a projected three-year distilled store
    (~10,500 items) it ranges from **19,000× on disk** down to **2.0× on the one naive mechanism**
    (brute-force vector scan streamed from disk), which a ten-year store actually crosses. The
    architecture choice, not the hardware, is what decides it.

---

### S2. The measured baseline — what a real agent actually accumulates

All figures read from `~/.shelra/shelra.db` (WAL mode, page size 4,096) on 2026-09-14/15. File size
**9,555,968 B** plus a **329,632 B** WAL. Window 2026-09-06T17:19Z → 2026-09-14T21:11Z.

| Object | Rows | Bytes on disk (dbstat) | Payload bytes | Mean payload/row |
|---|---:|---:|---:|---:|
| `messages` | 864 | 4,653,056 | 4,287,106 | **4,961** |
| `tool_results` | 420 | 1,986,560 | 1,804,240 | **4,295** |
| `tool_calls` | 420 | 1,236,992 | 1,097,017 | **2,611** |
| `objectives` | 65 | 593,920 | 552,031 (`request`) | 8,493 |
| `checkpoints` (file snapshots) | 143 | 266,240 | 224,210 | 11,210 |
| `sessions` | 160 | 57,344 | — | 358 |
| `sessions.recap_text` (distilled) | 47 | — | 12,712 | **270** |
| `usage_events` | 253 | 28,672 | — | — |
| **Whole database** | — | **9,617,408** (2,348 × 4,096 pages) | — | **60,109 / session** |

Model-call ledger, same database, `usage_events` grouped by `source`:

| Source | Calls | Input tokens | Output tokens | Mean input/call | Recorded cost |
|---|---:|---:|---:|---:|---:|
| `message` (main agent loop) | 92 | 15,579,087 | 452,946 | **169,338** | $0.000002 |
| `task` (sub-agent) | 4 | 4,244,265 | 64,540 | 1,061,066 | $0.000003 |
| `title` | 74 | 201,030 | 3,974 | 2,717 | $0.026608 |
| `recap` (session consolidation) | 83 | 36,504 | 7,495 | **440** | $0.008786 |
| **Total** | **253** | **20,060,886** | **528,955** | 79,292 | **$0.035399** |

```
CLAIM: In a real coding agent, the memory-maintenance calls (session consolidation and titling) cost
1.18% of total input tokens - and 0.18% for consolidation alone - while the main agent loop's context
re-sends cost 98.8%. Long-horizon memory is not expensive; looking at it is.
LABEL: OBSERVED TODAY
CONFIDENCE: high for this system, medium for generality (n = 1 agent, 1 user, 9 days)
EVIDENCE: Own aggregation over ~/.shelra/shelra.db `usage_events`, 253 calls logged 2026-09-06 to
2026-09-14, read read-only 2026-09-15. recap: 83 calls, 36,504 input / 7,495 output tokens. title: 74
calls, 201,030 / 3,974. message: 92 calls, 15,579,087 / 452,946. task: 4 calls, 4,244,265 / 64,540.
(36,504 + 201,030) / 20,060,886 = 1.184%; 36,504 / 20,060,886 = 0.182%. Mean input per main-loop call
169,338 tokens vs 440 per recap call = 385x. Distilled output is small: 47 stored recaps totalling
12,712 bytes, mean 270 bytes, against a mean message of 4,961 bytes - 18x compression per record and
222x per session (60,109 bytes of session transcript to a 270-byte recap).
SOURCE: own measurement, ~/.shelra/shelra.db, node:sqlite (SQLite 3.53.4) - 2026-09-15
COUNTEREVIDENCE: this agent compacts rarely - the `compactions` table has zero rows - so its recap is
a cheap end-of-session summary over an already-short session (mean 11 messages), not the
150,000-token compaction Anthropic documents. Anthropic's own compaction example bills 180,000 input
+ 3,500 output tokens for ONE consolidation event (see S6): 409x the input of a shelra recap. The
1.18% figure is therefore a property of *what* you consolidate, not a law. A system that summarises
raw transcript instead of distilled records lands on the other number.
OPEN QUESTION: what is the maintenance share for an agent that runs multi-hour sessions and hits the
150K compaction trigger several times a day? Measurable in a week of instrumented use.
```

**Projection to a multi-year store** (LABEL: REASONABLE EXTRAPOLATION — arithmetic over the measured
rates, no new evidence). At the measured 20 sessions/day × 250 working days = 5,000 sessions/year:

| Horizon | Raw transcript store | Distilled records | Distilled item count |
|---|---:|---:|---:|
| 1 year | 5,000 × 60,109 B = **301 MB** | 5,000 × 270 B = **1.35 MB** | ~3,500 |
| 3 years | **902 MB** | **4.1 MB** | ~10,500 |
| 10 years | **3.0 GB** | **13.5 MB** | ~35,000 |

The brief's "hundreds to thousands of stored items" is therefore **about one year** of real solo use
on this measured rate, and the ten-year distilled store is **13.5 MB**.

---

### S3. Storage and index cost at scale — measured

Synthetic corpus of memory items with a Zipf term distribution over a 4,000-word code-review
vocabulary, sized to the measured mix (55% at 300 B "episodic event" scale — the measured mean git
commit message in this repo is 369 B, 64,567 B over 175 commits; 30% at 900 B; 15% at 2,000 B), mean
**788 B** of raw text per item. SQLite table + external-content FTS5 (`tokenize='porter unicode61'`,
default `detail=full`). Run 2026-09-15.

| N items | Raw text | Table on disk | FTS5 index | **Total** | **B/item** | Insert | FTS build | RSS |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10,000 | 7.87 MB | 10.40 MB | 2.36 MB | **12.75 MB** | **1,275** | 0.21 s | 0.11 s | 49.8 MB |
| 100,000 | 78.8 MB | 103.7 MB | 25.2 MB | **128.9 MB** | **1,289** | 1.80 s | 2.03 s | 51.7 MB |
| 1,000,000 | 788 MB | 1,035 MB | 232.6 MB | **1,268 MB** | **1,268** | 16.95 s | 21.57 s | 58.3 MB |

Retrieval latency, top-20 by BM25, 30 runs per shape, warm cache:

| Query shape | 10K | 100K | 1M | Scaling |
|---|---:|---:|---:|---|
| rare term (1 doc in ~10⁴) | **0.01 ms** | **0.02 ms** | **0.02 ms** | flat |
| phrase `"a b"` | 0.31 | 2.76 | 29.65 | linear |
| `a AND b AND c` | 0.64 | 5.51 | **72.63** | linear |
| `a OR b OR c` | 5.39 | 55.75 | **614.62** | linear |
| prefix `refa*` | 6.11 | 61.49 | **669.61** | linear |
| common term (top of Zipf) | 7.24 | 78.38 | **839.55** | linear |
| **naive `LIKE '%term%'` scan** | 2 / 29 (p50/max) | 2 / 302 | 2 / **2,919** | linear |
| **context pack: top-20 + bodies** | 0.86 | 15.36 | **149.42** | linear |
| **hybrid: FTS top-200 → 768-d rerank** | 1.01 | 6.00 | **71.90** | linear |
| **incremental write (1 item + FTS, own txn)** | 2.70 | 2.77 | 0.78 | **flat** |
| point read by id | 0.013 | 0.012 | 0.014 | **flat** |

Context-pack payload was **37.9 KB / 36.8 KB / 40.1 KB** at the three tiers — ≈ **9,200–10,000 tokens**
at 4 bytes/token for a top-20 pack, independent of corpus size.

```
CLAIM: SQLite + FTS5 storage for project memory is exactly linear at ~1,270 bytes per ~790-byte item,
the full-text index costs a flat 22.5% of content, and resident memory stays at 50-58 MB whether the
store holds ten thousand items or a million - so disk and RAM never become the constraint for a
local-first memory system at any project-sized scale.
LABEL: OBSERVED TODAY (own measurement)
CONFIDENCE: high
EVIDENCE: Table above. Bytes/item 1,275 / 1,289 / 1,268 across a 100x range of N. FTS index /
content = 2.36/10.40 = 22.7%, 25.2/103.7 = 24.3%, 232.6/1,035 = 22.5%. RSS 49.8 / 51.7 / 58.3 MB -
SQLite memory-maps and streams rather than resident-loading. SQLite's own FTS5 documentation reports a
comparable but larger overhead on natural text: "In one test that indexed a large set of emails
(1636 MiB on disk), the FTS index was 743 MiB on disk with detail=full, 340 MiB with detail=column
and 134 MiB with detail=none" - 45%, 21% and 8%. The 22.5% measured here sits inside that range and
can be pushed to ~8% with detail=none if phrase queries are not needed.
SOURCE: own benchmark 2026-09-15 (memcost.mjs, node:sqlite / SQLite 3.53.4, Ryzen 5 4600H);
sqlite.org/fts5.html - SQLite documentation - accessed 2026-09-15
COUNTEREVIDENCE: the synthetic corpus is Zipf-sampled from a 4,000-token vocabulary, so it has far
more term repetition than real prose or code - which is exactly why the index is 22.5% here and 45%
in SQLite's own email test. Real project memory (identifiers, stack traces, hashes, paths) has a much
larger vocabulary and will index closer to 45%, i.e. a 1M-item store is ~1.6 GB, not 1.27 GB. That
does not change the conclusion; it changes the constant by 1.3x. Also measured: this excludes file
snapshots. The real store's `checkpoints` rows average 11,210 B - 14x an average memory item - so a
system that snapshots file contents on every edit grows on a different curve than one that stores
records.
OPEN QUESTION: what is the FTS5 index ratio over real agent transcripts rather than synthetic text?
One `insert into fts select from messages` over a production store would settle it in minutes.
```

```
CLAIM: For lexical project memory the cost cliff is the shape of the query, not the size of the
corpus: at one million items a selective query costs 0.02 ms and an unselective one costs 839.55 ms -
a 42,000x spread on the same index, and the unselective query is the one a vague human question
produces.
LABEL: OBSERVED TODAY (own measurement)
CONFIDENCE: high
EVIDENCE: Table above, 30 runs per shape, warm page cache. At N = 1,000,000: rare term 0.02 ms p50;
phrase 29.65; AND-of-3 72.63; OR-of-3 614.62; prefix 669.61; common term 839.55. The rare-term cost is
FLAT across 10K -> 1M (0.01 -> 0.02 ms) because FTS5 reads one short posting list; the common-term
cost is linear in N because it reads a posting list proportional to the corpus. The naive
`LIKE '%term%'` baseline - "just grep everything" - hits 2,919 ms worst case at 1M.
SOURCE: own benchmark 2026-09-15 (memcost2.mjs)
COUNTEREVIDENCE: the "common term" here is the top of a Zipf distribution over 4,000 words, appearing
in a large fraction of all documents - harsher than most real queries. And every one of these numbers
is under an interactive threshold at 100K items (78 ms worst case), which is ten years of the
measured distilled-item rate. The cliff is real but it sits an order of magnitude beyond the product's
target scale. Mitigation is also trivial and measured: top-200 candidate generation with an AND query
plus reranking costs 71.9 ms at 1M.
OPEN QUESTION: what fraction of real "what did we decide about X" queries are selective? Nobody has
published a query-shape distribution for agent memory retrieval; it determines whether this cliff is
ever reached.
```

---

### S4. Vector and embedding cost — where the money and the RAM actually go

#### S4a. Own measurement: brute-force scan, in RAM and from disk

768 dimensions (EmbeddingGemma's native width) and 256 (its Matryoshka option). Pure scalar JS — no
SIMD, no BLAS; a C/AVX implementation would be several times faster, so treat these as an **upper
bound on time and an exact figure on bytes**.

| N | Precision | Bytes | Scan, resident in RAM | Scan, streamed from SQLite blobs |
|---:|---|---:|---:|---:|
| 10,000 | f32 768-d | 30.7 MB | 8.71 ms | — |
| 100,000 | f32 768-d | 307 MB | 87.17 ms | — |
| 1,000,000 | f32 768-d | **3.07 GB** | **880.59 ms** | — |
| 10,000 | int8 768-d | 7.68 MB | 9.46 ms | — |
| 100,000 | int8 768-d | 76.8 MB | 94.82 ms | **477 ms** |
| 1,000,000 | int8 768-d | 768 MB | 961.77 ms | **4,552 ms** |
| 10,000 | binary 768-bit | 0.96 MB | **0.89 ms** | — |
| 100,000 | binary 768-bit | 9.6 MB | **14.39 ms** | **306 ms** |
| 1,000,000 | binary 768-bit | 96 MB | **131.99 ms** | **2,981 ms** |
| 1,000,000 | f32 256-d | 1.02 GB | 301.04 ms | — |

Disk-resident rows measured at **1,026.6 B/row** (int8 768-d + binary 768-bit blobs + rowid in
SQLite), RSS while scanning **62–90 MB**.

#### S4b. Published sizing, for corroboration

Qdrant's capacity-planning documentation (accessed 2026-09-15) gives explicit formulas:

```
dense_size  = points × dimensions × bytes_per_dim      (f32 4, f16 2, uint8 1, turbo4 0.5)
hnsw_size   = points × m × 2 × 4 bytes × 1.2           (m = 16 default)
id_tracker  = points × 52 bytes
payload     = points × avg_payload × 1.5 (disk); × 3 more if cached in RAM
payload_idx ≈ 2 × indexed_payload
then + 20% headroom
```

Their worked example — 1M points, replication 2, 768-d float32, HNSW cached, payload cold —
is **RAM ≈ 7.33 GB, disk ≈ 10.76 GB**. At replication 1 that is **3.67 GB of RAM for 1M vectors**,
which matches my measured 3.07 GB of raw float32 plus their 0.147 GB HNSW graph, 0.052 GB id tracker
and 20% headroom, to within a few percent.

#### S4c. Embedding inference price, per document and per store

Assumption: a memory item averages ~200 tokens (my measured mean item is 788 B ≈ 197 tokens).

| Provider / model | $/M tokens | Free allowance | 10K items (2M tok) | 1M items (200M tok) | Fetched |
|---|---:|---|---:|---:|---|
| OpenAI `text-embedding-3-small` | **0.02** | — | $0.04 | **$4.00** | 2026-09-15 |
| OpenAI `text-embedding-3-large` | 0.13 | — | $0.26 | $26.00 | 2026-09-15 |
| OpenAI `text-embedding-ada-002` | 0.10 | — | $0.20 | $20.00 | 2026-09-15 |
| Google **Gemini Embedding 2** (paid) | 0.20 | free tier "Free of charge" | $0.40 | $40.00 | 2026-09-15 |
| Google Gemini Embedding 2 (batch) | 0.10 | — | $0.20 | $20.00 | 2026-09-15 |
| Voyage `voyage-4-lite` | 0.02 | **200M tokens free** | **$0** | **$0** (first 200M) | 2026-08-26 page |
| Voyage `voyage-code-4` | 0.12 | **200M tokens free** | **$0** | **$0** (first 200M) | 2026-08-26 page |
| Voyage `rerank-3-lite` | 0.02 | 200M tokens free | $0 | $0 | 2026-08-26 page |
| Local **EmbeddingGemma-300m** | electricity | — | ~$0 | ~$0 | model card 2025-09-04 |

```
CLAIM: Embedding inference is not the cost of a long-horizon memory system at any project-relevant
scale. Embedding a million memory items costs $4.00 on OpenAI's cheapest model and $0 inside Voyage's
standing 200-million-token free allowance or Google's free tier. The real embedding cost is the
RAM the resulting index occupies and the hours a re-index takes, not the dollars.
LABEL: OBSERVED TODAY (prices) / REASONABLE EXTRAPOLATION (the 200-token mean item)
CONFIDENCE: high on prices, medium on the token-per-item constant
EVIDENCE: developers.openai.com/api/docs/pricing lists text-embedding-3-small $0.02/M,
text-embedding-3-large $0.13/M, ada-002 $0.10/M (accessed 2026-09-15). ai.google.dev pricing lists
Gemini Embedding 2 text input at $0.20/M standard, $0.10/M batch, "Free of charge" on the free tier
(accessed 2026-09-15). docs.voyageai.com/docs/pricing (page dated 2026-08-26, accessed 2026-09-15)
lists voyage-4-lite $0.02/M and voyage-code-4 $0.12/M, each with "200M" free tokens, and a "33%
discount" batch API. 1M items x 200 tokens = 200M tokens, i.e. exactly Voyage's free allowance.
Against that: my measured float32 768-d index for 1M items is 3.07 GB resident and Qdrant's own
formula plans 3.67 GB for the same at replication 1 - on an 8 GB laptop that is the whole budget.
SOURCE: OpenAI, Google and Voyage pricing pages - accessed 2026-09-15; qdrant.tech capacity-planning
docs - accessed 2026-09-15; own benchmark 2026-09-15
COUNTEREVIDENCE: the free allowances are one-off, not recurring - Voyage's 200M is a lifetime grant
per the pricing page, so a store that re-embeds on every schema or model change pays list price from
the second pass. And embedding is not a one-time cost if the memory churns: a corpus where 20% of
items are rewritten per year re-pays 20% of the bill annually. Finally, my 200-token mean comes from
my own synthetic sizing and the measured 788-byte item; a system that embeds raw 4,961-byte messages
pays 6x more.
OPEN QUESTION: does anyone publish a measured tokens-per-memory-item distribution for a real coding
agent? Every cost estimate in this space, including mine, rests on an assumed constant.
```

```
CLAIM: Dense float32 embeddings over raw transcript produce an index LARGER than the text it indexes -
1.50x - which is the single most expensive design choice available in a local-first memory system,
and quantisation removes the problem entirely at 0.047x.
LABEL: OBSERVED TODAY (the byte arithmetic is measured; the chunking constant is stated)
CONFIDENCE: high
EVIDENCE: A 512-token chunk is ~2,048 bytes of text at the 4 bytes/token ratio measured across this
corpus. Its vector costs: 768-d float32 = 3,072 B = 1.50x the chunk; 256-d float32 (Matryoshka) =
1,024 B = 0.50x; 768-d int8 = 768 B = 0.375x; 768-bit binary = 96 B = 0.047x. Measured scan cost
follows the same ordering but not proportionally: at 1M vectors, f32 768-d 880.59 ms, int8 768-d
961.77 ms (no SIMD int8 path in scalar JS, so int8 buys bytes but not time here), binary 131.99 ms
(6.7x faster than f32), f32 256-d 301.04 ms (2.9x faster). Binary therefore buys 32x the RAM and 6.7x
the time simultaneously.
SOURCE: own benchmark 2026-09-15 (veccost.mjs); EmbeddingGemma model card - Google - 2025-09-04 -
huggingface.co/google/embeddinggemma-300m - accessed 2026-09-15 (768 dims, "smaller options available
(512, 256, or 128)")
COUNTEREVIDENCE: binary and int8 quantisation cost recall, and I did not measure recall - only bytes
and milliseconds. Qdrant's own documentation warns "Some embedding models don't quantize efficiently,
so verify recall against unquantized results." No source found publishes a recall-vs-quantisation
curve for a project-memory corpus specifically, so the 32x saving is a capacity claim, not a quality
claim. The int8 result also shows a trap: in a scalar interpreter, int8 is SLOWER than float32
(961.77 vs 880.59 ms) because the win requires SIMD the runtime does not emit.
OPEN QUESTION: what is recall@10 for binary-quantised EmbeddingGemma vectors over a decision/episodic
corpus, versus float32? That one experiment decides whether the 32x escape is free or paid for.
```

#### S4d. Local embedding: the wall-clock, not the money

EmbeddingGemma-300m (Google, published 2025-09-04): "308 million total parameters", "sub-200MB of RAM"
with quantisation-aware training, "<15ms embedding inference time (256 input tokens) on EdgeTPU", 768
dims with 128/256/512 Matryoshka truncation, 2K context, MTEB v2 English mean task 69.67 / code 68.76.

At the EdgeTPU rate that is 17,067 tokens/s, so embedding 1M items (200M tokens) takes **3.26 hours**
(LABEL: REASONABLE EXTRAPOLATION — vendor accelerator figure, not a laptop CPU measurement; a CPU-only
laptop will be materially slower and no primary measurement was found). Against that, rebuilding the
**FTS5 index over the same 1M items took a measured 21.57 seconds.**

```
CLAIM: The asymmetry that decides local-first memory architecture is not price but re-index time:
rebuilding a lexical index over a million memory items took 21.57 seconds on a 2020 laptop CPU;
re-embedding the same corpus locally takes hours even at accelerator throughput - roughly 545x.
LABEL: OBSERVED TODAY (the 21.57 s) / REASONABLE EXTRAPOLATION (the 3.26 h)
CONFIDENCE: high on the lexical side, low on the local-embedding side
EVIDENCE: Own benchmark: `insert into items_fts(items_fts) values('rebuild')` over 1,000,000 rows
completed in 21,572 ms (0.11 s at 10K, 2.03 s at 100K - linear). EmbeddingGemma's own card states
"<15ms embedding inference time (256 input tokens) on EdgeTPU" = 17,067 tok/s; 200M tokens / 17,067 =
11,719 s = 3.26 h. Ratio 11,719 / 21.57 = 543x.
SOURCE: own benchmark 2026-09-15; developers.googleblog.com/en/introducing-embeddinggemma (2025-09-04)
- accessed 2026-09-15
COUNTEREVIDENCE: you rarely re-embed everything. Incremental embedding of new items only is trivially
cheap - at the measured 3,500 distilled items/year, a full year's embedding is 700K tokens, about 41
seconds at the EdgeTPU rate. The 3.26 hours is the cost of *changing your embedding model*, which
happens perhaps yearly - and lane 09's first wave measured model turnover far faster than that
(the frontier repriced and re-released roughly quarterly through 2026). So the honest framing is: a
lexical index survives a model change for free; a vector index pays a multi-hour tax each time.
OPEN QUESTION: a measured tokens/second for EmbeddingGemma-300m on a CPU-only 8 GB laptop. Every
local-embedding cost estimate in this space, including mine, extrapolates from an accelerator number.
```

---

### S5. Retrieval cost per task — the number that dominates everything else

The measured context pack (top-20 items with bodies) is **9,200–10,000 tokens**, effectively
independent of corpus size, and takes **0.86 / 15.36 / 149.42 ms** to assemble at 10K / 100K / 1M.
Assembly is free. Delivery is not.

Per-call cost of a 10,000-token memory pack, at first-wave list prices (all accessed 2026-09-08 in §2):

| Route | $/M input | One pack | 20,750 packs/yr (83 calls/day × 250) |
|---|---:|---:|---:|
| Claude Fable 5.1 | 10.00 | $0.100 | $2,075 |
| Claude Opus 5 | 5.00 | $0.050 | **$1,037** |
| Claude Sonnet 5 | 2.00 | $0.020 | $415 |
| Opus 5, cache read | 0.50 | $0.005 | $104 |
| GPT-5.6 Luna | 0.20 | $0.002 | $41.50 |
| GLM-5.3-Flash (Z.AI) | 0.075 | $0.00075 | **$15.56** |
| DeepSeek V4 Flash 0731 (cheapest OR host) | 0.050 | $0.0005 | $10.38 |
| Local (energy, prefill at measured llama.cpp rates) | — | ~$0.0001 | ~$2 |
| **Storing the same 10,000 items** | — | — | **12.75 MB ≈ $0.0004 of SSD** |

```
CLAIM: At the scale this brief cares about, the storage cost of long-horizon memory is about six
orders of magnitude below the recurring cost of putting the retrieved content into a model's context.
Any memory design that trades bytes for tokens is optimising the wrong variable by a factor of a
million.
LABEL: OBSERVED TODAY (inputs) / REASONABLE EXTRAPOLATION (the annual projection)
CONFIDENCE: medium-high
EVIDENCE: Measured: a 10,000-item store with a full-text index occupies 12,750,848 bytes. At a
consumer SSD price of roughly $0.03/GB (ASSUMPTION - no primary source obtained; first-wave §4a
recorded that consumer hardware prices were NOT FOUND on primary pages) that is $0.0004. Measured: a
top-20 context pack is 37,938-40,140 bytes ~= 9,485-10,035 tokens. At Opus 5's $5.00/M input and the
measured real-agent rate of 83 model calls/day x 250 days, that same content costs $1,037/year to
deliver. 1,037 / 0.0004 = 2.6 million. Even against the cheapest open tier ($0.05/M) the ratio is
26,000x. And the measured real agent sends far more than a pack: 169,338 input tokens per main-loop
call.
SOURCE: own measurements 2026-09-15; price table in §2 of this report (all accessed 2026-09-08)
COUNTEREVIDENCE: caching collapses the gap - Anthropic's cache read is 0.1x base input price (0.025x
on Fable-series), so a stable memory prefix costs $104/year on Opus 5 rather than $1,037. Lane 13
documents the catch: the cache is an exact-prefix match at a declared breakpoint, so a pack that
reassembles a different subset every call never shares a prefix and pays cache-WRITE prices (1.25-2x)
instead. The dollar gap is therefore a function of pack stability, not of storage. Separately: the
whole comparison assumes you pay per token. On a free tier or a fixed-price subscription - which is
what the measured agent actually used, $0.0354 total for 20.06M input tokens - the token cost is zero
and the storage cost is still $0.0004, so the ratio is undefined and the argument evaporates.
OPEN QUESTION: what is the achievable cache-hit rate for a memory pack that must change per task?
Lane 13 flags it as unmeasured by anyone; it is worth ~10x on this line item.
```

---

### S6. Does consolidation become a meaningful recurring cost?

Two very different measured answers, and the difference is the design.

**(a) Consolidating distilled records — measured, effectively free.** The real agent's `recap` calls:
83 calls, **440 input / 90 output tokens each**, 0.18% of total token spend, and **130 of the 157
recap+title calls (83%) ran on a local `qwen2.5-coder-1.5b-instruct-q4_k_m.gguf` or a free endpoint,
at $0.00**.

**(b) Consolidating raw transcript — documented, not free.** Anthropic's compaction documentation
(accessed 2026-09-15) shows a worked usage response in which one compaction iteration bills
**180,000 input + 3,500 output tokens** before the 23,000-input main message, and states
"Compaction requires an additional sampling step, which contributes to rate limits and billing" and
"To calculate total tokens consumed and billed for a request, sum across all entries in the
`usage.iterations` array." Default trigger `input_tokens` = **150,000**, minimum **50,000**. Beta
header `compact-2026-01-12`; supported on the Fable/Mythos/Opus/Sonnet 5-series.

Cost of one such compaction, at §2 list prices:

| Model | $/M in | $/M out | One compaction | 583/yr (measured rate: ~7 per 3 heavy days) |
|---|---:|---:|---:|---:|
| Claude Fable 5.1 | 10.00 | 50.00 | $1.975 | $1,151 |
| Claude Opus 5 | 5.00 | 25.00 | **$0.988** | **$576** |
| Claude Sonnet 5 | 2.00 | 10.00 | $0.395 | $230 |
| Claude Haiku 4.5 | 1.00 | 5.00 | $0.198 | $115 |
| GPT-5.6 Luna | 0.20 | 1.20 | $0.040 | $23 |
| GLM-5.3-Flash | 0.075 | 0.25 | **$0.0144** | **$8.38** |
| Gemini free tier | 0 | 0 | **$0** (rate limits bind — lane 06) | $0 |
| Local, 120B MoE on DGX-Spark-class hw | — | — | ~$0.0015 electricity, **150 s wall clock** | ~$0.89 |

Local wall-clock is computed from first-wave §4b measured llama.cpp figures: prompt processing
1,956 t/s and generation 60.57 t/s for GPT-OSS-120B MXFP4 on a GB10, giving 92 s prefill + 58 s decode
= **150 s per compaction**. At 583 compactions/year that is **24 hours/year of a local box at full
load** — and on a cheap CPU-only laptop, materially more.

```
CLAIM: Periodic memory consolidation does not become a meaningful recurring cost if you consolidate
distilled records, and does become one if you consolidate raw transcript - a 409x difference in input
tokens per event, measured on one side and documented by the vendor on the other.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Measured: shelra's recap calls average 440 input / 90 output tokens (83 calls, 36,504 /
7,495 tokens total) and produce 270-byte records. Documented: Anthropic's compaction usage example
bills 180,000 input + 3,500 output tokens for one consolidation event, with a default trigger at
150,000 input tokens. 180,000 / 440 = 409x. At Opus 5 list prices one documented compaction costs
$0.988 and one measured recap costs $0.00243. 83% of the measured agent's memory-maintenance calls
ran on a local 1.5B model or a free endpoint at $0.00, which directly answers whether consolidation
can run on a free/cheap tier: it demonstrably already does.
SOURCE: own measurement of ~/.shelra/shelra.db usage_events (2026-09-15);
platform.claude.com/docs/en/build-with-claude/compaction - Anthropic - accessed 2026-09-15
COUNTEREVIDENCE: the two are not substitutes. Compaction over raw transcript preserves information a
440-token recap cannot; a 1.5B local model summarising a 400-turn session is not producing the same
artefact as Opus 5 compacting 150,000 tokens, and no source found evaluates the quality difference.
Sleep-time compute (arXiv:2504.13171, 2025-04-17) reports the favourable framing - "~5x" less
test-time compute for the same accuracy, "up to 13%" and "18%" accuracy gains, and a "2.5x" decrease
in average cost per query when offline work is amortised across related queries - but it is still net
NEW compute, moved off the latency path rather than removed. Mem0 (arXiv:2504.19413, 2025-04-28)
reports the opposite pole: "saves more than 90% token cost" and "91% lower p95 latency" against a
full-context baseline - but its pipeline runs an extraction LLM call per stored item, which is a
write-path cost its token accounting does not foreground.
OPEN QUESTION: what is the measured quality loss of a 1.5B local recap versus a frontier compaction,
on a task that actually needs the older context? Nobody has run it, and it is the whole argument.
```

---

### S7. The cost cliff map

Target hardware profile (stated, not measured — the product's floor): **8 GB RAM, SSD, no discrete
GPU**, with ~4 GB taken by OS and editor and ~2–3 GB by a local small model, leaving **≤1 GB for the
memory system** and an interactive latency budget of **100 ms**.

| # | Mechanism | What binds | Cliff (measured or derived) | Escape, measured |
|---|---|---|---:|---|
| 1 | **Disk-resident brute-force vector scan** (sqlite-vec style, no ANN, no RAM residency) | latency | **~21,000 items** at 100 ms (477 ms measured at 100K, int8 768-d); 1 s at ~210K | binary: ~33K at 100 ms; or don't scan — rerank candidates only |
| 2 | **In-RAM float32 768-d brute force** | latency | **~115,000 items** at 100 ms (87.17 ms at 100K) | Matryoshka-256: ~330K; binary: ~760K |
| 3 | **In-RAM float32 768-d residency** | 1 GiB RAM budget | **~350,000 items** (3,072 B each) | int8 ~1.4M; **binary ~11.2M** |
| 4 | **FTS5 unselective query** (common term / prefix / OR) | latency | **~130,000 items** at 100 ms (78.38 ms at 100K); 839.55 ms at 1M | AND-of-3: 1.4M; phrase: 3.4M; rare term: unbounded |
| 5 | **Context-pack assembly with bodies** | latency | **~670,000 items** at 100 ms (149.42 ms at 1M) | fetch bodies for top-20 by id (0.014 ms each, flat) |
| 6 | **Naive `LIKE '%x%'` over everything** | latency | **~33,000 items** at 100 ms worst case (302 ms at 100K, 2,919 ms at 1M) | any real index |
| 7 | **Disk footprint** | 256 GB SSD | **~200M items** (1,268 B each) | never binds |
| 8 | **SQLite resident memory** | 1 GB RAM budget | **never binds** (58.3 MB at 1M items) | — |
| 9 | **Incremental write** | latency | **never binds** (0.78–2.77 ms p50, flat in N) | — |
| 10 | **Embedding inference dollars** | budget | **never binds** ($4.00 for 1M items; $0 in free allowances) | — |
| 11 | **Re-embedding wall clock** | patience | **~1M items = 3.26 h** (extrapolated) vs 21.57 s for FTS rebuild | keep lexical primary |
| 12 | **Context tokens delivered per task** | money / context window | **binds at every scale, including 1 item** | caching, smaller packs, cheaper tier, free tier |

```
CLAIM: The first cost cliff for a local-first coding-agent memory on cheap hardware sits at roughly
20,000-100,000 stored items, it is caused entirely by dense-vector retrieval rather than by storage or
by text search, and it lands one to two orders of magnitude ABOVE the "hundreds to thousands of items
over months to years" scale the product targets.
LABEL: OBSERVED TODAY (all cliff positions derived from own measurements)
CONFIDENCE: medium-high
EVIDENCE: Table above. The earliest binding mechanisms are all vector-related: disk-streamed
brute-force int8 scan hits the 100 ms budget at ~21,000 items (measured 477 ms at 100,000); in-RAM
float32 hits it at ~115,000 (measured 87.17 ms at 100,000); float32 residency exhausts a 1 GiB budget
at ~350,000. Every text-side mechanism binds later or never: FTS5's worst query shape binds at
~130,000, disk at ~200M, resident memory never (58.3 MB at 1M items), incremental write never
(sub-3 ms flat). The projected distilled store from S2 is ~3,500 items/year - so the earliest cliff is
about SIX YEARS of real solo use, and the latest never arrives.
SOURCE: own benchmarks 2026-09-15 (memcost.mjs, memcost2.mjs, memcost3.mjs, veccost.mjs); target
hardware profile is an ASSUMPTION stated above, not a measurement
COUNTEREVIDENCE: three things move the cliff sharply inward. (1) If you index raw transcript rather
than distilled records, the item count is ~100x higher for the same project history - the measured
store has 864 messages and 420 tool results for 47 recaps - which puts a three-year raw store at
~300,000 chunks, i.e. PAST cliffs 1, 2, 3 and 4. (2) My latency numbers are scalar JS with a warm page
cache; cold-cache disk scans on a cheap SATA SSD or an eMMC device would be several times worse and I
did not measure them. (3) The 100 ms budget is my assumption; an agent that retrieves once per task
rather than once per keystroke can tolerate 1 s, moving every cliff 10x out.
OPEN QUESTION: where is the cliff on a genuinely cheap machine - 8 GB RAM, eMMC or SATA storage, 4
cores - with a cold cache? Every number here is from a 12-thread NVMe laptop with 31.4 GB of RAM.
```

---

### S8. Local-first verdict, and TCO at three horizons

Assumptions restated: 5,000 sessions/year and ~3,500 distilled items/year (measured rates, S2); 83
model calls/day × 250 days; 10,000-token memory pack; SSD at ~$0.03/GB (**assumption**, no primary
source); electricity 18.34 ¢/kWh (EIA, June 2026 — first wave §4a).

| | **1 year** (~3.5K items) | **3 years** (~10.5K items) | **10 years** (~35K items) |
|---|---|---|---|
| Distilled store + FTS5 | 4.4 MB | **13.3 MB** | 44 MB |
| Raw transcript store + FTS5 | 369 MB | 1.11 GB | 3.69 GB |
| f32 768-d vectors over distilled | 10.8 MB | 32 MB | 108 MB |
| f32 768-d vectors over raw (512-tok chunks) | 452 MB | **1.35 GB** | 4.50 GB |
| binary vectors over raw | 14 MB | 42 MB | 141 MB |
| Retrieval latency, FTS `AND` of 3 (scaled from measured) | 0.20 ms | 0.58 ms | ~1.9 ms |
| RAM needed (lexical only) | ~50 MB | ~50 MB | ~52 MB |
| One-off embedding cost (distilled, 3-small) | $0.014 | $0.042 | $0.14 |
| Consolidation, local 1.5B (measured route) | **$0** | **$0** | **$0** |
| Consolidation, Opus 5 over raw transcript | $576 | $1,728 | $5,760 |
| Context packs delivered, Opus 5 uncached | $1,037 | $3,111 | $10,370 |
| Context packs delivered, GLM-5.3-Flash | $15.56 | $46.68 | $155.60 |
| Context packs delivered, free tier (measured) | **$0.035 total, all sources** | — | — |

**Headroom against each measured cliff**, at the projected distilled-item counts (ratio of the cliff
to the store; <1 means the cliff has been crossed):

| Mechanism | Cliff | 1 yr (3.5K) | 3 yr (10.5K) | 10 yr (35K) |
|---|---:|---:|---:|---:|
| Disk-streamed brute-force vector scan (int8) | 21,000 | 6.0× | **2.0×** | **0.6× — crossed** |
| Naive `LIKE` over everything | 33,000 | 9.4× | 3.1× | **0.9× — crossed** |
| In-RAM float32 768-d scan | 115,000 | 33× | 11× | 3.3× |
| FTS5 worst-case (common-term) query | 130,000 | 37× | 12× | 3.7× |
| In-RAM float32 768-d residency, 1 GiB | 350,000 | 100× | 33× | 10× |
| Context-pack assembly with bodies | 670,000 | 191× | 64× | 19× |
| FTS5 `AND`-of-3 query | 1,400,000 | 400× | 133× | 40× |
| Disk footprint, 256 GB SSD | ~200,000,000 | 57,000× | **19,000×** | 5,700× |
| SQLite resident memory | never | ∞ | ∞ | ∞ |
| Incremental write latency | never | ∞ | ∞ | ∞ |

```
CLAIM: Local-first long-horizon project memory is economically viable on cheap hardware at the scale
the brief specifies, but the headroom is wildly non-uniform - 19,000x on disk and 2.0x on the one
naive retrieval mechanism at three years - and the two mechanisms a ten-year store actually crosses
are both naive-implementation artefacts, not hardware limits.
LABEL: OBSERVED TODAY (all cliff positions measured) / REASONABLE EXTRAPOLATION (the item-count projection)
CONFIDENCE: medium-high
EVIDENCE: Headroom table above, computed from the S7 cliffs and the S2 projection of ~3,500 distilled
items/year. A three-year distilled store projects to 13.3 MB with a full-text index, answering an
AND-of-3 query in ~0.58 ms at ~50 MB RSS. Against that: disk 19,000x headroom, FTS worst case 12x,
in-RAM float32 scan 11x - and disk-streamed brute-force vector scan only 2.0x, crossing at about year
six. Consolidation at the measured rate ran on a local 1.5B quantised model and a free endpoint for
$0.00 on 83% of calls. Embedding the whole three-year distilled store costs $0.042 on
text-embedding-3-small and $0 inside Voyage's 200M-token allowance.
SOURCE: own measurements 2026-09-14/15; pricing pages as cited in S4c; first-wave §2 price table
COUNTEREVIDENCE: the headroom is a property of DISTILLATION, and distillation is an LLM operation
whose quality nobody in this evidence base has measured. If a 270-byte recap loses what a later
session needed, the system silently substitutes a cheap wrong answer for an expensive right one, and
none of these numbers capture that. The one quantified comparison available is unfavourable to naive
compression: lane 13 records Zep retrieving ~1.6k tokens against a 115k full-context baseline while
scoring HIGHER (LongMemEval 63.8-71.2% vs 55.4-60.2%), which shows good distillation can win - but
Zep is a temporal knowledge graph built by a vendor with a paper to sell, not a 1.5B local summariser.
Second: the whole analysis assumes storage is local and single-project. A team store, multi-project
search, or an agent that snapshots file contents (measured 11,210 B/checkpoint) grows on different
curves I did not model.
OPEN QUESTION: what is the recall of a distilled memory store against the raw transcript it replaced,
on questions asked months later? That is the number that decides whether the cheap architecture is
actually the same product.
```

---

### S9. Contradictions with common belief (second wave)

**C7. "Long-horizon agent memory needs a vector database."**
Against the measured numbers, a vector index is the *only* component that comes near a cliff at
project scale, and it is the expensive one in exactly the dimension cheap hardware lacks: RAM. 1M
float32 768-d vectors = 3.07 GB resident (my measurement) or 3.67 GB planned (Qdrant's own formula at
replication 1), against 58.3 MB of resident memory for a 1M-item SQLite+FTS5 store answering selective
queries in 0.02 ms. Lane 13 independently records that production coding agents (Claude Code, Cursor,
Cline, Windsurf, Amp) converged on lexical+agentic search and that keyword search inside an agentic
loop reaches >90% of vector-RAG performance. The vector database is the component to add last, not
first — and when added, as a reranker over ~200 lexical candidates (measured: 71.9 ms at 1M items,
614 KB of vectors touched, versus 880 ms and 3.07 GB for a full scan).

**C8. "Storage is the cost of remembering."**
Storage is the *cheapest* thing in the system by six orders of magnitude. 10,000 items with a
full-text index = 12.75 MB ≈ $0.0004 of SSD; delivering the same content as context packs for a year
costs $1,037 at Opus 5 input prices. Every published memory-system paper I could reach reports token
counts and accuracy; none reports bytes. The field measures the cheap variable and ignores the
expensive one, which is backwards.

**C9. "Consolidation is an expensive background tax."**
Measured, it was 0.18% of token spend and 83% of the calls ran on a local 1.5B model or a free tier at
$0.00. The expensive version exists — Anthropic's documented compaction bills 180,000 input tokens per
event, 409× a measured recap — but that is the price of consolidating *raw transcript*, which is a
choice. The tax is not consolidation; it is what you feed it.

**C10. "Scale means number of items."**
It does not, for text. At 1,000,000 items, a selective FTS5 query cost 0.02 ms and an unselective one
839.55 ms — the same index, the same corpus, a 42,000× spread. Growth in corpus size is nearly free;
growth in *query vagueness* is what costs. No memory-system paper found states a query-shape
distribution, so nobody can currently predict their own retrieval cost.

---

### S10. Problems nobody is talking about (second wave)

**P8. The memory-systems literature reports tokens and accuracy, never bytes, RAM or watts.**
Mem0 reports "more than 90% token cost" saved and "91% lower p95 latency"; sleep-time compute reports
"~5x" test-time compute reduction and a "2.5x" cost decrease; Zep reports 1.6k vs 115k tokens (lane
13). Not one of them reports the disk footprint, resident memory, or re-index time of the store that
produces those savings — the three numbers that decide whether it runs on a cheap laptop. I could not
find a single published memory-system paper with a megabytes-per-thousand-items figure. That is why
this section had to measure its own.

**P9. Write-path inference, not storage, is the marginal cost of a memory item — and nobody prices it.**
An extract-then-consolidate pipeline runs at least one model call per candidate memory. At the
measured rate of ~14 distilled items/day, that is ~3,500 write-path calls/year. At the measured recap
size (440 in / 90 out) on a free or local tier it is $0; at frontier prices with a 2,000-token
extraction prompt it is ~$0.015/item = $52/year, and rising with *how much you choose to remember*.
The cost of memory therefore scales with **write-gate permissiveness**, a parameter no cost model in
this field contains. Lane 11 catalogues write-gate *policies*; none of the sources it found price one.

**P10. Quantisation is the entire local-first vector story and there is no recall curve for it.**
Binary quantisation buys 32× the RAM and 6.7× the scan time in my measurements — it is the difference
between ~350,000 and ~11.2 million items in a 1 GiB budget. Qdrant's own documentation says only "Some
embedding models don't quantize efficiently, so verify recall against unquantized results." No public
recall-versus-quantisation curve exists for a project-memory corpus. The single cheapest escape from
the only real cliff is completely unevaluated. (This mirrors first-wave P1 and open question 6 exactly:
undeclared and unmeasured numerics, one layer up the stack.)

**P11. Re-indexing is a hidden depreciation schedule on every embedding-based memory.**
A lexical index rebuilt over 1M items in a measured 21.57 s. Re-embedding the same corpus is a
multi-hour local job or a $4–40 cloud job, **and it recurs every time the embedding model changes**.
First-wave §2 measured the model layer repricing and re-releasing roughly quarterly. A vector memory
store therefore carries an implicit "re-embed on model change" liability that nobody amortises — the
same defect first-wave P2 found for agent scaffolds, transplanted into the data layer, where it is
worse because the data is the durable asset.

**P12. The measured input:output token ratio of a real agent is 37.9:1, and memory makes it worse.**
20,060,886 input tokens against 528,955 output tokens in the measured ledger. Every byte of memory you
retrieve lands on the *input* side, which is the side that is 38× larger and the side that cache
pricing, context-rot (lane 13) and rate limits all act on. A memory system that improves recall by
retrieving more is directly buying into the most-constrained resource in the stack. No memory paper
found reports its effect on the input:output ratio.

---

### S11. Open questions for a third wave

13. **Cold-cache measurement on genuinely cheap hardware.** Every latency figure here is warm-cache on
    NVMe with 12 threads. The cliffs on an 8 GB / 4-core / eMMC machine are the ones that matter.
14. **Recall versus quantisation for a project-memory corpus.** Binary quantisation is the only cheap
    escape from the only real cliff, and its cost in recall is unmeasured (P10).
15. **Query-shape distribution for agent memory retrieval.** The 42,000× spread between selective and
    unselective queries means retrieval cost is undefined until this distribution is known (C10).
16. **Recall of a distilled store against the raw transcript it replaced**, on questions asked months
    later. Decides whether the 222× compression that makes local-first viable is free or fatal.
17. **Measured tokens/second for a 300M embedding model on a CPU-only laptop.** Every local-embedding
    estimate here extrapolates from an EdgeTPU figure.
18. **Cache-hit rate achievable for a per-task-variable memory pack.** Worth ~10× on the dominant line
    item (S5); lane 13 flags it as measured by nobody.
19. **FTS5 index ratio over real agent transcript** rather than synthetic Zipf text — 22.5% measured
    here versus 45% in SQLite's own email test; a 2× constant on the storage projection.
20. **Cost of a memory item as a function of write-gate permissiveness.** The one parameter that makes
    memory expensive, absent from every cost model found (P9).

---

*Lane 09 second wave ends. New sources appended to `research/sources/09-economics.md`.*
