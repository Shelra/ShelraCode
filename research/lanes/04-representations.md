# Lane 04 — Representations, IR, and the failure of model-driven engineering

Researcher: representations-ir-researcher (compiler / modelling-language perspective)
Date: 2026-09-08. Cutoff for unverified memory: 2024. Everything later was fetched.

Method note: the session's WebSearch quota was exhausted by earlier lanes before this lane started,
and `export.arxiv.org`'s API returned HTTP 429 throughout. Discovery was therefore run against the
**OpenAlex** and **Crossref** REST APIs (which index arXiv preprints, and which were not
rate-limited), with **WebFetch** against arxiv.org abstract pages, publisher pages, standards bodies
and the GitHub REST API for primary reading. This is a different search path to the other lanes, not
a shallower one. Where a source could not be fetched it is marked UNVERIFIED.

---

## 1. Summary (10 lines)

1. The representation contest is already over for now, and Markdown won it: 470,795 `spec.md` files
   across 73,030 GitHub repositories, versus roughly 1,345 GitHub stars for the entire SysML v2
   ecosystem after six years.
2. MDE did not fail on expressiveness. It failed on *reviewability*: 12/12 engineers in the deepest
   field study hit model-diffing friction and fell back to text because text has a linear reading path.
3. The MDE research community itself has abandoned its own interchange formats: a 2026 mapping study
   of 86 primary studies finds LLM outputs favour "lightweight textual formats rather than native MDE
   exchange formats".
4. AI does not relax the DSL constraint, it inverts it. On ATL, `Pass@1` is unchanged across all
   prompting strategies and all models: LLM competence tracks training-corpus mass, so a private IR is
   a *tax*, not a lever.
5. The one asymmetry that genuinely transfers: LLMs are strong at **intensional** representations
   (predicates, rules, constraints — F1 ≈ 0.99) and weak at **extensional** ones (enumerated sets,
   instance models). Choose an IR that states rules, never one that enumerates.
6. In narrow, strongly-typed domains an explicit intent IR does beat direct generation (HINT: 7/7 vs
   1/5 on RTL synthesis). In open domains a typed IR buys 6 points (CCA: 15.4% → 21.4%).
7. Every machine check studied — compiler, verifier, solver — is decoupled from correctness:
   verifier-accepted JML specs are "in fact incorrect or incomplete", and ~1 in 4 solver-feasible LP
   repairs violate the domain theory.
8. SysML v2 is formally adopted (30 June 2025; KerML 1.0 / SysML 2.0 / API 1.0) and essentially
   unadopted in software: its flagship open-source editor is still Eclipse *Incubating* in 2026.
9. OMG still markets MDA, but the MDA Guide is frozen at revision 2.0, `ormsc/14-06-01` — June 2014 —
   and still names CORBA and J2EE as target platforms.
10. "Compiler" is the wrong metaphor. The evidence supports **language server** (incremental, partial,
    error-resilient) wrapped in a **controller** (closed loop against reality), borrowing the solver's
    *diagnostic* and explicitly rejecting the compiler's *totality*.

---

## 2. Mandatory failure analysis: CASE, UML, MDA, xUML, 4GLs, DSLs, low-code

### 2.1 The evidence base

Scholarly retrospectives and empirical studies used. All citation metadata verified via Crossref
and/or OpenAlex on 2026-09-08.

| Study | Design | Scale | DOI |
|---|---|---|---|
| Whittle, Hutchinson & Rouncefield 2014, *The State of Practice in MDE*, IEEE Software | survey + interviews | 450 practitioners + 22 interviews | 10.1109/ms.2013.65 |
| Hutchinson, Whittle & Rouncefield 2011, *Empirical assessment of MDE in industry*, ICSE | 12-month qualitative study | 20 engineers, 20 organisations | 10.1145/1985793.1985858 |
| Hutchinson, Whittle & Rouncefield 2014, *…Social, organizational and managerial factors…*, Sci. Comput. Program. | qualitative | — | 10.1016/j.scico.2013.03.017 |
| Kuhn, Murphy & Thompson 2012, *Forces and Frictions…*, MODELS | semi-structured interviews, one large automotive firm | 20 engineers/managers, 12 coded | 10.1007/978-3-642-33666-9_23 |
| Petre 2013, *UML in practice*, ICSE | interview corpus | 50 engineers in 50 companies | 10.1109/icse.2013.6606618 |
| Mohagheghi & Dehlen 2008, *Where Is the Proof?*, ECMDA-FA | meta-analysis | 25 papers, 2000–2007 | 10.1007/978-3-540-69100-6_31 |
| Selic 2003, *The pragmatics of model-driven development*, IEEE Software | retrospective (1,225 cites) | — | 10.1109/ms.2003.1231146 |
| Iivari 1996, *Why are CASE tools not used?*, CACM | empirical | — | 10.1145/236156.236183 |
| Kemerer 1992, *How the learning curve affects CASE tool adoption*, IEEE Software | empirical | — | 10.1109/52.136161 |
| Baker, Loh & Weil 2005, *MDE in a Large Industrial Context — Motorola Case Study*, MODELS | industrial case study | — | 10.1007/11557432_36 |
| Zhang et al. 2026, *LLMs in MDE: a systematic mapping study*, EMSE | mapping study | 86 primary studies, 2022–early 2026 | 10.1007/s10664-026-10921-4 |

That is well past the required three, and four of them (Whittle, Hutchinson, Kuhn, Petre) are primary
empirical field studies rather than opinion.

### 2.2 What the field studies actually say

Whittle et al. 2014 is the most-cited industry-wide result, and it is not a story of outright failure
— it is a story of **partial application**:

> "although MDE might be more widespread than commonly believed, developers rarely use it to generate
> whole systems. Rather, they apply MDE to develop key parts of a system."

Petre 2013 is blunter. Fifty engineers in fifty companies, five patterns of use, and the framing is
that "UML has been described by some as 'the lingua franca of software engineering' … Evidence from
industry does not necessarily support such endorsements."

Kuhn et al. 2012 is the most useful study for this lane, because it is the only one that asks *why the
representation itself* creates friction. Findings, by interview count:

- **Insufficient support for model diffing — 12/12 interviews.** Engineers described commercial
  model-diff tools as "going blind" (P10). They work around it by diffing the *auto-generated source*
  instead, "which puts them at risk to misinterpret the modeler's intention".
- **Lack of point-to-point traceability — 12/12 interviews.** Workaround: embedding change-ticket
  identifiers as string markers and using keyword search. "If engineers forget to mark one of the
  documents with the unique identifier, traceability is broken."
