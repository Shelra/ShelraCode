# Contradiction and convergence matrix

Lead-authored, updated as lanes land. Rows are added only where both sides cite evidence.
Status at time of writing: lanes 04, 05 and 10 complete; 01, 02, 03, 06, 07, 08, 09 pending.

---

## A. Convergences (independent lanes reaching the same finding)

Convergence between an adversarial lane and an analytical lane is the strongest signal available in
this mission, because lane 10 was instructed to attack and lane 05 to classify.

| # | Finding | Lane 05 evidence | Lane 10 evidence | Weight |
|---|---|---|---|---|
| A1 | **Everything upstream of the specification is commodity.** | 20+ capabilities shipped by ≥3 systems incl. free/open ones. Absorption lag collapsed from 6–7 months (2025) to **19 and 26 days** (Aug–Sep 2026). | Spec Kit MIT 134,096★ ships `/speckit.converge`; OpenSpec 67,659★; Kiro; Claude Code ships Channels/skills/hooks/routines. | **Very high.** Two methods, same conclusion. |
| A2 | **The judging/enumerating asymmetry is the one design the 2026 literature actively supports.** | Judge F1 0.74–0.90; authored suites admit only 19–42% of correct solutions; **predicate-writing reaches F1 ≈0.99**. | Enumerate 0.26–0.48 vs judge 0.60–0.77; 10:1 omission-first failures over 43,227 items; names it "an architecture, not a defect". | **Very high.** Lane 05 adds the decisive refinement — see C1. |
| A3 | **Nobody closes the reality→intent loop.** | "Reality-feedback (did the deployed change still match intent) — DIFFERENTIABLE — open — nobody." | "The last arrow… is a human judgement"; no product found that checks a shipped change against its motivating intent. | High, pending lane 07 which owns this arrow. |
| A4 | **Clarification is shipped everywhere and measured nowhere.** | Three vendors ship it (Claude Code 2025-10-16, Cursor 2.4, Codex `/plan`); "zero benchmarks score the question"; "probably-inverted hit rate". | Post-clarification collapse **rises to 37.3–76.5%** on MBPP variants. | **Very high, and actionable.** A shipped feature whose effect may be negative. |
| A5 | **Semantic collapse is real, large, and unaddressed by any product.** | Cited as a "stays hard" item; disagreement detectors blind to it. | 3–32% baseline, 11–49.7% receive wrong solutions with no clarifying question triggered. | Very high. |

### A6–A9: convergences involving lane 04 (added after lane 04 landed)

| # | Finding | Lane 04 evidence | Corroborating lanes | Weight |
|---|---|---|---|---|
| A6 | **The artifact must be a RULE, never an enumeration.** | *Judging Is Not Enumerating*, the multi-level-modelling study (52–79% instantiation correctness) and AMIGO (XMI "verbose, deeply nested … cannot reliably produce or edit") independently find the same boundary in three vocabularies **and none cites the others**. Predicate F1 ≈0.99. | Lane 05 (predicate F1 ≈0.99 vs suites admitting 19–42%); lane 10 (judge 0.60–0.77 vs enumerate 0.26–0.48). | **Highest in the mission.** Three lanes, three literatures, one design rule — and it is unwritten. |
| A7 | **Review, not authoring, is the binding constraint — and always was.** | Kuhn 2012: model diffing 12/12 interviews, point-to-point traceability 12/12. Engineers printed models on walls to obtain "a linear reading path". AI removes the authoring barrier and leaves the review barrier untouched. | Lane 05 (+91% review time, flat delivery; ChainSWE state decay); lane 10 (66% "almost right"; agentic PRs 5.3× in queue; 31% merging unreviewed). | **Very high.** A 2012 field study predicts the 2026 telemetry exactly. |
| A8 | **The oracle is the scarce thing, and formality moves the failure rather than removing it.** | Three checkers, three domains: VeriAct (verifier-accepted specs "in fact incorrect or incomplete"); OptiRepair (~1 in 4 solver-feasible repairs violate domain theory); Vericoding (NL descriptions do not help). Spec-as-source works only where a cheap continuous oracle exists — the condition an intent IR fails hardest. | Lane 10 (Kleppmann and Gavran both land on "the challenge moves to correctly defining the specification"). | Very high. |
| A9 | **Nobody owns the reading path, and omission is structurally unauditable.** | P5: every 2026 SDD tool optimises spec generation, none optimises reading. P6: "Every review UI ever built shows you what *is* there. Nothing shows you what should have been." Omissions detected 6–7× less often than over-inclusions; production deployment fails omission-first at 10:1. | Lane 05 (clarification shipped by three vendors, scored by zero benchmarks); lane 10 (accountability tax). | **Very high, and it is a product gap, not a research gap.** |

