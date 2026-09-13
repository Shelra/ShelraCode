# Lane 02 — The intent gap: human intent → system understanding

Researcher: intent-gap-researcher. Date: 8 September 2026. Cutoff: September 2026.
Method: arXiv API + arXiv advanced-search scraping (the session's WebSearch budget was exhausted
session-wide before this lane started; all discovery was done through `export.arxiv.org`,
`arxiv.org/search/advanced` and the Semantic Scholar citations graph). 76 sources, 34 search
operations, ~50 primary sources read at abstract level or deeper, 12 read in full HTML.

---

## 1. Summary (10 lines)

1. Intent formalization became a named research programme in March 2026 (Lahiri) and by September 2026
   six of its seven open problems have visible movement; one — **change intent and compositionality** — has none.
2. The field's founding assumption, *"there is no oracle for specification correctness other than the user"*,
   was empirically tested in July 2026 and the user failed: 86 programmers judged **incorrect** assertions at
   **49% accuracy** (chance) while reporting the same confidence as on correct ones.
3. Three oracle-free specification-quality proxies appeared instead: regeneration-equivalence (AfterVibe),
   deterministic execution judges (semantic-block benchmark), symbolic over/under-constraint detection (Spec-Harness).
4. "Just ask a clarifying question" has three independently measured failure modes: multi-turn degradation
   (**-39%**), prompt-injection amplification (**1.8% → 34.0%**), and timing (late clarification is worse than none).
5. Value of information for clarification **has** been formalised (NetVoI = VoI − c, Jan 2026) including stakes;
   what has not been formalised is the cost term — every published model is turns × a constant.
6. Empirical demand curves for clarification timing exist as of May 2026 (6,000+ runs): goal clarification loses
   nearly all value after **10%** of execution, and **no frontier model asks inside the optimal window**.
7. Agents are stakes-blind in practice: varying blast radius from contained to production changed action rates
   by 1.5 points (**65.5% vs 64.0%**) while 55.8–67.8% of acted runs violated an action boundary.
8. The circular-specification claim is now partly measurable and points the *other* way for machine cost —
   dropping a full spec to a bare user story costs only **+29.7%** tokens — while human review cost rises sharply
   (**44%** of real agent turns contain user pushback; **44%** of agent code survives to commit).
9. Spec-Driven Development is a real, dated, measurable phenomenon (**470,795** specs, **92%** first committed in
   2026) with an almost empty evidence base; its own flagship review says peer-reviewed evidence "is not yet established".
10. The residue nobody counts: **24.7%** of requirement decisions are *indeterminate* — valid, discretionary, and
    not mandated by any stakeholder. That is unattributed authorship, and no system records it.

---

## 2. What is solved / partially solved / research-stage / unsolved

| Capability | Status | Evidence (September 2026) |
|---|---|---|
| Detecting that a description *contains* ambiguity | **Partially solved** | Orchid: LLMs show "surprisingly high recall in flagging potential ambiguities" but precision ≈50%; SpecFix modified 43.58% of descriptions unaided, +30.9% Pass@1 on the modified set (arXiv:2604.21505; 2505.07270) |
| Detecting ambiguity the model itself did not notice | **Unsolved** | Semantic collapse: 3% (HumanEval), 10–16% (MBPP), 18–32% (LiveCodeBench) of tasks get a single wrong reading; 11%–49.7% receive an incorrect solution *without triggering a clarifying question* (arXiv:2607.01953) |
| Generating a *useful* clarifying question | **Partially solved** | ClarifyCodeBench best TKQR 0.30 / ORA 0.50 across 6 SOTA models on 419 tasks; CLARITI reaches GPT-5 task success with 41% fewer questions (2607.00711; 2604.14624) |
| Deciding *whether* to ask | **Research-stage** | Ambig-DS: "permissive prompts induce over-asking on clear tasks, while conservative prompts induce silent defaulting on ambiguous ones" (2605.09698); Ask-or-Assume interactive baseline queried 99.2% of tasks for no gain (2603.26233) |
| Deciding *when* to ask | **Research-stage, newly quantified** | First demand curves May 2026: goal clarification value collapses after 10% of execution; late clarification worse than never asking; 52% of unscripted sessions over-ask (2605.07937) |
| Pricing the interruption (human attention) | **Unsolved** | Every published cost model is `c(H) = T·c`; the authors state "accurately modeling the nuances of human cognitive load is a major, open research challenge" (2601.06407) |
| Recovering *implicit* requirements | **Unsolved** | SWE-RPG: implicit-requirement recovery is the main bottleneck, 24.5%–46.0% of agent runs; ReqElicitGym: LLMs elicit "less than half of the users' implicit requirements" (2608.09072; 2602.18306) |
| Validating a specification without running code | **Research-stage, assumption broken** | Human oracle at 49% on incorrect assertions (2607.08885); three machine proxies proposed 2026 (2607.09900; 2608.19475; 2604.00280) |
| Composing intent across a *change* | **Unsolved — no method found** | Lahiri's problem #2. Searches over cs.SE 2025-06→2026-09 returned corpora (SpecMine co-change layer), governance framings (spec-delta), and skill-contract monitoring — no compositional change-specification method |
| Turning a resolved intent into a structured artefact | **Solved in practice** | 18 SDD tools, 470,795 specs across 73,030 repos, 99.7% first committed 2025+, 92% in 2026 (2608.25202) |
| Post-hoc recovery of a spec from a session | **Partially solved** | AfterVibe: mean regeneration score 5.06/6.0 on 72 real internal vibe-coded projects, refinable to 5.74 (2607.09900) |
| Personalising ambiguity resolution across sessions | **Partially solved** | CAPA: +15.6pp first-turn executable success with user history; Claude Opus 4.8 24.3% → 60.3%; still "almost 40% of sessions requiring clarification" (2607.26611) |
| Modelling the user's mental state persistently | **Research-stage, promising** | ToM-SWE: 59.7% vs 18.1% (OpenHands) on stateful SWE-bench; 86% usefulness over three weeks with professional developers (2510.21903) |
| Detecting requirement conflict / contradiction | **Research-stage, thin** | ArgRE (formal argumentation), QUARE (dialectical negotiation), LLM goal extraction at 61% accuracy (2604.23124; 2603.11890; 2604.22207) |

---

## 3. Intent formalization: state of the art and the seven open problems

### 3.0 The anchor

```
CLAIM: Intent formalization is a named, dated research programme with seven enumerated open problems,
       authored by a single Microsoft researcher in March 2026, and it has attracted only ~10 citing
       papers by September 2026.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: arXiv:2603.17150v1, submitted 17 Mar 2026, sole author Shuvendu K. Lahiri. Section 4 ("A Research
  Agenda") enumerates: (1) from benchmarks to real-world systems; (2) change intent and compositionality;
  (3) identifying what to clarify cost-effectively; (4) automated metrics for spec validation; (5) rich logics
  and quantifiers; (6) human-AI interaction for specification; (7) integration into developer workflows.
  Verbatim: "Since there is no oracle for specification correctness other than the user, we need semi-automated
  metrics that assess specification quality with or without code." Cited evidence in-paper: LLM postconditions
  caught one in eight real Defects4J bugs; TiCoder user study 84% vs 40% correct evaluation (p<0.001);
  Auto-Verus 3.6x GPT-4o zero-shot proof accuracy. Semantic Scholar citation graph returns 10 citing papers
  as of 8 Sep 2026.
SOURCE: Intent Formalization: A Grand Challenge for Reliable Coding in the Age of AI Agents — Shuvendu K. Lahiri
  (Microsoft) — 17 Mar 2026 — https://arxiv.org/abs/2603.17150 — accessed 2026-09-08
COUNTEREVIDENCE: The programme is one person's agenda with a thin citation base; the parallel and much larger
  literature (clarification benchmarks, RE-with-LLMs) does not cite it and uses different vocabulary. It may
  be a naming exercise over an already-moving field rather than a field-founding document.
OPEN QUESTION: Does the SpecOps 2026 workshop (6 Oct 2026, co-located ISSTA/SPLASH, Oakland) adopt this
  seven-problem framing, or does the practitioner branch of spec-driven development ignore it entirely?
```

