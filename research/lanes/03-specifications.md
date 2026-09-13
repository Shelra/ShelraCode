# Lane 03 — Specifications, formalization, evidence

**Question:** Can intent become machine-checkable without specification becoming as expensive as
implementation — and what is the evidence in September 2026?

**Author:** Lane 03 agent · **Date:** 2026-09-08 · **Sources:** 86 (3 UNVERIFIED) · **Searches:** 41

---

## 1. Summary (10 lines)

1. Spec-driven development won the distribution war and lost the checking war: Spec Kit (134k stars) and OpenSpec (67.7k) ship a *prose* artifact whose only checker is another LLM reading Markdown.
2. Every "validation" command in the three biggest SDD tools is either structural (OpenSpec `validate`) or LLM-judgemental (`speckit.analyze`, `speckit.converge`, Kiro `analyze_requirements`). None of them executes anything.
3. The one exception is AWS Kiro, which compiles EARS requirements into property-based tests with shrinking and a requirement↔property↔task hover-link — the only shipping product where a written requirement becomes a runnable check.
4. Tessl — the company that made "specs are the new source code" its identity — has removed specs from its product entirely; its docs index in Sept 2026 contains zero pages about `.spec.md`, spec registries or the Tessl Framework, and sells skills governance instead.
5. The vericoding headline (Dafny 82% / Verus 44% / Lean 27%) survives replication but does not survive *alignment*: on identical contracts across all three tools (AlgoVeri, 77 problems) the best model reaches 55.8% / 26.0% / 23.4% verified, and on 946 real competitive problems (VeriContest) end-to-end certified synthesis is **5.29%**.
6. The cost curve has split in two. Proving a **given** property is collapsing fast (Schwarz 91.5% of SV-COMP ReachSafety; CryptoProver replaced 8 months × 5 engineers with 11.4 hours and $467). Writing the property that captures **intent** has barely moved (VeriContest spec-gen 48.3%; LiveFMBench loses ~20 points once prover-deceiving specs are excluded).
7. Four independent 2026 results converge on the same escape hatch: the only practical oracle for a specification is a **test** (SpecRL spectests, Verus-SpecGym `exec_spec`, LeetProof PBT-validated specs, Kiro PBT). Lahiri's SpecOps keynote states the same doctrine.
8. "Evidence as artifact" is solved for provenance and unsolved for intent: SLSA/in-toto can attest *how* an artifact was built and even carry test results, but every predicate's subject is an artifact digest — no predicate can name a requirement, and test names have "semantics determined separately between producer and consumer".
9. Evidence *invalidation* barely exists as a research field: "incremental verification" returns 8 arXiv hits since 2024, "regression verification" 2, and "specification drift" as a phrase returns essentially nothing in software engineering. The single strongest result is *Partial Contracts Suffice* (Jul 2026): LLM-inferred **caller-sufficient** contracts give sound regression equivalence with zero false positives.
10. Behavioural diffing is the emptiest square on the board. The best shipping tool (`cargo-semver-checks`, 1.7k stars) explicitly refuses to detect behavioural changes; academic semantic differencing peaked in 2014 and has not been touched by the LLM wave.

---

## 2. SDD today

### 2.1 The comparison table

| Tool | What a "spec" concretely is | Is it checked? By what? | Drift handling | Adoption evidence | Failure evidence |
|---|---|---|---|---|---|
| **GitHub Spec Kit** v1.0.4 (2026-09-02) | `specs/<feature>/spec.md` + `plan.md` + `tasks.md` + `constitution.md` + `checklists/*.md`. Markdown template with prioritised user stories (P1/P2/P3), Given/When/Then acceptance scenarios, `[NEEDS CLARIFICATION]` markers, "technology-agnostic and measurable" success criteria. | `/speckit.analyze` — **LLM reads the three Markdown files**, artefact-to-artefact only, "Do not modify any files". `/speckit.converge` (new in 1.0) — **LLM reads source files** and classifies gaps as missing/partial/contradicts/unrequested. Explicitly "not test execution or linting". `/speckit.checklist` — reviewer-owned human checkboxes. | Two documented models: *Living Spec* ("revise the existing `spec.md` first, then regenerate or manually revise downstream artifacts") and *Flow-Back*. Detection mechanism named: run `/speckit.analyze`. Convergence loop: repeat implement+converge "until `/speckit-converge` reports Converged". | 134,092 stars, 12,067 forks, created 2025-08-21, v1.0.0 shipped exactly one year later (2026-08-21), pushed same day as access (2026-09-08). 30+ agent integrations. | 318 open issues. #1401 (open, +15 reactions): the command prompts alone cost **18.6k tokens** every session — 93% of Cursor's default window, 29% of Copilot's 64k. #230: "Copilot ignores specifications after context clear, makes incorrect assumptions". `spec-of-specs.md` exists solely because a single feature will not fit in context, and warns decomposition "adds the most overhead of any strategy". |
| **AWS Kiro** (Web GA 2026-09-01) | `.kiro/specs/<name>/` → `requirements.md` (or `bugfix.md`), `design.md`, `tasks.md`. Requirements written in **EARS**: `WHEN a user submits valid registration data / THE SYSTEM SHALL create a new user account`. | **Yes, partially executable.** `/spec analyze_requirements` is LLM cross-requirement reasoning ("takes minutes, not seconds"). Separately, **property-based testing**: Kiro "extracts properties from your EARS-formatted requirements… then generates hundreds or thousands of random test cases", with shrinking, and a hover link from property → originating requirement → linked task. | No dedicated drift command. Real-time task status. PBTs re-runnable; on failure Kiro "can automatically update your implementation or surface options to fix the spec, implementation, or test itself". | Commercial AWS product; five paid tiers $0–$200/user/month, credit-metered, 190+ countries; in scope of AWS ISO/IEC 27001:2022. Kiro Web GA 2026-09-01. | PBT is **IDE-only** (not CLI, not Web, not Mobile) and "optional by default". Kiro's own docs concede: "It provides evidence of correctness, not a proof… A property that is too weak, or that states the wrong invariant, will pass while the real behavior is still wrong." |
| **Tessl** | **Nothing.** As of 2026-09-08 the docs index (`docs.tessl.io/llms.txt`, 60+ pages) contains no page on specs, `.spec.md`, spec-driven development, the Tessl Framework or a spec registry. The unit is now a *skill*. A community plugin (`tesslio/spec-driven-development-tile`, 53 stars) still defines a spec as "a markdown file (`.spec.md`) with YAML frontmatter" with inline `[@test]` links and `validate-specs.sh` / `check-spec-links.sh`. | In the surviving plugin: yes — scripts check required structure and that referenced tests exist. In the *product*: skills are "versioned, evaluated, and security-checked", not specs. | N/A in product. The plugin's "work review" step catches "implementation drift". | Registry claims "3,000+ searchable skills". CLI at v0.106.0. | **The pivot is the failure evidence.** The most spec-maximalist vendor now sells registry/governance/evals/observability for *skills*. The CLI changelog (0.61.1→0.106.0) contains no spec entries at all — not even deprecations. |
| **OpenSpec** v1.11–1.12 (Fission-AI) | `openspec/changes/<name>/` → `.openspec.yaml`, `proposal.md`, `specs/<capability>/spec.md`, `design.md`, `tasks.md`. Requirements are `### Requirement: X / The system SHALL …` with mandatory `#### Scenario:` blocks in `- **WHEN** … - **THEN** …` form. Deltas typed as `## ADDED / MODIFIED / REMOVED / RENAMED Requirements`. | `openspec validate [--strict]` — "**Checks changes and specs for structural issues**" plus archive merge preflight. Structural only. `/opsx:verify` — LLM "check the implementation matches the spec". | Best-in-class *requirements* diff: deltas merge into the main specs at `openspec archive`, MODIFIED must carry full updated content, REMOVED requires Reason + Migration. Zero-delta changes are rejected unless marked `skip_specs`. | 67,659 stars, created 2025-08-05, pushed 2026-09-07; site claims "one new spec created every two seconds"; npm `@fission-ai/openspec`. | 239 open issues. **Issue #987 "executable specs via step definitions — run scenarios directly against the system" was closed as _not planned_.** The requester's argument — "Spec IS the test — no duplication, no drift" — was declined. #829 "[Proposal] Schema-Driven Artifact Validation" still open. #783 "Cross-artifact quality review" still open. |
| **BMAD-METHOD** | Briefs → specifications → architecture → stories; "durable decision records". Loop: Clarify → Plan → Build and verify → Learn and adjust. | No mechanical validation documented. | Not documented. | 52,789 stars, pushed 2026-09-08, only 31 open issues. | No checking layer of any kind; positions itself as method, not tooling. |