### B5–B6: contradictions involving lane 04

| # | Claim A | Claim B | In dispute | What would settle it | Wave-2 action |
|---|---|---|---|---|---|
| B5 | **Lane 04:** Markdown has won decisively — 470,795 `spec.md` files across 73,030 repos; spec-kit + OpenSpec ≈202k stars in 13 months vs ~1,345 for the entire SysML v2 ecosystem in six years. LSP won by *refusing* to standardise a semantic representation. **AI is anti-DSL**: on ATL "Pass@1 remains unchanged across all strategies and models" because competence tracks corpus mass. | The mission's own premise (§4, §19) that a representation "richer than Markdown" is needed. | Whether a new notation is an asset or a liability. | Already settled by lane 04 against the premise. The residual question is whether *structure inside Markdown* (typed slots, CCA-style) counts as a new notation. | **Amend the mission premise.** Any proposal to invent a notation now carries a burden of proof it cannot currently meet. |
| B6 | **Lane 04:** the north-star's central arrow may be aimed wrong — the 2026 SysML+AI literature is uniformly *LLM writes the model*, not *model constrains the LLM*. SEI: "AI could plausibly reduce some of that effort, but plausibility is not evidence." | The thesis assumes the representation constrains generation. | Direction of the arrow between representation and model. | Find one 2026 system where a formal model measurably constrains generation rather than being produced by it. Lane 03 owns this. | Ask lane 03 directly. |

### C4–C6: refinements from lane 04

**C4 — The three conditions for spec-as-source, and which one fails.**
Lane 04 extracts a testable rule from the successful cases: spec-as-source works where **(a)** the derived
artifact is cheap to regenerate, **(b)** there is no hidden state to preserve, and **(c)** a cheap
continuous oracle can say whether reality matches. OpenAPI has all three. Terraform has (a) and (c) and
pays for (b) with statefiles and drift detection. Database schemas fail (b) — you cannot regenerate a
populated database. **General software fails (c) hardest, not (a).** Generation is now cheap; the oracle
is scarce. This is the sharpest formulation of the intent problem produced anywhere in the mission so far,
and it converts "why does spec-as-source fail" from opinion into a three-condition test.

**C5 — The MDE failure was reviewability, and AI does not touch it.**
No row in lane 04's failure table earned AI-YES. AI is AI-PARTIAL where it collapses authoring cost and
AI-NO where the constraint is linguistic (4GL ceilings, DSL corpus mass) or standards-institutional. The
one constraint that killed MDE in the field — 12/12 on diffing, 12/12 on traceability — is a *reading*
problem, and cheap generation makes reading load worse, not better. Any thesis that says "AI removes the
barrier that killed MDE" is contradicted by the primary field studies.

**C6 — The unbuilt tool named by three lanes independently.**
Lane 04 P3: *"There is no `git merge` for requirements."* Lane 04 P6: no review surface shows what is
absent. Lane 05: nobody ships a "what did I leave half-done in this repository" ledger, while 48% of
downstream agent failures come from the agent's own prior state. Lane 10: the accountability tax means the
artifact must cost the requester almost nothing. These are three descriptions of one missing object: **a
review surface for behavioural change that makes omissions and unreconciled decisions visible.** It is a
product problem, requires no new notation, and no lane found anyone building it.

---

## B. Contradictions between lanes

