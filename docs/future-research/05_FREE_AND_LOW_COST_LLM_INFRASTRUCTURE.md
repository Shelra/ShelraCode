# Free and low-cost LLM infrastructure

All provider facts fetched or tested on **8 September 2026**. Full evidence:
`research/lanes/06-free-inference.md` (provider matrix, live tests) and `research/lanes/09-economics.md`
(price curves, computed over 429 models).

**Spending discipline.** The repository's `KEY_GROQ` turned out to be on Groq's **paid Developer plan**,
not the free plan — proven by rate-limit headers on the first call (`x-ratelimit-limit-requests: 500000`
against a documented free ceiling of 1,000 requests/day). One 99-token call had completed before this was
discovered; all further Groq inference was stopped. Groq capabilities below are documentation-derived and
labelled NOT TESTED. All OpenRouter testing used only models whose id ends in `:free` and whose response
`usage.cost` was zero. No accounts were created and no billing details were requested.

---

## 1. Verdict

**Zero-cost cloud inference in September 2026 is real, capable, and shrinking.** Capability per free token
has risen while the number of durable free doors has fallen.

And the strategic finding that settles the question:

> **Paid open-weight inference is now so cheap (~$0.09 per million input tokens) that the engineering cost
> of harvesting free tiers likely exceeds the money saved** for anything past a demo.

So "zero cost to the user" stops being an engineering goal and becomes a consequence of choosing the right
capability tier. See §5.

## 2. Durability classification

| Provider | Status | Class |
|---|---|---|
| **GitHub Models** | **RETIRED 2026-07-30** — *"no longer available to any customer"* | DEAD |
| **Cerebras** | Free tier replaced by **$5 credits expiring in 30 days**; states plainly it offers no always-free allowance | TRIAL ONLY |
| **Groq** | Free plan alive but narrowed: 30 RPM / **1,000 RPD** / 8K TPM on gpt-oss | RATE-LIMITED FREE TIER |
| **OpenRouter `:free`** | Alive, volatile. **16 of 429 models** carry the suffix — 3.7% | VENDOR-SPONSORED, UNSTABLE |
| **Google AI Studio / Gemini** | Alive, but **limits are no longer published** — *"Specified rate limits are not guaranteed"* | FREE TIER, UNSPECIFIED |
| **Cloudflare Workers AI** | 10,000 Neurons/day free, but **frontier open weights are paid-only** | LIMITED FREE TIER |
| **Hugging Face** | **$0.10/month**, "subject to change" | TOKEN-SIZED CREDIT |
| **Mistral** | $10/month API credits; concrete rate limits NOT FOUND | PROMOTIONAL CREDIT |
| **Together / Fireworks / SambaNova / NVIDIA** | No documented free tier (Fireworks throttles uncredited accounts to 10 RPM) | PAID |

## 3. What the live tests found

Three sweeps × 16 free models = **29/48 successes (60.4%)**. Only 7 of 16 worked on all three passes and
**5 of 16 never worked at all**.

- **Throughput spans 6.2 to 218.3 tokens/s — a 35× spread at an identical price of zero.** One endpoint
  named "Lightning" timed out at 120 seconds.
- **At least 8 of the 16 are paid for with your prompts.** Requiring `data_collection: deny` removes them
  with *"No endpoints found matching your data policy (Free model training)"*.
- **A strict JSON schema was accepted with HTTP 200 and silently ignored** — 3 of 3 trials returned prose,
  contradicting OpenRouter's own structured-outputs documentation. For any system depending on structured
  output, a silent schema failure is worse than an error.
- **No `x-ratelimit-*` headers at all** on OpenRouter, and HTTP 200 can carry a 502 body.

**What is genuinely commodity at zero cost:** tool calling (6/6 models tested), the OpenAI-compatible
protocol, and long context — **146,466 prompt tokens with correct needle retrieval in 10.9 s for $0**.

## 4. A gate nobody is discussing

> **The two strongest free models are restricted to "agentic harnesses".**