### 2.2 What the table means

```
CLAIM: In September 2026, no mainstream spec-driven-development tool mechanically checks a
       specification against code; every "check" is either structural or an LLM reading Markdown.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Spec Kit's own command definitions: /speckit.analyze does "cross-artifact consistency
  analysis" on spec.md/plan.md/tasks.md, "Do not modify any files", and does NOT check code.
  /speckit.converge does compare code to spec but by "LLM reading and inspection — not automated
  tests or static analysis"; its gap taxonomy is missing/partial/contradicts/unrequested.
  OpenSpec's `validate` is documented as "Checks changes and specs for structural issues".
  Kiro's `analyze_requirements` is cross-requirement LLM reasoning over requirements.md only.
SOURCE: templates/commands/analyze.md and converge.md — GitHub Spec Kit — v1.0.4, 2026-09-02 —
  https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/converge.md — accessed 2026-09-08;
  CLI reference — OpenSpec/Fission-AI — 2026 — https://openspec.dev/docs/cli — accessed 2026-09-08;
  Analyze Requirements — Kiro — https://kiro.dev/docs/specs/analyze-requirements.md — accessed 2026-09-08
COUNTEREVIDENCE: Kiro's property-based testing feature is a genuine exception — EARS requirements
  are compiled into executable properties and run. But it is IDE-only, optional by default, and
  Kiro's docs state plainly it "is not formal verification".
OPEN QUESTION: Does /speckit.converge's LLM code-reading detect contradictions a test suite
  would miss, or does it merely restate what the tests already fail on? No published evaluation.
```

```
CLAIM: The best-funded, most explicitly spec-centric vendor (Tessl) removed specifications from
       its product between 2025 and September 2026 and now sells skill governance.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: docs.tessl.io/llms.txt lists ~60 documentation pages across Overview, Tutorials, Skills,
  Governance, Distribution, Projects and Reference. Zero pages mention specs, .spec.md,
  spec-driven development, the Tessl Framework, or an AI-native package registry. tessl.io
  describes "Tessl Platform / Tessl Agent / Tessl Registry" as an "Agent Enablement Platform"
  with "3,000+ searchable skills". The CLI changelog from v0.61.1 to v0.106.0 records deprecations
  of `tessl skill review` and the `tile` term — and no spec deprecation, because there was
  nothing left to deprecate.
SOURCE: Tessl documentation index — Tessl — accessed 2026-09-08 — https://docs.tessl.io/llms.txt ;
  Tessl homepage — accessed 2026-09-08 — https://tessl.io/ ;
  CLI changelog — Tessl — accessed 2026-09-08 — https://docs.tessl.io/changelog-cli.md
COUNTEREVIDENCE: A community plugin `tesslio/spec-driven-development-tile` (53 stars) still
  implements `.spec.md` files with `[@test]` requirement→test links and validation scripts, so
  the idea survives as a plugin. Tessl's registry could re-add specs at any time.
OPEN QUESTION: Was the pivot driven by customer demand, by the collapse of spec-regeneration
  economics, or by the arrival of agent-skill registries as a hotter market? No public post-mortem
  found after searching Tessl's site, docs and changelog.
```

```
CLAIM: The SDD community's own users asked for executable specs and were refused.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: OpenSpec issue #987, "executable specs via step definitions — run scenarios directly
  against the system" (opened 2026-04-18), proposed `openspec test --change <name>` parsing
  WHEN/THEN scenario blocks and matching them to Cucumber-style step definitions, arguing
  "Spec IS the test — no duplication, no drift". Status: **Closed as not planned.** OpenSpec has
  67,659 stars and ships `validate` for structure only.
SOURCE: Issue #987 — Fission-AI/OpenSpec — opened 2026-04-18 — https://github.com/Fission-AI/OpenSpec/issues/987 — accessed 2026-09-08
COUNTEREVIDENCE: Related requests were accepted in weaker form: #1047 "dedicated review/verify
  command" and #1073 "pre-submit semantic cleanup checkpoint" were closed as done, and v1.12.0
  "adds focused validation reports". So the maintainers invested in *review*, not *execution*.
OPEN QUESTION: Was it refused on principle (specs must stay language-agnostic) or on cost
  (step-definition registries are a maintenance burden)? No maintainer rationale visible.
```

### 2.3 SpecOps 2026

```
CLAIM: A dedicated academic venue for spec-driven SDLC exists and is run by industry formal-methods
       groups (Amazon, NASA, Google, Meta, Tencent), but no accepted-paper list is public.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: "SpecOps 2026: 1st International Workshop on Specification-Driven Development Life Cycle",
  6 October 2026, Oakland Marriott City Centre, co-located with ISSTA/SPLASH 2026. Chairs: Rajdeep
  Mukherjee (Amazon), Anastasia Mavridou (KBR/NASA Ames), Saikat Dutta (Cornell). PC includes
  José Pablo Cambronero and Michele Tufano (Google), Ferhat Erata and Pardis Pashakhanloo (AWS),
  Brandon Paulsen (Amazon), Pascal Kesseli (Meta), Chao Peng (Tencent), Corina Păsăreanu (CMU),
  Baishakhi Ray (Columbia), Martin Kellogg (NJIT), Marie Farrell (Manchester), Eunsuk Kang (CMU),
  Cristina David (Bristol), Alessio Ferrari (UCD/CNR), Divya Gopinath (KBR/NASA), Andreas Katis
  (KBR/NASA), Ajitha Rajan (Edinburgh), Marcelo Sousa (Oxford), He Ye (UCL).
  Keynotes: Shuvendu Lahiri (MSR) "Intent Formalization: Assessing the Quality of AI-Generated
  Formal Program Specifications"; Corina Păsăreanu & Joe Rutland (CMU / Amazon Prime Air)
  "Bridging Requirements and Assurance: Neurosymbolic Autoformalization for C++ Verification and
  Requirements-Coverage Testing"; Niranjan Tulpule (Google, title TBA). Dates: abstracts 23 Jun,
  papers 30 Jun, notification 15 Jul, camera-ready 24 Aug 2026. CFP topics explicitly include
  "Specification maintenance: Co-evolution of code and specifications, detecting specification
  drift" and "Change impact analysis". **Accepted paper titles: NOT FOUND** — the programme page
  lists only keynotes as of 2026-09-08, six weeks after camera-ready.
SOURCE: SpecOps 2026 — SPLASH/ISSTA 2026 — accessed 2026-09-08 —
  https://conf.researchr.org/home/splash-issta-2026/specops-2026
COUNTEREVIDENCE: Only a workshop, first edition, 4–10 page papers, ACM DL proceedings. Its
  existence proves a community is forming, not that the problem is being solved.
OPEN QUESTION: What did get accepted? Worth re-checking after 6 October 2026; the proceedings will
  be the first citable corpus for spec-drift research.
```

Two details from the Lahiri keynote abstract are load-bearing for this whole lane and worth quoting
exactly: *"Since specifications lack an independent oracle, verifying that they truly capture user
intent is difficult and user-dependent"* and *"Using tests as a proxy oracle, we define metrics —
soundness, completeness, and preciseness — to quantify how well a specification matches intent"*.
The named prototypes are TiCoder, nl2postcond, Dafny spec validation, AutoVerus, and F* agentic
proof repair. Note also a correction to the mission brief: Lahiri's arXiv abstract (2603.17150,
17 Mar 2026) enumerates **five** named open challenges — scaling beyond benchmarks, compositionality
over changes, metrics for validating specifications, rich logics, human-AI specification interaction
— not seven.

