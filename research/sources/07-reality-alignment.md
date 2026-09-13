# Lane 07 — Sources

All accessed **2026-09-08** unless stated. Order: standards/official docs, then peer-reviewed and
preprint literature, then surveys/reports, then databases used. `UNVERIFIED` marks anything I could
not fetch and read directly.

Note on method: this session's WebSearch budget was exhausted before lane 07 began, so discovery was
done through (a) the arXiv API and arXiv's own search UI, (b) the OpenAlex API, (c) Crossref, and
(d) direct fetches of primary documents. DBLP was unavailable (bot challenge); DuckDuckGo/Bing were
unavailable (CAPTCHA). ~41 distinct queries were run.

---

## Standards, specifications and official documentation

1. **"Cloud Native Computing Foundation Announces OpenTelemetry's Graduation, Solidifying Status as
   the De Facto Observability Standard"** — CNCF — 2026-05-21 —
   https://www.cncf.io/announcements/2026/05/21/cloud-native-computing-foundation-announces-opentelemetrys-graduation-solidifying-status-as-the-de-facto-observability-standard/
   — Evidences: graduation date; 12,000+ contributors from 2,800+ companies; 1.36B JS API downloads
   and 1.3B Python API downloads over 12 months with April 2026 monthly records; metrics/logs/traces +
   Collector + semconv graduated; Profiles in alpha; maintainer quotes on GenAI observability.

2. **OpenTelemetry — Semantic Conventions index** — https://opentelemetry.io/docs/specs/semconv/ —
   Evidences: list of convention areas; GenAI conventions "Moved to the OpenTelemetry GenAI semantic
   conventions repository".

3. **OpenTelemetry — Versioning and stability** —
   https://opentelemetry.io/docs/specs/otel/versioning-and-stability/ — Evidences: four lifecycle
   stages (Development / Stable / Deprecated / Removed); what semantic-convention stability protects
   (attribute keys, metric names/kinds/units, span names/kinds, well-known values) and what it
   explicitly does not (arbitrary attribute values, span links, metric descriptions, recorded values);
   the "MUST always be possible to upgrade to the latest minor version" guarantee.

4. **OpenTelemetry — GenAI semantic conventions (redirect page)** —
   https://opentelemetry.io/docs/specs/semconv/gen-ai/ — Evidences: gen_ai conventions relocated out of
   the main semconv repository.

5. **open-telemetry/semantic-conventions-genai (README and docs/gen-ai/README.md)** —
   https://github.com/open-telemetry/semantic-conventions-genai and
   https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/README.md —
   Evidences: scope (spans, metrics, events for GenAI clients, MCP, provider-specific: Anthropic,
   Azure AI Inference, AWS Bedrock, OpenAI); documents for events, exceptions, metrics, model spans,
   agent spans; **"Status: Development"**.

6. **OpenTelemetry — Feature flags semantic conventions** —
   https://opentelemetry.io/docs/specs/semconv/feature-flags/ — Evidences: **"Status: Development"**;
   feature flags currently defined for the events signal.

7. **OpenTelemetry — CI/CD semantic conventions** — https://opentelemetry.io/docs/specs/semconv/cicd/
   — Evidences: **"Status: Release Candidate"**; spans, metrics and logs conventions exist.

8. **OpenTelemetry — Profiles signal** — https://opentelemetry.io/docs/concepts/signals/profiles/ —
   Evidences: **"Status: Alpha"**; supports sampling (timer interrupts, eBPF) and instrumentation-based
   profiling; On-CPU / Off-CPU / Heap / Allocations; correlation with logs, metrics and traces;
   eBPF-based agent profiles "most languages without any code changes".

9. **Kubernetes documentation — Controllers** —
   https://kubernetes.io/docs/concepts/architecture/controller/ — Evidences: control-loop definition;
   "Each controller tries to move the current cluster state closer to the desired state"; the explicit
   non-convergence statement "potentially, your cluster never reaches a stable state... it doesn't
   matter if the overall state is stable or not"; controllers report current state back to the API
   server for other loops to observe.

