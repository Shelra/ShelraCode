# The emerging thesis

Lead-authored 2026-09-08, after lanes 01 (truncated), 02, 04, 05, 06, 07, 08, 09, 10. Lane 03
(specifications) still pending. This is a candidate, not a conclusion; §6 lists what could still kill it.

---

## 1. The object nobody owns

Lane 02, problem 9.2, is the sharpest sentence produced anywhere in this mission:

> 24.7% of requirement decisions are "structurally valid but discretionary choices not explicitly
> mandated by the stakeholder". These are not bugs and not requirements: they are **authorship,
> exercised by a machine, attributed to nobody**. Software has provenance mechanisms for code (blame,
> review, sign-off) and for requirements (traceability). It has none for *discretion*. Nobody is
> building the record "the system chose X; the human never said anything about X; here is the list".

That is a measured number for the quantity the abandoned `src/intent/` experiment was trying to
estimate, produced independently, with the gap named as unowned. The experiment was pre-empted; the
*problem* was not.

**Candidate thesis.** The durable, unowned artifact of AI-assisted software engineering is not the
specification and not the code. It is **the record of machine discretion**: the set of behavioural
decisions the system made that no human ever made, each expressed as a checkable rule, each carrying
provenance and a status.

---

## 2. Why this and not the alternatives

Each rejected candidate is rejected by evidence, not taste.

| Candidate | Killed by |
|---|---|
| A richer representation than Markdown | Lane 04: Markdown won 470,795 `spec.md` files to ~1,345 SysML v2 stars; LSP won by *refusing* to standardise a representation; **AI is anti-DSL** — on ATL "Pass@1 remains unchanged across all strategies and models" because competence tracks corpus mass. |
| Spec-as-source-of-truth | Lane 10: Tessl ($125M, the best-funded pure-play) removed it from its homepage. Lane 08: every surviving spec tool is a free giveaway from AWS, GitHub or Zencoder. Lane 04: spec-as-source needs a cheap continuous oracle, which general software lacks. |
| Better clarifying questions | Lane 02: post-clarification collapse *rises* to 37.3–76.5%; multi-turn degradation −39%; goal clarification "loses nearly all value after 10% of execution" and **no frontier model asks inside the optimal window**. Lane 05: three vendors ship it, zero benchmarks score it. |
| A better agent harness | Lane 05: benchmark maintainers made a 100-line bash-only agent the *control condition*; Terminal-Bench's top two harnesses are 0.30 points apart while effort level moves 7.57. |
| Local-first / zero-cost inference | Lane 09: local inference costs $0.14–0.17 per M output tokens **in electricity alone**, at parity with the cheapest cloud open model; 20 of 26 open-weight 2026 models need >128 GB at 4-bit; hardware improves 1.49×/yr against a 40–100×/yr price-at-capability curve. |
| Anything compensating for a current model weakness | Lane 09: for **37–63% of ICSE 2026 LLM-technique papers, a newer model with a plain prompt beats the tooling from a year earlier**. "Intent survives; workarounds do not." |

The discretion record survives all six tests. It is not a notation, not a source of truth, not a
question generator, not a harness, not an inference strategy, and it does not get better when the
model does — it gets *larger*, because a more capable model exercises more discretion, not less.

---

## 3. The design rules the evidence dictates

Every one of these is a convergence of at least two independent lanes.

1. **Rules, never enumerations.** Predicate-writing F1 ≈0.99; authored acceptance sets admit 19–42% of
   correct solutions; omissions detected 6–7× less often than over-inclusions. *(Lanes 02, 04, 05, 10 —
   three separate literatures that do not cite each other.)*