Free frontier capacity now flows to incumbent distribution rather than to new builders. Combined with §2's
two dead tiers, the direction of travel is clear: free capacity is consolidating behind the platforms that
already have users.

**Privacy terms, verbatim.** Google's Gemini API additional terms (last modified 2026-04-28): *"When you
use Unpaid Services … Google uses the content you submit to the Services and any generated responses to
provide, improve, and develop Google products and services and machine learning technologies"*, and *"human
reviewers may read, annotate, and process your API input and output."* The paid tier is marked "not used".
Groq is the counterexample and the strongest term found: *"Groq is not permitted to use Inputs or Outputs
for training or fine-tuning."*

## 5. The capability threshold that actually decides this

*(Original computation over 429 OpenRouter models with Artificial Analysis benchmark fields)*

| Intelligence Index | Price-floor fall in window | Open substitute at the floor? |
|---|---|---|
| ≥ 20 | 64× | Yes |
| ≥ 35 | **94.5× in four months** ($11.25 → $0.119) | Yes |
| ≥ 45 | 5× | **No** |
| ≥ 50 | **1× — did not move** ($10 → $10) | **No** |

Below index 45 the floor is open-weight and falling roughly two orders of magnitude a year. At 45+ there is
no open substitute and the floor barely moves.

The same split shown as cost per unit of capability, running the identical benchmark suite:

| Model | Index | Cost to run the suite | Weights |
|---|---|---|---|
| Claude Fable 5.1 | 53 | **$13,128.86** | closed |
| Claude Opus 5 | 51 | $7,274.74 | closed |
| GPT-6 Astra (max) | 53 | $5,324.10 | closed |
| DeepSeek V4 Flash | 35 | $474.19 | MIT |
| **GLM-5.3-Flash** | 42 | **$280.28** | MIT |

**46.8× the price for 21% more index score** — and on the *coding* index specifically the gap narrows to
12% (81.6 vs 71.5).

**Implication for the selected thesis.** The thesis uses the model strictly as a *judge* over predicates —
the mode where measured performance is F1 0.74–0.90 — not as an author or enumerator. Judging is a sub-45
task. So the work lands squarely in the band where the open-weight price floor applies and is collapsing.
Zero cost is achievable not by harvesting free tiers but by never needing the frontier.

## 6. Local inference is not the escape hatch

Two independent routes reach the same verdict.

**Electricity.** Local inference costs **$0.14–0.17 per million output tokens in US residential power
alone** — at parity with the cheapest cloud open-model output price ($0.16 for DeepSeek V4 Flash). The
hardware never pays back against that tier.

**Memory.** 20 of 26 notable 2026 open-weight models need **>128 GB at 4-bit**. The best locally-runnable
coder is Qwen3.8-27B. Hardware price-performance improves only **1.49×/yr** against a 40–100×/yr
price-at-capability curve — and memory prices reversed years of decline, with Micron signing 16 five-year
strategic agreements and discontinuing its consumer brand in December 2025.

There is also a market-structure problem: **8.8× price dispersion for byte-identical open weights**, with
undeclared quantisation across much of supply and no enforcement. That is a lemons market, not a clean
commodity.

## 7. Continuity risk, now demonstrated

**OpenAI announced it will stop supplying models to Cursor as of 12 November 2026**, following SpaceX's
acquisition of Anysphere. A product with $3B of annual recurring revenue lost a model supply relationship
because of *who bought it*.

Every architecture bound to a single provider carries an unpriced counterparty risk that has now visibly
triggered at the largest scale in the industry. This is the strongest available argument for the
provider-agnostic boundary already present in `src/intelligence/` — see `09_SHELRA_IMPLICATIONS.md`.

## 8. Recommendation

- **Do not** build on free tiers for anything beyond prototyping. Two died this year; availability measured
  at 60.4%; a strict JSON schema was silently ignored; and at least half train on submitted content.
- **Do** target the sub-45 capability band deliberately, where open-weight pricing applies and falls ~2
  orders of magnitude per year, and keep the provider boundary narrow enough to switch in a day.
- **Do not** promise users zero cost as a product property. Promise a workload that does not need the
  frontier, and let the price follow.