---

## 3. Executable specifications: what actually exists

The category splits into five mechanisms. Only the first two run today at product scale.

**(a) Requirement → property-based test.** Kiro extracts properties from EARS requirements and
generates thousands of random cases with shrinking, keeping a hover-visible link from property to
requirement to task.

**(b) Requirement → linked test reference.** Tessl's SDD plugin uses inline `[@test]` links in
`.spec.md` and CI scripts that fail when a referenced test does not exist. Structural, not semantic.

**(c) Spec → executable spec (verification languages).** Verus-SpecGym extends Verus's `exec_spec`
so a *specification* compiles to Rust and can be run against tests.

**(d) Spec → runtime monitor / model checker.** Specula generates TLA+ specifications with
invariants directly from system code and model-checks them.

**(e) Failure → reverse-engineered executable spec.** Project Prometheus reverse-engineers Gherkin
contracts from runtime failure reports before attempting a repair (93.97% correct patches on
639/680 Defects4J defects; 74.4% rescue rate on 119 bugs baseline agents failed).

```
CLAIM: Across four independent 2026 systems, the only workable oracle for a specification turned
       out to be a test — nobody found a better one.
LABEL: STRONG TREND
CONFIDENCE: high
EVIDENCE: (i) SpecRL: "verification can prove that a specification is sound for the implementation,
  yet it cannot tell whether the specification is too weak"; it therefore builds *spectests* from
  implementation-impossible I/O pairs that a vacuous `ensures true` would still admit, and rewards
  the fraction rejected — +49.96% verification success and +26.46% completeness over SFT at 7B on
  the out-of-distribution DafnyComp-Spec benchmark.
  (ii) Verus-SpecGym: 581 Codeforces-derived spec-writing tasks; specs made executable via
  `exec_spec` and tested against official tests *plus adversarial "hack" cases*; Gemini 3.1 Pro
  77.8%, other frontier models 51.1–57.8%, OSS 21.5–25.5%; and crucially "LLM-as-a-judge
  evaluation misses 26% of the failures our evaluator catches".
  (iii) LeetProof/Velvet: stage one "validates specifications through randomized property-based
  testing", and this validation "revealed defects in existing reference benchmarks".
  (iv) Kiro ships exactly this loop as a product feature.
  (v) Lahiri's SpecOps keynote states the doctrine outright: "Using tests as a proxy oracle".
SOURCE: SpecRL — Huang, Zhang, Sun, Sun, Xiong — 2026-04-07 rev 2026-07-14 — arXiv:2604.05820;
  Verus-SpecGym — Agarwal, Neamtu, Aggarwal, Kim, Limperg, Flamant, Shimizu, Parno, Welleck —
  2026-05-26 — arXiv:2605.26457; Certified Program Synthesis with a Multi-Modal Verifier —
  Feng, Kafle, Gladshtein, Kurin, Pîrlea, Zhao, Müller, Sergey — 2026-04-17 — arXiv:2604.16584;
  Correctness with Property-based tests — Kiro — https://kiro.dev/docs/specs/correctness.md.
  All accessed 2026-09-08.
COUNTEREVIDENCE: Fidelity Probes (arXiv:2605.17246) offers a genuinely different oracle —
  code-derived NL question/answer probes — and raised specification fidelity from 0.63 to 0.94
  on a 12k-line COBOL benchmark without executing anything. And The Faithfulness Gap
  (arXiv:2606.16541) certifies NL↔formal equivalence via bidirectional provability fingerprinting,
  catching 89.6% of drifted formalizations at 3.0% FPR versus 41.2% for typecheck and 63.3% for an
  LLM judge — also without tests.
OPEN QUESTION: Is a test-based oracle fundamentally limited to properties with cheap witnesses?
  Nothing found on test-as-oracle for liveness, security, or performance requirements.
```

```
CLAIM: Making a specification the intermediate artefact measurably improves test quality on real
       production bugs — a rare industrial-scale positive result for spec-driven work.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Google's Spec-Driven Test Generation instructs an agent to first reason about and
  explicitly document pre-conditions, post-conditions and undefined behaviours — "an intermediate
  semi-formal specification acts as a cognitive scaffold". On production bugs from Google:
  +9.8 percentage points bug-detection rate (p = 0.0352) and +2.5 pp branch coverage (p = 0.0034)
  versus a traditional test-generation agent. LLM-as-judge preferred the spec-driven suites over
  the baseline in 77.8% of cases and over *human-authored* tests in 56.7%.
SOURCE: Grounding AI Agents in Contracts: An Empirical Evaluation of Spec-Driven Test Generation
  — Tufano, McClure, Cambronero, Cheng, Shi, Wei, Chen, Ivančić, Dalloro, Rondon (Google) —
  2026-08-17 rev 2026-08-21 — arXiv:2608.17177 — accessed 2026-09-08
COUNTEREVIDENCE: The specification here is throwaway scaffolding, not a durable artefact — nobody
  claims it is maintained, versioned or re-checked. And the 77.8%/56.7% preference figures are
  LLM-as-judge, which Verus-SpecGym shows misses 26% of real spec failures.
OPEN QUESTION: Does the benefit come from the specification, or from the extra reasoning tokens?
  No ablation against "think harder without writing a spec" was reported in the abstract.
```

```
CLAIM: LLM-generated formal specifications now find real bugs in real open-source software, at
       small scale and with low precision.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: (i) LM2Alloy generated Alloy specs from documentation and source for two production
  Python libraries and derived tests "without any manual correction"; for Flipper it "uncovered a
  genuine bug that the existing test suite had missed: the library silently accepts duplicate flag
  names, directly contradicting its documented uniqueness requirement". A direct LLM baseline that
  skipped Alloy hit 68% branch coverage and missed the bug. Code-derived specs had lower variance
  (mean SD 2.15) than documentation-derived (5.0).
  (ii) Agentic property-based testing across 100 popular Python packages: 56% of generated reports
  were valid bugs, 32% worth reporting; of the 21 top-scoring bugs, 86% valid and 81% reportable;
  5 reported, 4 patched, 3 merged (including NumPy).
  (iii) Specula generated TLA+ specs and found 249 bugs across 48 open-source system projects and
  "has been used by several companies".
SOURCE: LM2Alloy — Rashid, Malik — 2026-07-20 — arXiv:2607.18555; Agentic Property-Based Testing
  — Maaz, DeVoe, Hatfield-Dodds, Carlini — 2025-10-10 — arXiv:2510.09907; Specula — Cheng, Pial,
  Tang, Su, Ma, Hackett, Beschastnikh, Huang, Xu — 2026-07-28 rev 2026-08-03 — arXiv:2607.25333.
  All accessed 2026-09-08.
COUNTEREVIDENCE: LM2Alloy is two libraries and its authors flag generalisability. Agentic PBT's
  headline is that **44% of generated reports were NOT valid bugs** and only 5 were ever reported
  to maintainers — human triage cost is the real bottleneck. Specula's 249 bugs come with no
  false-positive rate in the abstract.
OPEN QUESTION: What is the maintainer-hours-per-true-bug figure? Without it, "specs find bugs" is
  not the same claim as "specs are worth writing".
```

---

## 4. AI + formal methods: the cost table

The single most important structural fact this lane found: **the cost of proving a given property
and the cost of stating the right property have decoupled.** They are now different businesses.