10. **OpenGitOps — GitOps Principles v1.0.0** — CNCF GitOps Working Group — https://opengitops.dev/ —
    Evidences: the four principles verbatim, including "Continuously Reconciled — Software agents
    continuously observe actual system state and **attempt** to apply the desired state"; no
    convergence guarantee anywhere in the four principles.

11. **RFC 9315, "Intent-Based Networking - Concepts and Definitions"** — IETF — (Informational) —
    https://www.rfc-editor.org/rfc/rfc9315.txt (also .html) — Evidences: definition of intent;
    intent vs policy vs configuration; §2 definition of Intent Assurance; §5.2 verbatim definition of
    **intent drift**; §5.2.3 requirement that operators be alerted and helped "articulate
    modifications to the original intent to moderate between conflicting concerns"; inner autonomic
    loop / outer human loop.

12. **EU AI Act, Article 14 (Human oversight)** — https://artificialintelligenceact.eu/article/14/ —
    Evidences: the five oversight capabilities (understand capacities/limitations; awareness of
    automation bias; correctly interpret output; decide not to use / disregard / override / reverse;
    intervene or stop); four-eyes rule for Annex III 1(a) biometric ID; application dates 2 Dec 2027
    (Annex III) and 2 Aug 2028 (Annex I).

13. **Google SRE Book — "Monitoring Distributed Systems"** —
    https://sre.google/sre-book/monitoring-distributed-systems/ — Evidences: four golden signals
    (latency, traffic, errors, saturation); **"We avoid 'magic' systems that try to learn thresholds or
    automatically detect causality"**; "only limited success with complex dependency hierarchies";
    monitoring can itself become fragile and a maintenance burden; black-box monitoring is poor for
    imminent-but-not-yet-occurring problems.

14. **Google SRE Workbook — "Implementing SLOs"** — https://sre.google/workbook/implementing-slos/ —
    Evidences: an SLO means "almost all users should be happy... (assuming they are otherwise happy
    with the utility of the service)"; "an error budget is an approximation of user satisfaction" that
    treats a four-hour outage, four one-hour outages and a constant 0.5% error rate the same; warning
    that dependency calculations are "deceptive" unless every failure pattern is enumerated; users
    "might be unhappy, but simply lacking an alternative".

15. **CNCF TAG Observability — Observability Whitepaper** —
    https://github.com/cncf/tag-observability/blob/main/whitepaper.md — Evidences: five signals
    (metrics, logs, traces, profiles, dumps); "Each type of signal is highly specialized for its
    purpose"; cardinality as "the Achilles heel of metrics"; "every piece of observability data has
    its cost"; SLI/SLO/error-budget definitions as the business-alignment mechanism.