| # | Claim A | Claim B | What is actually in dispute | What would settle it | Wave-2 action |
|---|---|---|---|---|---|
| B1 | **Lane 10:** spec-as-source is receding. Tessl ($125M, the best-funded pure-play) removed it from its homepage; ETH SRI ablation finds context files change resolve rate by −0.5% to +2.4% (never significant) at +20–23% cost; practitioner reviews report 1,300 lines for a date display. | **Lane 05:** the defensible ground is "specification artefacts a machine can check", and models write predicates at F1 ≈0.99. | Not spec vs no-spec. **Prose spec vs machine-checkable predicate.** Every lane-10 attack lands on natural-language markdown artifacts; every lane-05 pro-spec datum concerns executable predicates. | Measure resolve-rate and review-time delta for a *checkable* artifact (property/contract/invariant) against both a prose spec and no artifact. Nobody has run this. | **Highest-value wave-2 experiment.** Lanes 03 + 07 to attack jointly. |
| B2 | **Lane 10:** the review bottleneck may be dissolving on its own — DORA 2025 reversed DORA 2024 and now links AI adoption to *higher* delivery throughput. | **Lane 05:** Productivity-Reliability Paradox (+98% PRs, +91% review time, flat delivery) plus METR RCT 19% slowdown, with ChainSWE supplying the mechanism (agents degrade against prior agents' state). | Whether the urgency premise of the entire thesis holds in late 2026. | Read DORA 2025 **and** 2026 primary datasets, not the blog summary. Lane 10 could not retrieve them (gated). | Lane 08 to obtain DORA primaries. If the bottleneck is dissolving, the thesis loses its "why now". |
| B3 | **Lane 10:** the residual agent failures are **not intent failures** — Sourcegraph attributes them to retrieval ("efficient access to context", ~400k-line grep threshold). | **Lane 05:** retrieval has collapsed into grep plus a cheap explore subagent; Cursor deleted its codebase-indexing docs page (404). The named failures are *state across sessions* (ChainSWE 48% self-inflicted) and *end-to-end autonomy* (SWE-Cycle 13.5%). | Where the residual ~35% actually lives: retrieval, state, or intent. | Failure-mode attribution study on a modern benchmark. Neither lane has one. | Wave-2 targeted question. This decides which product is the right one. |
| B4 | **Lane 10:** open-weight local inference is not viable — 31.2% vs 64.5% frontier on contamination-free issues; hardware squeeze through 2031. | **Lane 05:** under an identical bash-only harness, open-weight MiniMax M2.5 scored **75.8% vs 76.8%** for Claude 4.5 Opus at one-tenth the cost ($36.6 vs $377). | Whether the open-weight gap is ~1 point or ~33 points. | Lane 05 flags the reconciliation itself: Feb 2026 single-patch data vs Sep 2026 long-horizon data (Terminal-Bench gap 16.4 points). Task horizon may be the whole explanation. | Lane 09 to resolve. Bears directly on the zero-cost preference. |

---

## C. Refinements the lead draws from the pair

**C1 — The predicate finding reframes the whole opportunity.**
Lane 05 surfaces a datum lane 10 did not have: when asked to emit a *predicate* rather than enumerate
instances, models reach F1 ≈0.99 against 0.19–0.42 for authored suites. Combined with A2 this says the
viable artifact is neither a prose spec (lane 10 kills it) nor a generated test suite (silent omissions
kill it) but **a rule the machine can check**. This is the only reading of the evidence under which B1
is not a real disagreement.

**C2 — The strongest unowned problem in either lane is not intent at all.**
ChainSWE: 48% of downstream failures come from the agent's own accumulated state; under-edits outnumber
over-edits **nine to one**; degradation up to −70% along a chain. Lane 05's verdict: *"Nobody ships a
'what did I leave half-done in this repository' ledger."* This is a decision-provenance product that
does not require solving elicitation, is measured by an existing benchmark, and sits in the
"DIFFERENTIABLE — open" column. It must be ranked against the intent thesis in §48, not assumed away.

**C3 — Two structural facts constrain every candidate product.**
(i) Absorption lag is 19 days to 8 months and falling, so build time must be shorter than lag or the
idea is dead on arrival. (ii) Codex `/import` pulls a user's whole Claude Code or Cursor setup with
optional sync, and Copilot/OpenCode/Cursor read each other's directories — so **any thesis resting on
accumulated user configuration is dead on arrival**. Durability must come from data the incumbent
cannot import: the organisation's own decision history and production evidence.

---

## D. Gaps (asserted without evidence on one side — not contradictions)

- Whether Spec Kit's 134,096 stars represent usage. No telemetry exists. Both lanes flag it.
- Whether the Amazon/Kiro 13-hour outage was a specification failure or a permission failure. FT
  original paywalled; only Tessl's secondary account retrieved. Decides whether this thesis or a
  blast-radius product is the right response.
- Whether any coding-domain learned skill survives the next model release. Lane 05: "no existing
  benchmark evaluates evolution longitudinally."

---

## E. Operational finding affecting the whole mission

**WebSearch budget exhausted at 200/200 for the session.** Lane 10 hit it at its first call; lane 05
worked around it via Brave/Bing HTML endpoints through WebFetch (10 successes in ~32 attempts, the rest
CAPTCHA/429) plus direct primary fetches. The arXiv API also returned 429 during lane 05's window.

Both lanes still produced high-quality, primary-sourced work, so this is a degradation of discovery
breadth rather than a failure. It biases the corpus toward sources reachable by direct fetch and away
from vendor marketing, analyst reports and non-English material. Recorded here so the synthesis does
not mistake absence of a finding for absence of a fact. Raising
`CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION` would lift it.

---

# Update after lanes 08 (market) and 09 (economics)

## F. Corrections to claims the lead previously relayed

| # | What was claimed earlier in this mission | What lane 08/09 establishes | Status |
|---|---|---|---|
| F1 | "+98% PRs, +91% review time, flat delivery, across 10,000+ developers" — relayed by the lead as established fact, and used to justify the urgency premise. | Farrag (arXiv:2605.01160) is a **single-author position paper that compiles other people's telemetry**; it measures nothing. Lane 08 could not locate the underlying study (the Faros AI URL 404s), and found Qodo attributing "91%" to DORA 2025 instead. One attribution is wrong. | **UNVERIFIED at primary level. Do not build a pitch on it.** |
| F2 | "Lahiri names seven open problems." | Lane 08 read the abstract and counts **five** named challenges: scaling beyond benchmarks, compositionality over changes, metrics for validating specifications, rich logics, and human-AI specification interaction. The lead's "seven" came from a body-section summary produced by a fetch tool, not from the abstract. | Corrected to five in the abstract; the body may enumerate more. Cite the five. |
| F3 | "The review bottleneck is the wound the thesis aims at." | The best primary evidence (He et al., arXiv:2607.01904 — 802 developers, 196,212 PRs, Jan 2024–Apr 2026) shows throughput reaching 2.09× while **merge rate stayed flat and revert rate declined slightly**. Human review coverage fell 89%→68%; automated review rose ~19%→~84%. | **The bottleneck was resolved by lowering the standard, not by a crisis.** Reframes the entire urgency argument — see G1. |

## G. The reframing these two lanes force

**G1 — The honest form of the problem statement.**
Lane 08 states it better than any other lane in the mission:

> "The failure modes we can currently measure have not worsened. Reverts catch breakage in days;
> nothing in these datasets can see a requirement quietly implemented wrong. Anyone selling 'AI is
> breaking production' is ahead of the evidence — and anyone concluding 'therefore it is fine' is
> mistaking the absence of a measurement for the absence of a problem. That distinction *is* the
> opportunity, and it is also why the opportunity is hard to sell."

This kills the crisis narrative and replaces it with something harder and more defensible: the
instrument is missing, not the failure. It also predicts the go-to-market problem — nobody buys a
detector for a failure their dashboards say is not happening.

**G2 — The capability threshold that decides the zero-cost question.**
Lane 09's own computation over 429 OpenRouter models: below Intelligence Index 45 the price floor is
open-weight and falling ~2 orders of magnitude per year ($11.25 → $0.119 in four months at II≥35,
94.5×). **At II≥50 the floor did not move at all** ($10 → $10, 1×). There is no open substitute at
the frontier. So "zero cost to user" is viable for everything a sub-45 model can do and structurally
impossible above it — the question is not ideological but a capability-threshold question about the
specific task.

**G3 — Local-first is dead as an economic argument, and by a route nobody expected.**
Not model quality: **electricity**. Local inference costs ~$0.14–0.17 per M output tokens in US
residential power *alone*, which is at parity with the cheapest cloud open-model output pricing
($0.16 for DeepSeek V4 Flash). The hardware never pays back. Add that 20 of 26 notable 2026
open-weight models need >128 GB at 4-bit, and hardware price-performance improves only 1.49×/yr
against a 40–100×/yr price-at-capability curve. Lane 10 argued local-first dies on the DRAM market;
lane 09 shows it dies on the electricity bill first. Two independent routes to the same verdict.

**G4 — The strongest single argument against building tooling at all.**
Lane 09: for **37–63% of ICSE 2026 LLM-technique papers, a newer model with a single plain prompt
beats the tooling proposed a year earlier**. Its own summary: *"Intent survives; workarounds do not."*
Any artifact whose value is compensating for a current model weakness has a shelf life of about one
model generation. This is the sharpest available test for a product idea: **does it still make sense
if the model gets twice as good?** Elicited intent and accumulated decisions pass it. Scaffolding,
routing, prompt engineering and compaction do not.

## H. Candidate problems now on the table (lane 08's ranked set)

| id | Problem | Classification | Falsification test | Solo-viable? |
|---|---|---|---|---|
| U1 | Longitudinal intent conformance — does the system still do what we agreed? | **UNDER-SERVED** (Baz's spec-reviewer exists, per-PR only) | 50 merged PRs from a repo with written ADRs/specs; how many silently violated a stated commitment without breaking a test or causing a revert? **<5% ⇒ the problem is imaginary.** | Yes, on three conditions: start where an authoritative spec already exists (OpenAPI, RFCs, ADRs, regulation); use predicates with the model as judge, never enumerator; ship as an OSS CLI in CI. |
| U2 | Comprehension measurement — how much do we actually understand? | APPARENTLY OPEN (low confidence) | Blind prediction quiz, 20 engineers, AI- vs human-authored code they own. No score difference ⇒ construct is not real. | Weak. The buyer must commission evidence of their own ignorance. A "won't", not a "can't". |
| U3 | Correlated (monoculture) defects across unrelated codebases | APPARENTLY OPEN / RESEARCH-STAGE — genuine network effect | Cluster near-duplicate implementations of the same primitive across 500 public repos with AI-attributed commits; no excess over pre-2023 duplication ⇒ false. | No. Needs the corpus before the product. Public-corpus research-report version only. |
| U4 | Triage capacity for OSS maintainers | UNDER-SERVED (real demand, no budget) | Offer free triage to three projects for a month. | Emotionally compelling, commercially poor. |
| U5 | Productised remediation — ship the fix, not the finding | EMERGING (services) / UNDER-SERVED (productised) | Do it by hand for ten customers at fixed price; negative margin manually ⇒ automation will not save it. | **Only candidate producing revenue in month one.** Ceiling is a good solo income, not a company. |
| U6 | Predicate elicitation rather than examples | RESEARCH-STAGE | Two cohorts specify the same feature, by example vs by predicate; measure defect rate against held-out reference. | Not a company. The **mechanism** that makes U1 tractable. |

Note the structure: U6 is the mechanism, U1 is the product, and lane 04's three-condition test
(cheap regeneration / no hidden state / **cheap continuous oracle**) says U1 succeeds only where the
oracle already exists — which is exactly U1's own solo-founder condition, arrived at independently.
Three lanes converging on one design constraint is the strongest structural signal in the mission.

## I. New counterparty risk (lane 08, P3)

OpenAI announced it will stop supplying models to Cursor as of **12 November 2026**, following
SpaceX's acquisition of Anysphere. A product with $3B ARR lost model supply because of who bought it.
Any architecture bound to a single provider carries an unpriced counterparty risk that has now
visibly triggered at the largest scale in the industry. This strengthens the case for the
provider-agnostic boundary already present in `src/intelligence/`.
