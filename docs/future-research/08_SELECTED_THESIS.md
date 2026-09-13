# The selected thesis

One thesis, not ten. Selected 8 September 2026 after nine research lanes and an adversarial lane
instructed to kill it. Evidence lives in `research/lanes/`; the reasoning that eliminated the
alternatives is in `research/hypotheses/04-emerging-thesis.md`.

---

## Statement

> We believe **the record of machine discretion** — the set of behavioural decisions a system made that
> no human ever made — will become the scarce, durable artifact of software engineering, because
> generation is now free while the *oracle* that says whether generated behaviour was wanted is not.
>
> Existing systems solve **authoring** the specification and **proving** a given property. They fail at
> **stating what should be true** and at **making a machine's undeclared choices visible**.
>
> We can falsify this by measuring the base rate of silent commitment violations in real merged pull
> requests.

## The problem

Software has provenance mechanisms for code — blame, review, sign-off — and for requirements —
traceability. It has **none for discretion**.

Measured: **24.7% of requirement decisions are "structurally valid but discretionary choices not
explicitly mandated by the stakeholder"**. They are not bugs and not requirements. They are authorship,
exercised by a machine, attributed to nobody. Nobody is building the record *"the system chose X; the
human never said anything about X; here is the list."*

Three independent gaps describe the same hole:

- **No review surface shows what is absent.** Every review interface ever built shows what *is* there.
  The dominant error class is omission, detected 6–7× less often than over-inclusion.
- **Behavioural diffing is the emptiest square on the board.** `cargo-semver-checks` explicitly refuses
  to detect behavioural changes; academic semantic differencing peaked in 2014, untouched by the LLM wave.
- **Evidence invalidation barely exists as a research field.** "Incremental verification" returns 8 arXiv
  hits since 2024; "specification drift" essentially nothing in software engineering.

## Why now

**The cost curve split in two during 2025–2026**, and only one half fell.

| | 2026 status |
|---|---|
| Proving a **given** property | Schwarz: 91.5% of SV-COMP ReachSafety. CryptoProver: 8 months × 5 engineers → **11.4 hours and $467**. Pure Dafny verification 68% → 96% in one year. |
| Writing the property that captures **intent** | VeriContest spec-generation 48.3%. End-to-end certified synthesis on 946 real competitive problems: **5.29%**. Adding natural-language descriptions to formal specs does not help. |

Checking became nearly free. Deciding what to check did not. Everything scarce in software engineering
is now on the second row.

Two enabling changes make the artifact newly maintainable: extraction and re-checking of behavioural
commitments now costs near zero, which is why live traceability failed in every previous era; and models
are demonstrably good at the *judging* half of the work (F1 0.74–0.90 on executable code) even while
being bad at the authoring half (their acceptance suites admit 19–42% of correct solutions).

## What exists today

- **Spec-driven development won distribution and lost the checking war.** Spec Kit (134k stars) and
  OpenSpec (67.7k) ship a *prose* artifact whose only checker is another LLM reading Markdown. Every
  validation command in the three biggest tools is either structural or LLM-judgemental. **None executes
  anything.**
- **One partial exception**: AWS Kiro compiles EARS requirements into property-based tests with shrinking
  and a requirement↔property↔task link. It is IDE-only, optional by default, and Kiro's own documentation
  concedes it *"provides evidence of correctness, not a proof… A property that is too weak, or that
  states the wrong invariant, will pass while the real behavior is still wrong."*
- **The gap is deliberate, not merely unnoticed.** OpenSpec issue #987 asked for executable specs — *"Spec
  IS the test — no duplication, no drift"* — and was **closed as not planned**.
- **The best-funded pure play left the field.** Tessl raised $125M on "specs are the new source code";
  its documentation index in September 2026 contains no page on specs, `.spec.md`, or a spec registry. It
  sells skills governance.
- **The nearest competitor** is Baz's spec-reviewer agent, which validates code against product
  requirements — per pull request, at planning time, not longitudinally.

## Why current agents do not solve it

Three measured reasons, each fatal on its own.