| Cost centre | Direction 2025→2026 | Best current evidence | Label |
|---|---|---|---|
| **Proof of a *given* property** | **Collapsing** | Schwarz: 95.2% on 475 agentic-verification tasks, **91.5% on 1,000 SV-COMP 2026 ReachSafety tasks averaging 1,427 LOC** vs 60.1% for CPAchecker. CryptoProver: independent Verus proof of curve25519-dalek + first verification of RustCrypto chacha20 against RFC 8439 in **11.4 hours and USD 466.99**, where the human-led curve25519-dalek verification took **eight months and five contributors**. Odersky's case study: 14,000 LOC of Lean 4 for System Capless type soundness, 189 tasks, **87% agent success, only 16% needing human intervention**. | OBSERVED TODAY |
| **Specification of intent** | **Barely moving** | VeriContest (946 competitive problems, Rust/Verus, 10 models): NL→code 92.18%, **specification generation 48.31%**, proof generation 13.95%, **end-to-end certified 5.29%**. Verus-SpecGym: best model 77.8%, OSS 21.5–25.5%; failures "omit important input assumptions, accept incorrect outputs, and reject valid ones". LiveFMBench (630 ACSL-annotated C programs, 360 fresh): "naive evaluation substantially overestimates performance because models under direct prompting may exhibit unfaithful behaviors, such as **deceiving automated provers**" — accuracy drops ~20 points once those are excluded. | OBSERVED TODAY |
| **Invariant discovery** | **Improving, still the top error class** | LiveFMBench: "incorrect loop invariants represent the dominant error category". LimICE integrates LLMs into the ICE framework for loop-invariant inference (2026-07-30). Automated Lemma Discovery in Agentic Program Verification (2026-03-23). Verus/Dafny agents (AxDafny, VeriStruct, KVerus, ExVerus) attack invariants and proof repair separately from spec writing. | STRONG TREND |
| **Proof maintenance** | **Almost no evidence either way** | The only direct study found is *What's in a Proof?* — fine-grained source-code telemetry from **eight experts** in F* and Verus, identifying "bias toward early specification drafting, explicit sub-goal decomposition, bounded active errors, and disciplined verifier interaction" as success predictors. ExVerus does Verus proof repair via counterexample reasoning; BlueprintRepair does typed local edits for failed Lean blueprints. **No longitudinal study of proof-maintenance cost under code churn was found.** | (gap) |
| **Specification *validation*** | **New sub-field, 2026** | ProofPulse: three-valued proof-coverage model over Dafny proof dependencies; on 252 dafny-synthesis programs it achieves perfect precision for precondition classification and flags "unnecessary preconditions and vacuous proofs". Its framing is the key sentence of the year: "**successful verification does not guarantee the quality of the specification… weak specifications and redundant invariants may create overconfidence in 'verified' code**". | OBSERVED TODAY |
| **Training data for verified code** | **Commoditised** | VeruSyn synthesised **6.9 million Rust programs each with a formal specification and a proof**. Formal Disco releases synthetic verified-program datasets in Dafny, Verus and Frama-C, with fine-tuned open models "often matching or exceeding the performance of Claude Opus 4.5". | STRONG TREND |

```
CLAIM: The headline vericoding numbers (Dafny 82% / Verus 44% / Lean 27%) are real but are an
       artefact of unaligned, easy benchmarks; on aligned contracts and on real problems the
       numbers are three to fifteen times worse.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: The original benchmark is confirmed exactly as reported: 12,504 formal specifications
  (3,029 Dafny, 2,334 Verus/Rust, 7,141 Lean), 6,174 unseen, success 27% Lean / 44% Verus / 82%
  Dafny, "adding natural-language descriptions does not significantly improve performance", and
  pure Dafny verification improved 68%→96% over the prior year. But AlgoVeri, which enforces
  "identical functional contracts" across Dafny, Verus and Lean over 77 classical-algorithm
  problems, reports best-in-class results of Dafny 55.84% verified / 40.26% full-mark
  (Gemini-3 Flash), Verus 25.97% / 24.68%, Lean 23.38% / 11.69% (GPT-5.3 Codex); open models fall
  to 9.09–25.32% on Dafny and 3.38–12.60% on Lean. AlgoVeri's stated motivation is that prior
  benchmarks "often present different problems to different tools, or specifications of various
  difficulties for the same problem". VeriContest, on 946 competitive-programming problems, puts
  end-to-end certified synthesis at 5.29%. Vero, at repository scale (43 multi-module instances
  from real repos including cryptographic protocols and distributed systems, evaluated in Lean 4),
  has the strongest configuration solving 27/43 and "closing zero specifications on the most
  difficult repositories".
SOURCE: A benchmark for vericoding — Bursuc, Ehrenborg, Lin, Astefanoaei, Chiosa, Kukovec, Singh,
  Butterley, Bizid, Dougherty, Zhao, Tan, Tegmark — 2025-09-26 — arXiv:2509.22908;
  AlgoVeri — Zhao, Yang, Li, He, Li, Jin, Veeravalli, Gupta, Arora — 2026-02-10 rev 2026-06-03 —
  arXiv:2602.09464 (results table read from arxiv.org/html/2602.09464v2);
  VeriContest — Xie, Pawagi, Liu, Rai, Shao, Berberian, Che, Wang — 2026-05-08 — arXiv:2605.08553;
  Vero — Ye, Lou, Sun, Song, Yan, Kasriel, Zhang, Yang, Kong, He, Song — 2026-08-13 —
  arXiv:2608.13522. All accessed 2026-09-08.
COUNTEREVIDENCE: The comparison is not like-for-like — AlgoVeri deliberately selects harder
  problems, and VeriContest's tasks are competitive-programming, not typical application code.
  The vericoding artifact repo (Beneficial-AI-Foundation/vericoding, 30 stars) notes the paper is
  "currently under ICLR review" and publishes 55,397 experiments in vericoding_results_v1.csv;
  no updated leaderboard was published as of 2026-09-08.
OPEN QUESTION: What is the vericoding rate on *ordinary business logic* — CRUD, workflows,
  permissions — rather than algorithms? Every benchmark found is algorithmic, systems or crypto.
```

```
CLAIM: For a fixed, machine-stated property, AI has already made verification cheaper than
       writing the code by hand — by roughly three orders of magnitude on one real crypto library.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: CryptoProver "synthesizes the internal specifications and proofs in 11.4 hours with USD
  466.99 in recorded API cost", constructing "a new independent proof of curve25519-dalek" and
  verifying "RustCrypto's previously unverified chacha20 implementation against an RFC 8439
  specification", where the comparable human effort was "developed publicly over eight months by
  five main contributors". Crucially the humans still supplied the boundary: this was done
  "**Given the API contracts and a fixed trusted library of field specifications, arithmetic
  facts, axioms, and vstd**".
SOURCE: An AI Approach to Verified Production Cryptographic Libraries — Sun, Fong, Kuang, Jiao,
  Narodytska, Wu, Dill, Barrett — 2026-08-02 — arXiv:2608.00965 — accessed 2026-09-08
COUNTEREVIDENCE: The 8-months/5-people baseline was open-source volunteer work, not a costed
  project, so the ratio is indicative not measured. And the trusted spec library it was handed
  is itself the product of years of human effort — the comparison excludes the expensive half.
OPEN QUESTION: What does it cost to *re-run* the proof after the implementation changes? No
  maintenance figure is given, and this is the number that decides whether verification survives
  contact with a product roadmap.
```

```
CLAIM: LLM-based test oracles are mostly ungrounded: more than half decide correctness with no
       specification behind them at all.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: A systematic literature review screening 2,436 records down to 54 included studies
  (83 after citation search) classifies oracles by *source of authority* rather than form, and
  finds "**just over half of the corpus reaches a verdict with no specification at all**". Its
  framing: "a label such as LLM-as-a-judge names how a verdict is produced, not why it should be
  trusted". It also notes oracle quality is typically assessed by resemblance to known oracles
  rather than by fault detection.
SOURCE: LLM-Based Test Oracles: Source-of-Authority Taxonomy — A Systematic Literature Review —
  Mughal, Bilal — 2026-07-06 rev 2026-09-02 — arXiv:2607.05031 — accessed 2026-09-08
COUNTEREVIDENCE: Two independent 2026 results show a *grounded* oracle beats an ungrounded one
  when you build it: Verus-SpecGym's executable-spec evaluator catches 26% more failures than an
  LLM judge; DriftBench's bidirectional provability fingerprinting catches 89.6% of drifted
  formalizations vs 63.3% for an LLM judge.
OPEN QUESTION: How much of the reported gain from "LLM-as-judge" pipelines across SE research
  survives if you require the judge to cite the specification clause it applied?
```

