# Representations, formal methods, evidence

Full evidence: `research/lanes/04-representations.md` (MDE failure analysis, IR, SysML v2) and
`research/lanes/03-specifications.md` (formal methods, evidence, invalidation, semantic diff).

---

## 1. Why model-driven engineering failed — and whether AI changes it

The mission required this analysis before any representation could be proposed. The evidence base is
eleven studies, four of them primary empirical field studies rather than opinion: Whittle et al. (450
practitioners + 22 interviews), Hutchinson et al. (20 engineers across 20 organisations), Kuhn et al. (20
interviewed at one large automotive firm), Petre (50 engineers in 50 companies).

**MDE did not fail on expressiveness. It failed on reviewability.** *(STRONG TREND, high confidence)*

Kuhn's frictions, by interview count:

- **Insufficient support for model diffing — 12/12.** Commercial model-diff tools described as *"going
  blind"*. Engineers worked around it by diffing the *auto-generated source* instead, *"which puts them at
  risk to misinterpret the modeler's intention"*.
- **Lack of point-to-point traceability — 12/12.** Workaround: embedding change-ticket identifiers as
  string markers. *"If engineers forget to mark one of the documents with the unique identifier,
  traceability is broken."*

And the two sentences that should govern any representation proposal:

> *"Engineers seem to prefer a linear reading path of textual diffing in order to make it easier for them
> to 'not miss a change'."* · *"syntactic diffing is in their words 'more than good enough' for most use
> cases."*

One team printed an entire model, hung every layer on a wall, and walked the printout. Another engineer
hand-numbered blocks 8.1, 8.2, 8.3.1.6 *"so I can read the model from top to bottom"*. Offered a tree view
instead of visual UML, engineers preferred the tree.

Kuhn also names the structural cost the current wave has not absorbed: *"the introduction of software
models as an additional layer of abstraction exponentially increases the traceability needs of engineers."*

**Does AI change it?** Scoring every approach: no row earned "AI-YES".

| Approach | Does 2026 AI dissolve the constraint? |
|---|---|
| CASE tools | **Partial.** Authoring cost collapses; the *review* curve does not. Kuhn's 12/12 is a reading problem. |
| 4GLs | **No.** The expressive ceiling is a property of the language, not of who writes it. |
| UML as design language | **Partial.** Cheap production of a notation nobody treated as authoritative does not make it authoritative. |
| MDA / MDD | **No, and the standard is frozen.** The MDA Guide is still revision 2.0, `ormsc/14-06-01`, **June 2014**, and the live OMG page still names CORBA and J2EE as target platforms. Twelve years without revision. |
| Executable UML | **Partial.** Regeneration weakens the round-trip argument; it does not weaken the debugging argument — failure still surfaces in the artifact that runs. |
| DSL movement | **No — inverted.** See below. |
| Low-code | **Partial, possibly terminal.** The 2026 literature reframes low-code as an LLM front-end. |

## 2. AI is anti-DSL

*(OBSERVED TODAY, high confidence — and this is the finding that most directly contradicts the mission's
own premise)*

LLM competence tracks training-corpus mass. Tested across ATL, ETL, QVTo and Reactions: few-shot prompting
improved *syntax* everywhere, but for ATL **"Pass@1 remains unchanged across all strategies and models"**,
and grammar prompting alone *"can be ineffective or even counterproductive"*.

> The 2010 case for a private modelling language was "tooling is expensive". The 2026 case against it is
> "your language is out of distribution and will stay that way."

Markdown won the representation contest at a scale no formal modelling language ever reached: **470,795
`spec.md` files across 73,030 repositories**, and spec-kit plus OpenSpec at roughly 202,000 GitHub stars in
thirteen months, against **~1,345 stars for the entire SysML v2 ecosystem in six years**.

The design precedent is decisive too. **LSP won by explicitly refusing to standardise a semantic
representation**: *"It is much simpler to standardize a text document URI or a cursor position compared
with standardizing an abstract syntax tree and compiler symbols across different programming languages."*
MOF/XMI tried to standardise the representation and lost.

And the MDE research community itself has given up on its own interchange formats: a 2026 mapping study of
86 primary studies finds LLM outputs favour *"lightweight textual formats rather than native MDE exchange
formats"*.

## 3. The one design rule that does transfer

*(STRONG TREND, high confidence — three literatures, three vocabularies, no cross-citation)*

> **LLMs are strong at intensional representations (rules, predicates, constraints) and weak at
> extensional ones (enumerated sets, instance models). An intent artifact must be built out of rules,
> never out of enumerations.**

- *Judging Is Not Enumerating*: judging membership F1 0.74–0.90 while authored suites admit only **19–42%**
  of oracle-correct solutions; the judge-vs-author gap is +0.29 to +0.34 and *"does not close"* over a 24×
  parameter range. The control is decisive: **asked to emit the predicate rather than its extension, the
  same models reach F1 ≈0.99.** Diagnosis: *"The failure is not missing knowledge or an inability to
  specify, but an inability to materialise the region a specification induces."*
- Multi-level modelling: instantiation correctness only 52–79%; models *"rarely complete structure and
  constraints the text implies without stating"*.
- AMIGO: instance models *"serialized as verbose, deeply nested XMI … today's large language models cannot
  reliably produce or edit"* — so it routes intent through schema-typed tools instead.

The corollary nobody has written: **the instance layer must be produced by deterministic tooling, never by
the model.** AMIGO stumbled into the right architecture without naming the principle.

*Honest limit:* the paper only shows models can emit a predicate matching a **known** extension. It does
not show they can emit the right predicate for an **unstated** intent — and a rule set can be silently
incomplete exactly as an enumeration can.

