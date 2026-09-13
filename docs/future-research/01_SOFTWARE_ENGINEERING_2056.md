# Software engineering, 2026 → 2056

Full evidence: `research/lanes/01-future-se.md` (historical shifts, analogies, timeline) and
`research/lanes/09-economics.md` (price curves, scenarios). Labels are mandatory; nothing thirty years
out exceeds REASONABLE EXTRAPOLATION.

---

## 1. The pattern that predicts whether an abstraction shift succeeds

This is the most useful historical result the mission produced, because it is a *test*, not a narrative.

> Shifts that reached majority adoption — high-level languages, logic synthesis, SQL, declarative
> infrastructure — had a **fixed, machine-checkable target semantics**, and their residual gap was a
> **performance** gap, not a **correctness** gap.

| Shift | Outcome | Why |
|---|---|---|
| RTL → gates (logic synthesis) | Won in ~8 years, permanently | Boolean equivalence between levels is **decidable** and was industrialised |
| SQL + optimiser | Won in ~15 years | Fixed relational semantics. The optimiser is routinely wrong by **1000×** on cardinality — and it did not matter, because a bad plan is *slow*, not *wrong* |
| Kubernetes / declarative infra | Won in ~10 years | Desired state as data, non-terminating reconciliation, and convergence **explicitly abandoned**: *"potentially, your cluster never reaches a stable state"* |
| C → RTL (high-level synthesis) | **Stalled 30 years, still partial** | Requires *inventing* a micro-architecture. *"None of the existing tools can deploy general high-level code without manual intervention"* |
| 4GLs / "automatic programming" | Never generalised | Parnas 1985: *"automatic programming always has been a euphemism for programming with a higher-level language than was presently available to the programmer"* |
| UML / MDA / MDE | Never reached wholehearted use | **0 of 50** engineers used it wholeheartedly; 35 of 50 used no UML at all. One case saw certification costs rise **×8** from unreadable generated code |

**Intent → code sits on the failure side.** No decidable check exists between an English intent and a
program, and the residual gap is a correctness gap. That is the structural reason this transition behaves
like high-level synthesis rather than like SQL — and it is why any product here must promise visibility,
never closure. *(OBSERVED TODAY on the history; STRONG TREND on the inference.)*

## 2. Where we actually are in 2026

*(OBSERVED TODAY)* 90% of technology professionals use AI at work, but agents remain minority practice —
14.1% daily, 52% not using agents at all. Agent PR acceptance runs 38–65% in the wild against >70% on
benchmarks. Autonomy breaks at **~6 turns** without a feedback loop and reaches ~57 turns at a 25% pass
rate with retries.

The trinket that should worry anyone assuming AI raises abstraction: **the abstraction ratchet reversed.**
Duplication rose 8.3% → 12.3% and refactoring fell 25% → under 10% across 211M lines; a causal
difference-in-differences study over 151 Java repositories found **+12.8% lines of code with no
architectural gain**; and models *"prefer to repeat existing code instead of making use of abstractions"*.
Trust fell while adoption rose: positive sentiment 70%+ → 60%, only 3.1% highly trust accuracy, 66% cite
*"almost right, but not quite"* as their leading frustration.

## 3. Timeline

Each horizon carries three tiers. Where the evidence does not support a forecast, the entry says so.

**2030** — *High confidence:* specifications become version-controlled artifacts with review discipline,
because the review load forces it; spec-diff tooling exists and matters; agent turn limits move an order
of magnitude through harness engineering rather than model scale. *Medium:* regeneration-instead-of-
maintenance becomes real for small, leaf-level, high-variability components — exactly where DSLs
succeeded. *Speculative:* a decidable-enough equivalence check between intent and program. Nothing makes
this look close.

**2035** — *High confidence:* the primary engineering activity is **oracle engineering** — designing and
maintaining the executable checks that decide whether a generated system matches intent. Three
independent lines converge: Conant–Ashby (the regulator must contain a model of the system), deterministic
checks beating LLM judges 30/30 against 26/30, and the judging-beats-authoring asymmetry. *Medium:*
codebases bifurcate into a small hand-maintained kernel carrying the invariants and a large regenerated
shell — the high-level-synthesis outcome transposed. *Speculative:* natural language stops being the
primary intent medium in favour of constraints plus examples.

