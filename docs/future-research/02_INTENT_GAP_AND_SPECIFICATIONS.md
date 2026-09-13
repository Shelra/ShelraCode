# The intent gap and specifications

Full evidence: `research/lanes/02-intent-gap.md` (76 sources) and `research/lanes/03-specifications.md`
(86 sources).

---

## 1. Status of the field, September 2026

Intent formalization became a named research programme in March 2026 (Lahiri, arXiv:2603.17150) with a
seven-item research agenda. Six months later, six of the seven have visible movement. **One has none.**

| Lahiri's open problem | Movement by Sept 2026 |
|---|---|
| 1. From benchmarks to real-world systems | **Substantial** — but see the caveat below |
| 2. Change intent and compositionality | **None. No published method.** |
| 3. Cost-effective clarification | Most movement — but the cost term is a placeholder |
| 4. Automated metrics for spec validation | The founding assumption broke; three proxies appeared |
| 5. Rich logics and quantifiers | Moved (lane 03's territory) |
| 6. Human–AI interaction for specification | Moved a lot; calibration unsolved |
| 7. Workflow integration | Fastest movement, thinnest evidence |

The caveat on problem 1 matters: benchmarks scaled from functions to repositories, and performance
collapsed accordingly — SWE-RPG reports an average resolved rate of **31.5%**, with implicit-requirement
recovery the dominant failure at 24.5–46.0% of runs. But *"none of these benchmarks specify side effects,
mutable state or concurrency — the three things Lahiri named as the real-world gap. They scaled the
repository, not the semantics."*

## 2. The founding assumption broke

Lahiri's premise: *"Since there is no oracle for specification correctness other than the user, we need
semi-automated metrics that assess specification quality."* That premise was tested in July 2026.

> **86 Python programmers judged correct assertions at 74% accuracy and incorrect assertions at 49% —
> chance — while reporting the same confidence for both** (p<0.001, OR 2.94). Natural-language
> explanations *"provided no overall benefit"*; low-quality explanations impaired accuracy (p=0.037) while
> **increasing** confidence (3.99 → 4.25 out of 5, p=0.005).

The authors' own conclusion: *"contrary to common assumptions, AI assistance may not improve the
reliability of code comprehension and review."*

Read alongside the REFSQ 2026 study — where participants rated LLM revisions of their own requirements as
significantly better on alignment-with-intent and unambiguity — the two are consistent and jointly
damning: **humans like machine-written specifications and cannot tell when they are wrong.**

*(OBSERVED TODAY, high confidence. This single result is why the selected thesis does not ask humans to
confirm anything.)*

Three oracle-free proxies appeared in response, all built on the same trick — judge a specification by
what a second blind process derives from it: **regeneration equivalence** (AfterVibe, Google: a blind
agent re-implements from the spec alone; 72 real projects, mean 5.06/6.0), **deterministic execution
judges** (a live PostgreSQL and Oracle instance adjudicating), and **symbolic over/under-constraint
detection** (VeriAct's Spec-Harness).

All three share one blindness, and it is the same failure one level up: *"A spec that faithfully encodes a
misunderstanding regenerates perfectly."*

## 3. Clarification does not work the way everyone assumes

Three independently measured failure modes. *(OBSERVED TODAY)*

- **Asking can make it worse.** After one clarification turn, detrimental semantic collapse *rises* to
  **37.3–76.5%** on MBPP variants. Multi-turn degradation runs −39%. Prompt-injection amplification goes
  1.8% → 34.0% once a clarification state exists to attack.
- **Timing dominates quality, and nobody optimises for it.** The first demand curves (May 2026, 6,000+
  runs) show goal clarification *"loses nearly all value after 10% of execution"*, that late clarification
  is worse than never asking, and that **no frontier model asks inside the optimal window**. 52% of
  unscripted sessions over-ask. Meanwhile ReqElicitGym finds that effective questions *"often emerge in
  later turns"* — so training pressure rewards exactly the wrong timing. Every clarification benchmark
  scores question *quality* and is turn-agnostic. **No joint quality-by-timing objective exists anywhere.**
- **Agents are stakes-blind.** Varying blast radius from contained to production moved action rates by
  1.5 points (65.5% vs 64.0%) while **55.8–67.8% of acted runs violated an action boundary**.

Value of information *has* been formalised (NetVoI = VoI − c, Jan 2026, including stakes). What has not is
the cost term: **every published model is `turns × constant`**, and the authors of the most careful one say
plainly that a real cognitive-load model *"is a major, open research challenge"*. Nobody has priced a
developer-second, so no system can decide whether a given question is worth asking.

## 4. The circular specification problem, resolved

**Verdict: true in the limit, false in practice — but only where an oracle exists.**
*(REASONABLE EXTRAPOLATION, medium confidence)*

*For:* a crossover theorem exists (ICML 2026 position track, Theorem 3.10) proving that above a
task-specificity threshold, prose necessarily costs more than formal specification. Position papers name
Specification Overfitting and Specification Debt. And the cost lands on humans: **44% of real agent turns
contain user pushback, and only 44% of agent-produced code survives into user commits.**

*Against:* the theorem's own authors flag that it assumes **one-shot** specification and *"breaks down with
iteration"*, and ignores human domain-learning costs. The single direct measurement points the other way
for machine cost — **reducing a full specification to a bare user story raises token spend by only 29.7%**.
And every partial-specification intervention measured a real gain without approaching completeness:
SpecFirst +6.9–21.3pp, Google's spec-driven test generation +9.8pp bug detection (p=0.0352), verifiable
literate programming 28.7–73.2% → 65.4–93.5%.

*The counter that survives:* **all four wins were measured on tasks with an available oracle.** The
circularity bites hardest exactly where none exists — and there the evidence is a single self-reported
case study whose author is also its subject.

## 5. Spec-driven development won distribution and lost the checking war

*(OBSERVED TODAY, high confidence)*

**470,795 `spec.md` files across 73,030 repositories**, 92% first committed in 2026. And:

> No mainstream spec-driven-development tool mechanically checks a specification against code. Every
> "check" is either structural or an LLM reading Markdown.

Spec Kit's `/speckit.analyze` reads three Markdown files and modifies nothing; `/speckit.converge` compares
code to spec *"by LLM reading and inspection — not automated tests or static analysis"*. OpenSpec's
`validate` checks *"structural issues"*. Kiro's `analyze_requirements` reasons over requirements only.

**The one exception**: AWS Kiro compiles EARS requirements into property-based tests with shrinking and a
requirement↔property↔task hover link — the only shipping product where a written requirement becomes a
runnable check. It is IDE-only, optional by default, and Kiro's own documentation concedes it *"provides
evidence of correctness, not a proof… A property that is too weak, or that states the wrong invariant,
will pass while the real behavior is still wrong."*

**The gap is deliberate.** OpenSpec issue #987 requested executable specs — *"Spec IS the test — no
duplication, no drift"* — and was **closed as not planned**.

**And the most spec-maximalist vendor left.** Tessl raised $125M on specs as the source of truth; its
documentation index in September 2026 contains no page on specs, `.spec.md`, spec registries or the Tessl
Framework. Its CLI changelog from 0.61.1 to 0.106.0 contains no spec entries at all — not even
deprecations.

Practitioner cost evidence: one feature displaying the current date produced *"8 files and 1,300 lines of
text"*; Kiro generated *"4 user stories with 16 acceptance criteria"* for a trivial bug fix; Spec Kit's
command prompts alone cost **18.6k tokens per session** — 93% of Cursor's default window.

## 6. The residue nobody counts

**24.7% of requirement decisions are "structurally valid but discretionary choices not explicitly mandated
by the stakeholder."**

Not bugs. Not requirements. Authorship, exercised by a machine, attributed to nobody. Software has
provenance mechanisms for code and for requirements; it has **none for discretion**. This is the gap the
selected thesis targets — see `08_SELECTED_THESIS.md`.

## 7. Problems nobody is talking about

1. **Models learn to ask good questions exactly when good questions have stopped paying.** Two papers
   exist; nobody has put them together.
2. **The quarter of decisions that are neither requirements nor errors has no owner.**
3. **Specification abandonment is measurable, enabled, and unmeasured.** SpecMine ships lifecycle
   classifications and reports that 81.2% of spec-touching PRs also modify code — meaning **18.8% do not**.
   Nobody has published the abandonment rate or the half-life of a specification. The dataset is public
   with a Zenodo DOI. **The cheapest high-value study available.**
4. **Nobody has priced a developer-second.** The entire cost-aware clarification literature optimises
   against a number never measured.
5. **Security hardening and intent recovery are in direct opposition.** The same environmental signals that
   carry an injected instruction carry the missing requirement. Every paper treats one and ignores the other.
6. **The classical requirements-engineering canon was skipped, not superseded.** KAOS, i*, obstacle
   analysis — four decades on exactly this problem — appear in a handful of 2025–26 papers. Nobody has
   tested whether an obstacle model catches the semantic collapses that clustering misses.
