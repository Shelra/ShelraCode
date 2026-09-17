# Sources — Lane 11 (memory taxonomy)

All accessed 2026-09-14 unless noted. Primary sources fetched directly (arXiv HTML/abs, official docs)
are marked **[fetched]**; sources known only through a WebSearch synthesized summary (not independently
opened) are marked **[search-summary only]** and were used at correspondingly lower confidence, or
dropped where a direct fetch contradicted the summary (see RAGShield below).

## Grounded systems — primary papers

- **MemGPT: Towards LLMs as Operating Systems** — Packer, Wooders, Lin, Fang, Patil, Stoica, Gonzalez
  (UC Berkeley) — arXiv:2310.08560, v1 2023-10-12 / v2 2024-02-12 —
  https://arxiv.org/abs/2310.08560 — **[fetched]** — evidences: three-tier memory (main context / recall
  storage / archival storage), self-directed function-calling memory management, virtual-context-paging
  framing.
- **Generative Agents: Interactive Simulacra of Human Behavior** — Park, O'Brien, Cai, Morris, Liang,
  Bernstein (Stanford/Google/DeepMind) — arXiv:2304.03442, v1 2023-04-07 / rev 2023-08-06 —
  https://arxiv.org/abs/2304.03442 — **[fetched]** — evidences: memory stream (observation/reflection/plan
  objects), recency+importance+relevance retrieval, LLM-scored importance (1–10), ablation showing all
  three components (observation, planning, reflection) are load-bearing for believability.