### 3.1 Problem 1 — from benchmarks to real-world systems: **moved substantially**

```
CLAIM: Between March and September 2026 the field moved from function-level ambiguity benchmarks to
       repository-, infrastructure- and production-scale ones, and performance collapsed accordingly.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: SWE-RPG (Aug 2026): 163 tasks from 31 Python/Java repos, 113 bug fixes + 50 feature additions,
  3 agents (Claude Code, Codex, OpenCode) x 6 backends including Claude-Sonnet-5 and GPT-5.6-Terra —
  "average resolved rate of only 31.5%", with implicit-requirement recovery the dominant failure at
  24.5%–46.0% of runs. UnderSpecBench (Jul 2026): 69 DevOps task families from real incidents and CVEs,
  2,208 prompt variants, 5 agent-model configurations — "55.8–67.8% of acted runs violate at least one
  boundary"; Safe Success 15.5–36.8%. Ambig-IaC (Apr 2026): 300 expert-verified ambiguous IaC tasks.
  CAPA (Jul 2026): 600 coding sessions, 60 user-ambiguity cells. Contrast with the March-2026 baseline
  benchmarks Lahiri cites (self-contained algorithmic functions).
SOURCE: A Unified Issue Resolution Benchmark for Requirement Clarification, Planning, and Code Generation for
  Coding Agents — Xin Zhou et al. (SMU and partners) — 10 Aug 2026 — https://arxiv.org/abs/2608.09072 — accessed 2026-09-08
SOURCE: Coding Agents Are Guessing: Measuring Action-Boundary Violations in Underspecified DevOps Instructions —
  Zimo Ji et al. (HKUST, Tongji) — 2 Jul 2026 — https://arxiv.org/abs/2607.02294 — accessed 2026-09-08
COUNTEREVIDENCE: None of these benchmarks specify side effects, mutable state or concurrency — the three
  things Lahiri named as the real-world gap. They scaled the *repository*, not the *semantics*. The hard part
  of problem 1 is untouched.
OPEN QUESTION: Is there any benchmark where the ground-truth specification includes a concurrency or
  side-effect obligation that the agent must recover from an underspecified request?
```

### 3.2 Problem 2 — change intent and compositionality: **no movement found**

```
CLAIM: Six months after being named, Lahiri's second open problem — specifying what should CHANGE and
       composing that with existing specifications — has no published method.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: Searches over cs.SE / cs.PL / cs.AI 2025-06 → 2026-09 for "specification drift", "intent drift",
  "change intent", "specification evolution", "compositionality specification" returned: (a) corpora —
  SpecMine indexes 5,992 spec-touching pull requests and reports 81.2% of them also modify code in the same
  changeset, i.e. it measures co-change but supplies no composition method; (b) governance framings —
  "spec-delta as the unit of change in lakehouse data platforms" (arXiv:2608.19838), a data-platform practice
  report; (c) the adjacent monitoring result — Skill Drift Is Contract Violation, which extracts executable
  environment contracts from skill documents and validates role-bearing assumptions (100% precision / 76% recall
  on known drift, 86% conservative precision on 49 real skills, 880-pair benchmark) — but this is drift
  *detection* in agent skill libraries, not change-intent specification for code. "Intent drift" as a phrase is
  owned by intent-based networking (LEAD-Drift, arXiv:2602.13672) and by multi-turn jailbreak safety, not by SE.
SOURCE: SpecMine: A Large-Scale Corpus of Spec-Driven Development Artifacts — Shyam Agarwal, Anmol Singhal,
  Travis Breaux, Bogdan Vasilescu (CMU) — 25 Aug 2026 — https://arxiv.org/abs/2608.25202 — accessed 2026-09-08
SOURCE: Skill Drift Is Contract Violation: Proactive Maintenance for LLM Agent Skill Libraries — Linfeng Fan
  et al. — 9 May 2026 — https://arxiv.org/abs/2605.10990 — accessed 2026-09-08
COUNTEREVIDENCE: Absence of evidence on arXiv is not absence of work — this could sit in ICSE/FSE 2027
  submissions or inside a closed industrial tool. The term of art may also differ ("delta specification",
  "refinement", "behavioural subtyping") in ways my query set missed.
OPEN QUESTION: Search FSE 2026 / ICSE 2027 accepted lists and the SpecOps 2026 programme specifically for
  change-specification composition. If genuinely empty, this is the single largest open slot in the lane.
```

### 3.3 Problem 3 — cost-effective clarification: **moved most, but the cost term is a placeholder**

```
CLAIM: What to clarify is now empirically ranked; the value side of the trade-off is formalised;
       the cost side is a placeholder constant in every published system.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Value side — the VOI framework (Jan 2026) defines VoI(q) = V_post(b,q) − V(b), NetVoI(q) = VoI(q) − c,
  and terminates when max_q NetVoI(q) <= 0; matches or beats manually tuned baselines in 18 of 20 conditions
  across four domains, and asks more questions in high-stakes settings (medical diagnosis U=10) than low-stakes
  (20-questions U=1). Ranking side — CLARITI's Shapley analysis over 700 underspecified SWE-Bench instances
  gives Error Information mean |SHAP| 0.183 vs Expected Behavior 0.0572, while Expected Behavior is missing in
  65% of issues and Error Information in only 33%: the most frequently missing information is not the most
  valuable. Result: 22.4% (no clarification) → 36.8% (CLARITI) against a 41.6% fully-specified ceiling, at 3.0
  questions vs GPT-5's 5.1. Removing the answerability reward collapses the gain (36.8% → 24.4%) — unanswerable
  questions actively poison context. Cost side — the VOI authors write, verbatim: "accurately modeling the
  nuances of human cognitive load is a major, open research challenge", and use c(H) = T·c.
SOURCE: Value of Information: A Framework for Human-Agent Communication — Yijiang River Dong, Tiancheng Hu,
  Zheng Hui, Caiqi Zhang, Ivan Vulić, Andreea Bobu, Nigel Collier — 10 Jan 2026 —
  https://arxiv.org/abs/2601.06407 — accessed 2026-09-08
SOURCE: Asking What Matters: Reward-Driven Clarification for Software Engineering Tasks — Sanidhya Vijayvargiya,
  Vijay Viswanathan, Graham Neubig (CMU) — 16 Apr 2026 — https://arxiv.org/abs/2604.14624 — accessed 2026-09-08
COUNTEREVIDENCE: Information-gain rewards buy less than the framing suggests. τ-Bench with a Bayesian
  information-gain reward improves success by only 3.7% at +0.3 turns (arXiv:2606.03135). The gains are real but
  small relative to the 19.2-point gap CLARITI is chasing.
OPEN QUESTION: What is the exchange rate between one developer-second of interruption and one point of task
  success? Nobody has measured it; every system assumes it is a constant.
```

### 3.4 Problem 4 — validating specifications: **the "user is the oracle" assumption was tested and broke**

