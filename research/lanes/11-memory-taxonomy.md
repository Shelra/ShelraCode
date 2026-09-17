# Lane 11 — Memory taxonomy for long-horizon coding agents

Researcher: memory-taxonomy-researcher. Written 2026-09-14. All sources accessed 2026-09-14 unless noted
in `research/sources/11-memory-taxonomy.md`. This lane does not reopen the mission's selected thesis
(`docs/future-research/08_SELECTED_THESIS.md`); it investigates the separate, additive question of
project-continuity memory for a long-horizon coding agent, per the extension brief.

Method note: the arXiv Atom API returned HTTP 429 on the first call and was not retried; all arXiv
discovery in this lane ran through WebSearch plus direct `arxiv.org/abs` and `arxiv.org/html` fetches,
consistent with lanes 01, 04 and 05's experience this mission. Where a claim rests only on a WebSearch
synthesized summary rather than an opened primary document, it is marked accordingly below and in the
sources file, and confidence is downgraded. One WebSearch summary (for RAGShield, arXiv:2604.00387) was
directly contradicted by the fetched abstract and the disputed detail was dropped — recorded as a
caution about trusting search synthesis over primary fetch.

---

## 1. Summary (10 lines)

1. Five memory types are genuinely evidence-backed by independent systems and survey literature:
   semantic, episodic, procedural, failure, and agent (isolated-vs-shared) memory. Three are named in
   the general LLM-agent literature by a different vocabulary ("working memory" for task state) or not
   named at all as durable objects (task memory, evidence memory). One — project constitution — is a
   real shipping pattern with no distinct academic memory-taxonomy status; it is best modeled as
   semantic memory with maximal trust and a human-authored source class, not a separate category.
2. The field's own 2026 reference taxonomy (58-author survey, arXiv:2602.06052) uses three orthogonal
   axes — substrate, cognitive mechanism, subject — and explicitly ranks procedural memory as "less
   standardized than fact-centric settings" and sensory memory as "rarely labeled." Nobody disputes the
   episodic/semantic/procedural vocabulary itself; it is inherited wholesale from 1970s–80s cognitive
   psychology (Tulving) and cognitive architecture (ACT-R), not invented for LLM agents.
3. The one production system found that was purpose-built for coding agents rather than adapted from
   chatbot personalization (PROJECTMEM, arXiv:2606.12329) independently arrived at a five-type schema
   — Issue, Attempt, Fix, Decision, Note — that maps closely onto this lane's brief (episodic=Issue/
   Attempt, decision=Decision, failure=Attempt-with-outcome, semantic="durable gotcha"=Note) and
   explicitly rejects embeddings in favor of a deterministic, append-only, idempotently-replayable event
   log — the strongest single validation found for an event-sourced design in this domain, though it is
   a single-author, 207-event, 10-project self-study with no controlled benchmark.
4. A full bitemporal model is not speculative design — it is a shipping architecture. Zep
   (arXiv:2501.13956) carries four explicit timestamps per fact (valid-from, valid-until, ingested-at,
   expired-at) and reports DMR 94.8% (vs MemGPT 93.4%) and a LongMemEval accuracy gain of +18.5pp with a
   ~90% latency reduction versus full-context. By contrast, the two most cited chat-personalization
   systems, Letta and Mem0, do **not** expose an equivalent explicit temporal schema in what they
   document: Letta's core-memory blocks are simply overwritten (label/description/value/char-limit, no
   valid-time field), and Mem0's own docs describe the default mode as strictly additive with an
   explicit warning that mixing modes "can save it twice" — a real, verifiable gap between what the
   field's most cited production systems ship and what a project-continuity agent needs.
5. Decision memory (ADR-style: choice, alternatives, rejection reason, supersession) is a 15-year-old,
   now-standardized software-engineering practice (MADR 4.0.0, released 2024-09-17, with a literal
   `status: superseded by ADR-0123` field) that essentially none of the general-purpose agent-memory
   research (MemGPT, Letta, A-MEM, Mem0, Zep) treats as a first-class memory type. The one system that
   does (PROJECTMEM) is the newest and least validated. This is this lane's sharpest finding: the
   agent-memory research community and the decision-record practice community have not merged, despite
   solving adjacent problems.
6. Provenance and trust are treated seriously in 2026, but only in the multi-agent / security-adjacent
   literature, not in the taxonomy literature. Governed Shared Memory (arXiv:2606.24535) formalizes four
   failure modes (unauthorized leakage, stale propagation, contradiction persistence, provenance
   collapse) and reports near-perfect provenance-chain reconstruction (100% on 50 four-hop chains) but
   only 49% overall contradiction-detection — and traces that gap to an admission-pipeline ordering bug,
   not a detector weakness, which is itself a useful design lesson: sequencing the write gate wrong
   silently disables the contradiction check downstream of it.
7. The strongest, most-replicated 2026 finding across independent groups (three or more papers, none
   citing the others) is that the write decision — not retrieval — is where memory systems actually
   fail: over-writing degrades recall (arXiv:2605.12978), under-gating admits contamination
   (arXiv:2607.22962), and naive admission wastes cost that a cheap novelty gate recovers 2.5–3.4x
   (arXiv:2605.30711, directly fetched and verified).
8. Task memory (objective / plan / blockers / next step, surviving across sessions as a discrete,
   explicitly-updated object) is the clearest gap this lane found: no grounded system — not MemGPT,
   Letta, Mem0, Zep, A-MEM, nor PROJECTMEM — implements it as a first-class type distinct from raw
   episodic log and ephemeral working-memory context. What the field calls "working memory" is
   explicitly scoped to within-session context-window management and is expected to be discarded, not
   to persist as project state across months.
9. Evidence memory (a claim paired with its proof — a test result, a verification artifact) was not
   found implemented anywhere in this lane's search, general-purpose or coding-specific. This directly
   corroborates lane 01's and lane 04's independent finding (this lane did not re-derive it, only
   confirmed the memory-system literature has no answer for it) that models judge far better than they
   enumerate, and that no shipped memory system currently stores the judgment's evidentiary basis
   alongside the judgment itself.
