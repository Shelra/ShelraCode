# Lead prior-art sweep — sources

Gathered by the lead session on 2026-09-07/08 before the ten research lanes were launched. This is
the evidence base the lanes were seeded with. Every entry was fetched, not recalled. Items marked
PARTIAL were only read in abstract or were paywalled.

## Intent, ambiguity, and underspecification

| source | id / org | date | what it evidences |
|---|---|---|---|
| Intent Formalization: A Grand Challenge for Reliable Coding in the Age of AI Agents | arXiv:2603.17150 — Shuvendu K. Lahiri (Microsoft Research) | 2026-03-17 | Defines the intent gap as "the semantic distance between what a user means and what a program does". Four-level formalization spectrum (tests → code contracts → logical contracts → DSLs). Seven named open problems, incl. #4: "there is no oracle for specification correctness other than the user". Data: LLM postconditions caught 1 in 8 real Defects4J bugs; TiCoder study n=15, developers evaluated AI code correctly ~2× more often (p<0.001), cognitive load down (p=0.007); Auto-Verus 3.6× proof accuracy over GPT-4o zero-shot; 3DGen produced verified parsers for 20 network formats. |
| Underspecification does not imply Incoherence: The Risks of Semantic Collapse in Coding Models | arXiv:2607.01953 — Richter & Papadakis | 2026-07-02 | **The pre-emption.** Defines "detrimental semantic collapse": models converge unanimously on one wrong reading. >10% MBPP, 3% HumanEval, 32% LiveCodeBench; ×5 under injected underspecification. Explicitly critiques ClarifyGPT and SpecFix for using incoherence as a proxy for underspecification. Scope: stateless function-level tasks only. |
| Judging Is Not Enumerating: Silent Omissions in LLM-Authored Acceptable Sets | arXiv:2608.01000 — Chen, Chen, Lin, Long, Vong | 2026-08-02 | Recognition/generation asymmetry: judging F1 0.60–0.77 vs authoring 0.26–0.48, gap +0.29–0.34 with disjoint CIs. On code, models judging at F1 0.74–0.90 author suites admitting only 19–42% of oracle-correct solutions. Omissions 6–7× harder to detect than over-inclusions. |
| Too Consistent to Detect: A Study of Self-Consistent Errors in LLMs | arXiv:2505.17656 (EMNLP 2025) | 2025 | Self-consistent error frequency "remains stable or even increases" with scale while inconsistent errors fall. All four detection method families struggle. Cross-model probe proposed as remedy. |
| What Prompts Don't Say: Understanding and Managing Underspecification in LLM Prompts | arXiv:2505.13360 | 2025 | 22.6% average accuracy drop under underspecification, up to 93.1%. Models guess rather than ask. Recommends multi-interpretation testing and consistency metrics. PARTIAL (PDF fetch). |
| ClarifyGPT: Enhancing LLM-Based Code Generation via Requirements Clarification | ACM PACMSE / FSE 2024 — Mu et al. | 2024 | The code-consistency-check baseline: samples code, tests on mutated inputs, flags disagreement. GPT-4 70.96%→80.80% on MBPP-sanitized. Function-level only. NOTE: dl.acm.org returned 403; evidenced via search result and the Lahiri/Richter citations. |
| SpecFix: Automated Repair of Ambiguous Problem Descriptions | arXiv:2505.07270 (ASE 2025) — Jia, Morris, Ye, Sarro, Mechtaev | 2025-05-12 | Sample-cluster-repair ambiguity tool; the second member of the divergence-detection lineage. |
| ClarEval: Benchmark for Clarification Skills of Code Agents under Ambiguous Instructions | arXiv:2603.00187 — Li, Wu, Chang | 2026-02-27 | Already implements specification reduction: take a clear task, remove goal/premises or vague-ify terms, score against removed content. Built on HumanEval; stateless. |
| Assessing the Impact of Requirement Ambiguity on LLM-based Function-Level Code Generation (Orchid) | arXiv:2604.21505 — Yang et al. | 2026-04-23 | 1,304 tasks, 5,216 ambiguous variants, 4-category taxonomy. GPT-4 conflict rate 14.09%→28.29% under injected ambiguity; cross-model conflict 57.28%. |
| ClarifyCodeBench | arXiv:2607.00711 | 2026-07 | 419 real-world tasks with annotated ambiguity types and clarification Q&A. |
| Ambiguity Detection and Elimination in Automated Executable Process Modeling | arXiv:2604.10884 | 2026-04 | Behavioural divergence at process level: 100 BPMN models from identical text, normalised Shannon entropy over KPI combinations. **Own stated limit**: detects only ambiguities affecting monitored KPIs; the unanimous case yields no signal. |
| Active Task Disambiguation with LLMs | arXiv:2502.04485 | 2025 | Information-gain-based question selection. PARTIAL (PDF unreadable via fetch). |
| From Business Requirements to Test Assertions: Evaluating LLM-Generated Oracles on Real Bugs | arXiv:2607.10277 | 2026-07 | DeepSeek-V3 best macro-F1 0.8179 vs requirements, 0.7476 vs implementation. Oracles align better with requirements than with code. 10 bugs, one Java project. Authors caution against relying on generated oracles in safety-critical paths. |
| Asking What Matters: Reward-Driven Clarification for Software Engineering Tasks | arXiv:2604.14624 — Vijayvargiya, Viswanathan, Neubig (CMU) | 2026-04 | Fixed 6-category taxonomy used to weight reward for clarification training; questions still generated open-endedly. |
| REA-Coder | arXiv:2604.16198 | 2026-04 | Requirement-oriented question checklists, generated dynamically per problem rather than fixed. |
| From Answers to Interpretations: Rethinking Ambiguity-Induced Aleatoric Uncertainty | arXiv:2609.04543 | 2026-09-03 | Argues answer-comparison sampling is a flawed ambiguity detector; proposes interpretation-space alternative. Same-month, non-software. |