```
CLAIM: The human user, named by Lahiri as the only oracle for specification correctness, judges INCORRECT
       machine-generated specifications at chance, with confidence indistinguishable from correct ones, and
       natural-language explanations do not help — bad explanations make it worse while raising confidence.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Controlled experiment, 86 Python programmers, plus a follow-up think-aloud study. Accuracy judging
  correct assertions 74%; judging incorrect assertions 49%. Difference significant at p<0.001, odds ratio 2.94.
  Confidence reported at similar levels for both. Natural-language explanations "provided no overall benefit";
  low-quality explanations impaired assessment accuracy (p=0.037, OR=0.58) while simultaneously *increasing*
  developer confidence (3.99/5 → 4.25/5, p=0.005). Authors' own conclusion: "contrary to common assumptions,
  AI assistance may not improve the reliability of code comprehension and review."
SOURCE: Programmers Are Poor and Overconfident Judges of LLM-Generated Assertions — Zhanna Kaufman, Yuriy Brun,
  Adithya Murali, Madeline Endres — 9 Jul 2026 — https://arxiv.org/abs/2607.08885 — accessed 2026-09-08
COUNTEREVIDENCE: The strongest counter is REFSQ 2026: 26 participants producing 130 requirement statements
  rated LLM revisions significantly higher than their own on alignment-with-intent, readability, reasoning and
  unambiguity, and reported that revisions "surfaced tacit details stakeholders considered important". But that
  study measures *perceived* quality by the same people whose judgment the Kaufman study shows is miscalibrated.
  Taken together the two are consistent: humans like machine-written specs and cannot tell when they are wrong.
OPEN QUESTION: Does the 49%-on-incorrect result replicate for full behavioural specifications (not just
  assertions), and does it improve with counterexample-driven presentation rather than explanation?
```

```
CLAIM: Because the human oracle failed, three oracle-free specification-quality metrics appeared in 2026,
       all built on the same trick: judge a specification by what a second, blind process derives from it.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: (a) Regeneration equivalence — AfterVibe recovers an abstract NL specification from a vibe-coding
  session, then has "a second, blind AI agent re-implement the artifact from the spec alone", grading the result
  against the original; 72 real internal company projects, mean regeneration score 5.06/6.0, refinable to 5.74,
  outperforming human-authored descriptions. (b) Deterministic execution judges — the semantic-block model uses
  "PostgreSQL 16 and a live Oracle instance as deterministic execution judges", explicitly "evaluating
  specification quality independently of model capability"; 18 semantic blocks / 19 dependency edges, 71%
  reduction in mean per-task context, 85.5% taxonomy coverage, 14.4pp median run-to-run variability. (c) Symbolic
  over/under-constraint detection — VeriAct's Spec-Harness reveals "a large fraction of verifier-accepted
  specifications, including optimized ones, are in fact incorrect or incomplete, over- or under-constraining both
  inputs and outputs in ways invisible to the verifier."
SOURCE: AfterVibe: What Remains When the Conversation Ends — Matteo Paltenghi, Satish Chandra (Google) —
  10 Jul 2026 — https://arxiv.org/abs/2607.09900 — accessed 2026-09-08
SOURCE: Measuring What a Specification Determines: A Formal Semantic-Block Model and an Execution-Judged
  Benchmark — Oleg Grynets, Dmytro Kostetskyi, Vasyl Lyashkevych — 19 Aug 2026 —
  https://arxiv.org/abs/2608.19475 — accessed 2026-09-08
SOURCE: VeriAct: Beyond Verifiability — Agentic Synthesis of Correct and Complete Formal Specifications —
  Md Rakib Hossain Misu, Iris Ma, Cristina V. Lopes (UC Irvine) — 31 Mar 2026 —
  https://arxiv.org/abs/2604.00280 — accessed 2026-09-08
COUNTEREVIDENCE: Regeneration equivalence only tests whether the spec *determines* a behaviour, never whether it
  determines the RIGHT behaviour. A spec that faithfully encodes a misunderstanding regenerates perfectly. That
  is exactly detrimental semantic collapse promoted from the code level to the specification level, and none of
  the three metrics can see it.
OPEN QUESTION: Can a spec-quality metric distinguish "determined and correct" from "determined and wrong"
  without a human? If not, the oracle problem has been relocated, not solved.
```

### 3.5 Problem 5 — rich logics and quantifiers: **moved, mostly in lane 03's territory**

```
CLAIM: Formally verified synthesis from formal specs works well in Dafny and badly elsewhere, and adding a
       natural-language description of the intent does not help.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Vericoding benchmark: 12,504 formal specifications (3,029 Dafny, 2,334 Verus/Rust, 7,141 Lean;
  6,174 unseen). Success rates 82% Dafny, 44% Verus/Rust, 27% Lean with off-the-shelf LLMs. Verbatim: "Adding
  natural-language descriptions does not significantly improve performance." Pure Dafny verification improved
  68% → 96% over one year. Lahiri's own August-2026 follow-up, Neuro-Formal Verification, returns a Dafny
  proof of correctness or of a bug on 57% of entries at 92% precision and a CBMC counterexample for 63% of
  buggy programs at 90% precision, against an LLM-as-judge baseline.
SOURCE: A benchmark for vericoding: formally verified program synthesis — Bursuc, Ehrenborg, Lin, Astefanoaei,
  Chiosa, Kukovec, Singh, Butterley, Bizid, Dougherty, Zhao, Tan, Tegmark (BAIF / MIT) — 26 Sep 2025 —
  https://arxiv.org/abs/2509.22908 — accessed 2026-09-08
SOURCE: Neuro-Formal Verification: Agentic Language-Agnostic Formal Program Reasoning — Shuvendu K. Lahiri —
  21 Aug 2026 (v2 26 Aug 2026) — https://arxiv.org/abs/2608.21516 — accessed 2026-09-08
COUNTEREVIDENCE: That NL descriptions do not help formal synthesis is the single most inconvenient result in
  this lane for any "natural language is the new specification language" thesis. It says the informal artefact
  adds nothing once a formal one exists — the bridge, not the endpoints, is where the value sits.
OPEN QUESTION: Does NL help when the formal spec is INCOMPLETE (the realistic case), rather than complete?
```

### 3.6 Problem 6 — human-AI interaction for specification: **moved a lot, calibration still unsolved**

```
CLAIM: Persistent user modelling produces the largest single measured improvement in underspecified software
       tasks found anywhere in this lane — 18.1% → 59.7% — and it survives contact with professional developers.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: ToM-SWE pairs a SWE agent with a lightweight theory-of-mind partner agent holding persistent memory of
  the user's goals, constraints and preferences. On stateful SWE-bench (user simulator plus previous interaction
  histories) it reaches 59.7% task success vs 18.1% for OpenHands. A three-week study with professional
  developers using it in daily work found it useful 86% of the time. Independently, CAPA shows the same
  mechanism at benchmark scale: same-user history lifts first-turn executable success by 15.6pp on average
  (Claude Opus 4.8: 24.3% → 60.3%) and cuts turns-to-completion by 0.81.
SOURCE: ToM-SWE: User Mental Modeling For Software Engineering Agents — Xuhui Zhou, Valerie Chen, Zora Zhiruo
  Wang, Graham Neubig, Maarten Sap, Xingyao Wang (CMU) — 24 Oct 2025, v2 29 Jan 2026 —
  https://arxiv.org/abs/2510.21903 — accessed 2026-09-08
SOURCE: Fewer Clarifications, Better Code: Benchmarking Cross-Session Personalized Ambiguity Adaptation in
  Coding Assistants — Zijian Xu, Wenshuo Zhang, Zisen Qin, Rui Sheng, Yushi Sun, Huamin Qu, Chuhan Shi (HKUST) —
  29 Jul 2026 — https://arxiv.org/abs/2607.26611 — accessed 2026-09-08
COUNTEREVIDENCE: The 18.1% OpenHands baseline is low and the benchmark is the authors' own. CAPA's ceiling
  result is more sober: even with full user history frontier models reach 78.7–90.0% executable success against
  100% on unambiguous baselines, and "almost 40% of sessions [still require] clarification". Preference dynamics
  defeat it: AcCoRD finds frontier models "can handle underspecification but struggle to satisfy preferences that
  emerge or evolve mid-interaction", and "prompting alone fails to elicit the required uncertainty recognition."
OPEN QUESTION: Does a persistent user model degrade when the user's preferences change — i.e. does memory of
  intent become a source of intent error?
```