2. **The model judges; it must never enumerate.** On executable code across models: judge F1 0.74–0.90
   while the suites those same models author admit only **19–42%** of oracle-correct solutions. (The
   often-quoted 0.60–0.77 vs 0.26–0.48 pair is narrower than it looks — it comes from one
   algorithmic-construction task across a Qwen2.5 parameter sweep, per the lane-10 verification audit.
   Use the cross-model numbers above; the *direction* is safe, holding at +0.25 to +0.34 at every scale.) The
   candidate set comes from outside the model — from the code diff, the telemetry, a fixed catalogue.
3. **Start where an oracle already exists.** Lane 04's three-condition test (cheap regeneration / no
   hidden state / **cheap continuous oracle**) and lane 02's circularity verdict ("the circularity bites
   hardest exactly where no oracle exists") and lane 01's historical pattern (shifts succeed when the
   residual gap is *performance*, not *correctness*) are the same constraint stated three ways.
   Concretely: OpenAPI contracts, RFCs, ADRs, regulatory text, IaC policy, invariants already asserted
   in code. RFCAudit is the existence proof — 47 real bugs at 81.9% precision against RFC prose.
4. **Show what is absent, not what is present.** Lane 04 P6: every review UI ever built shows what *is*
   there. The failure mode is omission and it is structurally unauditable by diff.
5. **Cost the requester almost nothing.** Lane 10's accountability tax; lane 02's 9.4 — nobody has priced
   a developer-second, and every clarification cost model is `turns × constant`.
6. **Do not depend on the human to validate.** Lane 02's decisive finding: 86 programmers judged
   *incorrect* assertions at **49% — chance** — with confidence indistinguishable from correct ones, and
   bad explanations *raised* confidence while lowering accuracy. Lahiri's founding assumption ("no oracle
   but the user") was tested in July 2026 and the user failed.

Rule 6 is the one that changes everything. The product cannot be "ask the human to confirm". It must be
"make the decision *visible and cheap to contest*", which is a different and much weaker demand on human
judgement.

---

## 3b. The unification with lane 01

Lane 01 arrives at a different-sounding conclusion from a completely different route — historical
abstraction analysis — and it turns out to be the same object.

Its 2035 forecast: *"The primary engineering activity is **oracle engineering**: designing, maintaining
and evolving the executable checks that decide whether a generated system matches intent."* Three
independent lines converge on it: Conant–Ashby (the regulator must contain a model of the system),
FlowCheck (deterministic checks beat LLM judges 30/30 versus 26/30), and judging-beats-enumerating.

And the sentence that reframes the division of labour:

> the machine is good at *checking* and bad at *specifying*, exactly inverting the popular division of
> labour.

**The unification.** A discretion record whose entries are *executable checks* is simultaneously both
objects. Each entry reads "the system chose X where nothing required X", expressed as a predicate that
can be evaluated against the running system. That makes it:

- a **provenance record** (lane 02's missing mechanism for discretion),
- an **acceptance oracle** (lane 01's durable 2035 asset),
- a **rule, not an enumeration** (lanes 02/04/05/10's design law),
- and **omission-visible** (lane 04 P6), because the record's entries are precisely the things absent
  from the request.

Four lanes, four routes, one artifact. That is the strongest structural result the mission has produced,
and none of the four lanes could see it alone.

Lane 01 also supplies the historical warning that bounds the ambition: the abstraction shifts that
succeeded had a **decidable equivalence check** between levels (Boolean equivalence for logic synthesis;
fixed relational semantics for SQL, where a bad plan is *slow*, not *wrong*). High-level synthesis
stalled for thirty years because turning C into RTL requires *inventing* a micro-architecture. Intent →
code sits on the failure side: no decidable check exists between an English intent and a program, and
the residual gap is a correctness gap. **So the product must never promise to close the gap. It can only
promise to make its contents visible.**

## 4. The honest problem statement

Lane 08 wrote it better than the mission brief did:

> The failure modes we can currently measure have not worsened. Reverts catch breakage in days; nothing
> in these datasets can see a requirement quietly implemented wrong. Anyone selling "AI is breaking
> production" is ahead of the evidence — and anyone concluding "therefore it is fine" is mistaking the
> absence of a measurement for the absence of a problem.

So the thesis is **not** "there is a reliability crisis". It is: *there is a class of decision that is
now being made at machine volume, by machines, with no record, and no instrument exists that would tell
us whether it matters.* The first deliverable is therefore the measurement, not the product.

---

## 5. Where this sits on the north-star chain

Not on the arrows the brief emphasised. The decision record sits **between** understanding and
specification, and it is orthogonal to all five arrows: it is the log of every place an arrow was
traversed without a human. That is why it survives all three scenarios — agent-dominant, spec-dominant
and hybrid. In an agent-dominant world there are *more* undeclared decisions, not fewer.

Sub-hypotheses from `00-north-star-as-hypothesis.md`, provisional verdicts:

| id | Verdict | Basis |
|---|---|---|
| H0 (five-node chain is the right decomposition) | **Partly false** | The decision record is orthogonal to the chain, not a node on it. Lane 04 shows the representation question is settled against the brief. |
| H1 (each arrow loses information, losses compound) | Unsupported as stated | Lane 08: measured failure modes have not worsened. The loss is real but currently unobservable, which is not the same claim. |
| H2 (loss can be measured) | **Partly true, newly so** | Three oracle-free proxies appeared in 2026 (regeneration equivalence, deterministic execution judges, symbolic over/under-constraint). All three are blind to a faithfully-encoded misunderstanding. |
| H3 (loss moves upward and outward as generation cheapens) | **Supported** | Lane 01's abstraction pattern; lane 02's benchmark migration; lane 09's "intent survives, workarounds do not". |
| H4 (explicit representation pays for itself) | **False for prose, open for predicates** | ETH ablation: −0.5% to +2.4%, never significant, +20–23% cost. But every *partial, predicate-shaped* intervention measured a real gain. |
| H5 (invariant across futures) | **Supported** | Discretion volume rises with capability under every scenario. |
| H6 (solo-buildable) | **Conditionally** | Only as an OSS CLI in CI, starting where the oracle exists. Absorption lag is 19 days to 8 months; `/import` zeroes configuration lock-in. |

---

## 6. What would kill this thesis

Ranked by how cheaply each can be tested.

1. **The base rate is near zero.** Lane 08's U1 test: take 50 merged PRs from a repo with written ADRs
   or an OpenAPI contract; count how many silently violated a stated commitment without breaking a test
   or causing a revert. **Under ~5% and the thesis is dead.** This is the single decisive experiment and
   it needs no new corpus.
2. **The decisions are not consequential.** 24.7% indeterminate is measured, but "discretionary" is not
   the same as "would have been decided differently by a human who cared". If a human shown the list
   shrugs at 90%+ of it, the record is noise.
3. **Nobody will read it.** Lane 04's P5 — the reading path is the binding constraint, and this thesis
   adds another artifact to read. If the record is not *shorter* than the diff it replaces, it fails on
   its own terms.
4. **An incumbent ships it.** Spec Kit already ships `/speckit.converge`; Baz already ships a per-PR
   spec-reviewer agent. If either goes longitudinal, the wedge closes.
5. **The oracle precondition is too narrow.** If the only places with a cheap oracle are also the places
   with the fewest undeclared decisions, the addressable surface is empty.

---

## 7. Immediate next steps

- Lane 03 is still pending and owns the executable-specification evidence. Do not finalise before it lands.
- Lane 01 returned truncated at section 3 (no 2026→2056 timeline). Re-run.
- Wave 2 must resolve: B1 (prose spec vs checkable predicate), B2 (does the review bottleneck actually
  exist — obtain DORA 2025/2026 primaries), B3 (where the residual failures live: retrieval, state, or
  intent), and the F1 provenance question (+98%/+91% is unverified).
- Test 6.1 above before any further architecture work. It is cheap, it is decisive, and everything else
  is downstream of it.