```
CLAIM: Specification autoformalization can be measured with a real fidelity metric, and the metric
       predicts its own convergence — the strongest reusable primitive found in this lane.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: Fidelity probes are "natural-language questions generated from a reference artifact with
  code-derived ground-truth answers, answered from a candidate specification"; the agreeing
  fraction ("fidelity") decomposes into contradiction and coverage-gap rates that drive targeted
  spec edits. On a 15-program, ~12k-line COBOL benchmark (AWS CardDemo) fidelity rose 0.63 → 0.94
  over eight iterations, "with the plateau location predicted by a two-state Markov fixed point F†
  from just four iterations of rate data". Probes come from an LLM reading code or from a
  static-analysis pipeline over control-flow, data-flow and system-dependence graphs;
  graph-grounded mixtures lift fidelity by +16 to +30 points, and the two channels are
  "empirically complementary". A frozen held-out set gives a Hoeffding-bounded overfitting
  discriminant, and a five-family generator sweep (Anthropic, DeepSeek, Google, Alibaba, OpenAI)
  shows three of five non-Claude generators follow the Markov prediction while the protocol
  "actively falsifies the two generators whose probe distributions drift across iterations".
  Generalisation claim: "the method applies to any pair of artifacts that are supposed to describe
  the same behaviour."
SOURCE: Fidelity Probes for Specification–Code Alignment — Erata, Zhou, Huan — 2026-05-17 —
  arXiv:2605.17246 — accessed 2026-09-08
COUNTEREVIDENCE: One benchmark, one language (COBOL), 15 programs. And the ground truth is
  code-derived — so fidelity measures spec↔code alignment, not spec↔intent alignment. A perfectly
  faithful spec of the wrong code scores 1.0.
OPEN QUESTION: Does it hold on a modern polyglot service? And can the same probe protocol be
  pointed at (requirement, production trace) pairs rather than (spec, code) pairs — which is what
  the north-star chain's last link would need?
```

---

## 5. Evidence as artifact, and evidence invalidation

### 5.1 Evidence as artifact

```
CLAIM: The software-evidence stack can prove where an artifact came from and cannot express what
       it was supposed to do; no attestation predicate can name a requirement.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: SLSA v1.1 Build L1–L3 are entirely about provenance integrity — L1 "Package has
  provenance showing how it was built… trivial to bypass or forge"; L3 "Forging the provenance or
  evading verification requires exploiting a vulnerability that is beyond the capabilities of most
  adversaries". Nothing in the level definitions concerns behaviour or correctness. The in-toto
  attestation spec has twelve vetted predicates (CycloneDX, Link, Reference, Release, Runtime
  Traces, SCAI Report, SLSA Provenance, SLSA VSA, SPDX2/3, Simple Verification Result, Test
  Result, VULNS). The Test Result predicate's fields are `result`, `configuration`, `url`,
  `passedTests`, `warnedTests`, `failedTests`; "the expected `subject` are the source artifacts
  tested", and of the test names it says "**the semantics of the name must be determined
  separately between the producer and consumer**". So evidence attaches to a digest, and the only
  link back to intent is a free-text test name with no shared semantics. Meanwhile the
  reproducibility layer is genuinely mature: Debian unstable/amd64 stood at 38,756 / **94.1%**
  reproducible of 41,188 packages, arm64 94.2%, forky 94.5%/94.7%, experimental ~71%, at
  2026-09-08 17:02 UTC.
SOURCE: SLSA v1.1 Levels — OpenSSF/SLSA — https://slsa.dev/spec/v1.1/levels ; Verification Summary
  Attestation — https://slsa.dev/spec/v1.1/verification_summary ; in-toto attestation predicates —
  https://github.com/in-toto/attestation/tree/main/spec/predicates and .../test-result.md ;
  Debian reproducible builds — https://tests.reproducible-builds.org/debian/reproducible.html .
  All accessed 2026-09-08.
COUNTEREVIDENCE: The SLSA VSA does carry a `policy` field describing "the policy that the
  `subject` was verified against" and a PASSED/FAILED `verificationResult`, and its stated purpose
  includes letting consumers "delegate complex policy decisions to some trusted party". The
  Simple Verification Result predicate exists for exactly this. So the *envelope* is capable —
  what is missing is any convention for what a requirement identifier looks like inside it.
OPEN QUESTION: Would a `requirement` field in a Test Result predicate (subject = requirement URI,
  not artifact digest) be accepted by the in-toto community, and would anyone emit it? This is a
  small, concrete, unclaimed standardisation gap.
```

```
CLAIM: The industrial proof that machine-checked evidence can run at internet scale already
       exists — but only for property classes fixed in advance by the vendor.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: AWS runs "a billion SMT queries a day" (Neha Rungta, Amazon Science, 2022-08-18), with
  Zelkova answering "within a couple hundred milliseconds to tens of seconds". Six AWS services are
  documented as using automated reasoning: CodeGuru, S3 Block Public Access, IAM Access Analyzer,
  VPC Network Access Analyzer, VPC Reachability Analyzer, Amazon Verified Permissions. Bedrock
  Guardrails' Automated Reasoning checks claim to "systematically validate correct model responses
  with up to 99% accuracy" using "sound mathematical techniques".
SOURCE: Provable security — AWS — https://aws.amazon.com/security/provable-security/ ;
  A billion SMT queries a day — Neha Rungta, Amazon Science — 2022-08-18 ;
  Bedrock Guardrails — AWS — https://aws.amazon.com/bedrock/guardrails/ . All accessed 2026-09-08.
COUNTEREVIDENCE: Every one of these checks a *pre-defined* property (policy reachability, network
  reachability, permission subsumption). None checks a user-written requirement. The "up to 99%"
  claim is vendor marketing with no published methodology found.
OPEN QUESTION: What is the cost curve for a *customer-authored* property versus an AWS-authored
  one? The billion-queries figure says nothing about who wrote the query.
```

### 5.2 Evidence invalidation

```
CLAIM: "Which claims must be re-proved after this change?" is essentially an unstudied question:
       the literature is thin, old, and not being renewed by the LLM wave.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: arXiv full-text queries run 2026-09-08: all:"incremental verification" since 2024-01-01
  returns **8** results, of which 5 are neural-network or DNS verification, not program proofs.
  all:"regression verification" since 2024-01-01 returns **2**. all:"proof reuse" since 2023-01-01
  returns **8**. all:"specification drift" since 2024-01-01 returns **19**, of which zero concern
  software specifications drifting from code (they are ML distribution drift, traffic drift, EEG).
  By contrast the same interface returns dozens of 2026 papers per month on Dafny/Verus proof
  *generation* (30 hits for all:"Dafny" since 2025-09-01 alone).
SOURCE: arXiv API (export.arxiv.org) queries run 2026-09-08; exact query strings and result counts
  recorded in research/sources/03-specifications.md
COUNTEREVIDENCE: The gap is not total. *Partial Contracts Suffice* (below) is a genuine 2026
  advance. ProofPulse analyses Dafny proof dependencies, which is exactly the dependency graph an
  invalidation engine needs. Dafny ships proof-dependency analysis in its reference manual
  (section 13.7.5 "Analyzing proof dependencies", UNVERIFIED — the page truncated before the
  option names). *Toward Semantically-Seeded, Graph-Propagated Impact Analysis Across Software
  Artifacts: A Vision* (arXiv:2606.18855) names the goal. And the SpecOps CFP explicitly solicits
  "Change impact analysis" and "detecting specification drift", so the community has *named* the
  gap even if it has not filled it.
OPEN QUESTION: Do Verus/Dafny/Lean already emit enough dependency metadata to compute a minimal
  re-proof set on a diff, and has anyone measured what fraction of proofs a typical commit
  invalidates? Not found.
```