16. **Principles of Chaos Engineering** — https://principlesofchaos.org/ — Evidences: definition
    ("the discipline of experimenting on a system in order to build confidence in the system's
    capability to withstand turbulent conditions in production"); the five advanced principles;
    "systems behave differently depending on environment and traffic patterns"; steady-state
    hypothesis focuses on "the measurable output of a system, rather than internal attributes".

17. **SpecOps 2026 — 1st International Workshop on Specification-Driven Development Life Cycle** —
    https://conf.researchr.org/home/splash-2026/specops-2026 and
    https://conf.researchr.org/track/specops-2026/specops-2026-papers — Evidences: date 6 Oct 2026,
    Oakland Marriott City Centre, collocated with ISSTA; scope is intent formalization, AI-driven
    specification, requirements-coverage testing; **no mention of runtime, observability, telemetry,
    monitoring or production feedback on either page** (checked twice, two different pages).

18. **DORA — "DORA metrics: the four keys"** — https://dora.dev/guides/dora-metrics-four-keys/ —
    Evidences: five metrics now listed (change lead time, deployment frequency, failed deployment
    recovery time, change fail rate, deployment rework rate); framed as "leading indicators for
    organizational performance and employee well-being" and "lagging indicators for software
    development and delivery practices". Performance-band thresholds were NOT on this page —
    UNVERIFIED for the elite/high/medium/low numbers.

---

## Peer-reviewed papers and preprints

19. **"Acto: Automatic End-to-End Testing for Operation Correctness of Cloud System Management"** —
    Gu, Sun, Zhang, Jiang, Wang, Vaziri, Legunsen, Xu — SOSP '23 (23–26 Oct 2023) —
    https://doi.org/10.1145/3600006.3613161 ; full text read at https://tianyin.github.io/pub/acto.pdf
    — Evidences: 56 new bugs in eleven Kubernetes operators, 42 confirmed, 30 fixed, none rejected;
    6 further bugs in Kubernetes and the Go runtime; blackbox mode reports no false alarms, whitebox
    0.19%; Figure 2 TiDB liveness bug (infinite waiting loop, unrecoverable by rollback);
    "Convergence time ranges from one second to 10 minutes, so setting a fixed timer would be
    unreliable"; "Finding 4. The few assertions on system behavior are basic and mostly check service
    availability"; level-triggering principle; "operator correctness is hard to achieve".

20. **Sieve — "Automatic Reliability Testing for Cluster Management Controllers"** — Sun et al. —
    OSDI 2022 — repo https://github.com/sieve-project/sieve — Evidences: "Sieve has found 46 bugs in
    10 different controllers"; the three fault patterns (intermediate-state, unobserved-state,
    stale-state). The USENIX paper page returned HTTP 403; the bug count and patterns come from the
    project README — the OSDI paper itself is **UNVERIFIED**.

21. **"Online Controlled Experiments at Large Scale"** — Kohavi, Deng, Frasca, Walker, Xu, Pohlmann —
    Microsoft — KDD 2013 — https://exp-platform.com/Documents/2013%20controlledExperimentsAtScale.pdf
    (PDF downloaded and text-extracted) — Evidences: Tenet 3 verbatim — "Only one third of the ideas
    tested at Microsoft improved the metric(s) they were designed to improve"; Google ~10% of
    experiments leading to business changes (via Manzi); Kaushik 80%; Netflix 90% wrong (via Moran);
    Quicken Loans 33%; Etsy "nearly everything fails"; "'Profit' is not a good OEC"; "The hard part is
    finding metrics that are measurable in the short-term that are predictive of long-term goals".

22. **"A Dirty Dozen: Twelve Common Metric Interpretation Pitfalls in Online Controlled Experiments"**
    — Dmitriev, Gupta, Kim, Vaz — Microsoft — KDD '17 (13–17 Aug 2017) —
    https://doi.org/10.1145/3097983.3098024 ; PDF
    https://exp-platform.com/Documents/2017-08%20KDDMetricInterpretationPitfalls.pdf (downloaded and
    text-extracted) — Evidences: §5.12 MSN.com Outlook-button case (+4.7% navigation clicks, +28%
    button clicks, +27% adjacent-button clicks; no stat-sig retention/satisfaction change; daily decay;
    experiment shut down mid-way); Twyman's Law formulation; §5.7 Bing ad-auction case (+2.3% revenue,
    −0.6% ads/page overall, but +0.3% on original pages, so the goal was not met); "it's pretty much
    impossible to reliably detect such effects via a manual analysis"; automatic heterogeneous-effect
    warnings; Simpson's paradox and SRM segment invalidation.

23. **"Focusing on the Long-term: It's Good for Users and Business"** — Hohnhold, O'Brien, Tang —
    Google — KDD 2015 — https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/43887.pdf
    (downloaded and text-extracted) — Evidences: cohort methodology for user-learning effects; ads
    blindness/sightedness; "a 50% reduction of the ad load on Google's mobile search interface";
    "Reducing the mobile ad load strongly improved the user experience but was a substantially
    short-term revenue negative change; with our work, the long-term revenue impact was shown to be
    neutral"; "optimizing for short-term revenue may be detrimental in the long-term if users learn to
    ignore the ads, or, even worse, stop using Google"; Google running 1000+ concurrent experiments a
    day.