```
CLAIM: The ask/don't-ask decision is a knife edge that no current prompting strategy sits on.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Ambig-DS finding (iii), verbatim: "agents cannot reliably tell when to use it: permissive prompts
  induce over-asking on clear tasks, while conservative prompts induce silent defaulting on ambiguous ones."
  Ask-or-Assume: the interactive baseline queried in 99.2% of Claude tasks and scored 70.40%, versus UA-Multi's
  69.40% at 3.06 queries/task — near-identical outcome for roughly thirty times the interaction. Kimi K2.6 in the
  same study went the wrong way: hidden baseline 72.80% → UA-Multi 69.40%, i.e. adding clarification HURT, at
  8.71 queries/task. Ask Early/Late's unscripted study of 300 sessions: over-asking in 52% of sessions, other
  models never asking, and "no current frontier model asks within the empirically optimal window."
SOURCE: Ambig-DS: A Benchmark for Task-Framing Ambiguity in Data-Science Agents — Josefa Lia Stoisser, Marc
  Boubnovski Martell, Sidsel Boldsen, Kaspar Märtens, Robert Kitchen — 10 May 2026 —
  https://arxiv.org/abs/2605.09698 — accessed 2026-09-08
SOURCE: Ask or Assume? Uncertainty-Aware Clarification-Seeking in Coding Agents — Nicholas Edwards, Sebastian
  Schuster (University of Vienna) — 27 Mar 2026, v2 3 Jun 2026 — https://arxiv.org/abs/2603.26233 — accessed 2026-09-08
COUNTEREVIDENCE: Ambig-DS also reports that "allowing the agent to ask one clarifying question recovers much of
  the loss under idealized conditions" — the information is available and one question is enough. The failure is
  entirely in the gating decision, not in the clarification mechanism.
OPEN QUESTION: Is gating learnable from outcome reward alone, or does it need a calibrated cost signal the model
  never sees?
```

### 3.7 Problem 7 — workflow integration: **moved fastest, with the thinnest evidence**

```
CLAIM: Spec-Driven Development went from nothing to nearly half a million public specification artefacts in
       about eighteen months, and 92% of them were first committed in 2026.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: SpecMine census of public GitHub: 470,795 specifications across 73,030 repositories using 17 named
  SDD tools, plus 98,574 files across 12,910 repositories in a separate AWS Kiro census. "Nearly all specs
  (99.7%) were first committed in 2025 or later" and "92% in 2026". 780,335 spec-file commits; 5,992
  spec-touching pull requests across 581 repositories, of which 81.2% also modify code in the same changeset;
  a traceability index of 2,421,323 typed references; 14.7 GB uncompressed; Zenodo DOI 10.5281/zenodo.22102779.
  Leading tools: OpenSpec (274,955 files / 8,926 repos), Spec Kit (54,640 / 10,619), caffeine.ai (14,262 /
  13,749, "primarily auto-generated"). Institutional marker: SpecOps 2026 — "Specification-Driven Development
  Life Cycle", 6 October 2026, Oakland Marriott City Centre, collocated with ISSTA/SPLASH.
SOURCE: SpecMine: A Large-Scale Corpus of Spec-Driven Development Artifacts — Agarwal, Singhal, Breaux,
  Vasilescu (CMU) — 25 Aug 2026 — https://arxiv.org/abs/2608.25202 — accessed 2026-09-08
SOURCE: SpecOps 2026 — 1st International Workshop on Specification-Driven Development Life Cycle —
  SPLASH/ISSTA 2026 — https://conf.researchr.org/home/splash-issta-2026/specops-2026 — accessed 2026-09-08
COUNTEREVIDENCE: Only 923 of 73,030 repositories have >=100 stars — 1.3%. The corpus is overwhelmingly small,
  young, low-signal repositories, and one tool's contribution is largely auto-generated. Volume here is not
  adoption by serious projects; much of it is tool default output.
OPEN QUESTION: What fraction of the 470,795 specs are ever updated after the first commit, and what is the
  abandonment rate? SpecMine enables the question and does not answer it.
```

---

## 4. Uncertainty representation: what exists, what is measured

**What the literature actually uses.** The taxonomy in the mission brief (KNOWN / INFERRED / ASSUMED /
AMBIGUOUS / CONTRADICTORY / UNKNOWN / UNVERIFIED) does **not** appear in the 2025–2026 literature under that
or any equivalent name. What is actually used, in descending order of frequency:

1. **Binary ask/act** — the overwhelming majority (Ask-or-Assume, ClarEval, Ambig-SWE, ClarifyCodeBench).
2. **Aleatoric / epistemic**, imported from ML — and explicitly declared insufficient for interactive agents by
   a June 2025 position paper calling for "underspecification-aware, decomposed, and communicable uncertainty
   representations" that would unlock "proactive clarification seeking and shared mental-model building"
   (arXiv:2506.07448).
3. **Two-way decomposition: action confidence vs request uncertainty** — the first concrete answer to that call
   (arXiv:2606.19559), improving clarification F1 on ALFWorld-Clarification by 73% over ReAct+UE and 36% over
   Uncertainty-Aware Memory across five backbones, using prompt-based estimation only (black-box APIs, no
   logprobs, no multi-sampling, no training).
4. **Three-valued Truth / Indeterminacy / Falsity** — the only formal lattice found (arXiv:2607.26220).
5. **Guess / enumerate-multiple / ask** — a three-action policy space, cost-conditioned (arXiv:2512.04068).
6. **Mandatory vs opportunistic information-seeking** — emergent from the agent's own action ratings, with
   Information-Seeking Effectiveness rising 50% → 74% across a regime shift (arXiv:2606.11349).
7. **Semantic clustering over sampled programs** — behavioural rather than declarative (ClarifyGPT, SpecFix,
   and the clustering family that semantic collapse breaks).

```
CLAIM: The only measured quantity of "how much of a specification is neither specified nor wrong" is 24.7%,
       and it comes from a single small study nobody has replicated.
LABEL: OBSERVED TODAY
CONFIDENCE: low
EVIDENCE: A neuro-symbolic multi-agent architecture over the OOMRAM lattice classifies each LLM requirement
  decision as Truth, Indeterminacy or Falsity. Across 37 natural-language project visions in eleven application
  families it eliminated structural inconsistencies in 35/37 cases (94.6%), leaving 6 unresolved structural
  errors (0.39% of decisions). The headline: "Three-valued analysis revealed that 24.7% of all decisions are
  indeterminate -- structurally valid but discretionary choices not explicitly mandated by the stakeholder."
SOURCE: Model-Driven Requirements Configuration with Three-Valued Uncertainty Scoring — Ahmed Ibrahim —
  28 Jul 2026 — https://arxiv.org/abs/2607.26220 — accessed 2026-09-08
COUNTEREVIDENCE: n=37 visions, single author, no baseline, bound to one domain model; the 24.7% is partly an
  artefact of the OOMRAM lattice's granularity. It is not a general constant. But it is the only number of its
  kind found, and its order of magnitude is consistent with independent measurements of the same residue:
  10–32% of tasks silently collapse on a single wrong reading (arXiv:2607.01953); under half of implicit
  requirements are elicited (arXiv:2602.18306); best model 48.3% on implicit-constraint scenarios
  (arXiv:2602.20424).
OPEN QUESTION: Is the indeterminate fraction stable across domains and specification granularities? If it is
  roughly 25% everywhere, that number is both the size of the intent gap and the size of the market.
```

**What is NOT measured.** I found no study asking whether *tracking* uncertainty explicitly changes the final
outcome versus tracking it implicitly. Every uncertainty-representation paper measures clarification F1, success
rate, or question count — never the counterfactual "does surfacing an ASSUMED tag to a human change what the
human does". Searching explicitly for disconfirming evidence ("explicit uncertainty tracking does not change
outcomes") returned nothing: the null result has not been published because the experiment has not been run.