```
CLAIM: You do not need a full specification to know a change is behaviour-preserving — a partial,
       caller-sufficient contract suffices, and an LLM can infer it soundly.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: *Partial Contracts Suffice* infers contracts from counterexamples rather than requiring
  complete behavioural specifications, and shows "partial, caller-sufficient contract[s]" are
  enough for sound verification. Soundness is preserved by proving all function versions match the
  inferred contract and then applying assume-guarantee reasoning, giving **zero false positives**
  on the EqBench-C suite while "identif[ying] nine mislabeled equivalent pairs" in that benchmark;
  verification rate is comparable to AutoSpec and Preguss on Frama-C-Problems and the ANSSI X509
  parser; on Frama-C-Problems the partial contracts achieved near-maximal tightness.
SOURCE: Partial Contracts Suffice: Sound, LLM-Inferred Regression Verification — Charalambous,
  Menezes, Sun, Cordeiro — 2026-07-11 — arXiv:2607.10291 — accessed 2026-09-08
COUNTEREVIDENCE: C only, function-level, Frama-C/EqBench scale. Nothing about repository-scale
  change, nothing about cross-module invalidation, and no cost figure per verified diff.
OPEN QUESTION: Does "caller-sufficient" compose? If module A's contract is only sufficient for its
  current callers, adding a caller silently invalidates the evidence — is that detected?
```

```
CLAIM: The only shipping-grade invalidation protocol found in 2026 is for agent memory, not for
       proofs — and it works, deterministically, via version stamps.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: Invalidation Contracts attach "version stamps and cacheability hints to every recovery
  suggestion so the client can evict stale entries without trial and error, and keep the rest".
  Results across 9,400 episodes: **eviction precision 1.00 at row granularity across all models**,
  zero contract failures, 15% payload overhead; row-level invalidation raised compliance by
  0–66.7 pp and recovered 29–33% of baseline token cost on four of seven models. Crucially,
  "version-stamp validity is deterministic by construction and produced identical results across
  every model and serving path", while *compliance* — whether the planner acts on the eviction —
  varied wildly (Claude Haiku 4.5 100% first-try; Claude Sonnet 5 ≤11%).
SOURCE: Invalidation Contracts for Cross-Episode Agent Memory — Wu, Canedo — 2026-08-31 —
  arXiv:2609.00243 — accessed 2026-09-08
COUNTEREVIDENCE: This is API-error-recovery caching, not verification evidence; the analogy to
  proof invalidation is mine, not the authors'. Table-level (coarse) invalidation *destroyed*
  performance — "reduced post-drift first-try rates to 0% on five of seven models" — which warns
  that granularity choice dominates the design.
OPEN QUESTION: The paper's cleanest lesson is that invalidation is deterministic and *acting on it*
  is not. If a system says "these 12 proofs are stale", who or what re-proves them, and at what
  precision does the human stop trusting the list?
```

```
CLAIM: The most promising unclaimed design is to make traceability a compile-time property with a
       graduated invalidation lifecycle — proposed in 2026, never evaluated.
LABEL: SPECULATIVE
CONFIDENCE: low
EVIDENCE: ReqToCode proposes "Traceables" — "language-native, generated code element[s] that
  represent[s] a single requirement and carr[y] its metadata" — referenced from implementation and
  test code, "validated automatically during the build process", so that traceability becomes
  "a compile-time verifiable property of the system rather than an external documentation task".
  When requirements change the system responds "through a graduated lifecycle — from deprecation
  warnings to build failures". Its diagnosis of the status quo is precise: "traces degrade silently
  as requirements, code, and tests evolve independently across tools, repositories, and revisions"
  and LLM traceability work "focus[es] on recovering broken links after the fact — an inherently
  retrospective approach".
SOURCE: ReqToCode: Embedding Requirements Traceability as a Structural Property of the Codebase —
  Thorsten Schlathölter — 2026-03-14 — arXiv:2603.13999 — accessed 2026-09-08
COUNTEREVIDENCE: Single-author, 23-page, non-peer-reviewed preprint with **no quantitative results
  at all** — a generic illustrative example only. Tessl's `[@test]` links are the same idea shipped,
  and Tessl abandoned the surrounding product.
OPEN QUESTION: Would developers tolerate a build failure caused by a requirement edit? Every prior
  attempt to make traceability mandatory (DOORS, ReqIF, MDA) was routed around.
```

---

## 6. Semantic and behavioural diffs

**State of the art, honestly stated: this is the emptiest square in the lane.**

- **Production tooling only diffs signatures, and says so.** `cargo-semver-checks` (1.7k stars,
  162 open issues) is the flagship. Its README states "There are many ways to break semver, and
  cargo-semver-checks doesn't yet have lints for all of them", and explicitly lists what it will
  **not** detect: breaking type changes in fields and parameters, breaking changes in generics or
  lifetimes, changes affecting only some feature combinations, and — flatly — **behavioral changes**.
- **Academic semantic differencing is a 2014 field.** An arXiv full-text search for
  all:"semantic differencing" (2026-09-08, no date filter) returns 8 papers: PASDA (2023-11-14),
  "Has My Release Disobeyed Semantic Versioning?" (2022-09-01), and five 2014 papers by the
  Maoz/Ringert group (CDDiff, ADDiff, Summarizing Semantic Model Differences, An Interim Summary
  on Semantic Model Differencing). Nothing since 2023.
- **The LLM wave went to *generation*, not *comparison*.** SWE-Bench ProMax, SWE Refactor Bench,
  SmellBench, RepoRescue, ScarfBench, AgenticFlict and RoadmapBench all appeared in 2026 to measure
  whether an agent can *make* a change; none measures whether two versions are behaviourally
  equivalent.
- **The one live thread** is contract-based regression verification (§5.2), plus SWE-STEPS'
  finding that isolated-PR evaluation inflates success "by as much as 20 percentage points"
  because it ignores "the 'spillover' effects of previous inefficient or buggy code", and that
  agents "degrade repository health by generating code with higher cognitive complexity and
  technical debt compared to human developers".

```
CLAIM: Nothing in production can tell a reviewer "this diff changes behaviour X and nothing else";
       the tooling that exists deliberately excludes behaviour.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: cargo-semver-checks — the most-used behavioural-compatibility linter in any ecosystem —
  lists "behavioral changes" among the categories it will not detect, alongside breaking type,
  generic and lifetime changes; it also depends on rustdoc's *unstable* JSON format, so support
  "varies by Rust version" and nightly is "best-effort only". Academic semantic differencing has
  produced no new arXiv work since PASDA (2023-11-14).
SOURCE: cargo-semver-checks README — obi1kenobi — accessed 2026-09-08 —
  https://github.com/obi1kenobi/cargo-semver-checks ; arXiv query all:"semantic differencing"
  run 2026-09-08 (8 results, newest 2023-11-14).
COUNTEREVIDENCE: Buf's protobuf breaking-change detector implements wire/JSON compatibility
  categories that are genuinely behavioural for serialisation (UNVERIFIED — buf.build/docs and
  its mirror redirected and could not be fetched). And *Partial Contracts Suffice* achieves
  exactly this on C functions with zero false positives — so the capability exists in a lab, at
  function scale.
OPEN QUESTION: Is behavioural diffing hard, or merely unglamorous? The Frama-C result suggests the
  latter for C. Nobody has tried it on a TypeScript service.
```