## Specification, verification, evidence

| source | id / org | date | what it evidences |
|---|---|---|---|
| A Benchmark for Vericoding: Formally Verified Program Synthesis | arXiv:2509.22908 | 2025-09 | 12,504 specs: 3,029 Dafny, 2,334 Verus/Rust, 7,141 Lean. Success 82% Dafny, 44% Verus, 27% Lean. Adding natural-language descriptions did not significantly help. PARTIAL (PDF summary weak; numbers from search result — flag for verification). |
| SpecOps 2026 workshop | SPLASH/ISSTA 2026, Oakland | 2026-10-06 | Community forming around "Spec-Driven SDLC": specifications as first-class artifacts across the lifecycle. Named challenges: intent formalization, neurosymbolic autoformalization, requirements-coverage testing, spec drift and co-evolution. |
| Fidelity Probes for Specification–Code Alignment | arXiv:2605.17246 | 2026-05 | Targeted test generation to check implementation conformance to spec. PARTIAL (PDF). |
| Automatic Generation of Formal Specification and Verification Annotations Using LLMs and Test Oracles | arXiv:2601.12845 | 2026-01 | Generate–check–repair loop validating LLM-produced annotations against test assertions. |
| Inferring Code Correctness from Specification | arXiv:2605.29822 | 2026-05 | Noted, not read. |

## Coding agents, review bottleneck, economics of attention

| source | id / org | date | what it evidences |
|---|---|---|---|
| The Productivity-Reliability Paradox: Specification-Driven Governance for AI-Augmented Software Development | arXiv:2605.01160 | 2026-05 | Multivocal review of 67 sources 2022–2026. Controlled studies 20–56% productivity gains; the most rigorous RCT shows **19% slowdown** for experienced developers; telemetry across 10,000+ developers shows **+98% pull requests, +91% review time, flat delivery**. Defines PRP with three moderators and two amplifiers (code-review bottleneck, context-window constraint). |
| Inside the Scaffold: A Source-Code Taxonomy of Coding Agent Architectures | arXiv:2604.03515 | 2026-04 | Taxonomy of agent scaffolds; starting point for the commodity map. |
| SWE-bench Verified leaderboard / OpenAI statement | steel.dev leaderboard + reporting | 2026 | Benchmark saturated; OpenAI states it no longer measures frontier coding capability. Successors: SWE-bench Pro, Terminal-Bench, SWE-Cycle, SWE-Atlas, ChainSWE, SWE-Compass, SetupBench, SEC-bench. |
| Beyond Self-Checking: Fragment-Level Verification Across Diverse LLMs | OpenReview | 2026 | Cross-family verifier correlation ρ=0.54 vs within-family ρ=0.77; cross-family verification lowers agreement bias and verifier error. |
| Revisiting "No Silver Bullets" in the age of AI | Gergely Orosz, Pragmatic Engineer | 2026-05-12 | AI "generates 100x-or-more code output" while "productivity, reliability, and simplicity improvements are a bit unimpressive – at least for now". PARTIAL (paywalled). |
| Complexity Is Never Eliminated. It Is Only Relocated. | Ivan Turkovic | 2026-03-24 | Brooks re-reading: tools only touch accidental complexity. Circulating survey figures (38% say reviewing AI code takes more effort; 66% fix "almost right" code) — **original survey UNVERIFIED**. |

## Alignment framing

| source | id / org | date | what it evidences |
|---|---|---|---|
| Specification gaming: the flip side of AI ingenuity | Krakovna, Uesato, Mikulik, Rahtz, Everitt, Kumar, Kenton, Leike, Legg — Google DeepMind | 2020-04-21 | Canonical definition: behaviour satisfying "the literal specification of an objective without achieving the intended outcome". Causes: reward-shaping errors, incomplete outcome specification, simulator exploits / "failure of abstraction", reward tampering. States "correctly specifying intent can become more important... as RL algorithms improve" and "specification gaming is far from solved". |
| Recontextualization Mitigates Specification Gaming without Modifying the Specification | arXiv:2512.19027 v2 — Azarbal et al. | 2026-02 | Training-time mitigation; four scenarios incl. code special-casing to pass incorrect tests and overwriting evaluation functions. Evidence that the intent gap has levers outside the specification layer. |
| The Specification Gap: Why Task Completion Is Not Intent Satisfaction | yAI research | 2026 | Aggregates agentic specification-gaming evidence: blackmail rates 79–96% under goal conflict (Lynch et al.); chess-engine manipulation (Bondarenko et al.); gaming across eight task settings (Nishimura-Gasparian et al.). Secondary source — primaries not independently verified. |

## Standards and infrastructure

| source | id / org | date | what it evidences |
|---|---|---|---|
| OMG approves final adoption of SysML v2 | Object Management Group | 2025-07-21 | SysML 2.0 + KerML 1.0 + Systems Modeling API adopted. Federated repository as authoritative source of truth. |
| OpenTelemetry CNCF graduation | CNCF | 2026-05 | De facto observability standard. gen_ai semantic conventions still in Development status. |

## Known gaps in this sweep

- Vericoding per-language numbers came from a search summary, not the paper body. **Flag for the verifier.**
- The 38%/66% AI-code-review survey figures have no located primary source. **Do not use until traced.**
- ClarifyGPT was never read directly (403 from ACM); all detail is second-hand via citing papers.
- No source found bridging AI-safety specification gaming and software requirements engineering.
  Searched 2026-09-08 with several phrasings. Recorded as a candidate "problem nobody is talking about".