---

## 5. Human attention and the value of information

```
CLAIM: Value of information for clarification IS formalised, IS stakes-sensitive, and IS steerable by an
       externally supplied cost — the theory question this lane was asked is answered YES, as of January 2026.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Dong et al. define NetVoI(q) = VoI(q) − c with VoI(q) = V_post(b,q) − V(b), terminate at
  max_q NetVoI(q) <= 0, and demonstrate stakes-sensitivity directly: medical diagnosis carries U=10 for a correct
  answer, animal-guessing carries U=1, and "agents ask more questions in high-stakes scenarios and fewer in
  low-stakes settings, unlike confidence thresholding which ignores stakes." Utility 14.14 vs 11.49 for
  confidence-thresholding on Mixed 20 Questions (GPT-4, c=0.01); matches or exceeds best manually tuned baselines
  in 18 of 20 conditions. Independently, Berant et al. train a policy that "takes as input the numerical cost of
  each clarification question, and each generated word", maximising cost-penalised accuracy via ReST, and show it
  "generalizes to numerical cost values that were unobserved at training time" — the cost knob is real and
  transferable. So "which CSS file" versus "refund inside six hours" is expressible today: it is a difference in U.
SOURCE: Value of Information: A Framework for Human-Agent Communication — Dong, Hu, Hui, Zhang, Vulić, Bobu,
  Collier — 10 Jan 2026 — https://arxiv.org/abs/2601.06407 — accessed 2026-09-08
SOURCE: Learning Steerable Clarification Policies with Collaborative Self-play — Jonathan Berant, Maximillian
  Chen, Adam Fisch, Reza Aghajani, Fantine Huot, Mirella Lapata, Jacob Eisenstein — 3 Dec 2025, v2 13 Jan 2026 —
  https://arxiv.org/abs/2512.04068 — accessed 2026-09-08
COUNTEREVIDENCE: Formalised is not calibrated. Both papers require someone to supply U and c. Nobody has
  measured either for software work. The VOI authors say so explicitly and justify c(H) = T·c as avoiding
  "confounding variables from a more complex, speculative cognitive model."
OPEN QUESTION: Where do U and c come from in a real product? Elicited from the user once? Inferred from
  observed pushback? Learned from revert rates? No paper found answers this.
```

```
CLAIM: Deployed coding agents are stakes-blind: telling them the blast radius is production rather than
       contained changes their willingness to act by 1.5 percentage points.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: UnderSpecBench crosses 69 DevOps task families with intent clarity (4 levels), target certainty
  (4 levels) and blast radius (2 levels: contained vs production), 2,208 prompt variants, 5 agent-model
  configurations including Claude Code + Claude Haiku-4.5 and Codex + Codex-5.1-mini. Verbatim: "blast-radius
  cues had minimal effect—action rates remained nearly flat across risk levels (65.5% vs 64.0%)." Meanwhile
  target underspecification is devastating: Safe Success collapses 67.9% → 8.6% and Wrong Target rises
  9.6% → 75.1% from fully specified to highly ambiguous target. On shared control planes OverScope reaches
  59.8–77.2% versus 14.4–37.6% on bounded-object surfaces.
SOURCE: Coding Agents Are Guessing: Measuring Action-Boundary Violations in Underspecified DevOps Instructions —
  Zimo Ji, Zekai Zhang, Congying Xu, Zongjie Li, Yudong Gao, Shuai Wang, Shing-Chi Cheung (HKUST, Tongji) —
  2 Jul 2026 — https://arxiv.org/abs/2607.02294 — accessed 2026-09-08
COUNTEREVIDENCE: None found. I searched for any coding-agent study showing consequence-sensitive asking and
  found only the abstract VOI/utility formulations, never an agent that modulates behaviour on stated stakes.
  The nearest positive result is in embodied navigation, where a cost-sensitive navigator queries "only when the
  expected uncertainty reduction justifies the interaction cost" (arXiv:2606.03175) — a different domain.
OPEN QUESTION: Is stakes-blindness a training artefact (no reward signal for caution) or an architectural one
  (stakes are stated in the prompt but never enter the policy)? A single ablation would settle it.
```

```
CLAIM: The value of a clarification decays sharply with execution progress, and the empirical demand curves
       for that decay have existed only since May 2026.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: A forced-injection framework supplies ground-truth clarifications at controlled points across four
  information dimensions (goal, input, constraint, context), three benchmarks, four frontier models, 84 task
  variants, 6,000+ runs. Against the "earlier is always better" intuition: goal clarification "loses nearly all
  value after 10% of execution (pass@3 drops from 0.78 to baseline)"; input clarification "retains value through
  roughly 50%"; and "deferring any clarification type past mid-trajectory degrades performance below never asking
  at all." Timing profiles are substantially task-intrinsic (cross-model Kendall tau 0.78–0.87 among models with
  identical coverage; 0.34–0.67 across the full four-model panel). Authors' framing: "These empirical demand
  curves provide the quantitative foundation that existing theoretical frameworks require but have lacked."
SOURCE: Ask Early, Ask Late, Ask Right: When Does Clarification Timing Matter for Long-Horizon Agents? —
  Anmol Gulati, Hariom Gupta, Elias Lumer, Sahil Sen, Vamse Kumar Subbiah — 8 May 2026 —
  https://arxiv.org/abs/2605.07937 — accessed 2026-09-08
COUNTEREVIDENCE: Forced injection is not agent-initiated asking; the demand curve measures the value of
  information arriving, not the value of an agent choosing to seek it, which carries extra cost (a wasted turn,
  a user context switch, an injection surface).
OPEN QUESTION: Cross this with ReqElicitGym's finding that LLMs' effective elicitation questions "often emerge
  in later turns" — if models get good at asking exactly when asking stops paying, the whole clarification
  research programme has an unnoticed structural defect. See §9.1.
```

**Where the human-attention question stands.** Formalisation: done (VOI, cost-conditioned policies, Bayesian
experimental design). Empirical demand curves for *timing*: done, May 2026. Empirical impact ranking of *what*
to ask: done, April 2026 (Shapley). Calibration of the *cost* of asking a specific human at a specific moment:
not started. Deployment of any of it in a real coding agent: not observed.

---

## 6. The circular specification problem

**The claim under test:** fully specifying a system costs as much as implementing it, so specification-first
workflows cannot pay for themselves.

### Evidence FOR

- **A crossover theorem exists.** ICML 2026 position track, Theorem 3.10: for σ(T) < σ*, "Natural language can
  be more efficient (i.e., possibly L_NL < L_formal)"; for σ(T) >= σ*, "Natural language cannot be more efficient
  (i.e., necessarily L_formal <= L_NL)", with σ* = H(Y) + R_formal − Δ_trans. Task specificity is "the minimal
  mutual information I(Y;Ŷ) such that Ŷ ∈ [[T]] with probability > 1−ε"; the translation gap
  Δ_trans = D_KL(p_M ‖ p_NL) is "the cost of using a general-purpose language to describe domain-specific
  content." Above the threshold, describing the requirement in prose costs more than writing it formally —
  the circularity claim, formalised. (arXiv:2607.20432)
- **The position-paper consensus.** The Specification Paradox: "the more capable artificial intelligence systems
  become at automatically generating software, the greater the dependence on correct, complete, verifiable, and
  explainable human-produced specifications"; AI "shifts this complexity toward domain understanding,
  requirements elicitation, specification development, validation, maintenance, and software evolution", naming
  Specification Overfitting and Specification Debt. (arXiv:2608.16618)