24. **"A Generic and Efficient Python Runtime Verification System and its Large-scale Evaluation"
    (PyMOP)** — Shen, Yaseen, Silva, Guan, Lee, d'Amorim, Legunsen — arXiv:2509.06324 — 2025-09-08 —
    https://arxiv.org/html/2509.06324v1 — Evidences: 1,463 projects, 290,133 unit tests, 73 API specs,
    18,254,008 events, 5,686,846 monitor instances; mean overheads 12.33x / 17.15x / 33.96x with
    maxima 848.76x / 879.01x / 5,500.27x; 93 unique bugs reported, 44 confirmed or fixed, 4 in Python
    itself; 42.9% false-positive rate vs ~90% for Java RV; evaluated during testing only.

25. **"Diagnosing Violations of State-based Specifications in iCFTL"** — Stratan, Mandrioli, Bianculli
    — arXiv:2509.17776 — 2025-09-22 — Evidences: 112 specifications across 10 projects; 90% precision
    on 100 of 112; ≥90% reduction in lines to inspect; diagnosis within 7 minutes and ≤25 MB;
    instrumentation overhead <30% time, <20% memory.

26. **"A Unified Framework for Runtime Verification and Model-Based Diagnosis in LOLA"** — Hipler,
    Leucker, Rodler — arXiv:2606.23720 — 2026-06-18 — https://arxiv.org/html/2606.23720v1 —
    Evidences: health states as Boolean internal streams; k-instant vs k-temporal diagnosis; runtimes
    246 ms–1,106 ms per instant, up to 136 s for k-temporal; NP-hard; requires synchronous
    discrete-time systems; failures "must first be detected... and then localized".

27. **"Protocol-Driven Development: Governing Generated Software Through Invariants and Continuous
    Evidence"** — Jun He, Deying Yu — arXiv:2605.12981v3 — submitted 2026-05-13, v3 2026-05-19 —
    https://arxiv.org/html/2605.12981v3 — Evidences: protocol triplet P=(S,B,O) and compliance
    definition; Evidence Chain and `Validate(I,P) ∈ E ∪ {⊥}`; Dynamic Evidence Ledger
    `L_t = L_{t-1} || E_t`; remediation path `E_t^fail → C_t → I' → Validate(I',P) → L_{t+1}`;
    Definition 13 Monitorable Runtime Projection `Ω_P^r ⊆ Ω_P`; the six-question evaluation agenda
    (nothing empirically validated); conditional Theorem 1; semi-manual NL-to-protocol translation.

28. **"Who judges the judges? Governance from metrics: a runtime framework for continuous LLM
    compliance monitoring" (govllm)** — arXiv:2605.24737 — 2026-05-23 —
    https://arxiv.org/html/2605.24737v1 — Evidences: "compliance fiction" — "the illusion that systems
    evaluated at time t₀ remain compliant indefinitely"; governance profiles with weighted criteria and
    LLM judge panels; 49-case annotated ground-truth corpus over five regulatory criteria; judge
    agreement 51.5–69.1% (phi4-mini 3.8B, mistral 7B, gemma3 4B, qwen3 1.7B); position bias degrading
    agreement by up to 25 percentage points; specialised panel +3.5 pp over best single judge; "Human
    arbitration remains necessary".

29. **"VIGIL: Runtime Enforcement of Behavioral Specifications in AI Agent Skills"** —
    arXiv:2606.26524 — 2026-06-25 — Evidences: contextual-granularity challenge for monitors; policy
    language over agent-tool events with temporal dependencies, argument constraints, value-flow
    conditions; compilation to SMT over finite traces; ">95% recall and a false-positive rate below
    10%" on real LLM-agent runs across office-document, operational and engineering tasks.