- **A-MEM: Agentic Memory for LLM Agents** — Xu, Liang, Mei, Gao, Tan, Zhang — arXiv:2502.12110, v1
  2025-02-17 / v11 2025-10-08, NeurIPS 2025 — https://arxiv.org/abs/2502.12110 —
  https://arxiv.org/html/2502.12110v1 — **[fetched, partial]** — evidences: Zettelkasten-inspired atomic
  notes (content, keywords, tags, context, links), "memory evolution" (new notes retroactively update
  existing notes' representations), dynamic linking without a fixed schema.
- **Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory** — Chhikara, Khant, Aryan,
  Singh, Yadav — arXiv:2504.19413, 2025-04-28, ECAI 2025 — https://arxiv.org/abs/2504.19413 —
  **[fetched, partial — abstract only, no confirmed ADD/UPDATE/DELETE mechanism in the fetched content]**
  — evidences: LoCoMo benchmark numbers (26% relative LLM-judge improvement over OpenAI Memory, 91% lower
  p95 latency, >90% token savings vs full-context; graph variant +2% over base).
- **Mem0 memory-operations docs** — mem0.ai — https://docs.mem0.ai/core-concepts/memory-operations —
  **[fetched]** — evidences: Mem0's documented default behavior is **additive** ("new memories are added
  without overwriting or deleting existing memories"), with an explicit warning that mixing `infer=True`
  and `infer=False` modes for the same fact "can save it twice." No documented contradiction-resolution
  logic found on this page — a discrepancy against the more sophisticated
  extract-consolidate-retrieve framing in the paper's abstract.
- **Zep: A Temporal Knowledge Graph Architecture for Agent Memory** — Rasmussen, Paliychuk, Beauvais,
  Ryan, Chalef (Zep AI) — arXiv:2501.13956, 2025-01-20 — https://arxiv.org/html/2501.13956 —
  **[fetched, full]** — evidences: three-tier graph (episode / semantic entity / community subgraphs),
  explicit four-timestamp bi-temporal model (t_valid, t_invalid, t'_created, t'_expired), LLM-based
  contradiction detection with "new information wins" invalidation policy, DMR 94.8% vs MemGPT 93.4%,
  LongMemEval +18.5pp accuracy / ~90% latency reduction vs full-context.
- **Letta — Agent Memory: How to Build Agents That Learn and Remember** — Letta (successor project to
  MemGPT) — 2025-07-07 — https://www.letta.com/blog/agent-memory/ — **[fetched]** — evidences: core
  memory blocks (label/description/value/character-limit schema, editable by the agent or other agents),
  recall memory (full searchable history, disk-persisted), archival memory (vector or graph-backed),
  sleep-time compute (async "sleeper" agent reorganizes memory off the response-latency critical path).
  No independent evaluation of Letta's own implementation found on this page.
- **PROJECTMEM: A Local-First, Event-Sourced Memory and Judgment Layer for AI Coding Agents** — Malo, Qiu
  (University of Utah) — arXiv:2606.12329, 2026-06 — https://arxiv.org/html/2606.12329v1 —
  **[fetched, full]** — the single most directly on-point grounded system found: five typed event
  categories (Issue, Attempt, Fix, Decision, Note) in an append-only JSONL log, deterministic idempotent
  projection into summary.md, a pre-action deterministic "precheck" gate that warns before an agent
  repeats a previously-failed action, explicit rejection of vector/embedding memory in favor of
  determinism and zero read-time model cost, self-study over 207 events / 10 projects / 2 months (no
  controlled benchmark; authors explicitly flag this as the paper's main open gap).
- **Governed Shared Memory for Multi-Agent LLM Systems** — Margalit, Cohen-Inger, Avram, Taig, Margalit
  (Caura.ai; Ben-Gurion University of the Negev) — arXiv:2606.24535, 2026-06-23 —
  https://arxiv.org/html/2606.24535v1 — **[fetched, full]** — evidences: four fleet-memory failure modes
  (unauthorized leakage, stale propagation, contradiction persistence, provenance collapse), four
  architecture primitives (scoped retrieval with a four-level scope hierarchy, temporal supersession,
  provenance tracking, policy-governed propagation), evaluation (100% provenance-chain reconstruction on
  50 four-hop chains, 97.5% fleet-sibling visibility, zero cross-fleet leaks in 0/80 trials, but only 49%
  overall contradiction-detection rate — 100% when both conflicting writes were actually admitted,
  meaning the bottleneck is upstream admission ordering, not the detector).

## Surveys (2026)

- **Rethinking Memory Mechanisms of Foundation Agents in the Second Half: A Survey** — Huang, Zhang,
  Liang et al. (58+ authors) — arXiv:2602.06052, 2026-01-14 —
  https://arxiv.org/html/2602.06052v3 — **[fetched, full]** — the field's current reference taxonomy: three
  orthogonal axes (substrate: internal vs external; cognitive mechanism: sensory/working/episodic/
  semantic/procedural; subject: agent- vs user-centric). Explicitly states procedural memory "remains less
  standardized than fact-centric settings" and sensory memory is "rarely labeled" in LLM-agent work.
  Names open problems: episode-boundary definition, retention-at-scale, multi-agent consistency, privacy
  (targeted extraction attacks), cross-session retention.
- **Anatomy of Agentic Memory: Taxonomy and Empirical Analysis of Evaluation and System Limitations** —
  arXiv:2602.19320, 2026 — https://arxiv.org/html/2602.19320v2 (PDF also fetched) — **[fetched, partial]**
  — a structural (not cognitive) taxonomy: lightweight semantic / entity-centric+personalized /
  episodic+reflective / structured+hierarchical. Empirical critique: proposes a "Context Saturation Gap"
  diagnostic because modern 128k–1M context windows make many memory benchmarks fit in a single prompt
  un-augmented; documents "Silent Failure" (format corruption during structured memory writes on smaller
  open-weight backbones, e.g. Qwen-2.5-3B); reports graph-based systems (e.g. MemoryOS) with 32+ second
  per-turn latency; argues reported gains are "inconsistent across benchmarks, highly backbone-dependent."
- **Governing Evolving Memory in LLM Agents: Risks, Mechanisms, and the Stability and Safety Governed
  Memory (SSGM) Framework** — arXiv:2603.11768, 2026 — https://arxiv.org/pdf/2603.11768 —
  **[fetched, partial — PDF metadata/structure only, not full body text]** — names three risk categories
  (drift, poisoning, staleness) and proposes a per-item metadata schema: trust/provenance, confidence
  score, expiry/TTL, access control. Evaluated against "MemoryBench 2026" and Mem0/MemGPT baselines per
  the fetched summary; full quantitative results not independently confirmed — treat as UNVERIFIED pending
  a full-text read.
- **Always-On Agents: A Survey of Persistent Memory, State, and Governance in LLM Agents** — Ding,
  Nannapaneni, Liu, Zhang — arXiv:2606.30306, 2026 — https://arxiv.org/pdf/2606.30306 —
  **[fetch failed to return body text; PDF structure only]** — UNVERIFIED for this lane's purposes beyond
  confirming the paper exists and its stated scope (persistent memory, state, governance for long-running
  agents). Flagged for a second-wave full read.

## Multi-agent / failure-memory 2026 cluster (search-summary level — titles and one-line findings only,
not independently opened; recorded because the convergence across independent groups is itself the
evidence, per the mission's "three independent lines that don't cite each other" pattern)

- **Negative Knowledge as Failure-aware Shared Memory for AutoResearch** — arXiv:2606.21024, 2026-06 —
  https://arxiv.org/html/2606.21024v1 — **[search-summary only]** — a curator agent writes each failed
  attempt as a bounded, typed record; a downstream agent must explicitly adopt or reject each record
  before its next attempt.
- **Experience Memory Graph: One-Shot Error Correction for Agents** — arXiv:2607.13884, 2026-07 —
  https://arxiv.org/abs/2607.13884 — **[search-summary only]** — reframes failure recovery as graph
  matching between a failed trajectory and prior successful ones.
- **EvoGraph-Mem: Failure-Aware Editable Graph Memory for Long-Term Language Agents** —
  arXiv:2608.11248, 2026-08 — https://arxiv.org/abs/2608.11248 — **[search-summary only]** — insight nodes
  track positive evidence, negative evidence, and an activation state.
- **DELTAMEM: Incremental Experience Memory for LLM Agents via Residual Trees** — arXiv:2606.03083,
  2026-06 — https://arxiv.org/pdf/2606.03083 — **[search-summary only]** — failure recording captures
  "gaps in existing skills that caused failures."
- **Learning When to Remember: Risk-Sensitive Contextual Bandits for Abstention-Aware Memory Retrieval in
  LLM-Based Coding Agents** — arXiv:2604.27283, 2026-04 — https://arxiv.org/html/2604.27283 —
  **[search-summary only]** — coding-agent-specific; separates reusable root-cause patterns,
  context-specific variants, and validated episodes.

## Memory write-gate / consolidation research

- **ConsistencyGate: Preventing Memory Contamination in LLM Agents via Self-Consistency Admission
  Control** — arXiv:2607.22962, 2026-07 — https://arxiv.org/html/2607.22962 — **[search-summary only]**
  — write-time admission gate scoring candidate facts on factual support rather than utility; framed as a
  Truth Maintenance System doing strict logical contradiction checks before admission.
- **SAGE: A Novelty Gate for Efficient Memory Evolution in Agentic LLMs** — Wang, Brahma, Henao —
  arXiv:2605.30711, submitted 2026-05-29 / rev 2026-06-18 — https://arxiv.org/abs/2605.30711 —
  **[fetched]** — von-Mises-Fisher density estimator over memory embeddings with an adaptive threshold
  routes candidates to add / merge / discard, sending only uncertain cases to an LLM; on GPT-4o-mini,
  3.4x lower API cost and 2.5x lower latency in the add phase; as a gate in front of another system,
  skipped 16–18% of LLM calls across five models with minimal quality loss on open-weight models.
- **Useful Memories Become Faulty When Continuously Updated by LLMs** — arXiv:2605.12978, 2026-06 —
  https://arxiv.org/pdf/2605.12978 — **[search-summary only, title + framing only]** — names a specific
  failure mode: repeated LLM-driven memory updates degrade previously-correct memories over time.
- **The Consolidation Problem in Agent Memory** — Hindsight (vectorize.io), blog, 2026-05-21 —
  https://hindsight.vectorize.io/blog/2026/05/21/agent-memory-consolidation — **[fetched via WebSearch
  summary, practitioner blog — not peer-reviewed, treat as industry practice signal not research
  evidence]** — names the "write decision" as more consequential than retrieval; describes a four-lever
  framework (importance, merge, decay, eviction), dual-buffer consolidation (hot probation buffer →
  long-term store after re-verification/dedup/importance checks), and three named contradiction policies
  (recency wins / source wins / confidence wins).

## Provenance / trust and memory-poisoning-adjacent (light touch only, per scope — deep analysis is
lane 14's)

- **Governing Evolving Memory...(SSGM)** — see above — trust/provenance/confidence/expiry per-item schema.
- **Governed Shared Memory for Multi-Agent LLM Systems** — see above — provenance = writer identity +
  source system + derivation history + modification lineage; scoped/policy-governed propagation.
- **When Does Belief-Based Agent Memory Help? Reliability-Conditional Updating and Provenance-Capped
  Poisoning Defense** — Singh — arXiv:2606.22030, submitted 2026-06-20 / rev 2026-07-16 —
  https://arxiv.org/abs/2606.22030 — **[fetched, abstract-level]** — core mechanism: "trust is bounded by
  source provenance rather than textual confidence" — a memory item's influence is capped by its source's
  reliability regardless of how confident the extracted text sounds; belief-updating beats alternatives
  specifically when observations differ in trustworthiness; flags a 27.5-point gap between strict
  token-F1 and LLM-as-judge evaluation on the same task (a reproducibility warning for the whole field's
  benchmark practice).
- **RAGShield: Provenance-Verified Defense-in-Depth Against Knowledge Base Poisoning in Government
  Retrieval-Augmented Generation Systems** — Patil — arXiv:2604.00387, v1 2026-04-01 / v2 2026-04-04 —
  https://arxiv.org/abs/2604.00387 — **[fetched, abstract-level — corrects an earlier WebSearch summary]**
  — the fetched abstract describes pattern-based numeric-value extraction, entity-linked context
  propagation (99.8% accuracy on 2,742 IRS passages), and cross-source registry verification, with 100%
  detection / 0% attack success rate across 430 real attacks vs 79–90% miss rate for embedding-based
  defenses. **Note:** an earlier WebSearch summary of this paper described "C2PA-inspired cryptographic
  document attestation" and a "taint lattice" — neither term appears in the directly-fetched abstract.
  That claim is dropped from the lane report as unconfirmed; recorded here as a caution about trusting
  WebSearch synthesis over a direct fetch.
- **Securing Retrieval-Augmented Generation: A Taxonomy of Attacks, Defenses, and Future Directions** —
  arXiv:2604.08304, 2026-04 — https://arxiv.org/pdf/2604.08304 — **[search-summary only, not opened]**
  — recorded for the second wave; not relied on for any claim in the lane report.
- **From Agent Traces to Trust: A Survey of Evidence Tracing and Execution Provenance in LLM Agents** —
  arXiv:2606.04990, 2026-06 — https://arxiv.org/pdf/2606.04990 — **[search-summary only]** — frames memory
  as "a provenance-bearing evidence source rather than a passive storage module," with items derived from
  retrieved documents, tool output, environment observations, or prior conversations — directly supports
  a source-class taxonomy for memory provenance.

## Temporal modeling foundations

- **Bitemporal History** — Martin Fowler — https://martinfowler.com/articles/bitemporal-history.html —
  **[fetched]** — canonical statement of the two-timeline model (actual/valid time vs record/transaction
  time), how retroactive corrections vs actual-world changes are distinguished, and explicit caution that
  bitemporal modeling should be avoided unless actions depend on historical states that later get
  retroactively corrected.
  - Date of the article itself not visible on the fetched page; Fowler's bitemporal-history writing on
    this domain dates from the 2010s and remains the standard citation as of 2026 — **UNVERIFIED exact
    publish date**, treat the content as a stable reference rather than a dated claim.
- **Bitemporal database foundations (Snodgrass, Jensen & Snodgrass)** — found only via a WebSearch summary
  of a 2026 Springer Nature literature review ("Comprehensive insights into bitemporal databases: a
  PRISMA-guided systematic literature review," Journal of Data, Information and Management) —
  https://link.springer.com/article/10.1007/s42488-026-00162-x — **[search-summary only, not
  independently fetched]** — used only for the standard terminology (valid time / transaction time, the
  Bitemporal Conceptual Data Model / BCDM, TSQL2, SQL:2011) which is uncontroversial textbook material;
  no claim in the lane report depends on a number from this source.

## ADR / decision-record conventions

- **ADR Templates** — adr.github.io — https://adr.github.io/adr-templates/ — **[fetched]** — comparison of
  Nygard (title/status/context/decision/consequences, no explicit rejected-alternatives or supersession
  field), MADR (decision drivers, considered options, pros/cons, decision-makers/consulted/informed,
  confirmation), Y-statements, and ISO/IEC/IEEE 42010:2011.
- **MADR** — adr.github.io/madr — https://adr.github.io/madr/ — **[fetched]** — current version MADR 4.0.0,
  released 2024-09-17. Confirms the `status` field explicitly supports the literal value
  `superseded by ADR-0123`, plus `date`, `decision-makers`, `consulted`, `informed` metadata and the
  content sections (context and problem statement; decision drivers; considered options; decision
  outcome; consequences; confirmation; pros/cons; more information).

## Cognitive-architecture origins of the episodic/semantic/procedural split (background, secondary)

- Tulving's 1972 episodic/semantic distinction and ACT-R's declarative/procedural split — found via
  WebSearch summaries of secondary/tertiary sources (ScienceDirect, Springer *Memory & Cognition*,
  ResearchGate ACT-R descriptions), not independently fetched in primary form —
  **[search-summary only, textbook-level background]**. Used only to establish that the
  episodic/semantic/procedural vocabulary the 2026 agent-memory literature uses is borrowed from 1970s–80s
  cognitive psychology and cognitive architecture (Tulving 1972; Anderson's ACT-R), not invented for LLM
  agents. No quantitative claim in the lane report rests on these.

## Adjacent production example (light mention only — not competitive mapping, which is lane 05's job)

- **Kiro Steering** — kiro.dev — https://kiro.dev/docs/steering/ — **[search-summary only]** — one
  concrete shipping example of a "project constitution" style memory surface: markdown files in
  `.kiro/steering/`, workspace-scoped and personal-scoped, merged and read at the start of every session.
  Mentioned once, to ground the "project constitution" taxonomy discussion in something that ships, not
  to map its competitive position (that is lane 05's territory, already covered).

## Lanes already written, cited rather than re-derived

- `research/lanes/01-future-se.md` (future-se-historian, 2026-09-08) — cited for the "oracle engineering"
  framing and the finding that models judge (F1 0.74–0.90) far better than they enumerate acceptance sets
  (19–42% admitted), which motivates why "evidence memory" (claim + proof) is a distinct, presently-unmet
  need rather than something semantic memory already covers.
- `research/lanes/04-representations.md` (representations-ir-researcher, 2026-09-08) — cited for the
  intensional/extensional asymmetry (rules beat enumerations, F1 ≈0.99 vs 19–42%), for MDE's documented
  12/12 traceability and diffing friction (Kuhn et al. 2012), and for the source-of-truth conditions
  (cheap regeneration, no hidden state, a cheap continuous oracle) used here to argue why a durable
  "project constitution" memory type is best modeled as semantic memory with elevated trust rather than as
  its own category.
- `research/lanes/05-commodity-map.md` (coding-agent-commodity-analyst, 2026-09-08) — cited for "procedural
  / auto memory" already being COMMODITY across ≥4 shipping products, for the existence of a 4-note-type
  split (user/feedback/project/reference) in at least one shipping system (not re-derived here — that
  system's internals are lane 12's job), and for `/skill-doctor` as the first shipped symptom of a
  procedural-memory lifecycle/provenance problem with no cross-vendor solution.
- `docs/future-research/08_SELECTED_THESIS.md` — the already-selected mission thesis (the durable record of
  machine discretion as executable checks). Cited, not reopened: it is the reason "evidence memory" and
  "decision memory" are treated in this lane as the taxonomically interesting, currently-unimplemented
  categories, since no grounded memory system found here stores a check's *proof* alongside its claim.