10. Confidence calibration across this lane is genuinely mixed: the primary-fetched core (MemGPT,
    Generative Agents, Mem0 abstract, Zep full text, PROJECTMEM full text, Governed Shared Memory full
    text, MADR spec, Fowler's bitemporal article, SAGE) supports high-confidence claims. A meaningful
    minority of claims — the 2026 failure-memory cluster, SSGM's exact schema, RAGShield before
    correction — rest on WebSearch summaries only and are labeled accordingly; do not treat every claim
    in this report as equally load-bearing.

---

## 2. Memory type taxonomy

Evaluated against the ten candidate categories in this lane's brief. For each: is it validated as a
distinct, useful category by research or a shipping system, or is it redundant with / better modeled as
another category?

### 2.1 Semantic memory — VALIDATED, foundational

```
CLAIM: Semantic memory (durable, decontextualized facts) is a validated, independently-converged-upon
category across both cognitive-architecture lineage and every 2026 grounded system this lane examined.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: The 58-author 2026 survey (arXiv:2602.06052) defines it as "storage of abstract facts, general
concepts, and structured knowledge" providing "decontextualized information that remains stable over
time," distinct from episodic memory by design. Zep implements it directly as the semantic entity
subgraph (extracted, resolved entities plus relationship edges) with explicit bi-temporal validity per
edge. Mem0's stated purpose is exactly this: "dynamically extracts, consolidates, and retrieves salient
information." A-MEM's atomic notes (content, keywords, tags, context) are semantic-memory objects
structured as a Zettelkasten. The category traces to Tulving's 1972 episodic/semantic distinction
(cognitive-psychology background, search-summary level only — see sources file).
SOURCE: arXiv:2602.06052 (fetched); arXiv:2501.13956 (fetched); arXiv:2504.19413 (fetched, abstract);
arXiv:2502.12110 (fetched, partial) — all accessed 2026-09-14
COUNTEREVIDENCE: none found; this is the least contested category in the entire literature.
OPEN QUESTION: none live for this lane; settled.
```

### 2.2 Episodic memory — VALIDATED, but definitions diverge on granularity

```
CLAIM: Episodic memory (what happened, timestamped, in context) is validated but the field disagrees on
its unit of storage — raw turn-level events (Zep's episode subgraph, PROJECTMEM's Issue/Attempt/Fix) vs
consolidated "reflections" (Generative Agents) — and this is a real design choice, not a settled default.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Generative Agents stores every observation as a timestamped memory object and periodically
synthesizes "reflections" that are written back into the same stream, retrievable alongside raw
observations — an explicit compression step the ablation study found necessary for believable long-horizon
behavior. Zep's episode subgraph stores raw messages non-lossily and derives semantic facts from them
separately, keeping the two tiers distinct rather than consolidating in place. PROJECTMEM records raw
typed events (Issue, Attempt, Fix) and derives a separate, deterministically-regenerable summary.md,
architecturally closer to Zep's separation than to Generative Agents' in-stream consolidation.
SOURCE: arXiv:2304.03442 (fetched); arXiv:2501.13956 (fetched); arXiv:2606.12329 (fetched) — accessed
2026-09-14
COUNTEREVIDENCE: the 2602.06052 survey notes episodic memory's own open problems include "how agents
should define episode boundaries" and "manage long-term retention as episodic memory scales" — i.e. even
the reference survey treats the granularity question as unresolved, not merely a stylistic choice.
OPEN QUESTION: For a coding agent specifically, is the right episodic unit a commit, a session, a tool
call, or a task? No source in this lane's search answers this for the coding domain specifically.
```

### 2.3 Procedural memory / skills — VALIDATED as a category, IMMATURE as an evaluated one

```
CLAIM: Procedural memory is validated conceptually (cognitive-architecture lineage plus a real 2026
production standard, SKILL.md) but the field's own survey concedes it lacks the evaluation rigor semantic
and episodic memory have.
LABEL: STRONG TREND (category validity) / SPECULATIVE (evaluation maturity)
CONFIDENCE: medium-high
EVIDENCE: ACT-R's declarative/procedural split (condition-action production rules encoding skills,
distinct from fact-like declarative chunks) is the cognitive-architecture ancestor (search-summary level).
The 2602.06052 survey names procedural memory as "encoding operational skills, execution strategies, and
automated routines" and states plainly it "remains less standardized than fact-centric settings" despite
"growing interest in assessment." Lane 05 (already written, cited not re-derived) independently found
Agent Skills (`SKILL.md`) is COMMODITY across ~50 shipping clients as of 2026-09-08, and that Claude Code
shipped `/skill-doctor` specifically because nobody has solved skill lifecycle/provenance — i.e. the
*artifact* for procedural memory is standardized while the *governance* of it is not.
SOURCE: arXiv:2602.06052 (fetched); research/lanes/05-commodity-map.md (already written, cited) — accessed
2026-09-14
COUNTEREVIDENCE: none found against the category's validity; the immaturity claim is corroborated
independently by two unrelated sources (the survey and lane 05), which strengthens it.
OPEN QUESTION: Is procedural memory's evaluation gap a benchmark problem (nobody built the eval) or a
structural one (skill quality is inherently hard to score outside its execution context)?
```

### 2.4 Decision memory (ADR-style) — VALIDATED IN PRACTICE, ABSENT FROM AGENT-MEMORY RESEARCH

```
CLAIM: Decision memory is a mature, standardized software-engineering practice on its own (MADR 4.0.0)
but is essentially unrepresented as a first-class category in the general-purpose LLM-agent-memory
literature; only a coding-agent-specific system built independently of that literature includes it.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: MADR 4.0.0 (released 2024-09-17) codifies exactly the fields this lane's brief asks about —
context/problem, decision drivers, considered options (= alternatives), decision outcome, consequences,
and a `status` field whose literal supported value is `superseded by ADR-0123` (fetched from
adr.github.io/madr/). Nygard's original 2011 format (title/status/context/decision/consequences) predates
this and, per the ADR-templates comparison page, does not itself require capturing rejected alternatives.
None of MemGPT, Letta, A-MEM, Mem0, or Zep's documented schemas include a "decision" object type with
alternatives/rejection-reason/supersession fields — their closest analog is a generic semantic fact, which
loses the rejection reason and the alternatives entirely. PROJECTMEM is the exception: its five event types
include an explicit "Decision" category ("an architectural or product choice") alongside Issue/Attempt/
Fix/Note — but PROJECTMEM is the newest, smallest-n system in this lane (207 events, single author,
2-month self-study, no controlled comparison).
SOURCE: https://adr.github.io/madr/ (fetched); https://adr.github.io/adr-templates/ (fetched);
arXiv:2606.12329 (fetched) — accessed 2026-09-14
COUNTEREVIDENCE: it is possible decision memory is implicitly present in Mem0/Zep as an ordinary semantic
fact plus a text description that happens to mention alternatives — none of the fetched schemas structurally
forbid this. But none of the fetched primary sources describe a *typed* decision object with a
machine-readable alternatives/supersession field, which is the property that makes ADR practice queryable.
OPEN QUESTION: Has any team actually tried bolting MADR's schema onto Zep's or Letta's storage layer, or
is this genuinely unattempted? No source found either way.
```

### 2.5 Task memory (objective/plan/blockers/next-step) — THE CLEAREST GAP

```
CLAIM: No grounded system examined in this lane implements a persistent, explicitly-updated "current task
state" object distinct from both raw episodic log and ephemeral working memory; what the field calls
"working memory" is explicitly scoped to be discarded at session end, not to survive as project state.
LABEL: SPECULATIVE (as a validated category) — this is an absence finding, not a presence finding
CONFIDENCE: medium
EVIDENCE: The 2602.06052 survey defines working memory as "temporary holding and manipulation of current
information" under "strict online capacity constraints," with mechanisms for "update, eviction, and
runtime control of context" — every cited technique (compression, folding, KV-cache scheduling) is about
managing what is *currently in the context window*, not about a durable record of what the agent is
trying to accomplish that persists once the window is cleared. PROJECTMEM's closest analog, "Issue," is
GitHub-issue-shaped (a problem is opened) rather than task-shaped (an objective with a plan, a blocker
list, and a next step). Letta's core-memory blocks could in principle hold a task-state block (the schema
supports arbitrary labeled blocks), but no source describes this as a distinguished, standardized block
type the way "persona" or "human" blocks are conventionally used.
SOURCE: arXiv:2602.06052 (fetched); arXiv:2606.12329 (fetched); Letta blog (fetched) — accessed 2026-09-14
COUNTEREVIDENCE: this is an absence claim from a necessarily incomplete search; a task-state memory type
may exist in a system this lane did not find, or may live inside a coding-agent harness's own state
management rather than its "memory" subsystem specifically — which is exactly why lane 12 (durable
harness, not yet written when this lane started) is the right place to check whether Claude Code's own
plan/task persistence already solves this outside the "memory" framing.
OPEN QUESTION: Is task memory genuinely missing from the research, or is it hiding inside "agent state"
/ "workflow" literature that uses different vocabulary and was not surfaced by this lane's searches?
```

### 2.6 Agent memory (durable specialist knowledge, isolated vs shared) — VALIDATED, NASCENT

```
CLAIM: Isolated-vs-shared agent memory is a real, actively-being-formalized category in multi-agent
systems as of mid-2026, with a named set of failure modes and architectural primitives, but the field is
new enough that its own evaluation surfaces a load-bearing bug in the reference implementation.
LABEL: STRONG TREND
CONFIDENCE: medium-high
EVIDENCE: Governed Shared Memory (arXiv:2606.24535, fetched in full) names four failure modes —
unauthorized leakage, stale propagation, contradiction persistence, provenance collapse — and proposes
four primitives: scoped retrieval (a four-level hierarchy: agent-local, team-shared, tenant-global,
restricted), temporal supersession, provenance tracking, and policy-governed propagation with trust-level
gating. Its own evaluation found near-perfect provenance reconstruction (100% on 50 four-hop chains,
p50 291ms per hop) and strong scoped-propagation results (97.5% fleet-sibling visibility, 0/80 cross-fleet
leaks), but only 49% overall contradiction-detection — traced specifically to a synchronous dedup gate
rejecting contradictory writes with a 409 before the asynchronous contradiction detector ever runs
(contradiction detection was 100% accurate *when both conflicting writes were actually admitted*). Multi-
Agent Transactive Memory (arXiv:2606.19911, search-summary level) independently frames the same problem:
agent trajectories "encode reusable procedural knowledge, yet these artifacts are typically discarded
after a single use or retained only by the producing agent."
SOURCE: arXiv:2606.24535 (fetched, full) — accessed 2026-09-14; arXiv:2606.19911 (search-summary only,
recorded for the second wave)
COUNTEREVIDENCE: this is a single lab-plus-startup paper (Caura.ai + Ben-Gurion University), June 2026,
with evaluation scale in the tens-to-low-hundreds of trials — a genuinely new result, not yet replicated.
OPEN QUESTION: Does the "admission ordering hides the contradiction detector" bug generalize — i.e. is
write-gate sequencing a structural trap that any two-stage admission pipeline (fast dedup, slow semantic
check) will hit, independent of implementation?
```

### 2.7 User preference vs project requirement — NOT DISTINGUISHED ANYWHERE FOUND

```
CLAIM: No grounded system's documented schema formally separates "a stylistic preference that binds only
for the person who stated it" from "a project requirement that binds regardless of who states it" — every
system found treats "preference" as an undifferentiated personalization signal.
LABEL: SPECULATIVE — again an absence finding
CONFIDENCE: medium
EVIDENCE: Letta's example core-memory blocks are "user preferences" and "persona" — both scoped to the
conversational user, with no parallel block type for a binding project-level requirement that would apply
even to a different user working the same codebase. Mem0's stated purpose is broadly "personalization."
Lane 05 (already written) found at least one shipping system splits notes into four types including both
`user` and `project` — a suggestive existing distinction — but that system's internal mechanics are
explicitly out of this lane's scope (lane 12's territory); this lane can only note the split exists
somewhere in production, not what it does or how well it works.
SOURCE: Letta blog (fetched); arXiv:2504.19413 (fetched, abstract); research/lanes/05-commodity-map.md
(already written, cited only for the existence of a 4-note-type split) — accessed 2026-09-14
COUNTEREVIDENCE: it is plausible this distinction is present in some system's *implementation* without
being named in its *published schema* — absence of documentation is not absence of the feature.
OPEN QUESTION: Should lane 12 be asked directly whether any harness's project-vs-user split includes an
explicit conflict-resolution rule (e.g., project requirement always overrides a contradicting personal
preference), or is the split purely organizational (which file it's stored in) with no binding semantics?
```

### 2.8 Evidence memory (claim + proof) — NOT FOUND IMPLEMENTED ANYWHERE

```
CLAIM: No memory system examined in this lane — general-purpose or coding-specific — stores a claim
together with the artifact that proves it (a test result, a verification run, a reproducible check); every
system stores the claim's text and, at best, its extraction provenance, never its evidentiary basis.
LABEL: SPECULATIVE (as an implemented category) — motivated by, not duplicating, the selected thesis
CONFIDENCE: medium
EVIDENCE: PROJECTMEM's closest object, "Fix," records that an issue was closed and references the issue,
but the fetched schema does not describe a field carrying the actual proof artifact (e.g., a test-run ID
or a diff hash) — the fix is asserted, not attached to its verification. Zep's fact-invalidation mechanism
uses an LLM to compare new edges against existing ones for contradiction, which is itself an unverified,
uncited judgment about the fact, not a proof. Lane 01 (already written, cited not re-derived) independently
measured that LLMs judge membership far better than they enumerate sets (F1 0.74-0.90 judging vs 19-42%
authored-set admission, arXiv:2608.01000, via lane 01) — this lane's finding is narrower and specific to
memory schemas: none of the systems checked *persists* the judgment's basis, so even a well-judged claim
becomes an unverifiable assertion the moment it is written to memory.
SOURCE: arXiv:2606.12329 (fetched); arXiv:2501.13956 (fetched); research/lanes/01-future-se.md (already
written, cited for the judge-vs-enumerate finding only) — accessed 2026-09-14
COUNTEREVIDENCE: this is again an absence claim from an incomplete search across a very large literature;
a system pairing claims with proof artifacts specifically may exist under a name (e.g., "verified memory,"
"certified fact") this lane's queries did not surface.
OPEN QUESTION: Is evidence memory absent because nobody has thought to build it, or because the underlying
problem (cheaply re-verifying an old proof is still valid, i.e. keeping the proof itself from going stale)
is at least as hard as the "evidence invalidation" gap lane 01 and the selected thesis already named — in
which case evidence memory is not a schema problem at all but the same unsolved problem restated?
```

### 2.9 Failure memory — VALIDATED, ACTIVE 2026 RESEARCH CLUSTER

```
CLAIM: Failure-aware memory (recording what did not work, so it is not retried) is validated by an
unusually dense, mutually-uncited cluster of independent 2026 papers plus one directly-fetched
coding-agent-specific system with a deterministic pre-action gate built specifically on failure records.
LABEL: STRONG TREND
CONFIDENCE: medium (high for PROJECTMEM specifically, which was fetched in full; medium for the wider
cluster, which rests on WebSearch summaries only)
EVIDENCE: PROJECTMEM's "Attempt" event type carries an outcome field (worked/failed/partial) and its
`precheck_file()` mechanism deterministically warns an agent before it repeats a previously-failed action
on that file — described by the authors as "Memory-as-Governance." Independently: Negative Knowledge
(arXiv:2606.21024) has a curator agent write each failure as a typed record a downstream agent must
explicitly adopt or reject; Experience Memory Graph (arXiv:2607.13884) reframes failure recovery as graph
matching; EvoGraph-Mem (arXiv:2608.11248) tracks positive and negative evidence per insight node with an
activation state; DELTAMEM (arXiv:2606.03083) records "gaps in existing skills that caused failures."
None of these cite each other per the search results, which is the same "independent convergence" pattern
lane 04 flagged for the intensional/extensional finding.
SOURCE: arXiv:2606.12329 (fetched, full); arXiv:2606.21024, 2607.13884, 2608.11248, 2606.03083
(search-summary only) — accessed 2026-09-14
COUNTEREVIDENCE: PROJECTMEM's authors themselves flag the load-bearing gap: "the single most valuable
next result is a measured one: the fraction of injected, previously-failed fixes the gate blocks" — no
controlled repeat-failure benchmark exists yet anywhere in this cluster.
OPEN QUESTION: Does any of these five systems measure false-positive cost — an agent refusing a fix that
would actually work this time because conditions changed since the recorded failure? PROJECTMEM names this
risk explicitly ("stale failure signals") and ships warnings as advisory-only for exactly this reason; none
of the other four papers' summaries mention it.
```

### 2.10 Project constitution (stable principles) — REDUNDANT, FOLDS INTO SEMANTIC MEMORY + PROVENANCE

```
CLAIM: "Project constitution" is not a distinct memory-taxonomy category validated by research; it is
better modeled as semantic memory whose source class is human-authored/user and whose trust tier and
expiry are set to maximum — a provenance-and-trust distinction, not a storage-type distinction.
LABEL: REASONABLE EXTRAPOLATION
CONFIDENCE: medium
EVIDENCE: No academic memory-taxonomy source in this lane names "constitution" or an equivalent as a
cognitive-mechanism category alongside episodic/semantic/procedural/working/sensory — the 2602.06052
survey's three axes have no slot for it. What exists in production is a *shipping pattern*: Kiro's
steering files (`.kiro/steering/`, workspace- and personal-scoped, read at the start of every session) are
functionally durable facts the team has chosen to assert rather than facts the system extracted — i.e.
the content is ordinary semantic memory, but its provenance (directly human-authored, not
inferred/extracted) and its intended trust level (should not be silently overwritten by an inferred fact)
differ from an extracted semantic memory item. Lane 04 (already written, cited not re-derived) found the
closest analogue's own historical failure mode — MDE's models had "no consistency check" and rotted
silently — which is the exact risk a "constitution" memory item is meant to resist by being both
high-trust and rarely re-derived.
SOURCE: kiro.dev/docs/steering/ (search-summary only); arXiv:2602.06052 (fetched);
research/lanes/04-representations.md (already written, cited for the MDE-rot analogy) — accessed
2026-09-14
COUNTEREVIDENCE: treating it as "just semantic memory with high trust" may understate a real functional
difference — a constitution item is meant to *constrain* future writes (nothing may silently contradict
it), which is closer to Governed Shared Memory's policy-governed propagation than to ordinary semantic
storage. If that constraint function turns out to require its own mechanism (not just a trust tag), the
"redundant" verdict would need revision.
OPEN QUESTION: Does any system enforce that a high-trust/human-authored item cannot be silently
overwritten by a later LLM-inferred item, or is this purely aspirational across every system checked?
No source found answering this directly.
```

---

## 3. Temporal model

### 3.1 Recommended fields, with evidence for each

| Field | Evidence it is validated | Source |
|---|---|---|
| `created_at` / ingestion timestamp | Zep's `t'_created`; MADR's `date` field | arXiv:2501.13956; adr.github.io/madr |
| `valid_from` (event-time, when the fact became true in the world) | Zep's `t_valid`; Fowler's "actual time" | arXiv:2501.13956; Fowler bitemporal-history article |
| `valid_until` / `t_invalid` (when the fact stopped being true) | Zep's `t_invalid`, set explicitly on invalidation rather than deleting the row | arXiv:2501.13956 |
| `expired_at` / transactional expiry (when the *system* stopped trusting it, distinct from when it stopped being true) | Zep's `t'_expired`; SSGM's expiry/TTL field | arXiv:2501.13956; arXiv:2603.11768 (partial) |
| `supersedes` / `superseded_by` | MADR's literal `status: superseded by ADR-0123`; Governed Shared Memory's "temporal supersession" primitive (creation timestamp + supersession reference + status field) | adr.github.io/madr; arXiv:2606.24535 |
| `confidence` | SSGM's confidence-score field; ConsistencyGate scores candidate facts on factual support before admission; SAGE's density-estimator score used to route add/merge/discard | arXiv:2603.11768 (partial); arXiv:2607.22962 (search-summary); arXiv:2605.30711 (fetched) |
| `scope` / `owner` | Governed Shared Memory's four-level scope hierarchy (agent-local, team-shared, tenant-global, restricted) | arXiv:2606.24535 |
| `evidence` (pointer to the proof, not just the claim) | **Not found implemented anywhere in this lane's search** — see §2.8 | — |

### 3.2 What production systems actually omit

```
CLAIM: The two most cited chat-personalization memory systems (Letta and Mem0) do not expose an explicit
bitemporal or supersession schema in what they publicly document, in contrast to Zep, which was purpose-
built with one from the start.
LABEL: OBSERVED TODAY
CONFIDENCE: medium-high
EVIDENCE: Letta's core-memory block schema, as documented, is label/description/value/character-limit —
four fields, none temporal beyond an implicit "current state." The block is edited via API calls by the
agent itself or a sleep-time agent; the fetched source describes no retained history of prior values
within the block object itself (history exists only insofar as raw messages persist separately in recall
memory). Mem0's own memory-operations docs, fetched directly, state the default behavior is additive —
"new memories are added without overwriting or deleting existing memories" — with an explicit warning that
mixing extraction modes for the same fact "can save it twice," and the fetched page describes no
contradiction-resolution logic. Zep, by contrast, carries four timestamps per edge from its 2025 design and
reports its LLM-based contradiction detector "consistently prioritizes new information when determining
edge invalidation" — an explicit, documented policy, not a silent duplicate.
SOURCE: Letta blog (fetched); https://docs.mem0.ai/core-concepts/memory-operations (fetched);
arXiv:2501.13956 (fetched) — accessed 2026-09-14
COUNTEREVIDENCE: absence from public documentation is not proof of absence in the underlying
implementation — Mem0's ECAI 2025 paper's abstract describes a more sophisticated "dynamically extracts,
consolidates, and retrieves" pipeline than the fetched docs page's plain description, so the two sources
may simply be describing different configuration modes or documentation lag rather than a true capability
gap. Flagged, not asserted as certain.
OPEN QUESTION: Is this a genuine architectural difference (Zep designed for state-tracking; Letta/Mem0
designed for conversational recall, where "latest wins" is an acceptable simplification) or a
documentation gap that would close on a deeper read of each system's source code?
```

### 3.3 Event sourcing as the substrate that makes bitemporal modeling cheap

PROJECTMEM's central architectural bet — an append-only log with a deterministic, idempotent projection
— is the general event-sourcing pattern (Fowler's 2005 essay, general background, not separately fetched
this session) applied to agent memory specifically. This matters for the temporal-model question because
event sourcing gets `created_at`/`valid_from` almost for free (the event's position in the log *is* its
timestamp) and makes `supersedes` a matter of appending a new event referencing the old one rather than
mutating a row — exactly the "invalidate, never delete" policy Zep also independently adopted for its
graph edges. Two systems built on unrelated substrates (an append-only JSONL file vs a temporal knowledge
graph) converged on the same non-destructive-write principle; PROJECTMEM does not implement Zep's dual
event/transaction timeline explicitly, but its substrate would support adding it without an architectural
change — the log already has one of the two required timelines (ingestion order) and would need only an
optional `valid_at` field per event to acquire the other.

---

## 4. Provenance/trust model

### 4.1 Source classes actually used by grounded systems

No single system in this lane's search implements the full ten-class taxonomy this lane's brief proposes
(user, repository, test, runtime, web, agent, skill, document, decision, inference). The closest is
Governed Shared Memory's provenance object: writer identity, source system, derivation history,
modification lineage — which is structurally general enough to carry any of the ten classes as a value,
but the paper's own evaluation only exercises "writer identity" at the level of which *agent* wrote an
item, not which *kind of source* (test result vs web fetch vs user statement) it originated from.

```
CLAIM: Trust-tiering by provenance, rather than by the confidence expressed in the memory's own text, is
the specific mechanism the 2026 poisoning-defense literature converges on — independent of whether the
threat model is adversarial or merely low-quality extraction.
LABEL: STRONG TREND
CONFIDENCE: medium
EVIDENCE: The provenance-capped poisoning defense paper's central claim, fetched at abstract level: "trust
is bounded by source provenance rather than textual confidence" — a memory item's influence on agent
beliefs is capped by its source's reliability regardless of how confident the extracted text sounds, and
this specifically outperforms alternatives "when observations differ in trustworthiness." RAGShield
(fetched, corrected from an earlier inaccurate WebSearch summary — see sources file) independently
operationalizes something adjacent for numeric facts: cross-source registry verification plus temporal
tracking of value changes outside expected update schedules, reaching 100% detection / 0% attack success
on 430 real attacks against government RAG corpora, versus 79–90% misses for embedding-based defenses —
i.e. checking a fact against its own corpus's update history (a provenance-adjacent signal) beat checking
its embedding similarity. Governed Shared Memory's scoped-retrieval primitive is a third, structurally
different mechanism for the same underlying goal: bound what an item can influence by where it is allowed
to be read, independent of how it is worded.
SOURCE: arXiv:2606.22030 (fetched, abstract-level); arXiv:2604.00387 (fetched, abstract-level, corrected);
arXiv:2606.24535 (fetched, full) — accessed 2026-09-14
COUNTEREVIDENCE: all three mechanisms were evaluated on their own authors' benchmarks (430 attacks; 50
provenance chains; belief-updating simulations) with no cross-system comparison found — it is unknown
whether any one of the three dominates the others on a shared benchmark, or whether they are complementary
layers.
OPEN QUESTION: this lane was told to research provenance only at the "does it reduce risk" level, per
scope; lane 14 owns the deeper threat model. The open question for lane 14 specifically: do these three
mechanisms compose, or does stacking scoped-retrieval + provenance-capping + numeric cross-source checking
introduce the same kind of pipeline-ordering bug Governed Shared Memory's own evaluation found in its
admission gate?
```

### 4.2 High-trust vs low-trust source classes: what differs in practice

The clearest concrete evidence of differential treatment found in this lane is negative: Mem0's documented
default treats every extracted fact identically (additive, no confidence-weighted overwrite logic visible
in the fetched docs), while Zep's LLM-based contradiction detector applies one uniform policy ("new
information wins") regardless of whether the new information came from a user statement or an inferred
summary. Neither system was found to differentiate a test result or a runtime observation (high
verifiability) from an LLM-generated summary or fetched web content (low verifiability) at the schema
level. The only systems that do differentiate by source reliability are the security-adjacent ones (§4.1),
which treat this as a defense mechanism rather than a general memory-quality mechanism — suggesting the
field currently only invests in provenance-weighting when the threat model is adversarial, not as a
default quality practice. This is one of this lane's "problems nobody is talking about" (§8).

---

## 5. Grounded systems table

| System | Org | Mechanism | Date/version verified | What it validates |
|---|---|---|---|---|
| MemGPT | UC Berkeley (Packer et al.) | Three-tier virtual context paging (main context / recall storage / archival storage), self-directed via function calls | arXiv v1 2023-10-12 / v2 2024-02-12, fetched 2026-09-14 | The OS-memory-hierarchy metaphor as a workable pattern; the origin point for "self-managing" memory |
| Letta | Letta (MemGPT's successor) | Core memory blocks (label/description/value/char-limit, editable), recall memory (full history, disk-persisted), archival memory (vector/graph-backed), sleep-time compute (async consolidation) | Blog post 2025-07-07, fetched 2026-09-14 | Moving consolidation off the response-latency path; no independent evaluation of Letta's own numbers found |
| Generative Agents | Stanford/Google DeepMind (Park et al.) | Single memory stream of timestamped observation/plan/reflection objects; recency+importance+relevance retrieval; LLM-scored importance 1–10 | arXiv 2023-04-07 / rev 2023-08-06, fetched 2026-09-14 | Reflection as a distinct, necessary consolidation step (ablation-confirmed); the template for in-stream consolidation |
| A-MEM | multi-author (Xu et al.) | Zettelkasten-style atomic notes with dynamic linking and retroactive "memory evolution" of existing notes | arXiv v1 2025-02-17 / v11 2025-10-08, NeurIPS 2025, fetched partial 2026-09-14 | That unstructured, LLM-driven link discovery is a viable alternative to fixed schemas — no controlled comparison against Zep's structured graph found |
| Mem0 | Mem0 (Chhikara et al.) | Extract-consolidate-retrieve pipeline (per paper abstract); documented default behavior is additive-only (per docs) | arXiv 2025-04-28 (ECAI 2025); docs fetched 2026-09-14 | LoCoMo-benchmark competitiveness (26% relative LLM-judge gain over OpenAI Memory, 91% lower p95 latency); a real gap between paper-claimed sophistication and documented default behavior |
| Zep / Graphiti | Zep AI (Rasmussen et al.) | Three-tier temporal knowledge graph (episode/semantic/community subgraphs), explicit four-timestamp bi-temporal edges, LLM-based contradiction detection with new-info-wins policy | arXiv 2025-01-20, fetched in full 2026-09-14 | That a full bitemporal schema is buildable and beats full-context on both accuracy (+18.5pp LongMemEval) and latency (~90% reduction) — the strongest evidence in this lane for the temporal-model recommendation in §3 |
| PROJECTMEM | University of Utah (Malo, Qiu) | Five typed events (Issue/Attempt/Fix/Decision/Note) in an append-only JSONL log, deterministic idempotent projection, deterministic pre-action failure-warning gate | arXiv 2026-06, fetched in full 2026-09-14 | The only coding-agent-specific system found; validates event sourcing, typed decision records, and failure-aware pre-action gating as buildable together — but n=207 events, single author, no controlled benchmark |
| Governed Shared Memory | Caura.ai + Ben-Gurion University (Margalit et al.) | Four-level scoped retrieval, temporal supersession, provenance tracking, policy-governed propagation across multi-agent fleets | arXiv 2026-06-23, fetched in full 2026-09-14 | That provenance-chain reconstruction is solvable (100% on 50 chains) while contradiction detection is not yet solved end-to-end (49% overall, bottlenecked by admission-pipeline ordering, not the detector) |
| SAGE | independent (Wang, Brahma, Henao) | Density-estimator-based novelty gate routing writes to add/merge/discard, only uncertain cases go to an LLM | arXiv 2026-05-29 / rev 2026-06-18, fetched 2026-09-14 | That cheap, non-LLM write-gating recovers real cost (3.4x cost, 2.5x latency) without a corresponding quality collapse — direct evidence for §6 |

---

## 6. Memory write-gate research

```
CLAIM: Across every system in this lane that discusses the write decision explicitly, the same pattern
recurs: a cheap, deterministic or lightweight first-pass filter (novelty/admission gate) defers only the
ambiguous cases to an expensive LLM judgment, rather than routing every candidate fact through the LLM.
LABEL: STRONG TREND
CONFIDENCE: medium-high
EVIDENCE: SAGE (fetched in full) uses a von-Mises-Fisher density estimator over memory embeddings with an
adaptive threshold to pre-classify candidates as clearly-novel (add), clearly-redundant (discard), or
uncertain (only these go to an LLM for merging) — 3.4x cost and 2.5x latency reduction on GPT-4o-mini, and
as a gate bolted onto another system it skipped 16-18% of LLM calls across five models with minimal quality
loss on open-weight models specifically. PROJECTMEM's pre-action gate (fetched in full) is even more
extreme: zero model calls, pure deterministic lookup against the typed event log, explicitly chosen over an
LLM check because it is "reproducible" and has "zero read-time model cost." ConsistencyGate
(search-summary level) frames the admission gate as a Truth Maintenance System doing "strict logical
contradiction checks" before write, again a deterministic-first posture. The one system that does the
opposite — Mem0's documented default of add-without-checking — is also the one system whose docs contain
an explicit self-reported duplicate-risk warning, which is suggestive (not proof) that skipping the gate has
a real, acknowledged cost.
SOURCE: arXiv:2605.30711 (fetched, full); arXiv:2606.12329 (fetched, full); arXiv:2607.22962
(search-summary); docs.mem0.ai (fetched) — accessed 2026-09-14
COUNTEREVIDENCE: SAGE's own reported quality trade-off is described only as "minimal degradation on
open-weight models," which leaves open whether the degradation is more than minimal on the frontier models
a production coding agent would actually use. No source in this lane quantifies false-negative admission
cost (an actually-important fact discarded by an over-aggressive novelty gate) as carefully as it
quantifies cost savings.
OPEN QUESTION: What is the false-negative rate of a deterministic or density-based write gate specifically
for the categories this lane found least standardized (task memory, decision memory) — where "is this
candidate novel" is a much fuzzier question than for a personalization fact like a stated preference?
```

```
CLAIM: Contradiction handling in production systems reduces to one of three named policies — recency
wins, source wins, confidence wins — and no source in this lane found a system that mixes policies by
memory type (e.g., recency for task state, source for decisions, confidence for inferred facts) even
though the differing risk profiles of those types would seem to justify it.
LABEL: OBSERVED TODAY (for the three-policy taxonomy) / SPECULATIVE (for the missing per-type mixing)
CONFIDENCE: low-medium — the three-policy framing comes from a practitioner blog, not a peer-reviewed
source, and should be weighted accordingly
EVIDENCE: The Hindsight blog post (fetched via WebSearch summary, not independently opened — see sources
file for this caveat) names recency-wins ("good for state but bad for stable attributes"), source-wins
("good for systems with explicit provenance"), and confidence-wins ("good when extraction is
probabilistic") as the three sensible policies in current practice. Zep's actual implemented policy is a
pure recency-wins variant ("consistently prioritizes new information"). Governed Shared Memory implements a
form of source/scope-wins via its policy-governed propagation. No fetched source describes a system that
applies different policies to different memory *types* within the same deployment.
SOURCE: Hindsight blog, 2026-05-21 (search-summary only); arXiv:2501.13956 (fetched); arXiv:2606.24535
(fetched) — accessed 2026-09-14
COUNTEREVIDENCE: this may simply be an artifact of this lane's search depth rather than a genuine gap —
per-type contradiction policy is a natural enough idea that it likely exists somewhere unindexed by this
lane's queries.
OPEN QUESTION: For a coding-agent memory system specifically, should decision memory use source-wins
(only the decision-maker of record can supersede a decision) while episodic/task memory uses recency-wins
(the newest status is definitionally correct)? This is a design question the second wave should treat as
open, not settled by any source found here.
```

---

## 7. Contradictions with common belief

**C1. "Vector embeddings and semantic search are the mature, default substrate for agent memory; a
coding-specific system would obviously build on that." The one system purpose-built for coding agents in
this lane's entire search explicitly rejected embeddings.** PROJECTMEM's authors chose an append-only,
deterministic, event-sourced log specifically because it trades "fuzzy recall for determinism, legibility,
and zero read-time model cost," and frame every general-purpose system in this lane (MemGPT/Letta, Mem0,
Zep) as solving a different problem — personalization/chat memory, which tolerates fuzziness — rather than
engineering correctness, which the authors argue does not. This is a single, small, unreplicated system
(n=207 events), so treat the *conclusion* as contested, but the *fact that the field's only coding-specific
entrant made this choice on purpose* is itself evidence against the "obviously vectors" assumption.

**C2. "Temporal/bitemporal modeling is exotic, academic infrastructure nobody actually ships." One of the
most-cited production agent-memory systems in 2026 ships a full four-timestamp bitemporal schema, and it
is the system with the strongest accuracy and latency numbers in this lane.** Zep's DMR (94.8%, beating
MemGPT's 93.4%) and LongMemEval (+18.5pp accuracy, ~90% latency reduction versus full-context) results
were achieved *with* the bitemporal overhead, not despite it — directly contradicting the intuition that
temporal correctness and production performance trade off against each other. Fowler's own caution ("if we
can avoid using bitemporal history, then that's usually preferable") is about implementation complexity
cost, not about whether it pays off when the domain needs it — and Zep is direct evidence that an agent
memory domain does need it once facts are expected to change over months.

**C3 (methodological, worth stating explicitly). "A WebSearch synthesis of a paper's findings is a safe
substitute for reading the paper."** This lane directly tested that assumption on RAGShield
(arXiv:2604.00387): the WebSearch summary reported "C2PA-inspired cryptographic document attestation" and
a "taint lattice," neither of which appears in the abstract this lane fetched directly. The claim was
dropped rather than kept. This is not a claim about the world of agent memory — it is a methodological
finding about this mission's own research process, offered because it is directly relevant to how much
weight the second wave should put on any lane's search-summary-only citations (marked throughout this
report and the sources file).