**2040** — *High confidence:* the intent→reality loop closes for **observable** properties — latency,
cost, error rates, data-flow reachability — because those already have a telemetry substrate. It stays
open for **interpretive** properties: whether the thing built was the right thing. *Medium:* specification
drift becomes the dominant maintenance cost, the way dependency management became the dominant cost of the
package era. *Speculative:* regulatory regimes making the specification, not the code, the legally binding
artifact. No evidence today; flagged because it is the single change that would most alter the economics.

**2045** — *High confidence:* someone still decides what the system is *for* and adjudicates conflicts
between stakeholders. Brooks has survived forty years: *"The hardest single part of building a software
system is deciding precisely what to build… the clients do not know what they want."* *Medium:* "software
engineer" splits into an intent-and-verification profession and an operations profession, with
implementation largely gone.

**2050** — *High confidence, low certainty:* one thing only — verification cost does not go to zero,
because verification is where the human's model of the world enters the system, and Conant–Ashby says that
model can be relocated but not eliminated. *Medium:* software is maintained the way infrastructure is
today — continuously reconciled toward a declared state nobody expects to fully reach.

**2056** — **No high-confidence trajectory, and claiming one would be a defect.** Thirty years back from
2026 is 1996: the web was four years old, Java was one, and the confident forecasts were CORBA and CASE
tools. The only structural claim the evidence supports:

> An intent gap will still exist, because intent is generated by humans changing their minds, and no
> amount of derivation closes a gap whose source keeps moving.

## 4. The economics underneath

*(OBSERVED TODAY, from original computation over 429 models)*

The frontier got **more expensive**: gpt-5 at $1.25/$10 (Aug 2025) → gpt-6-astra at $10/$50 (Sep 2026),
8× input and 5× output. But price at *fixed capability* is collapsing 40–100× per year. The threshold
that matters:

| Capability index | Price-floor fall in window | Open substitute? |
|---|---|---|
| ≥ 35 | 94.5× in four months | Yes |
| ≥ 45 | 5× | No |
| ≥ 50 | **1× — did not move** | No |

Hardware price-performance improves only **1.49×/yr** — two orders of magnitude slower. The curve is
algorithmic and competitive, not silicon-driven, and Epoch projects inference capacity growing 3.4×/yr
against demand at ~10×/yr, concluding *"the price of tokens from large models will rise."*

## 5. Three competing futures, and the invariant

**A — Intent/spec dominance.** Specification becomes the primary human-authored artifact; code is derived.
*Enablers:* cheap regeneration, checkable specs. *Barriers:* Markdown already won the representation
contest; Tessl left the field; the ETH ablation found prose artifacts change resolution by −0.5% to +2.4%
at +20–23% cost. **Assessment: partial and domain-limited**, strongest where behaviour is objectively
checkable and errors are expensive.

**B — Agent dominance.** Models get good enough that intermediate artifacts stay implicit. *Enablers:*
continued scaling; the measured absence of a reliability crisis — merge rate flat, revert rate slightly
down under a 2.09× throughput mandate. *Barriers:* semantic collapse does not diminish with scale;
accountability and audit; 24.7% of decisions remain unattributed. **Assessment: dominant for low-stakes
software, contested elsewhere.**

**C — Hybrid.** Humans use intent interfaces; systems generate checks and evidence internally; the explicit
artifact is a decision-and-evidence record rather than a full specification. **Assessment: most likely
shape; least clear who captures the value.**

**The invariant across all three** *(the §47 question, and the reason the thesis was selected)*:

> In every future, decisions get made that no human made, and in every future something must decide
> whether the resulting behaviour was wanted. Scenario B makes this **worse**, not better — a more
> capable model exercises more discretion, further from anything the human said.

That is why the selected thesis is the discretion record and not the specification: the specification is
scenario-A-shaped and dies if B wins, while the discretion record grows under every scenario.