30. **"Willful Disobedience: Automatically Detecting Failures in Agentic Traces" (AgentPex)** —
    Reshabh K Sharma, Shraddha Barke, Benjamin Zorn — arXiv:2603.23806v2 — submitted 2026-03-25,
    revised 2026-05-08 — https://arxiv.org/html/2603.23806v2 (full text read) — Evidences: extracts
    behavioural specifications from agent instructions and checks traces; detects "incorrect workflow
    routing, unsafe tool usage, or violations of prompt-specified rules"; 424 clean τ²-bench traces
    (140 Claude, 144 GPT-4.1, 140 o4-mini) across airline, retail and telecom; **"Among 58 Claude 3.5
    Sonnet traces with perfect τ2-bench reward, 48 (83%) contain at least one procedural violation"**;
    as a binary classifier of τ²-bench failure "output_spec achieves ROC-AUC 0.680" and "flags 48% of
    τ2-bench-failed traces"; compliance by spec type — output 63.6–66.9, transition 59.2–80.6,
    predicted-plan 77.0–81.0, argument groundedness 98.1–99.1; cost ~9 LLM API calls per trace,
    ~77,621 tokens, 139 s wall clock, ~$0.019 per trace; positioned as "a meaningful complementary
    signal", not a replacement for ground truth.

31. **"ARBITER: Guarded Agentic Control for SLO-Oriented Kubernetes Remediation"** — Pooyan Habibi,
    Alberto Leon-Garcia — arXiv:2607.19182 — submitted 2026-07-21, revised 2026-07-27 — Evidences:
    OpenTelemetry-native causal resource graph; bounded DiagnosisContext; finite typed-action
    interface separating planning from execution; schema checks, policy gates, resource/disruption
    budgets, approval, bounded execution; ARBITER chose rollback in all ten deployment-regression runs
    where HPA failed; targeted the bottleneck service in every critical-path replicate where HPA never
    did.

32. **"Intent Engine: Natural-Language Intent Translation for Intent-Driven Orchestration in the
    Compute Continuum"** — Koushikur Islam, Rodrigo N. Calheiros — arXiv:2608.20388 — 2026-06-30 —
    Evidences: schema-constrained extraction → retrieval-grounded value construction from monitored
    infrastructure state → validation against supported constraints; F1 0.941 with GPT-4.1 mini
    (also tested Claude Sonnet 4.5, DeepSeek V4-Flash); 85.1% reduction in aggregate hallucination;
    downstream placement failure 30.8% → 2.1%.

33. **"An Empirical Study of Observability Limits in Advanced Software Supply Chain Attacks"
    (SynthChain)** — arXiv:2603.16694 — March 2026 — https://arxiv.org/html/2603.16694v1 — Evidences:
    best single telemetry source 0.391 weighted tag/step coverage and 0.403 mean chain reconstruction;
    two-source fusion 0.636 / 0.639; sources compared (host/process lineage, audit logs,
    Zeek/Suricata, eBPF container instrumentation, cloud monitor streams); reconstruction depends on
    "joinable identifiers across sources".

34. **"Requirements After the First Edit: Mining Late Requirement Emergence and Rework in Real-World
    Coding-Agent Sessions"** — arXiv:2609.03028 — 2026-09-02 — Evidences: 3,553 eligible SWE-chat
    sessions; "stakeholders cannot express a constraint until part of the system exists to react to";
    requirement arrivals followed by "roughly twice as much invalidation as matched non-requirement
    edits"; no detectable decline over a session; delayed disclosure relocates implementation, advance
    warning has no detected effect; explicitly "not demonstrated as causal".

35. **"A Multi-Dataset Benchmark for Evaluating LLM Agents in Microservice Failure Diagnosis"
    (AgenticOpsEval)** — arXiv:2606.29193 — 2026-06-28 — Evidences: AIOps2025 and RCA100 datasets;
    500+ expert-labelled failure cases across HipsterShop and the OpenTelemetry Demo Store; evaluation
    along Localization / Identification / Reason; competition-validated with 6,000+ teams; criticism
    that existing benchmarks are "largely outcome-oriented: they score only the final answer".