- **Human review is where the cost lands.** SWE-chat, the largest in-the-wild dataset (6,000 sessions,
  63,000+ user prompts, 355,000 tool calls): "just 44% of all agent-produced code survives into user commits",
  and "users push back against agent outputs — through corrections, failure reports, and interruptions — in 44%
  of all turns." (arXiv:2604.20779)
- **Telemetry.** Productivity-Reliability Paradox: 98% more pull requests, 91% longer review times, flat
  delivery metrics; 19% slowdown in the most rigorous RCT; multivocal review of 67 sources concluding
  "Specification discipline, not model capability, is the binding constraint". The vibe-coding state-of-the-art
  review reports team-level code-review time up 441%. (arXiv:2605.01160; arXiv:2608.20446)

### Evidence AGAINST

- **The one direct measurement points the other way for machine cost.** 2,700 runs, Kimi K3 at three thinking
  efforts: "reducing a full task specification to a bare user story raises token spend by 29.7%", with
  prompt-sensitivity task-dependent from 13% to 115%, and run-to-run variance unaffected by any prompt change.
  A 29.7% surcharge is not "as much as implementing"; the machine absorbs most of the cost of vagueness.
  (arXiv:2608.25399)
- **The theorem has escape hatches its own authors name.** Remark 3.13: the result assumes *one-shot*
  specification and "breaks down with iteration". Remark 3.14: it ignores human domain-learning costs, which
  raise σ*. Both favour progressive, iterative, conversational specification — exactly the mitigation the
  mission asks about. It also proves only relative crossover conditions, not absolute cost differences.
- **Partial specification pays disproportionately.** SpecFirst on ProgramBench (where frontier models solve
  fewer than 1% of instances from scratch): a dedicated spec-elicitation phase before synthesis improves test
  pass rates by 6.9–21.3% and binary exploration coverage by 9.4–18.5%, all statistically significant. Google's
  spec-driven test generation on production bugs: +9.8pp bug detection (p=0.0352), +2.5pp branch coverage
  (p=0.0034), test suites judged superior to human-authored tests in 56.7% of cases. Verifiable literate
  programming: pass@1 from 28.7–73.2% to 65.4–93.5%. None of these wrote a complete specification.
  (arXiv:2607.27167; arXiv:2608.17177; arXiv:2607.02333)
- **A worked existence proof at scale.** A single instrumented case study: 717,725-line TypeScript application,
  3,648 files; dismantling a core lifetime invariant across 189 files (288 files with extraction, 34,770
  insertions, 16,422 deletions); protocol of agent-authored formal specification, 14 refinement cycles auditing
  spec against source, atomic implementation, 17 verification cycles auditing code against a frozen spec;
  201 defects corrected across 31 audit passes before any human ran the program; no human code review; three
  days; USD 2,430; the change assessed by the author as "effectively infeasible through incremental refactoring".
  (arXiv:2608.12440)

### Verdict

```
CLAIM: "Fully specifying costs as much as implementing" is true in the limit and false in practice, because
       nobody needs a full specification: the measured cost of underspecification to the machine is modest
       (+29.7% tokens), while the cost that actually bites is human review and rework, which partial,
       progressively-refined specification demonstrably reduces.
LABEL: REASONABLE EXTRAPOLATION
CONFIDENCE: medium
EVIDENCE: The crossover theorem is real but assumes one-shot specification and no domain learning, and its
  authors flag both. The single direct cost measurement (2,700 runs) puts the token surcharge for a bare user
  story at 29.7%, task-dependent 13–115%. The human-side cost is where the evidence concentrates: 44% pushback
  rate and 44% code survival in the wild; +441% and +91% review time in telemetry; 19% RCT slowdown. Every
  partial-specification intervention measured (SpecFirst +6.9–21.3pp; Google spec-driven tests +9.8pp;
  VLP 28.7–73.2% → 65.4–93.5%; CLARITI 22.4% → 36.8%) bought a real improvement without approaching completeness.
SOURCE: Position: Natural Language Should Not Fully Replace Formal Languages — Eitan Wagner, Elisha Rosensweig,
  Omri Abend — ICML 2026 (position track) — 10 May 2026 — https://arxiv.org/abs/2607.20432 — accessed 2026-09-08
SOURCE: Can your AI agent be cheaper? Investigating the effects of task specifications on token spend in agentic
  coding tasks — Jakub Smékal — 26 Aug 2026 — https://arxiv.org/abs/2608.25399 — accessed 2026-09-08
SOURCE: SWE-chat: Coding Agent Interactions From Real Users in the Wild — Joachim Baumann, Vishakh Padmakumar,
  Xiang Li, John Yang, Diyi Yang, Sanmi Koyejo — 22 Apr 2026 — https://arxiv.org/abs/2604.20779 — accessed 2026-09-08
COUNTEREVIDENCE: The strongest counter to my verdict is that all four partial-specification wins were measured
  on tasks with an available oracle (tests, an execute-only binary, production bugs). The circularity bites
  hardest exactly where no oracle exists — and there the evidence is one self-reported n=1 case study whose
  author is also its subject, and whose "no bug observed" rests on roughly thirty later sessions of personal use.
OPEN QUESTION: What is the marginal return curve of specification effort? Everyone reports a point; nobody has
  published a curve of task success against specification tokens. Cheap, high-value, and apparently unclaimed.
```

---

## 7. Is SDD a transitional step toward intent-driven engineering?

### Evidence that SDD is a durable end state
- Institutionalisation: a dedicated ISSTA/SPLASH workshop (SpecOps 2026, 6 Oct 2026), with Google publishing
  into it.
- Volume: 470,795 public specs, 18 tools, 780,335 spec commits, 2.4M typed references.
- Contract framing: SDD "reconstitutes, in specification-centric form, the contracts that vibe coding dissolves:
  accountability, verifiability, and transferability" (arXiv:2609.00252).
- Independent measured wins: +9.8pp production bug detection at Google; +6.9–21.3pp from-scratch synthesis.
- The theorem: above σ*, formal beats natural language — specifications are not a phase, they are the efficient
  encoding for high-specificity work (arXiv:2607.20432).
- Portability is being studied as an engineering property (cross-agent specification portability in
  Oracle-to-PostgreSQL migration, arXiv:2608.21208), which is what happens to artefacts that are here to stay.

### Evidence that SDD is transitional
- **Spec-after already works.** AfterVibe recovers strong specifications *from the conversation after the fact*
  and outperforms human-authored descriptions; its conclusion is that "specifications—not code—could become the
  primary artifact for human review", but the specification is an *output* of intent expression, not its input.
- **The evidence base is admitted to be empty.** Diaz et al. drew "predominantly on gray literature ... because
  peer-reviewed evidence and a shared academic-industrial vocabulary are not yet established", presenting the
  work "as a first step toward academic-industrial consensus rather than a validated theory". The Specification
  Paradox contains zero measurements.
- **Where SDD has been taught, it degraded understanding.** In a Software Development PBL course (CSEE&T 2026),
  "while AI agent utilization increased implementation throughput, it also tended to encourage students to
  proceed with development without fully understanding the code", requiring instructors to verify comprehension
  separately (arXiv:2608.30572).
- **The corpus is shallow.** 923 of 73,030 repos have >=100 stars; one large tool's output is "primarily
  auto-generated".
- **Intent, not specification, is what the newest work targets.** SpecBench/Buddy, ToM-SWE, CAPA and AcCoRD all
  model the *person* — preferences, mental state, history, evolving goals — and treat the specification as a
  derived artefact.