```
CLAIM: Coding agents are sensitive to the *path* by which a specification was reached, not just to
       its final content — so a "requirements diff" is not sufficient to predict behaviour.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: SpecPath constructs contract-equivalent specification histories — revision sequences
  A→B→C and A→D→C ending at the same requirement C — and finds that overall direct and
  revision-history accuracy is "nearly unchanged", yet **35 of 100 complete blocks that succeed on
  the direct specification fail on at least one equivalent history**, across five software tasks
  and fourteen agent configurations. The authors call this specification-path sensitivity and
  conclude that "evaluation methods must account for how requirements evolve, not merely their
  final form".
SOURCE: SpecPath: Testing Coding Agents Across Contract-Equivalent Specification Histories —
  Wu, Wang, Yang, Ji, Lin — 2026-08-10 — arXiv:2608.09799 — accessed 2026-09-08
COUNTEREVIDENCE: Aggregate accuracy is unchanged, so a team measuring only pass rates would see
  nothing wrong; the effect is a variance/robustness problem, not a mean-performance problem.
OPEN QUESTION: This is devastating for the "living spec" model in Spec Kit and OpenSpec, where the
  spec is *edited in place* and the history lives in git. Does replaying the same final spec into a
  fresh agent produce different code than continuing the edit session? Nobody has tested SDD tools
  this way.
```

---

## 7. Where formal methods expand, where they stay niche

**Expanding:**

| Frontier | Why now | Label |
|---|---|---|
| Proof *completion* for stated properties in Verus/Dafny/Lean | Schwarz 91.5% SV-COMP ReachSafety; Odersky 87% over 189 tasks; ExVerus/KVerus/AxDafny/VeriStruct proof repair | OBSERVED TODAY |
| Production cryptography and consensus protocols | CryptoProver ($467, 11.4h); Rust-to-Lean pipeline (Charon/Aeneas/Hax + ArkLib/CompPoly + Aristotle/Aleph) funded by the Ethereum Foundation zkEVM Verification Project on Plonky3 and RISC Zero; SoK on formal verification of consensus protocols | OBSERVED TODAY |
| Cloud policy and access control | AWS: a billion SMT queries/day, six named services; AutoCedar verifier-guided policy synthesis | OBSERVED TODAY |
| Legacy comprehension (COBOL, kernels, RTL) | Fidelity Probes on 12k-line COBOL CardDemo (0.63→0.94); BODHI OS-kernel spec inference; SpecLoop RTL-to-spec with FV feedback; DAInfer+ API specs from documentation | STRONG TREND |
| Model checking system code without humans writing TLA+ | Specula: 48 projects, 249 bugs, "used by several companies" | OBSERVED TODAY |
| Certification-driven domains (DO-178C) | Păsăreanu & Rutland (Amazon Prime Air) SpecOps keynote: neurosymbolic autoformalization for C++ verification and requirements-coverage test generation "achiev[ing] traceability and coverage criteria demanded by certification standards" | OBSERVED TODAY |
| Training-data supply for verification-aware languages | VeruSyn 6.9M Rust spec+proof programs; Formal Disco datasets in Dafny, Verus, Frama-C | STRONG TREND |

**Staying niche:**

| Frontier | Why it stays hard | Label |
|---|---|---|
| Full functional correctness of ordinary application code | VeriContest end-to-end 5.29%; Vero 27/43 and zero on hardest repos | OBSERVED TODAY |
| Knowing whether the specification is the *right* one | No oracle but the user (Lahiri); ProofPulse can detect vacuity but "cannot fully capture semantic intent" | OBSERVED TODAY |
| Proof maintenance under product-speed churn | No longitudinal study found; only eight experts studied, in a single telemetry paper | REASONABLE EXTRAPOLATION |
| Adoption of verification-aware languages by ordinary developers | "Steep learning curves and usability issues" identified from forum topic modelling plus a developer survey | OBSERVED TODAY |
| Lean as a target for *program* verification | Lean is the worst target in every aligned benchmark: 27% (vericoding), 7.79–23.38% (AlgoVeri) — the opposite of its reputation from AlphaProof-class mathematics results | OBSERVED TODAY |

---

## 8. Contradictions with common belief

**8.1 "AI has basically solved verified code generation — Dafny is at 82%."**
It has solved *proof completion*, not *verified synthesis from intent*. Once contracts are aligned
across tools the best Dafny result is 55.84% verified / 40.26% full-mark on 77 problems (AlgoVeri);
on 946 real problems end-to-end certified synthesis is **5.29%** with specification generation at
48.31% and proof generation at 13.95% (VeriContest); at repository scale the best agent solves 27
of 43 and zero on the hardest repos (Vero). The 82% figure is a benchmark artefact, and the paper
it comes from is still under ICLR review with 30 stars on its artifact repo.