---

## 8. Problems nobody is talking about

**P1. Nobody separates "the fact stopped being true" from "we stopped trusting the fact" — even though
Zep's own four-field schema has room for exactly this distinction and no source uses it that way.** Zep
carries `t_invalid` (event-occurrence timeline: when the fact stopped being true in the world) and
`t'_expired` (transactional timeline: when the system invalidated it) as genuinely separate fields, which
is precisely what the bi-temporal model is for. But every contradiction-handling policy this lane found
(Zep's own "new info wins," the three-policy taxonomy in §6) resolves both fields identically the moment a
contradiction is detected — there is no described case where a system says "we no longer trust this claim
enough to act on it (expire it transactionally) without asserting we know exactly when reality changed
(leave valid-time open)." For a coding agent, this distinction matters concretely: "this API is deprecated"
(a valid-time change with a known date) is a different kind of fact than "I am no longer confident this
decision rationale still holds" (a transactional-trust change with no known reality-change date) — and no
system found treats them differently.

**P2. Write-gate research (§6) optimizes for cost and contamination, but not one source in this lane
measures the write gate's effect on the categories this report found least standardized — task and
decision memory.** SAGE's density-estimator gate, PROJECTMEM's deterministic precheck, and ConsistencyGate
were all evaluated on fact-like or failure-like memory, where "is this novel" or "is this contradictory" is
a comparatively well-posed question against an embedding space or an event log. A decision ("we chose X
over Y because Z") and a task-state update ("blocker resolved, next step changed") are not naturally
embeddable as single facts, and no source in this lane's search describes a write gate evaluated against
either type specifically. This is a live, unmeasured gap directly downstream of §2.4 and §2.5's category
findings, not a restatement of them.

**P3. The field has converged on provenance-weighted trust as a *security* mechanism but nobody in this
lane's search treats it as a *quality* mechanism for ordinary, non-adversarial memory hygiene.** Every
system that differentiates trust by source (§4.1: provenance-capped belief updating, RAGShield,
Governed Shared Memory) does so under an explicit poisoning or leakage threat model. Meanwhile the two
most-cited general-purpose systems (Letta, Mem0) apply uniform trust regardless of source even in the
complete absence of any adversary — a test result and an LLM's own unverified summary of a conversation
are equally "true" the moment either is written. If provenance-weighting is worth building for defense, the
same mechanism (a test result should simply outrank an inference, always, adversary or not) appears to be
worth building for baseline memory quality, and nobody in this lane's search has made that argument
explicitly.

**P4. Nobody has measured what happens when a "constitution"-class item (§2.10) is contradicted by an
extracted fact — whether any system actually enforces the asymmetric trust this lane's own analysis
recommends, or whether it is purely aspirational.** This is stated as an open question in §2.10 but is
worth naming again here as a *problem*, not just a question: every provenance mechanism found (§4) treats
trust as a graded score or a scope boundary, not as an asymmetric veto ("a human-authored item cannot be
silently overwritten by an inferred one, ever, regardless of confidence or recency"). If that veto does not
exist anywhere, then "project constitution" memory is currently indistinguishable in practice from any
other semantic fact the moment a contradicting extraction is admitted — which would mean the redundancy
verdict in §2.10 understates the risk rather than correctly describing a solved special case.

---

## 9. What becomes commodity / what stays hard (this lane's topic, not competitive products — see lane 05)

**Becomes commodity**

- A three-tier storage split (fast in-context / searchable recall / long-term archival), in some form.
  **OBSERVED TODAY** — independently present in MemGPT, Letta, and (structurally) Zep's episode/semantic/
  community split.
- Semantic-fact extraction and retrieval from conversational or tool-use history. **OBSERVED TODAY** —
  Mem0, A-MEM, Zep, Letta's archival memory all do a version of this.
- Basic write-time deduplication/novelty gating to control cost. **STRONG TREND** — SAGE demonstrates it
  cheaply (3.4x cost reduction); expect this pattern to spread fast given how directly it pays for itself.
- Failure-aware "don't repeat this" signals of some kind. **STRONG TREND** — five independent 2026 papers
  converge on some version of this within months of each other.

**Stays hard**

- A schema that structurally distinguishes decision memory (with alternatives and supersession) from
  ordinary semantic fact. **OBSERVED TODAY (as a gap)** — mature practice (MADR) and agent-memory research
  have not merged; only one small, unreplicated coding-specific system attempts it.
- Persistent, explicitly-updated task/objective state distinct from ephemeral working memory. **OBSERVED
  TODAY (as a gap)** — not found implemented anywhere in this lane's search.
- Evidence memory (claim plus its proof, re-verifiable rather than merely re-assertable). **OBSERVED TODAY
  (as a gap)** — connects directly to the selected thesis's "evidence invalidation barely exists as a
  research field" finding, now confirmed absent specifically at the memory-schema level too.
- End-to-end contradiction detection under realistic write-pipeline ordering. **OBSERVED TODAY** —
  Governed Shared Memory's own result (100% detection when both writes are admitted, 49% overall) shows
  the theory works and the plumbing does not yet, which is a harder, more mundane problem than it sounds.
- Asymmetric, enforced trust for human-authored "constitution" items against inferred contradictions.
  **SPECULATIVE (as a gap)** — no source found either confirms or denies this is solved; treat as unknown,
  not merely hard.
- Cross-system provenance interoperability — a memory item moved between a Zep-style graph and a Letta-
  style block store has no described way to carry its full provenance/trust metadata intact. **REASONABLE
  EXTRAPOLATION** — inferred from the fact that every schema examined is architecture-specific with no
  shared interchange format found, echoing lane 04's finding that Markdown, not a formal IR, is what
  actually interoperates across tools; no source in this lane confirms or denies whether the same pattern
  will hold for memory specifically.

---

## 10. Open questions for the second wave

1. **Is task memory truly absent, or is it hiding under "agent state" / workflow vocabulary this lane's
   searches did not surface?** The single highest-value question for lane 12 to help answer, since a
   harness's own plan/task persistence may already solve this outside a "memory" framing.
2. **Does any team's system apply per-memory-type contradiction policy (decision=source-wins,
   task=recency-wins, semantic=confidence-wins)?** No source found either confirms or denies this is
   attempted; §6 flags it as a natural but unvalidated idea.
3. **Does the Governed Shared Memory admission-ordering bug (synchronous dedup gate silently disabling the
   asynchronous contradiction detector) generalize to any two-stage write-gate architecture?** If so, this
   is a load-bearing design trap for anyone building a write gate per §6's recommended cheap-filter-then-
   LLM pattern.
4. **Is evidence memory (claim + proof) the same unsolved problem as evidence invalidation (already named
   by the selected thesis and lane 01), restated at the memory-schema level — or a genuinely separate,
   buildable thing?** §2.8's open question, worth resolving before treating evidence memory as a design
   target rather than a research problem.
5. **Has anyone actually bolted MADR's decision schema onto a production agent-memory substrate (Zep,
   Letta) and tried it?** §2.4's open question — cheap to test, potentially decisive for whether decision
   memory is a real gap or just an unwritten integration.
6. **What is the false-negative cost of write-gating specifically for low-frequency, high-value memory
   types (decisions, task-state changes) as opposed to the high-frequency, low-value types (ordinary
   facts) the existing write-gate literature was evaluated on?** §8 P2.
7. **Does asymmetric trust for human-authored "constitution" items exist anywhere as an enforced
   mechanism, or is it aspirational everywhere?** §2.10 and §8 P4 — this determines whether "project
   constitution as semantic memory with elevated trust" is a safe design recommendation or a
   currently-unbuildable one.
8. **A full read of SSGM (arXiv:2603.11768) and Always-On Agents (arXiv:2606.30306)** — both fetches in
   this lane returned only PDF structural metadata, not body text. Both are directly on-topic (governance
   schema fields; persistence over months/years) and should be prioritized for a proper fetch before any
   claim resting on them is treated as settled.
9. **Cross-system benchmark for the three provenance-weighting mechanisms in §4.1** (provenance-capped
   belief updating, RAGShield's numeric cross-source verification, Governed Shared Memory's scoped
   propagation) — each was evaluated only on its own authors' benchmark; nobody has run them head to head,
   or tested whether they compose without introducing a new pipeline-ordering bug.
10. **What does Claude Code's (or any production harness's) own task/plan persistence actually look like
    at the schema level, and does it already answer question 1 above?** Explicitly lane 12's territory —
    flagged here so the second wave knows this lane's biggest gap (task memory) may already be answered
    once lane 12's findings exist, rather than being a genuine open research question.