```
CLAIM: SDD is a transitional scaffold: the durable object is a maintained model of the user's intent, of which
       the specification is a rendering; the direction of the 2026 frontier is from spec-as-input to spec-as-output.
LABEL: SPECULATIVE
CONFIDENCE: low
EVIDENCE: Directional only. Spec-after (AfterVibe) works and outperforms human-written descriptions;
  user-model-first approaches produce the largest gains in the lane (ToM-SWE 18.1% → 59.7%; CAPA +15.6pp FT-ES;
  SpecBench/Buddy decomposing intent into design dimensions before asking); the SDD literature's own flagship
  review calls its evidence base unestablished; and the newest conceptual work frames the human contribution as
  "problem framing, semantic commitment, verification, integration, attention, and residual-risk acceptance" —
  attention and acceptance, not document authorship (arXiv:2609.04630).
SOURCE: Spec-Driven Development for Agentic Software Engineering: Harnessing Human-Agent Teamwork — Jessica Diaz,
  Joaquin Gayoso, Andrea Cimminio, Jorge Perez — 31 Aug 2026 — https://arxiv.org/abs/2609.00252 — accessed 2026-09-08
SOURCE: Software Engineering in the Agent Era: From Trustworthy Change to Human Agent Software Organizations —
  Zhongjie Wang, Mingyi Liu — 4 Sep 2026 — https://arxiv.org/abs/2609.04630 — accessed 2026-09-08
COUNTEREVIDENCE: Specifications have survived every previous attempt to abolish them (CASE tools, MDA, literate
  programming), and the crossover theorem gives a principled reason they must exist above a specificity
  threshold. "Transitional" may simply mean "the artefact will be machine-written", not "the artefact will
  disappear". The strongest version of the SDD case — specifications as the accountability substrate for
  delegating to agents — is orthogonal to whether a human types them.
OPEN QUESTION: Does anyone maintain a spec after the first commit? SpecMine has the data (780,335 spec commits,
  lifecycle role classifications) and has not published the answer. That single number decides this section.
```

---

## 8. Contradictions with common belief

**8.1 — "The user is the ground truth for whether a specification is right."**
This is the founding assumption of intent formalization and it is false as an engineering assumption.
86 programmers judged incorrect assertions at **49% accuracy** — chance — while judging correct ones at 74%,
with **the same reported confidence** (p<0.001, OR=2.94). Natural-language explanations "provided no overall
benefit", and low-quality explanations *reduced* accuracy (OR=0.58) while *raising* confidence (3.99 → 4.25/5).
Compounding it, the machine has the mirror-image bias: models "detect planted over-inclusions 6-7x more often
than planted omissions", and a production system of 43,227 items "fails omission-first at 10:1". Both the human
reviewer and the machine reviewer are systematically blind to what is *missing* from a specification — precisely
the failure mode underspecification produces.
*(arXiv:2607.08885; arXiv:2608.01000)*

**8.2 — "If the model is unsure, it should ask."**
Asking has three independently measured costs that no clarification paper prices together.
(i) **Conversational**: across six generation tasks and 200,000+ simulated conversations, all top open- and
closed-weight models drop **39% on average** in multi-turn versus single-turn; "when LLMs take a wrong turn in a
conversation, they get lost and do not recover."
(ii) **Security**: entering a clarification state raises prompt-injection success from **1.8% → 34.0%** (o3) and
**2.2% → 35.7%** (Gemini-3-Flash) over 728 matched task-attack scenarios; "robustness under fully specified
tasks does not translate to robustness under ambiguity."
(iii) **Temporal**: "deferring any clarification type past mid-trajectory degrades performance below never
asking at all", and no frontier model asks in the right window.
*(arXiv:2505.06120; arXiv:2605.17324; arXiv:2605.07937)*

**8.3 — "Stronger models will absorb underspecification."**
Orchid measured the opposite: "the most pronounced negative effects observed in highly advanced models";
GPT-4 drops **more than 28 percentage points** on ambiguous specifications despite top-tier baseline performance;
mean relative Pass@1 decline 16.25%. Self-consistent errors — the ones sampling cannot detect — remain "stable or
even increase" with scale while inconsistent errors shrink. Semantic collapse is worst on the newest,
contamination-free benchmark (LiveCodeBench 18–32%) and mildest on the oldest (HumanEval 3%). And in
ClarifyCodeBench, the model with the *highest* ambiguous Pass@1 among non-reasoning models (Claude-Sonnet-4.5,
38.2%) had the *lowest* clarification quality (TKQR 0.12, ORA 0.22): being a better guesser and being a better
asker are not the same skill and may trade off. The same paper adds: "Thinking helps code generation under
complete requirements more than it helps clarification."
*(arXiv:2604.21505; arXiv:2505.17656; arXiv:2607.01953; arXiv:2607.00711)*

**8.4 — "Disagreement between samples reveals ambiguity."**
The entire clustering-based disambiguation family (ClarifyGPT, SpecFix) assumes it does. It does not: "coherent
model behavior cannot be interpreted as evidence of correct task understanding", and detrimental collapse is
"a blind spot of clustering-based disambiguation: from 11% to 49.7% of tasks receive an incorrect solution
without triggering a clarifying question." Worse, after one clarifying turn detrimental collapse *increases* to
37.3–76.5% on MBPP, because "if two incorrect solutions differ only in edge case handling, the clarifying
question will concern edge cases rather than the more fundamental source of incorrectness." Detecting collapse
at under 1% risk needs k=300 samples, over **$391 per MBPP run**. The same phenomenon was measured independently
and earlier from the diversity side: the "Artificial Hivemind" effect gives inter-response cosine similarity
≈0.80–0.90 even at high temperature, reducible to ≈0.65 only with extreme intervention (T >= 4.0 plus persona
anchoring).
*(arXiv:2607.01953; arXiv:2608.02618)*

**8.5 — "Spec-Driven Development is validated practice."**
It is a mass phenomenon with an admitted evidence vacuum: 470,795 public specs, 92% first committed in 2026,
and its own flagship conceptual paper says peer-reviewed evidence "is not yet established", presenting itself
"as a first step toward academic-industrial consensus rather than a validated theory". The Specification Paradox
is a position paper with no numbers. The most spectacular SDD result in the corpus (717k LOC, 189 files, 3 days,
$2,430) is n=1 and self-reported by its own subject.
*(arXiv:2608.25202; arXiv:2609.00252; arXiv:2608.16618; arXiv:2608.12440)*

---

## 9. Problems nobody is talking about

**9.1 — Models learn to ask good questions exactly when good questions have stopped paying.**
ReqElicitGym finds that LLMs' "effective elicitation questions often emerge in later turns of the dialogue".
Ask Early/Late finds that goal clarification "loses nearly all value after 10% of execution" and that late
clarification is worse than never asking. Both papers exist; nobody has put them together. Every clarification
benchmark found here scores question *quality* (TKQR, KQC, ORA, answerability, relevance, ATC) and every one is
turn-agnostic or at best turn-discounted — none scores a question against the *remaining* value of the
information at the moment it is asked. If training pressure rewards late, well-formed questions, the field is
optimising a metric anti-correlated with the outcome it wants. No joint quality-by-timing objective was found
anywhere in the corpus.

**9.2 — The quarter of decisions that are neither requirements nor errors has no owner.**
24.7% of requirement decisions are "structurally valid but discretionary choices not explicitly mandated by the
stakeholder". These are not bugs and not requirements: they are authorship, exercised by a machine, attributed
to nobody. Software has provenance mechanisms for code (blame, review, sign-off) and for requirements
(traceability). It has none for *discretion*. Nobody is building the record "the system chose X; the human never
said anything about X; here is the list". The closest work frames it as accountability across handoffs —
"accountable translation ... making consequential changes attributable, inspectable, scoped in validation, and
contestable" — and is a bounded trace study of six build attempts in an education tool, not a mechanism.
*(arXiv:2607.26220; arXiv:2609.04679)*