## 4. Where an explicit IR pays, and where it does not

| Domain | Result |
|---|---|
| Hardware RTL (HINT) | **7/7** synthesizable against 1/5 for the direct route; area 5.0–26.2% better than manual |
| Open-domain context compilation (CCA) | 15.4% → **21.4%** — six points, leaving ~79% still failing |
| Model-to-model transformation (LLM4MTLs) | Gains do not reach semantics at all |

The predictor is not formality. It is **oracle availability**: hardware operators have closed semantics, an
executable oracle, and a synthesis tool that adjudicates. Generalising from HINT to general software is
exactly the error MDA made.

## 5. Formal methods: the cost curve split in two

*(OBSERVED TODAY, high confidence — the central economic fact of the mission)*

| | Direction | Evidence |
|---|---|---|
| Proving a **given** property | Collapsing | Schwarz: 91.5% of SV-COMP ReachSafety. CryptoProver: 8 months × 5 engineers → **11.4 hours, $467**. Pure Dafny 68% → 96% in a year. |
| Writing the property that captures **intent** | Barely moved | VeriContest spec-generation 48.3%; end-to-end certified synthesis on 946 real problems **5.29%**; LiveFMBench loses ~20 points once prover-deceiving specs are excluded |

The vericoding headline (Dafny 82% / Verus 44% / Lean 27%) survives replication but **not alignment**: on
identical contracts across all three tools, the best model reaches 55.8% / 26.0% / 23.4%.

**Passing the machine check is decoupled from being right**, across three different checkers: VeriAct finds
*"a large fraction of verifier-accepted specifications, including optimized ones, are in fact incorrect or
incomplete"*; OptiRepair finds roughly **one in four** solver-feasible repairs *"violate supply chain
theory"*; and vericoding finds that adding natural-language descriptions *"does not significantly improve
performance"* — the natural-language intent layer adds nothing to verified synthesis.

**Four independent 2026 results converge on the same escape hatch: the only practical oracle for a
specification is a test.** SpecRL spectests, Verus-SpecGym `exec_spec`, LeetProof PBT-validated specs, and
Kiro's property-based testing. Lahiri's SpecOps keynote states the same doctrine.

## 6. Evidence, invalidation, and semantic diff

**Evidence as artifact** is solved for provenance and unsolved for intent. SLSA and in-toto can attest
*how* an artifact was built and can carry test results — but every predicate's subject is an **artifact
digest**. No predicate can name a requirement, and test names have *"semantics determined separately
between producer and consumer"*.

**Evidence invalidation barely exists as a field.** "Incremental verification" returns 8 arXiv hits since
2024; "regression verification" 2; "specification drift" essentially nothing in software engineering. The
single strongest result is *Partial Contracts Suffice* (July 2026): **LLM-inferred caller-sufficient
contracts give sound regression equivalence with zero false positives.** That is the most promising lead
for Phase 4 of the plan.

**Behavioural diffing is the emptiest square on the board.** The best shipping tool,
`cargo-semver-checks` (1.7k stars), **explicitly refuses** to detect behavioural changes. Academic semantic
differencing peaked in 2014 and the LLM wave has not touched it. There is no `git merge` for requirements,
no definition of what an intent conflict is, and no benchmark.

## 7. SysML v2: adopted, and essentially unadopted

OMG formally adopted KerML 1.0, SysML 2.0 and the Systems Modeling API on **30 June 2025**, with an
editorial update in March 2026 for ISO submission. Thirty-three organisations including Boeing, Lockheed
Martin, Siemens and Dassault contributed to the API specification.

Adoption in software is negligible: the reference release repository holds 912 stars, the API services 96,
and the flagship open-source editor (Eclipse SysON) 337 stars and is still in the **Incubating** phase at
release 2026.7.0. The correct reading is *"SysML v2 has not crossed into software engineering"*, not that
it has no users — its constituency works in commercial desktop tools and does not star repositories.

The interesting move is directional: **SysML v2 added a textual notation**, publishes normative libraries in
it, and Eclipse SysON plans to use *"SysML v2 textual specifications as an exchange format"*. Systems
engineering is adopting software's representation — plain text in files — not the reverse.

And from inside INCOSE: *"Common terms such as 'digital thread', 'digital twin', and 'authoritative source
of truth' are defined inconsistently across domains and organizations."* If the discipline that has
invested most in formal models cannot agree what "source of truth" denotes, a software intent IR has
nothing to standardise against.

## 8. "Compiler" is the wrong metaphor

Scored against the five properties that make a compiler a compiler:

| Property | Holds for intent? |
|---|---|
| Total | No — intent is chronically underspecified |
| Deterministic | No — the front end samples |
| Semantics-preserving | **No, and there is no semantics to preserve** |
| Batch | No — the work is incremental and interactive |
| **Fails rather than guesses** | **No — and this is the dangerous one.** Semantic collapse: coherent, behaviourally misaligned output on 3–32% of tasks |

> A compiler that silently guessed on 32% of programs would be recalled.

The best-supported metaphor is a **language server inside a controller**: incremental, partial and
error-resilient like an IDE compiler (rust-analyzer's parser returns `(T, Vec<Error>)`, not
`Result<T, Error>`, and is *"partially available even when the build is broken"*); closed-loop against
observed reality like a controller. Every working 2026 system has this shape — generate, verify, receive a
structured complaint, repair.

*Honest limit:* "controller" imports its own false promise. Control theory assumes a measurable error
signal and a stable plant, and intent supplies neither. Until a proxy for intent-minus-behaviour exists,
the controller half is aspirational and the honest object is **a language server for intent** — a smaller
and far more buildable thing.