1. **Models cannot enumerate what a request leaves out.** Authored acceptance sets admit 19–42% of
   correct solutions; omissions resist audit by construction — *"an over-inclusion is a written token a
   reviewer can challenge, while a missing member is an absence whose discovery is the authoring problem
   itself."*
2. **Asking does not fix it, and can make it worse.** After one clarification turn, detrimental semantic
   collapse *rises* to 37.3–76.5% on MBPP variants. Goal clarification loses nearly all value after 10%
   of execution, and **no frontier model asks inside the optimal window**. Three vendors ship clarifying
   questions; zero benchmarks score whether the question was the right one.
3. **Sampling cannot see the failure.** Models converge unanimously on a single wrong reading in 3–32% of
   tasks; 11–49.7% receive an incorrect solution without ever triggering a clarifying question from
   clustering-based methods. Self-consistent errors *"remain stable or even increase"* with scale.

## Why the problem grows

It is one of the few candidates that does **not** get smaller as models improve.

A more capable model exercises *more* discretion, not less — it makes more decisions unaided, further
from anything the human said. Meanwhile the durability test that eliminates most tooling ideas is brutal:
for **37–63% of ICSE 2026 LLM-technique papers, a newer model with a single plain prompt beats the tooling
proposed a year earlier**. *"Intent survives; workarounds do not."*

## Design laws the evidence dictates

Violating any of these is how this thesis becomes another failed spec tool.

1. **Rules, never enumerations.** Predicate F1 ≈0.99 against authored-set 19–42%. Three literatures found
   this independently and none cites the others.
2. **The model judges; it never enumerates.** Candidates come from outside the model — the diff, the
   telemetry, a fixed catalogue.
3. **Start only where an oracle already exists.** OpenAPI contracts, RFCs, ADRs, EARS requirements,
   IaC policy, invariants already asserted in code. RFCAudit is the existence proof: 47 real bugs at 81.9%
   precision against RFC prose.
4. **Show what is absent, not what is present.**
5. **Cost the requester almost nothing.** Nobody has priced a developer-second; every clarification cost
   model in the literature is `turns × constant`.
6. **Never rely on the human to validate.** 86 programmers judged incorrect assertions at **49% —
   chance** — while overconfident, and bad explanations raised confidence while lowering accuracy. Lahiri's
   founding assumption that the user is the oracle was tested in July 2026 and the user failed.
7. **Never promise to close the gap.** No decidable check exists between an English intent and a program.
   Promise only to make the gap's contents visible. Anything more is high-level synthesis in 1995.

## What would make us wrong

Ranked by cost to test.

1. **The base rate is near zero.** If fewer than ~5% of merged PRs silently violate a stated commitment,
   the problem is imaginary. *Decisive, cheap, needs no new corpus.*
2. **The decisions are not consequential.** "Discretionary" is not "a human would have chosen otherwise".
   If a human shown the list shrugs at 90% of it, the record is noise.
3. **Nobody reads it.** The reading path is the binding constraint. If the record is not *shorter* than
   the diff it replaces, it fails on its own terms.
4. **An incumbent ships it.** Spec Kit already has `/speckit.converge`; Kiro already compiles EARS to
   property tests. If either goes longitudinal, the wedge closes — and the absorption lag is 19 days to
   8 months.
5. **The oracle precondition is too narrow.** If the only places with a cheap oracle are also the places
   with fewest undeclared decisions, the addressable surface is empty.

## How to test it

`10_PHASED_PLAN.md`. Phase 1 is falsifier 1 above and gates everything else.

## What this becomes if it works

A durable, per-codebase corpus of behavioural commitments and the machine decisions taken against them —
data an incumbent cannot import, because Codex `/import` moves configuration, not an organisation's
decision history. Counter-positioning holds: the agent vendors sell velocity, and a product whose job is
to say *"this change violated a commitment you made"* is a brake.

Realistically, for a solo unfunded builder: a sharp public measurement and an OSS CLI that runs in CI. Not
a company. That is worth saying before anyone spends months on it.