36. **"Lessons from Formally Verified Deployed Software Systems"** — Li Huang, Sophie Ebersold,
    Alexander Kogtenkov, Bertrand Meyer, Yinling Liu — ACM Computing Surveys, 2026-01-16 —
    https://doi.org/10.1145/3785652 ; extended version arXiv:2301.02206 (submitted 2023-01-05, last
    revised 2026-01-19) — https://arxiv.org/html/2301.02206 — Evidences: §4.4 "Any verification
    success is relative: we verify a certain program element against a certain specification under
    certain hypotheses"; "The specification may be wrong (in the sense of not correctly expressing the
    desired behavior) or incomplete"; "To guarantee that a system is 'bug-free' one would have to prove
    that the specifications are correct and complete, the models are consistent with the code...";
    verification is iterative; few compilers are certified.

37. **"Control-Theoretical Software Adaptation: A Systematic Literature Review"** — Shevtsov, Weyns
    et al. — IEEE Transactions on Software Engineering, online 2017-05-16 —
    https://doi.org/10.1109/tse.2017.2704579 — Evidences (from abstract): "Most of the times, however,
    the adaptation targeted the resources that the software has available for execution (CPU, storage,
    etc.) more than the software application itself." Full text not fetched — the body of the SLR is
    **UNVERIFIED**; only the abstract was read (via OpenAlex).

38. **"Towards Bridging the Gap between Control and Self-Adaptive System Properties"** — Cámara,
    Papadopoulos, Vogel, Weyns, Garlan, Huang, Tei — arXiv:2004.11846 — 2020-04-24 —
    https://arxiv.org/abs/2004.11846 — Evidences: control properties (stability, settling time) vs
    self-adaptive properties (performance, reliability, cost); "it is not easy to reconcile these two
    types of properties or identify under which conditions they constitute a good fit to provide
    run-time guarantees".

39. **"Watchdogs and Oracles: Runtime Verification Meets Large Language Models for Autonomous
    Systems"** — Angelo Ferrando — FMAS 2025, EPTCS 436, pp. 80–87 — arXiv:2511.14435 — 2025-11-18 —
    Evidences: RV as guardrail for LLM autonomy and LLMs as assistants for specification capture; LLMs
    "hallucinate, misinterpret context, and provide no formal guarantees"; formal methods "typically
    assume complete and accurate models"; five challenges (trust, efficiency, human-AI collaboration,
    robustness, ethics/accountability); "monitor synthesis and enforcement must remain formal".

40. **"The Productivity-Reliability Paradox: Specification-Driven Governance for AI-Augmented
    Software Development"** — Sabry E. Farrag — arXiv:2605.01160 — submitted 2026-05-01 —
    https://arxiv.org/abs/2605.01160 — Evidences (abstract verbatim): "controlled studies report
    20-56% productivity gains on well-scoped tasks, while the most rigorous RCT documents a 19%
    slowdown for experienced developers, and telemetry across 10,000+ developers shows 98% more pull
    requests but 91% longer review times with flat delivery metrics." (Verifies a figure supplied in
    the mission brief.)

41. **"Specification-first convergence with an AI coding agent: a case study of dismantling a core
    architectural invariant across 189 files in a 717k-line codebase with no test oracle and no human
    code review"** — Joel Abenhaim — arXiv:2608.12440 — submitted 2026-08-12, v2 2026-08-15 —
    Evidences: 717,725-line TypeScript codebase; 31 audit cycles (14 specification-refinement,
    17 verification); 201 defects corrected before any human ran the program; 189 files,
    34,770 insertions, 16,422 deletions, three days, $2,430; no human code review or testing before
    deployment. Single-author, n=1, self-reported — treat as an anecdote, not evidence of a rate.