**9.3 — Specification abandonment is measurable, enabled, and unmeasured.**
SpecMine explicitly supports studying "spec abandonment mid-flight (open tasks that never close, placeholders
never filled)" and ships lifecycle role classifications (living, archived, feature, change-proposal). It also
reports that 81.2% of spec-touching PRs modify code in the same changeset — meaning **18.8% do not**. Nobody has
published the abandonment rate, the spec-code divergence rate, or the half-life of a specification.
"Specification Debt" is named in a position paper and quantified nowhere. This is the cheapest high-value study
available in the lane: the dataset is public with a Zenodo DOI. *(arXiv:2608.25202; arXiv:2608.16618)*

**9.4 — Nobody has priced a developer-second.**
Every clarification cost model in the corpus is `turns × constant`. The authors of the most careful one say
plainly that a real cognitive-load model "is a major, open research challenge" and that they avoided it to
prevent confounds. So the entire cost-aware clarification literature — VOI, steerable policies, cost-sensitive
navigation, reward-driven clarification, Bayesian experimental design — optimises against a number never measured
for software work. The units are missing. There is no published exchange rate between an interruption and a
defect avoided, so no system can currently decide whether the CSS-file question is worth asking.
*(arXiv:2601.06407)*

**9.5 — Security hardening and intent recovery are in direct opposition, and nobody prices the trade.**
TAB shows that among six prompt-injection defences, "suppressing distractor execution also suppresses the cues
required for task completion" — the same environmental signals that carry an injected instruction carry the
missing requirement. ASPI shows the complementary failure: the clarification state itself is the attack surface.
Together these say that recovering unstated intent from the environment and defending against unstated
instructions in the environment are the same problem viewed from two sides. Every paper treats one and ignores
the other. *(arXiv:2605.12233; arXiv:2605.17324)*

**9.6 — The classical RE canon was skipped, not superseded.**
KAOS, i*, goal-oriented RE, obstacle analysis, viewpoint resolution — four decades of work on exactly this
problem — appear in the 2025–2026 LLM literature in a handful of papers (ArgRE, QUARE, one EASE 2026
goal-extraction study reaching 61% accuracy on low-level goals and concluding the approach is "best suited as a
tool to accelerate manual extraction rather than as a full replacement"). The clarification literature reinvented
"ask a question" from scratch with benchmarks and RL and did not read the elicitation canon. Nobody has tested
whether a KAOS obstacle model would catch the semantic collapses that clustering misses. This is not a claim the
canon would work; it is a claim that nobody checked. *(arXiv:2604.22207; arXiv:2604.23124; arXiv:2603.11890)*

**9.7 — Style and taste are a separate, harder failure class and are being averaged away.**
ReqElicitGym's one qualitative finding: LLMs "can elicit interaction and content implicit requirements, but
consistently struggle with style-related requirements." Every benchmark in this lane scores functional
correctness through execution. There is no benchmark for eliciting aesthetic or stylistic intent, and the one
paper that noticed the gap reports it in a single sentence. *(arXiv:2602.18306)*

---

## 10. What becomes commodity / what stays hard

### Commodity
- **Detecting the presence of ambiguity in a description.** *(STRONG TREND)* — high recall already; SpecFix
  operates unaided on 43.58% of descriptions; ten-type taxonomies published.
- **Generating a syntactically good clarifying question.** *(STRONG TREND)* — at least fifteen frameworks in
  eighteen months; a trained 8B model matches GPT-5 task success with 41% fewer questions.
- **Rendering resolved intent as a structured specification artefact.** *(OBSERVED TODAY)* — 18 tools,
  470,795 artefacts, largely tool-default output.
- **Recovering a specification after the fact from a session transcript.** *(OBSERVED TODAY)* — AfterVibe beats
  human-authored descriptions on 72 real projects.
- **Cross-session personalisation of a user's recurring ambiguity resolutions.** *(STRONG TREND)* — +15.6pp
  first-turn success from user history alone, no model change.
- **Formally verified synthesis in a verification-native language.** *(OBSERVED TODAY)* — Dafny 82%; pure Dafny
  verification 68% → 96% in one year.

### Stays hard
- **Knowing whether to ask at all.** *(OBSERVED TODAY)* — knife edge in both directions; ten frontier agents,
  none calibrated.
- **Seeing the ambiguity the model did not notice.** *(OBSERVED TODAY)* — detrimental semantic collapse is
  invisible to disagreement, worsens after clarification, and costs $391/run to detect at 1% risk.
- **Validating a specification without an oracle.** *(OBSERVED TODAY)* — human oracle at chance; the three
  machine proxies test determinacy, not correctness.
- **Composing intent across a change.** *(OBSERVED TODAY, by absence)* — no method found.
- **Extracting what the human did not say and could not say.** *(OBSERVED TODAY)* — under 50% of implicit
  requirements elicited; 24.5–46.0% of agent failures traced to implicit-requirement recovery; best model 48.3%
  on implicit-constraint scenarios.
- **Pricing human attention.** *(OBSERVED TODAY)* — declared an open research challenge by the people who
  needed it most.
- **Making agents stakes-sensitive.** *(OBSERVED TODAY)* — 65.5% vs 64.0%; formalised in theory, absent in every
  measured agent.
- **Style, taste and aesthetic intent.** *(OBSERVED TODAY)* — the one dimension every elicitation benchmark
  reports failing on, and none measures.
- **Keeping intent and reality aligned over time.** *(REASONABLE EXTRAPOLATION)* — drift detection exists for
  agent skill contracts (100% precision / 76% recall) and for network intent; nothing equivalent exists for
  software specifications.

---

## 11. Open questions for the second wave

1. **Change intent.** Is Lahiri's problem #2 genuinely empty, or published under other vocabulary (delta
   specification, refinement, behavioural subtyping) or in venues arXiv does not carry? Check the SpecOps 2026
   programme (6 Oct 2026) and FSE 2026 / ICSE 2027 accepted lists.
2. **The specification half-life.** SpecMine is public (Zenodo 10.5281/zenodo.22102779, 14.7 GB): what fraction
   of 470,795 specs are ever updated after the first commit; what is the abandonment rate; how far do specs and
   code diverge? This single analysis decides §7.
3. **The marginal return curve of specification effort.** Nobody has plotted task success against specification
   tokens. Is the curve concave, S-shaped, or does it turn down (over-specification)?
4. **Does explicit uncertainty tracking change human behaviour?** Every uncertainty-representation paper measures
   clarification F1. None measures whether showing a human an "ASSUMED" tag changes what the human does. Cheap,
   unclaimed, decisive for any product built on uncertainty labelling.
5. **Quality by timing.** Build the joint objective §9.1 says is missing and test whether models trained on
   turn-discounted quality metrics systematically ask late.
6. **Where do U and c come from?** Elicited once, inferred from pushback, learned from revert rates? Without an
   answer the VOI framework cannot ship.
7. **Does the 49%-on-incorrect result generalise from assertions to behavioural specs,** and does
   counterexample presentation fix what explanation does not?
8. **Is spec-quality-by-regeneration able to detect a faithfully-encoded misunderstanding?** If not, semantic
   collapse has moved up a level and the oracle problem is relocated rather than solved.
9. **Is stakes-blindness architectural or a training artefact?** One ablation where stated blast radius enters
   the policy would settle it, and the answer determines whether the "refund inside six hours" case is a
   research problem or an engineering one.
10. **Would a KAOS obstacle model catch collapses that clustering misses?** Nobody has run the classical
    baseline against the modern failure mode.
11. **Semantic collapse follow-ups.** As of 8 Sep 2026 the Semantic Scholar citation graph returns **zero**
    citing papers for arXiv:2607.01953. Whether the field absorbs or ignores that result is the strongest
    available signal about its direction — re-check in the second wave.
12. **ClarEval / ClarifyCodeBench / Orchid convergence.** Three independent ambiguity benchmarks published within
    five months of each other with non-overlapping taxonomies (10 types, 4 types, 3 types). Is there a stable
    ambiguity taxonomy underneath, or is each benchmark measuring its own construct?