- Lack of problem-specific visual "little languages" — 3/12. Hungarian notation used as ad-hoc types —
  4/12 (the printed prefix list "fills four pages"). Long build cycles preventing live modelling — 4/12.

And the two sentences that should govern this entire lane:

> "Engineers seem to prefer a linear reading path of textual diffing in order to make it easier for
> them to 'not miss a change' (P9)."

> "syntactic diffing is in their words 'more than good enough' (P7) for most use cases"

One team printed an entire model, put every layer on a wall, and walked the wall-sized printout so
they "can walk through the complete model and don't miss a block" (P7). Another engineer manually
numbered blocks 8.1, 8.2, 8.3.1.6 "so I can read the model from top to bottom" (P12). Offered
Rhapsody's tree view instead of visual UML class diagrams, engineers preferred the tree view and
believed nobody else used the visual form either.

Kuhn also lands the structural point the SDD movement has not yet absorbed:

> "the introduction of software models as an additional layer of abstraction exponentially increases
> the traceability needs of engineers."

### 2.3 The failure table

**AI-NO** = modern AI does not change this constraint; **AI-PARTIAL** = changes the cost but not the
constraint; **AI-YES** = genuinely dissolved. (No row earned AI-YES.)

| Approach | Era | Promise | Why it did not replace coding | Does 2026 AI change it? |
|---|---|---|---|---|
| **CASE tools** | 1985–1995 | Diagrams → systems; enforced method | Learning-curve cost fell on individuals while benefits accrued to the org (Kemerer 1992); poor fit to practice, weak perceived usefulness (Iivari 1996) | **AI-PARTIAL.** Generation cost collapses, so the *authoring* learning curve largely goes. The *review* curve does not: someone must still read and accept the artefact. Kuhn's 12/12 diffing friction is a reading problem, not an authoring one. |
| **4GLs** | 1980s–1990s | Business logic without programmers | Expressive ceiling: inside the domain, fast; outside it, escape to 3GL — and the escape hatch became the system | **AI-NO.** The ceiling is a property of the *language*, not of who writes it. An LLM writing a 4GL hits the same ceiling, with less training data than it has for the 3GL escape hatch. NOT FOUND: a 2025–26 empirical study of LLMs on 4GLs specifically. |
| **UML (as design language)** | 1997– | Common notation; blueprint-then-build | Used selectively and informally; 5 patterns of use, none of them "the source of truth" (Petre 2013). Class diagrams were "only the visual representations of source class skeletons" (Angyal et al. 2008) | **AI-PARTIAL.** LLMs make UML *cheap to produce* (CAS2UML: 557 hand-drawn diagrams → PlantUML; Xiao et al. ICSE-SEIP 2025). Cheap production of a notation nobody treated as authoritative does not make it authoritative. |
| **MDA / MDD** | 2001– | PIM → PSM → code; platform independence | Platform independence was the wrong axis; XMI interchange never really interchanged; tool lock-in; the "platforms" it abstracted over died | **AI-NO, and the standard is frozen.** OMG's MDA Guide is still revision 2.0, `ormsc/14-06-01` (June 2014), and the current OMG MDA page still names CORBA and J2EE as platforms MDA spans. Twelve years without revision. |
| **Executable UML / xUML** | 1998– | The model *is* the program | Debugging happened in generated code, not the model; the abstraction leaked exactly when it mattered; round-trip sync was never solved — "simultaneous evolution of the source code and the software models causes the loss of synchronization" (Angyal et al. 2008) | **AI-PARTIAL.** An LLM can re-derive code from a changed model cheaply, weakening the *round-trip* argument (regenerate, don't reconcile). It does not weaken the *debugging* argument: the failure still surfaces in the artefact that runs. |
| **DSL movement** | 2000s– | Right abstraction per domain | Language-building, tooling, hiring cost; maintenance of a private language | **AI-NO — inverted.** LLM4MTLs (2026) tested ATL, ETL, QVTo, Reactions across three models: few-shot improved *syntax* everywhere, but for ATL "Pass@1 remains unchanged across all strategies and models", and grammar prompting alone "can be ineffective or even counterproductive". A private DSL is now a *deeper* moat against your own tooling than in 2010. |
| **Low-code / no-code** | 2015– | Citizen developers; apps without engineers | Ceiling + lock-in + maintainability cliff; the 4GL shape with a nicer canvas | **AI-PARTIAL, possibly terminal.** The 2026 literature reframes low-code as an *LLM front-end* (LLM-driven LCNC analytics; n8n+Gemini chatbots), moving the value from the visual canvas to the natural-language layer. NOT FOUND: a peer-reviewed 2026 study showing low-code retains an advantage over an LLM writing ordinary code. |
| **MBSE / SysML v1** | 2007– | Model as primary SE artefact | Organisational structure and culture dominate (Henderson & Salado 2023); "MBSE has not achieved widespread adoption" (Call et al. 2024) | **AI-PARTIAL.** See §4: the 2026 work is overwhelmingly *LLM writes the model*, not *model constrains the LLM*. |

### 2.4 The cross-cutting cause the retrospectives agree on

Mohagheghi & Dehlen's meta-analysis of 25 papers found the evidence for MDE's quality benefits was
"anecdotal". Hutchinson et al. found that "complex organizational, managerial and social factors, as
opposed to simple technical factors" decided success or failure. Aranda et al., studying the same
organisation as Kuhn, found switching to MDE "may disrupt organizational structure, creating morale
and power problems".

```
CLAIM: The historical MDE failure was not caused by the tooling gap that AI is now closing; the
dominant documented causes were organisational and cognitive, and AI addresses neither.
LABEL: STRONG TREND
CONFIDENCE: high
EVIDENCE: Hutchinson et al. (ICSE 2011, 20 engineers/20 orgs) attribute success/failure to
"organizational, managerial and social factors, as opposed to simple technical factors". Kuhn et al.
(MODELS 2012) find "contextual forces dominate the cognitive issues of using model-driven technology",
with the top two frictions (model diffing, point-to-point traceability) at 12/12 interviews each, both
being reading/review problems. Mohagheghi & Dehlen (2008) found the benefit evidence across 25 papers
was anecdotal.
SOURCE: Empirical assessment of MDE in industry — Hutchinson, Whittle, Rouncefield — 2011-05-21 —
https://doi.org/10.1145/1985793.1985858 — accessed 2026-09-08; An Exploratory Study of Forces and
Frictions Affecting Large-Scale Model-Driven Development — Kuhn, Murphy, Thompson — 2012 —
https://arxiv.org/abs/1207.0855 — accessed 2026-09-08
COUNTEREVIDENCE: Whittle et al. (IEEE Software 2014) also report that where organisations tailored
tooling to their own domain, MDE did deliver — so tooling is not irrelevant, only insufficient. Kuhn
explicitly scopes his findings to one organisation using Simulink and Rhapsody, and concedes
domain-specific modelling "might alleviate the frictions discussed".
OPEN QUESTION: Rerun Kuhn's interview protocol in 2026 on a team using an SDD toolchain. If
"insufficient diffing" and "lack of point-to-point traceability" again come back at 12/12, the
constraint is representation-layer-invariant and the whole IR programme attacks the wrong thing.
```

---

## 3. Source of truth: where spec-as-source works and where it breaks

### 3.1 The table

| Domain | Artefact that is the source of truth | Why it works (or not) | Verdict |
|---|---|---|---|
| API contracts | OpenAPI, protobuf `.proto` | The spec *is* the interface; both sides generated; checkable at the boundary, and the boundary is narrow. protobuf 72,008★, OpenAPI 31,208★ | **WORKS.** Narrowest, most-checkable interface in software. |
| Infrastructure | Terraform HCL (49,635★) | Declarative desired state + a reconciler that can observe actual state | **WORKS, WITH DRIFT.** The IaC literature is largely *about* drift: model and world diverge and must be continuously reconciled. Works only because a cheap continuous oracle (the cloud API) exists. |
| Database schema | migrations | The migration, not the schema, is the source of truth — the schema alone cannot express *how to get from here to there* without losing data | **BREAKS.** State makes the declarative form insufficient. You cannot regenerate a populated database from its schema. |
| UI | React / declarative components | Declarative rendering succeeded where declarative *systems* failed, because the derived artefact is disposable each frame | **WORKS, NARROWLY.** Nothing persists between renders, so nothing must be reconciled. |
| Systems engineering | SysML v2 model, "authoritative source of truth" | Adopted vocabulary; contested meaning | **CONTESTED.** See §4 and the INCOSE vocabulary finding. |
| AI-assisted software | `spec.md` | 470,795 files, 73,030 repos, 17 tools | **UNPROVEN AT THE POINT THAT MATTERS.** See below. |

### 3.2 The pattern

Spec-as-source works exactly where three conditions hold: **(a)** the derived artefact is cheap to
regenerate, **(b)** there is no hidden state to preserve across regeneration, and **(c)** a cheap,
continuous oracle can tell you whether reality matches the spec. OpenAPI has all three. Terraform has
(a) and (c) and pays for (b) with statefiles and drift detection. Database schemas fail (b).
Executable UML failed (a) at 2003 tool speeds and fails (b) always.

Note what this predicts: an intent IR for general software fails condition **(c)** hardest, not (a).
Generation is now cheap. The oracle is the scarce thing — which is precisely Lahiri's framing.

```
CLAIM: Specification-as-source-of-truth is now the dominant stated practice in AI-assisted development
at very large scale, but no study has yet measured whether those specifications are maintained after
creation.
LABEL: OBSERVED TODAY
CONFIDENCE: high (on adoption); high (on the absence of maintenance evidence)
EVIDENCE: SpecMine (Aug 2026) mines public GitHub and finds 470,795 spec.md/specs.md files across
73,030 repositories attributed to 17 named tools; a separate Kiro census of 98,574
requirements/design/tasks artefacts across 12,910 repositories; 5,992 spec-touching pull requests
across 581 repositories; and a traceability index of 2,421,323 typed references (1.28M to code files,
863k to sibling documents, 152k to PRs). The authors state plainly that "How a spec becomes code is
itself an open question" and position the corpus as infrastructure for future analysis rather than as
completed analysis of quality, drift or staleness.
SOURCE: SpecMine: A Large-Scale Corpus of Spec-Driven Development Artifacts — Agarwal, Singhal, Breaux
(arXiv 2608.25202) — 2026-08-25 — https://arxiv.org/abs/2608.25202 — accessed 2026-09-08
COUNTEREVIDENCE: The 73,030-repos-with-specs vs 581-repos-with-spec-touching-PRs gap is NOT clean
evidence of abandonment — the PR layer was deliberately restricted to 11 tools with 10+ stars, so the
denominators differ. The honest statement is that the question is open, not that specs are abandoned.
OPEN QUESTION: For repositories with a spec.md, what fraction of merged behaviour-changing PRs also
change the spec? That single ratio is MDE's round-trip-engineering failure restated for 2026, and
SpecMine now makes it computable.
```

```
CLAIM: The 2026 spec-driven-development literature is overwhelmingly position papers and gray
literature, not evidence.
LABEL: OBSERVED TODAY
CONFIDENCE: medium-high
EVIDENCE: Diaz et al. (arXiv 2609.00252, Aug 2026), the most careful academic treatment found, states
its own work "represents a first step toward academic-industrial consensus rather than a validated
theory", outlines "a research agenda for future empirical validation", and relied primarily on gray
literature. Several of the most confident-sounding SDD documents surfaced are self-published Zenodo
preprints with zero citations and no evaluation section (Intent-to-System Compiler; Cognitive Compiler;
Spec Driven Development: A Structured Alternative to Vibe Coding).
SOURCE: Spec-Driven Development for Agentic Software Engineering: Harnessing Human-Agent Teamwork —
Diaz, Gayoso, Cimminio — 2026-08-31 — https://arxiv.org/abs/2609.00252 — accessed 2026-09-08
COUNTEREVIDENCE: Alenezi (arXiv 2607.16680, Jul 2026) reports a "73% reduction in security defects
under constitutional constraints" and "50% reduction in time-to-market"; the abstract attributes the
contribution to "a verified literature corpus", so these appear synthesised from cited reports rather
than measured by the authors. Treated here as UNVERIFIED for the numbers.
OPEN QUESTION: Is there a single registered, controlled trial of SDD versus unstructured agentic
development with delivery and defect outcomes? Nothing found.
```

---

## 4. SysML v2 and MBSE: adoption evidence in 2026

### 4.1 What is actually true about the standard

Verified directly at omg.org and the OMG reference-implementation repository on 2026-09-08:

- OMG formally adopted **KerML 1.0**, **SysML 2.0** and **Systems Modeling API and Services 1.0** on
  **30 June 2025**. (The mission brief's "July 2025" is essentially right; the repository states 30 June.)
- The formal specification pages give **Publication Date: September 2025**, document status **formal**,
  with document numbers **`formal/26-03-01`** (KerML), **`formal/26-03-02`** and **`formal/26-03-03`**
  (SysML 2.0 language and transformation) and **`formal/26-03-04`** (API). The `26-03` prefix reflects
  an **editorial update in March 2026 for ISO submission**.
- SysML v2 Beta1 was `ptc/23-06-02`, **July 2023**.
- The API specification was developed by **33 organisations** including Boeing, Lockheed Martin,
  Siemens and Dassault Systèmes.
- SysML v2 ships a **textual notation** alongside the graphical one; normative libraries are published
  in textual notation, KPAR and XMI.

### 4.2 What is actually true about adoption

```
CLAIM: SysML v2 is a completed, ISO-track standard with negligible adoption in software engineering
and immature open tooling more than a year after formal adoption.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: GitHub REST API, 2026-09-08: Systems-Modeling/SysML-v2-Release = 912 stars, 142 forks, 15
open issues (repo created 2020-10-19); Systems-Modeling/SysML-v2-API-Services = 96 stars;
eclipse-syson/syson (the flagship open-source SysML v2 web editor, which underpins SysML v2 editing in
Papyrus and Capella) = 337 stars, and the Eclipse project page records it as still in the Incubating
phase at release 2026.7.0 (10 July 2026). For scale, on the same day github/spec-kit (created
2025-08-21) had 134,102 stars and Fission-AI/OpenSpec (created 2025-08-05) had 67,659 stars. The
Dassault Cameo Systems Modeler product page returned NOT FOUND for any statement of SysML v2 support;
the OMG SysML landing page names no vendors and states only that "SysML v1 will continue to be used for
several years as industry, academia, and government transition".
SOURCE: https://github.com/Systems-Modeling/SysML-v2-Release ;
https://projects.eclipse.org/projects/modeling.syson ; https://www.omg.org/spec/SysML/ ;
https://www.omg.org/sysml/ — all accessed 2026-09-08
COUNTEREVIDENCE: This comparison is unfair in a specific, important way. GitHub stars measure developer
attention, and SysML v2's constituency is aerospace/defence systems engineers who work in commercial
desktop tools (Cameo/CATIA Magic, Rhapsody, Capella) and do not star repositories. spec-kit also carries
GitHub's own distribution. The 33 sponsoring organisations of the API spec are large and serious. NASA's
Gateway programme is documented using DOORS NG + MagicDraw with an authoritative-source-of-truth
architecture. The correct reading is "SysML v2 has not crossed into software engineering", not "SysML v2
has no users".
OPEN QUESTION: What is the count of production (non-pilot) SysML v2 models in industry, and what
fraction of SysML v2 activity is v1 migration versus greenfield? No public figure found.
```

```
CLAIM: SysML v2's most significant move for software engineering is that it adopted a textual notation —
systems engineering converging on software's representation, not the reverse.
LABEL: OBSERVED TODAY
CONFIDENCE: medium-high
EVIDENCE: The SysML v2 release distributes "introductory presentations on SysML v2 textual and graphical
notation" and publishes normative model libraries in textual notation as well as KPAR and XMI. Eclipse
SysON states plans "to adopt SysML v2 textual specifications as an exchange format for interoperability"
— i.e. the text, not the XMI, is becoming the interchange substrate. This mirrors Kuhn's 12/12 finding
on why practitioners fall back to text.
SOURCE: https://github.com/Systems-Modeling/SysML-v2-Release ;
https://projects.eclipse.org/projects/modeling.syson — accessed 2026-09-08
COUNTEREVIDENCE: SysML v2 retains a full graphical notation and a normative XMI serialisation; the
textual notation is an addition, not a replacement, and the KerML metamodel remains the semantic core.
OPEN QUESTION: Will the SysML v2 API (a service interface) or the textual notation (a format) turn out
to be the part that actually gets used? Section 6 predicts the API, on the LSP precedent.
```

```
CLAIM: MBSE's own community reports that its foundational vocabulary — "digital thread", "digital twin",
"authoritative source of truth" — is not consistently defined.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Gregory, Moreland & Wheaton, INCOSE Insight, Oct 2025: "Common terms such as 'digital thread',
'digital twin', and 'authoritative source of truth' are defined inconsistently across domains and
organizations, creating friction in digital information exchange."
SOURCE: The Need for a Shared Vocabulary of Digital Engineering — Gregory et al. — 2025-10-01 —
https://doi.org/10.1002/inst.70009 — accessed 2026-09-08
COUNTEREVIDENCE: None found. This is a self-report from inside INCOSE, which strengthens rather than
weakens it.
OPEN QUESTION: If the discipline that has invested most in formal models cannot agree on what "source of
truth" denotes, what exactly would a software "intent IR" be standardising?
```

### 4.3 What the 2026 SysML v2 + AI literature actually does

Every 2026 paper found points the same direction, and it is the *opposite* of the north-star
hypothesis's arrow. The work is **LLM writes the model**, not **model constrains the LLM**:

- *Prompt-Strategy-Driven SysML-v2 Artefact Generation Using LLMs* (AI, Jul 2026) — prompting
  strategies for generating SysML v2; "reliability … remains insufficiently understood".
- *A multi-agent framework for standards-aligned semantic validation of SysML v2 models*
  (Comput. Stand. Interfaces, Aug 2026) — "Ensuring semantic consistency between formal system models
  and natural-language requirements remains a major bottleneck for scalable MBSE … existing validation
  approaches primarily focus on syntactic correctness."
- *RADIANT* (arXiv 2607.16708, Jul 2026) — requirement model → DSL → system model → behaviour model →
  CSP verification with counterexample-driven repair; reports a 10–15× development-time reduction from
  a **six-participant** study, and concedes semantic gains are "model-dependent".
- SEI, *Native AI Integration for MBSE* (Sep 2026) — "AI could plausibly reduce some of that effort, but
  plausibility is not evidence."

That last sentence, from the Software Engineering Institute, is the fairest summary of this quadrant.

---

## 5. Representations: which compiler concepts transfer

### 5.1 The transfer table

| Compiler concept | Transfers to intent? | Evidence |
|---|---|---|
| **Incremental, on-demand recomputation** (salsa) | **YES — strongly** | rust-analyzer's core invariant: "typing inside a function's body never invalidates global derived data". An intent layer must re-derive only what a change touches, or the loop is too slow to sit in. |
| **Error resilience / partiality** | **YES — strongly** | rust-analyzer's parser "produces `(T, Vec<Error>)` rather than `Result<T, Error>`"; "syntax trees are by design incomplete and do not enforce well-formedness"; the tool "should be partially available even when the build is broken". Intent is *always* incomplete; a representation that rejects incomplete input is unusable. |
| **Diagnostics** (a machine explaining why it cannot proceed, at a location) | **YES** | OptiRepair's IIS-guided diagnosis; RADIANT's counterexample-driven repair; VeriAct's Spec-Harness feedback. All three work by feeding a *structured complaint* back, not by producing a better first draft. |
| **A typed IR with named slots** | **YES, but small effect in open domains** | CCA compiles prose into a typed IR with fixed slots (`rules.{must_do, must_not, conditional}`, `output_spec`, `available_tools`, `data_profile`); on CL-bench (1,899 tasks) it lifts Kimi K2.5 from 15.4% to 21.4%. COVER compiles NL into a typed IR making "variables, domains, quantified constraints, and objectives explicit". HINT does the same for hardware. |
| **Lowering through levels** (MLIR-style dialects) | **PARTIAL** | LACE uses "a compact two-level IR (operation-level and HDL task-level)". MLIR's own premise — that a single low-level IR loses domain information which then needs "complex analysis to recover" — is exactly the intent-loss argument. But MLIR dialects are authored by compiler engineers, not derived from users. |
| **Semantic analysis / name resolution** | **PARTIAL** | Works when the referent is in the artefact. Intent's referents are mostly *outside* it — in the user's head, the market, the regulation. |
| **A canonical AST as interchange** | **NO** | LSP's designers explicitly rejected it: "It is much simpler to standardize a text document URI or a cursor position compared with standardizing an abstract syntax tree and compiler symbols across different programming languages." And empirically ASTs are too verbose — in the BT-vs-AST study many ASTs "exceed the context limit" on longer samples. |
| **Determinism / referential transparency** | **NO** | The front end is a sampler. Same input, different output. Every compiler guarantee downstream of "the front end is a function" is void. |
| **Totality / fail-fast on first inconsistency** | **NO — actively harmful** | A batch compiler's job is to refuse. An intent layer's job is to keep working while the intent is contradictory, because it always is. |
| **A correctness-preserving semantics** | **NO** | There is no denotational semantics for "what the human wanted". Lahiri names specification validation as the bottleneck precisely because "users are ultimately the only source of correctness verification". |

### 5.2 The finding that should drive IR design

```
CLAIM: LLMs are strong at intensional representations (rules, predicates, constraints) and weak at
extensional ones (enumerated sets, instance models, exhaustive suites); an intent IR should therefore be
built out of rules, never out of enumerations.
LABEL: STRONG TREND
CONFIDENCE: high
EVIDENCE: Judging Is Not Enumerating (arXiv 2608.01000, Aug 2026) isolates this precisely: models judging
membership at F1 0.74-0.90 author suites "admitting only 19-42% of oracle-correct solutions"; on the
algorithmic construction the judge-vs-author gap is +0.34 to +0.29 F1 "over a 24x parameter range and
does not close". The control is decisive: "asked to emit the predicate rather than its extension, the
same models reach F1 about 0.99". The paper's own diagnosis: "The failure is not missing knowledge or an
inability to specify, but an inability to materialise the region a specification induces." The dominant
error is omission, which "resists audit" — models detect planted over-inclusions 6-7x more often than
planted omissions, and a 43,227-item production deployment "fails omission-first at 10:1". Three
independent 2026 results share the shape: AMIGO reports instance models "serialized as verbose, deeply
nested XMI … today's large language models cannot reliably produce or edit", and routes intent through
schema-typed MCP tools instead; the multi-level-modelling study finds Instantiation/Specialisation
Correctness of only 52%-79% and that models "rarely complete structure and constraints the text implies
without stating"; and CCA's gains come from a slot-typed rule IR.
SOURCE: Judging Is Not Enumerating: Silent Omissions in LLM-Authored Acceptable Sets — Chen, Chen, Lin,
Long, Vong — 2026-08-02 — https://arxiv.org/abs/2608.01000 — accessed 2026-09-08; Can LLMs Learn and
Apply Multi-Level Modelling Semantics? — Fu, Zhang, Jiang, Cheng, Kaur, Stumptner — 2026-07-14 —
https://arxiv.org/abs/2607.13257 — accessed 2026-09-08; AMIGO: Agentic Model Instance Generation —
Hummel, Rosskothen, Hagel — 2026-08-26 — https://doi.org/10.5445/ir/1000196359 — accessed 2026-09-08
COUNTEREVIDENCE: The rules/enumeration split is not free. Rules must eventually be checked against
instances, and the checking step is where omissions reappear — a rule set can be silently incomplete
exactly as an enumeration can. Judging Is Not Enumerating only shows models can emit a predicate matching
a KNOWN extension; it does not show they can emit the right predicate for an unstated intent. And a
rules-only IR loses the one thing enumerations are good for: being concretely reviewable by a non-expert.
OPEN QUESTION: Does the judge/author gap persist when the model may call tools and iterate, rather than
under the paper's "one-shot greedy authoring with no test-time reasoning" protocol? The paper explicitly
scopes itself to that protocol, so the result may weaken under an agentic harness.
```

### 5.3 Where an explicit IR demonstrably pays

```
CLAIM: In narrow, strongly-typed domains with a real oracle, an explicit intent IR decisively beats
direct generation; in open domains the same idea yields single-digit gains.
LABEL: OBSERVED TODAY
CONFIDENCE: medium-high
EVIDENCE: HINT (arXiv 2608.07625, Aug 2026) inserts "an executable hardware-intent intermediate
representation layer between behavioral specifications or executable oracles and RTL": across seven
operator cases the HINT route produced synthesizable RTL 7/7, versus Direct C2RTL 5/5 (applicable to only
5 of 7) and C2HLSC 1/5; area was 5.0%-26.2% better than five manual RTL implementations and 8.9%-86.1%
better than Direct C2RTL. Contrast CCA in the open domain: 15.4% -> 21.4% on CL-bench. Contrast also
LLM4MTLs, where the IR IS the target language and gains do not reach semantics at all.
SOURCE: HINT: Toward an Executable Hardware-Intent Representation Layer for LLM-Driven RTL Generation —
Cheng, Liu, Zuo — 2026-08-07 — https://arxiv.org/abs/2608.07625 — accessed 2026-09-08; Compile, Don't
Memorize: A Context Compilation Architecture (CCA) for In-Context Learning — Qi, Hu, Zhang — 2026-09-01 —
https://arxiv.org/abs/2609.00759 — accessed 2026-09-08
COUNTEREVIDENCE: HINT's n is seven operator cases — very small, and hardware operators are about the most
favourable domain imaginable (closed semantics, executable oracle, a synthesis tool that adjudicates).
Generalising from it to general software is exactly the error MDA made. CCA's baseline of 12-16% also
means the headline improvement leaves roughly 79% of tasks still failing.
OPEN QUESTION: What domain property predicts the size of the IR's benefit? The candidate is "existence of
a cheap executable oracle" — testable by running the same IR intervention across domains ranked by oracle
availability.
```

### 5.4 The verbosity constraint nobody costed in 2005

```
CLAIM: Representation verbosity is now a hard economic and functional constraint, not an ergonomic
preference, because structured representations consume context budget.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: In a controlled comparison of input representations for vulnerability detection (Mistral Small
3.2 24B, 460 Java samples from the Juliet suite), many ASTs "exceed the context limit" on longer samples;
Behavior Trees "encode control flow, conditions, and executable actions more compactly than ASTs".
Crucially, raw source code achieved higher precision overall — the structured representation was not
uniformly better. AMIGO makes the same point about XMI's verbosity from the MDE side.
SOURCE: Towards Behavior Tree-Guided Vulnerability Detection with Lightweight LLMs — Basic, Giaretta —
2026-09-01 — https://arxiv.org/abs/2609.01758 — accessed 2026-09-08
COUNTEREVIDENCE: Context windows keep growing and per-token prices keep falling, so this constraint is
being relaxed on a fast clock; a 2026 verbosity finding may not hold in 2030. The precision result is
single-model, single-benchmark.
OPEN QUESTION: Does the AST/BT ordering invert at long context and low price, or is there a residual
attention-dilution cost that verbosity always pays?
```

---

## 6. Compiler versus the alternative metaphors

### 6.1 Testing "compiler" against the evidence

A compiler is **total** (defined on all well-formed inputs), **deterministic**, **semantics-preserving**,
**batch**, and **it fails rather than guesses**. Score the intent layer on each:

| Compiler property | Holds for intent? | Why |
|---|---|---|
| Total | No | Intent is chronically underspecified. |
| Deterministic | No | The front end samples. |
| Semantics-preserving | **No — and there is no semantics to preserve** | No denotational account of "what the human wanted". |
| Batch | No | The interesting work is incremental and interactive. |
| Fails rather than guesses | **No — and this is the dangerous one** | Semantic collapse: models "consistently generat[e] coherent but behaviorally misaligned code" — over 10% of MBPP, 3% of HumanEval, **32% of LiveCodeBench** tasks, rising over 5× under injected underspecification. |

Two of five hold weakly, three fail outright, and the one that fails hardest is the one that gives the
metaphor its authority. **"Compiler" over-promises, and it over-promises in the exact direction of the
observed failure mode: it invites the user to believe a clean input yields a faithful output.** A
compiler that silently guessed on 32% of programs would be recalled.

### 6.2 The decisive structural result

```
CLAIM: Passing the machine check is systematically decoupled from being right, and this holds across
compilers, verifiers and solvers alike — so no amount of formalising the IR closes the intent gap.
LABEL: STRONG TREND
CONFIDENCE: high
EVIDENCE: Three independent 2026 results, three different checkers. VERIFIER: VeriAct asks "does passing
a verifier mean that the specification is actually correct and complete?" and finds "a large fraction of
verifier-accepted specifications, including optimized ones, are in fact incorrect or incomplete", via
over- and under-constraining the verifier cannot see. SOLVER: OptiRepair tests 22 API models from seven
families on 976 multi-echelon supply-chain problems; API models average 27.6% feasibility recovery (vs
97.2% for trained models), best-API rational recovery is 42.2% (vs 81.7%), and "roughly one in four
feasible repairs violate supply chain theory". SYNTHESIS: the Vericoding benchmark (12,504 specifications
— 3,029 Dafny, 2,334 Verus/Rust, 7,141 Lean) reports 82% / 44% / 27% verified synthesis, and "adding
natural-language descriptions does not significantly improve performance". Lahiri names this as the
field's grand challenge: specification validation is the bottleneck because "users are ultimately the
only source of correctness verification".
SOURCE: VeriAct: Beyond Verifiability — Misu, Ma, Lopes — 2026-03-31 — https://arxiv.org/abs/2604.00280 —
accessed 2026-09-08; OptiRepair — Ao, Simchi-Levi, Wang — 2026-02-23 — https://arxiv.org/abs/2602.19439 —
accessed 2026-09-08; A benchmark for vericoding — Bursuc et al. — 2025-09-26 —
https://arxiv.org/abs/2509.22908 — accessed 2026-09-08; Intent Formalization: A Grand Challenge — Lahiri —
2026-03-17 — https://arxiv.org/abs/2603.17150 — accessed 2026-09-08
COUNTEREVIDENCE: Dafny's 82% shows the gap is domain- and tooling-dependent, not constant — a mature
verifier with a large corpus gets close to usable. VeriAct and OptiRepair both show the loop improves
things substantially; the claim is that it does not close, not that it does not help.
OPEN QUESTION: Is the residual gap bounded below by something structural (the oracle problem) or merely
by current data? Dafny at 82% vs Lean at 27% is a corpus-size story as much as a semantics story, and
that distinction decides whether the gap shrinks by 2035.
```

### 6.3 Verdict on the metaphor

```
CLAIM: The best-supported metaphor is a language server inside a controller: incremental, partial and
error-resilient like an IDE compiler; closed-loop against observed reality like a controller; borrowing
the diagnostic from the solver and the twin only as an analogy.
LABEL: REASONABLE EXTRAPOLATION
CONFIDENCE: medium
EVIDENCE: The language-server half is grounded in rust-analyzer's stated invariants (salsa
incrementality; (T, Vec<Error>) parsing; "partially available even when the build is broken") — each of
which matches a property intent has and code does not. The controller half is what the working 2026
systems actually are: RADIANT (generate -> CSP-verify -> counterexample-repair), VeriAct (plan -> execute
-> verify -> Spec-Harness feedback), OptiRepair (IIS diagnosis -> repair -> domain validation), Agents4PLC
(generate -> verify -> repair, IEEE TSE 2026), and Agentic Model Transformation, which is explicit:
"Instead of directly replacing transformation engines, the LLM agent generates transformation code,
invokes bounded MCP tools, receives diagnostics from deterministic services, and iteratively repairs
failed transformation attempts." None of these is a compiler; all are control loops around deterministic
services.
SOURCE: https://rust-analyzer.github.io/book/contributing/architecture.html — accessed 2026-09-08;
Replication Package for Agentic Model Transformation — 2026-05-09 —
https://doi.org/10.5281/zenodo.20095491 — accessed 2026-09-08; Agents4PLC — Liu, Zeng, Wang — IEEE TSE —
2026-02-25 — https://doi.org/10.1109/tse.2026.3667895 — accessed 2026-09-08
COUNTEREVIDENCE: "Controller" imports its own false promise — control theory assumes a measurable error
signal and a stable plant. Intent supplies neither: you cannot measure intent-minus-behaviour without the
oracle you do not have, which is why "does reality still match intent?" is the hard arrow in the
north-star chain. "Digital twin" is worse: INCOSE itself reports the term is used inconsistently, and a
twin presupposes a physics you can simulate. "Planner" understates the representation problem entirely.
No metaphor survives intact; the language-server one survives best because it is the only one that was
designed for permanently-incomplete input.
OPEN QUESTION: Is there a measurable proxy for intent-minus-behaviour that does not require the user in
the loop on every change? If not, the controller half is aspirational and the honest object is "a
language server for intent" — a much smaller, much more buildable thing.
```

### 6.4 A note on the "intent compiler" literature

The phrase is spreading faster than the evidence. *Intent-to-System Compiler* and *Cognitive Compiler*
(both Zenodo, Aug 2026, zero citations) propose "compiling human natural language intent … into fully
functional, production-ready, and optimized software systems" and a "Thinking IR" respectively, with no
evaluation. By contrast, the papers that report numbers — HINT, CCA, LACE, COVER — all deliberately scope
the IR to a narrow, checkable domain. That asymmetry is itself a finding: **the compiler metaphor is
load-bearing only where it is least needed.**

---

## 7. Contradictions with common belief

**C1. "We need a representation richer than Markdown."** The evidence says the opposite twice over. By
adoption, Markdown has won at a scale no formal modelling language has ever reached (470,795 `spec.md`
files across 73,030 repos; spec-kit + OpenSpec ≈ 202k GitHub stars in ~13 months versus ~1,345 for the
whole SysML v2 ecosystem in six years). By *design precedent*, the most successful cross-language
interoperability standard in software history — LSP — explicitly refused to standardise a semantic
representation, on the grounds that "It is much simpler to standardize a text document URI or a cursor
position compared with standardizing an abstract syntax tree and compiler symbols across different
programming languages" — and won, while MOF/XMI tried to standardise the representation and lost. And
the MDE research community, when it picks up LLMs, produces "lightweight textual formats rather than
native MDE exchange formats" (86-study mapping, 2026). The binding constraint is not expressiveness.

**C2. "AI removes the tooling barrier that killed MDE, so now models can be the source of truth."** AI
removes the *authoring* barrier and leaves the *review* barrier untouched — and review was the documented
killer (12/12 on diffing, 12/12 on traceability). Worse, AI actively strengthens the argument against
custom notations: LLM competence tracks corpus mass, so on ATL "Pass@1 remains unchanged across all
strategies and models", and grammar prompting alone "can be ineffective or even counterproductive".
**AI is anti-DSL.** The 2010 case for a private modelling language was "tooling is expensive"; the 2026
case against it is "your language is out-of-distribution and will stay that way".

**C3. "Systems engineering and software engineering are converging on formal models."** The convergence
is real and running the other way. SysML v2 added a *textual* notation, and Eclipse SysON plans to use
"SysML v2 textual specifications as an exchange format". Systems engineering is adopting software's
representation — plain text in files — not software adopting systems engineering's graphs.

**C4. "Put a verifier or a solver in the loop and the intent gap closes."** Three checkers, three
domains, same result: verifier-accepted JML specs are "in fact incorrect or incomplete"; roughly 1 in 4
solver-feasible LP repairs "violate supply chain theory"; and adding natural-language descriptions to
formal specs "does not significantly improve performance" across 12,504 vericoding problems. Formality
moves the failure; it does not remove it.

**C5. "MDA is a dead standard everyone has moved on from."** Institutionally it is alive and still
promoted by OMG — but technically frozen: the MDA Guide remains at revision 2.0, `ormsc/14-06-01` (June
2014), and the live OMG page still lists CORBA and J2EE among the platforms MDA spans. That is a more
interesting failure than abandonment: a standards body can keep a paradigm nominally current for twelve
years after its technical content stopped moving. Anyone betting on a standards body to carry an intent
IR should read that as the base rate.

---

## 8. Problems nobody is talking about

**P1. The extensional/intensional asymmetry is never stated as an IR design rule.** *Judging Is Not
Enumerating*, the multi-level-modelling study, and AMIGO independently discovered the same boundary in
three different vocabularies (acceptable sets, instantiation correctness, XMI instance models) and none
cites the others. Nobody has written the design rule that falls straight out of it: **an intent IR must
be a rule language, and the instance layer must be produced by deterministic tooling, never by the
model.** AMIGO stumbled into the right architecture — schema-typed MCP tools instead of emitting XMI —
without naming the principle.

**P2. Traceability multiplication is being re-created, unmeasured, by SDD.** Kuhn's finding is that "the
introduction of software models as an additional layer of abstraction exponentially increases the
traceability needs of engineers", and that engineers coped with string markers so fragile that "if
engineers forget to mark one of the documents … traceability is broken". SDD inserts exactly such a
layer. SpecMine has already measured **2,421,323 typed references** across the corpus — the traceability
graph exists and is enormous — yet the SDD literature surveyed here cites not a single MDE traceability
study. The field is about to rediscover a solved-and-failed problem at 73,030-repo scale.

**P3. Nobody has defined what a semantic diff or a merge conflict *in intent* means.** Kuhn's top
friction was diffing, at 12/12. Specs are now Markdown, so they diff textually — which is why they work —
but a textual diff of a spec tells you the words changed, not that the *meaning* changed, and two
teammates editing adjacent paragraphs can produce a clean textual merge with contradictory intent. There
is no `git merge` for requirements. This is the most obvious unbuilt tool in the space and it appears in
none of the 2026 SDD papers found.

**P4. Representation verbosity became an economic constraint and the modelling community has not
noticed.** ASTs "exceed the context limit"; XMI is "verbose, deeply nested" and unusable to LLMs. Every
formal representation designed between 1997 and 2020 optimised for machine parseability and tool
interchange, with token cost at exactly zero weight. That was free then and is priced now. No 2026
modelling-language paper found treats tokens-per-concept as a language design metric. It should be the
first one.

**P5. The review affordance — the linear reading path — is unowned.** Kuhn's engineers printed a model on
a wall, hand-numbered blocks "8.3.1.6 … so I can read the model from top to bottom", and preferred a tree
view to a diagram, all to manufacture a linear reading path. Agents now generate specs far faster than
anyone reads them, and the productivity-reliability telemetry (+98% PRs, +91% review time, flat delivery,
across 10,000+ developers) is the same constraint surfacing as an economic one. Every 2026 SDD tool
optimises spec *generation*. None found optimises the reading path — the one thing 12/12 engineers built
workarounds for.

**P6. Omission is the dominant error and it is structurally unauditable.** "An over-inclusion is a token
a reviewer can challenge, a missing member an absence whose discovery is the authoring problem itself."
Models detect planted over-inclusions 6–7× more often than planted omissions; a 43,227-item production
deployment "fails omission-first at 10:1". Every review UI ever built — diffs, PRs, comment threads —
shows you what *is* there. Nothing shows you what should have been.

---

## 9. What becomes commodity, what stays hard

**Commodity** (OBSERVED TODAY unless noted)

- Syntactic and grammatical conformance to any well-documented notation. *(LLM4MTLs: few-shot
  "consistently improved code syntax across all four languages".)*
- Translation between notations — UML↔PlantUML, Ecore↔SysML v2, sketch→model. *(CAS2UML; LLM-Driven
  Modeling Tool Interoperability.)*
- Producing a plausible first-draft spec, model or diagram from prose.
- Metamodel/grammar co-evolution and other mechanical maintenance that used to justify a tools team.
- Extracting structure from unstructured prose into typed slots. *(CCA.)*
- Judging whether a candidate satisfies a stated criterion. *(F1 0.74–0.90.)*
- **REASONABLE EXTRAPOLATION:** by 2030, writing a bespoke DSL's parser, formatter, LSP server and docs
  becomes near-free — while the DSL's out-of-distribution penalty persists, so cheap DSL *construction*
  does not imply DSL *adoption*.

**Stays hard**

- **The oracle** — whether a specification is the *right* specification. *(Lahiri; VeriAct; OptiRepair's
  1-in-4.)* STRONG TREND, high confidence.
- **Extensional completeness / omission detection.** *(Judging Is Not Enumerating; a +0.34 F1 gap that
  "does not close" over a 24× parameter range.)* STRONG TREND, high.
- **Implied-but-unstated structure.** Models "rarely complete structure and constraints the text implies
  without stating" — 52–79% instantiation correctness. OBSERVED TODAY, high.
- **Semantic diff and merge of intent.** No tool, no definition, no benchmark found. OBSERVED TODAY (as
  an absence), medium-high.
- **Point-to-point traceability across layers, maintained over time.** 12/12 in 2012; 2.4M typed
  references and no maintenance study in 2026. STRONG TREND, medium-high.
- **Human review attention** — scarce, linear, and the binding constraint on throughput. *(+91% review
  time on flat delivery.)* STRONG TREND, high.
- **State, migrations and side effects.** Regeneration cannot recover data. STRONG TREND, high.
- **Niche/private language semantics** — anti-scaling with model capability. OBSERVED TODAY, medium-high.
- **SPECULATIVE:** that anything above except the oracle is *permanently* hard. The oracle looks
  structural — it is a question about a person, not about a program — and is the best candidate for a
  2050-durable constraint.

---

## 10. Open questions for the second wave

1. **The SpecMine ratio.** For repositories containing `spec.md`, what fraction of behaviour-changing
   merged PRs also change the spec? This is round-trip engineering restated for 2026 and it is now
   computable from a public corpus. If it is low, SDD has already failed the way xUML failed, and the IR
   programme should be redirected from *representation* to *reconciliation*.
2. **Replicate Kuhn on an SDD team.** Do "insufficient diffing" and "lack of point-to-point traceability"
   come back at 12/12 with Markdown specs and coding agents? If yes, the friction is
   representation-invariant and no IR fixes it.
3. **Does the judge/author gap survive an agentic harness?** *Judging Is Not Enumerating* scopes itself
   to "one-shot greedy authoring with no test-time reasoning". Re-run with tools, iteration and a
   reference executor. The paper's own repair result (yield up 3.3–10.6×) hints the gap is
   protocol-dependent, which would substantially soften the intensional/extensional design rule.
4. **What predicts IR payoff?** HINT gets 7/7 in hardware; CCA gets +6 points in open domains. Rank
   domains by oracle availability and run the same IR intervention across them. Hypothesis to test: IR
   benefit is a function of oracle cheapness, not of domain formality.
5. **Is there a proxy for intent-minus-behaviour?** Without one, the controller metaphor is aspirational.
   Candidates worth testing: user correction rate; spec-amendment latency after deploy; the ratio of
   behaviour-changing PRs to spec-changing PRs.
6. **Tokens per concept as a language-design metric.** Measure it for XMI, SysML v2 textual notation,
   PlantUML, Markdown, JSON Schema and a CCA-style slot IR on identical semantic content. Nobody has
   published this table, and it directly decides what an IR should look like.
7. **Does the Dafny/Lean spread (82% vs 27%) close with corpus growth?** This distinguishes "the gap is
   data" from "the gap is semantics", and therefore decides the 2035 outlook for formal IRs.
8. **What actually gets used from SysML v2 — the API or the notation?** §6 predicts the service interface
   outlives the format, on the LSP precedent. Check tool integrations against the Systems Modeling API in
   2027–2028.
9. **A merge-conflict semantics for requirements.** Not a survey question but a design question: what is
   the minimal definition of "these two intent edits conflict" that a tool could enforce? Nothing found.
10. **Solo-builder implication (unresolved).** Every leverage point this lane found — the oracle, the
    reading path, omission detection, spec/code reconciliation — is a *product* problem, not a
    *representation* problem, and none requires inventing a notation. Whether that is an opportunity, or
    an indication that durable value sits with whoever owns the review surface, is the question this lane
    could not settle.