**8.2 "Spec-driven development means specifications are executable."**
Spec Kit's own concept doc says "**specifications become executable**, directly generating working
implementations". What actually happens is that an LLM reads Markdown and writes code; the
verification command `/speckit.converge` is documented as "LLM reading and inspection — not
automated tests or static analysis"; OpenSpec's `validate` checks structure; and OpenSpec closed
the one request for genuinely executable specs (#987) as *not planned*. The single counterexample —
Kiro's EARS→property-based-test compiler — ships in one IDE, is optional by default, and its own
documentation says it "is not formal verification".

**8.3 "Natural language descriptions help models write better formal specs."**
The vericoding benchmark's own finding across 12,504 specifications in three languages is that
"adding natural-language descriptions does not significantly improve performance". The information
that helps is *executable* — tests, counterexamples, adversarial hacks, prover feedback — not prose.

**8.4 "LLM-as-a-judge is good enough to grade specifications."**
Verus-SpecGym: LLM-as-judge "misses 26% of the failures our evaluator catches". DriftBench: an
LLM-judge baseline detects 63.3% of drifted formalizations versus 89.6% for provability
fingerprinting (and 41.2% for typecheck alone). A systematic review of 83 studies finds "just over
half of the corpus reaches a verdict with no specification at all". Yet LLM-as-judge is the
measurement instrument in most 2026 SDD papers, including Google's own spec-driven test-generation
result and Spec Kit Agents.

**8.5 "Specs are the durable artefact; code is the disposable one."**
Tessl bet a whole product on this and removed it. Spec Kit refuses to take a position — its
`spec-persistence.md` offers three models (spec-first, where specs "can be discarded";
spec-anchored; spec-as-source) and explicitly states Spec Kit "does not prescribe how teams
preserve or mutate `spec.md`, `plan.md`, and `tasks.md` after requirements change". The one place
where the spec really is the durable artefact today is OpenSpec's archive merge — and that
durability is bought by making the spec purely descriptive prose that nothing executes.

**8.6 "More capable AI reduces the need for specification."**
The observed direction is the opposite, and both camps agree. The Specification Paradox states it
as "the more capable artificial intelligence systems become at automatically generating software,
the greater the dependence on correct, complete, verifiable, and explainable human-produced
specifications". VeriContest's decomposition is the quantitative version: NL→code 92.18% versus
spec generation 48.31% — code generation raced ahead and left specification as the binding
constraint.

---

## 9. Problems nobody is talking about

**9.1 Nobody knows how much a specification costs to keep.**
Every 2026 paper measures the cost of *producing* a spec or a proof. Not one measures the cost of
*maintaining* one across N commits. The nearest thing found — telemetry from eight F*/Verus experts
— studies a single authoring session. The SpecOps CFP names "specification maintenance: co-evolution
of code and specifications" as a topic and, six weeks after camera-ready, has published no papers.
Consequence: the entire economic case for SDD rests on an unmeasured quantity.

**9.2 Specification-path sensitivity breaks the "living spec" model and nobody has noticed.**
SpecPath shows 35% of tasks that succeed on a directly stated specification fail on at least one
*contract-equivalent revision history*. Spec Kit's Living Spec model and OpenSpec's delta-merge
model both assume the final spec text is what matters. If the agent's behaviour depends on how the
spec was edited into that state, then a spec file in git is not a sufficient description of the
system, and re-running the pipeline from the same file will not reproduce the same software. No SDD
tool documentation acknowledges this; no SDD paper found cites SpecPath.

**9.3 Evidence has no address to attach to.**
in-toto has a Test Result predicate whose subject is an artifact digest and whose test names have
"semantics… determined separately between the producer and consumer". SLSA VSA has a `policy` field
and a PASSED/FAILED result. Neither can say "requirement FR-014 is currently supported by these
three tests, this proof, and this production monitor". There is no identifier convention for a
requirement that survives across a spec file, a test name, a proof obligation and a trace
attribute. This is a small, boring, entirely unclaimed standards gap — and everything downstream
(evidence invalidation, change impact, "does reality still match intent") is blocked on it.

**9.4 Verification success is being reported without vacuity control.**
ProofPulse's finding — that "successful verification does not guarantee the quality of the
specification" and weak specs "create overconfidence in 'verified' code" — landed on 2026-08-31,
after a year of vericoding leaderboards. LiveFMBench found models "deceiving automated provers",
costing ~20 accuracy points once excluded. LeetProof's spec validation "revealed defects in
existing reference benchmarks". So a material fraction of the published verified-synthesis numbers
across 2025–2026 is measuring vacuous proofs, and the community has no standard vacuity check.

**9.5 The context tax on specifications is a real, quantified, unaddressed cost.**
Spec Kit's command prompts alone consume 18.6k tokens per session — 93% of Cursor's default window,
29% of Copilot's 64k. `spec-of-specs.md` exists purely because a single feature's artefacts will not
fit in context, and warns that decomposition "adds the most overhead of any strategy". The dominant
practical cost of spec-driven development in 2026 is not writing the spec; it is that the spec plus
its scaffolding does not fit next to the code. Nobody is publishing on specification *compression* —
what is the minimum spec that still determines the behaviour?

**9.6 "Caller-sufficient" contracts have a silent-invalidation failure mode.**
The most promising cheap-evidence result (Partial Contracts Suffice) proves equivalence against a
contract sufficient *for the current callers*. Adding a caller can invalidate the evidence without
touching the verified function or its contract. No paper found discusses this.

**9.7 Everyone measures specs against code; almost nobody measures specs against reality.**
Fidelity Probes derive ground truth from *code*. ProofPulse derives it from *proof dependencies*.
`/speckit.converge` reads *source files*. The one link in the north-star chain that no found tool
addresses is (requirement → production behaviour): a requirement that was correctly implemented
and correctly proved, whose environment then changed. Invalidation Contracts is the only paper in
this lane that treats *server-side data drift* as the thing that silently falsifies stored
knowledge — and it does so for agent memory, not for requirements.

---

## 10. Commodity vs stays hard

### Becomes commodity

| Item | Label |
|---|---|
| Turning a request into a structured Markdown artefact with user stories, acceptance criteria and tasks — five tools do it free, one has 134k stars | OBSERVED TODAY |
| Generating a syntactically valid formal specification (ACSL, Alloy, TLA+, Dafny/Verus contracts) from code | OBSERVED TODAY |
| Completing a proof for a stated property in Verus/Dafny/Lean (Schwarz 91.5% SV-COMP; Odersky 87% over 189 tasks) | OBSERVED TODAY |
| Training data for verification-aware languages (VeruSyn 6.9M programs; Formal Disco) | STRONG TREND |
| Generating property-based tests from prose requirements (Kiro ships it; agentic PBT works across the Python ecosystem) | OBSERVED TODAY |
| Provenance and reproducibility evidence (SLSA levels standardised; Debian 94.1% reproducible) | OBSERVED TODAY |
| Cross-artifact consistency review of prose documents by an LLM | OBSERVED TODAY |
| Model checking system code without a human writing TLA+ (Specula) | STRONG TREND |
| Regression equivalence proof for a C function given a partial contract | REASONABLE EXTRAPOLATION |

### Stays hard

| Item | Label |
|---|---|
| Deciding whether a specification says what the human meant — "specifications lack an independent oracle… other than the user" | OBSERVED TODAY |
| Detecting a *complete* specification (soundness is checkable; completeness needs spectests or adversarial cases; `ensures true` verifies) | OBSERVED TODAY |
| End-to-end verified synthesis of ordinary application code (5.29%) | OBSERVED TODAY |
| Knowing which evidence a change invalidated | OBSERVED TODAY (as absence) |
| Behavioural diffing at review time — the tools exclude it by design | OBSERVED TODAY |
| Keeping proofs alive under product-speed churn | REASONABLE EXTRAPOLATION |
| Making specification cost sublinear in system size (context tax, spec-of-specs recursion) | OBSERVED TODAY |
| Compositionality over *changes* — Lahiri's own named open problem | OBSERVED TODAY |
| Persuading ordinary developers to use verification-aware languages | OBSERVED TODAY |
| Attaching evidence to a requirement rather than to a build artifact | OBSERVED TODAY (as absence) |
| Reconciling a requirement with production reality after the environment changes | REASONABLE EXTRAPOLATION |

**The one-line synthesis for the north-star chain.** The links WHAT THE SPECIFICATION SAYS →
WHAT THE SOFTWARE DOES and WHAT THE SOFTWARE DOES → WHAT HAPPENS IN REALITY are becoming cheap:
proof completion, PBT generation, model checking, provenance attestation. The links WHAT THE HUMAN
WANTS → WHAT THE SPECIFICATION SAYS and DOES REALITY STILL MATCH INTENT? are not moving, because
both require an oracle that only the human holds. Every 2026 attempt to automate them converges on
the same substitute — a test — which is itself just another specification with the same oracle
problem, one level down.

**For a solo, bootstrapped builder,** the two cheapest unclaimed positions this lane found are
(a) a requirement-addressable evidence identifier — an in-toto/OpenTelemetry-compatible convention
that lets a test result, a proof obligation and a production trace all cite the same requirement id;
and (b) an evidence-invalidation engine over an existing dependency graph (Dafny/Verus already emit
proof dependencies; `cargo-semver-checks` already emits API deltas). Both are small, both are
boring, both are the thing everything else is waiting on, and neither requires a frontier model.

---

## 11. Open questions for the second wave

1. **What did SpecOps 2026 accept?** Camera-ready was 2026-08-24; nothing is public. The proceedings
   will be the first citable corpus specifically on spec drift, spec maintenance and change impact.
   Re-check after 2026-10-06.
2. **What is the maintenance cost of a specification?** Find or construct a longitudinal measurement:
   spec edits per code commit, proof re-runs per merge, hours per re-verification. Nothing exists.
3. **Does specification-path sensitivity affect Spec Kit / OpenSpec / Kiro?** Run SpecPath's protocol
   against the actual SDD tools: same final `spec.md`, different edit histories, compare emitted code.
4. **Can a minimal requirement identifier convention be standardised?** Concretely: an in-toto
   predicate whose subject is a requirement URI. Who would have to agree — in-toto, OpenTelemetry,
   the SDD tools? Is anyone proposing it?
5. **What fraction of a proof corpus does a typical commit invalidate?** Verus/Dafny already track
   proof dependencies (ProofPulse uses them). Measure it. If the answer is <5%, incremental
   verification is viable and unbuilt; if >50%, verified code cannot survive product velocity.
6. **Is vericoding on business logic materially different from vericoding on algorithms?** Every
   benchmark found is algorithmic, systems or crypto. Build or find one on CRUD/permissions/workflows.
7. **Does "caller-sufficient" compose under caller addition?** The silent-invalidation failure mode
   in Partial Contracts Suffice.
8. **What is the minimum specification that determines behaviour?** Spec compression as a research
   question, driven by the measured 18.6k-token context tax.
9. **Why did Tessl abandon specs?** Find a first-hand account (blog, talk, interview, investor
   letter). The strategic lesson for a solo builder is in the reason, not the fact.
10. **Do the Fidelity Probes results generalise off COBOL?** The method claims to apply "to any pair
    of artifacts that are supposed to describe the same behaviour" — the single most reusable
    primitive found in this lane, evaluated on exactly one 15-program benchmark.
11. **Is vacuity checking about to become mandatory?** If ProofPulse-style proof coverage becomes a
    standard reporting requirement, how many 2025–2026 verified-synthesis results survive?
12. **Where is the boundary between "property AWS wrote" and "property the customer wrote"?** The
    billion-SMT-queries-a-day figure proves scale for vendor-authored properties only.
13. **Is there any tool anywhere that checks a requirement against production behaviour** rather than
    against code or a proof? Lane 07 (observability) should be asked directly; this lane found none.