42. **"Judging Is Not Enumerating"** — arXiv:2608.01000 — Aug 2026 — cited from the mission brief for
    the judge/enumerate asymmetry (F1 0.60–0.77 vs 0.26–0.48). **UNVERIFIED in this lane** — not
    independently fetched here; verified by another lane.

43. **"Underspecification does not imply Incoherence" (semantic collapse)** — Richter & Papadakis —
    arXiv:2607.01953 — Jul 2026 — cited from the mission brief (3–32% of tasks; invisible to
    disagreement-based detectors). **UNVERIFIED in this lane** — used only as a caution against reading
    judge agreement as correctness.

44. Other arXiv items surfaced in sweeps and used only as landscape evidence (titles/abstracts read
    via arXiv search UI or API, not full text): 2608.20783 *Runtime Verification under Split Past and
    Future*; 2608.19861 *PolicyGuide*; 2608.13211 *Stream-based Online and Offline Monitoring under
    Measurement Noise (RLola)*; 2608.06090 *Two Ways to See the Future (RTLola)*; 2606.12022 *Runtime
    Enforcement of Hybrid System Properties*; 2605.12651 *Runtime Monitoring of Perception-Based
    Autonomous Systems*; 2603.17909 *ACTORCHESTRA / WALTZ* (ICST 2026); 2601.22997 *TriCEGAR*;
    2507.04830 *A Note on Runtime Verification of Concurrent Systems*; 2506.14426 *Varanus: Runtime
    Verification for CSP* (TAROS 2025); 2508.11824 *Rethinking Autonomy / SAFE-AI*; 2608.18390
    *SLO-Scaler* (29–56% fewer violations, 18–33% fewer replicas); 2512.23415 *SLO Driven and
    Cost-Aware Autoscaling for Kubernetes* (up to 31% shorter violation duration); 2510.09851
    *QONNECT*; 2602.05292 *ORACL*; 2507.17128 *Auto-scaling Approaches for Microservice Applications:
    A Survey*; 2606.17001 *Sandbox-Enabled Digital Twin for CPS*; 2401.07985 *From Digital Twins to
    Digital Twin Prototypes*; 2307.08421 *Systematic Comparison of Software Agents and Digital Twins*;
    2512.04117 *Reusing Model Validation Methods for the Continuous Validation of Digital Twins of
    CPS*; 2605.23058 *A measurement substrate for agentic Kubernetes operations*; 2604.03512
    *ActionNex: A Virtual Outage Manager for Cloud Computing*.

---

## Industry reports and surveys

45. **Grafana Labs Observability Survey 2026 (4th annual)** — https://grafana.com/observability-survey/
    — 1,363 responses, collected 1 Oct 2025 – 10 Jan 2026 — Evidences: 38% name complexity/overhead as
    the biggest concern; 65% prioritise cost when selecting tools; 77% report saving time or money
    through centralisation; 49% use SaaS (up 14pp YoY); 65% invest in both Prometheus and OpenTelemetry;
    57% use OTel for metrics, 50% traces, 48% logs; 47% increased OTel investment YoY; 30% struggle
    with alert fatigue (top obstacle to faster incident response); 92% see value in AI for anomaly
    detection but 95% want AI to "show its work".

46. **DORA 2025 — State of AI-assisted Software Development Report** —
    https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report and
    https://dora.dev/research/2025/dora-report/ — Evidences: nearly 5,000 technology professionals plus
    100+ hours of qualitative data; 90% report using AI at work; >80% believe it increased their
    productivity; 30% report little or no trust in AI-generated code; AI adoption positively related
    to software delivery throughput and product performance, negatively related to delivery stability;
    90% of organisations have adopted at least one platform; "AI doesn't fix a team; it amplifies
    what's already there." The full PDF was not retrievable (several candidate URLs 404) — the
    detailed report body is **UNVERIFIED**; figures above come from the announcement blog and the
    landing page.

---

## Sources sought and NOT FOUND / unusable

47. **"150 Successful Machine Learning Models: 6 Lessons Learned at Booking.com"** — Bernardi,
    Mavridis, Estévez — KDD 2019 — https://doi.org/10.1145/3292500.3330744 — **UNVERIFIED**: OpenAlex
    reports `oa_status: closed`, no OA location; ResearchGate returned HTTP 403. Only the abstract was
    read (via OpenAlex), which confirms ~150 customer-facing ML applications validated through RCTs but
    does not itself state the "model performance is not business performance" lesson. **Not used as
    evidence in the lane report.**

48. **Sieve OSDI'22 paper page and PDF** — https://www.usenix.org/conference/osdi22/presentation/sun
    and https://www.usenix.org/system/files/osdi22-sun.pdf — both HTTP 403 — **UNVERIFIED**; bug
    counts ("46 bugs in 10 different controllers") and the three fault patterns taken from the project
    README instead.

49. **AIOps/root-cause empirical literature via OpenAlex** — searched; the recall was dominated by
    predatory-journal and self-published Zenodo material (e.g. "DSFB-Debug Structural Detector-Field
    Residual Semiotics Engine", "TA-14 The Admissibility-Before-Execution Architecture", "HEXAGONAL
    LEXICAL ENGINE"). **Deliberately excluded**; no AIOps effectiveness claim is made in the lane
    report on the basis of these.

50. **Digital twins of software systems** — searched OpenAlex ("digital twin AND software system"
    2024+, 2,841 works; "digital twin AND microservice" 2023+, 253 works) and arXiv; **NOT FOUND** as a
    software-systems practice. Recorded as a null result in §5 of the lane report.

51. **Telemetry → requirements/specification feedback** — searched arXiv (`telemetry AND requirements`
    2025+; `production AND feedback AND specification` cs.SE 2025+; `requirements engineering AND
    monitoring AND runtime` cs.SE 2025+ returned 2 results, neither on topic; `runtime evidence AND
    requirements` 2025+) and the SpecOps 2026 pages. **NOT FOUND.** Recorded as the lane's central
    null result.

52. **Measured harm or benefit from telemetry-driven *specification* change** (as opposed to
    telemetry-driven feature decisions) — **NOT FOUND.** Recorded as open question 8.

53. **Evidence half-life / decay function for runtime evidence about a requirement** — **NOT FOUND.**

54. **A deployed reconciliation system reporting a proof of convergence rather than a heuristic
    timeout** — **NOT FOUND.**

---

## Databases and tooling used

- arXiv API (`export.arxiv.org/api/query`) — heavily rate-limited (HTTP 429) for much of the session;
  used with backoff.
- arXiv search UI (`arxiv.org/search/`) — used via WebFetch as the primary relevance-ranked interface.
- OpenAlex API (`api.openalex.org/works`) — used for title/abstract search, OA-location lookup and
  abstract reconstruction. Quality caveat: heavy contamination from Zenodo self-publications in
  observability/AIOps queries.
- Crossref API (`api.crossref.org/works`) — used to confirm DOIs.
- Semantic Scholar API — rate-limited (HTTP 429), unusable.
- DBLP — bot challenge, unusable.
- DuckDuckGo (html and lite endpoints) — CAPTCHA, unusable. WebSearch budget for the session was
  already exhausted before this lane started.
- `pdftotext -layout` for the three PDFs (Kohavi 2013, Dmitriev 2017, Hohnhold 2015, Acto SOSP'23).

**Source count (distinct, used in the report): 46.** **Marked UNVERIFIED: 7** (item 18 partial — DORA
band thresholds; item 20 — Sieve OSDI paper body, README used instead; item 37 partial — TSE SLR body,
abstract only; item 42 — arXiv:2608.01000, verified by another lane; item 43 — arXiv:2607.01953,
verified by another lane; item 46 partial — DORA 2025 report body; item 47 — Booking.com KDD 2019,
paywalled and therefore **not used as evidence**). **Distinct queries run: ~43.**
