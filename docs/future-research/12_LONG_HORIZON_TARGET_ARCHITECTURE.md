# Long-horizon target architecture

Layer-by-layer design for the memory/continuity system described in `11_LONG_HORIZON_MEMORY_AND_CONTINUITY.md`,
grounded in what `research/lanes/11-15.md` actually found — not invented from the brief's template. Each
layer states what exists in ShelraCode today (citations from the forensic audit, `research/lanes/15-*.md`),
what's missing, and who controls it: the deterministic harness, or the model's own judgment.

Contingent on the same gate as everything else in this direction: `10_PHASED_PLAN.md` Phase 1 (the base-rate
falsifier for `08_SELECTED_THESIS.md`). This document describes what to build *if* that passes.

---

## 1. The layers

```
┌─────────────────────────────────────────────────────────────────────┐
│ INTENT LAYER            — what the human asked for, verbatim         │
├─────────────────────────────────────────────────────────────────────┤
│ PROJECT CONSTITUTION    — durable, human-authored, asymmetric trust  │
├─────────────────────────────────────────────────────────────────────┤
│ OBJECTIVE LEDGER │ TASK LEDGER │ DECISION LEDGER │ EVIDENCE STORE    │
├─────────────────────────────────────────────────────────────────────┤
│ MEMORY ENGINE (write gate, temporal fields, provenance/trust)        │
├─────────────────────────────────────────────────────────────────────┤
│ CONTEXT RETRIEVAL ENGINE (lexical | graph | fallback-embedding)      │
├─────────────────────────────────────────────────────────────────────┤
│ AGENT RUNTIME (one kernel, not two) │ SKILLS RUNTIME │ MODEL ROUTER  │
├─────────────────────────────────────────────────────────────────────┤
│ EXECUTION RUNTIME → VERIFICATION ENGINE → REPAIR ENGINE              │
├─────────────────────────────────────────────────────────────────────┤
│ CHECKPOINT ENGINE (both paths)  │  PROJECT TIMELINE (derived, read-only) │
├─────────────────────────────────────────────────────────────────────┤
│ BENCHMARK / TELEMETRY (must exercise the layer above honestly)       │
└─────────────────────────────────────────────────────────────────────┘
```

Data flows down on write, up on retrieval. The Memory Engine is the only layer every ledger writes
through — this is the load-bearing design decision (§3).

---

## 2. Layer-by-layer

### 2.1 Intent Layer

**What exists:** `Objective.request` (`src/autonomy/types.ts:183`) on the autonomy path, verbatim original
request; `activeAcceptanceCriteria` (`src/agent/agent.ts:896,1079`) on the chat path, session-scoped and
now restart-durable via `src/plans/state.ts`. **Gap:** no single intent record shared by both execution
paths; no versioning (a v1→v2 intent change has nowhere to be recorded as a change, only overwritten).

**Recommendation:** one `Intent` record per objective, written once at task start, immutable — amendments
are new versions linked by `supersedes`, mirroring the Decision Ledger's own schema (§2.4) rather than
inventing a separate versioning mechanism. Both kernels read from it; neither kernel owns a private copy.

**Control:** harness-owned on write (the verbatim request is captured mechanically, not model-summarized);
model-owned on read (the model decides what's relevant to the current turn, per the Context Retrieval
Engine, §2.5).

### 2.2 Project Constitution

**What exists:** nothing distinct — `src/memory/store.ts` treats every write identically regardless of
whether it came from a human instruction or an inferred fact (lane 11 §2.10, P4: no system found anywhere
enforces asymmetric trust for human-authored content against a contradicting inference). ShelraCode's
`AGENTS.md`/`CLAUDE.md`-equivalent files are read at session start but are not distinguished in the memory
store's own trust model from anything a `memory_write` tool call produces.

**Recommendation:** not a new storage type — per lane 11 §2.10, model as ordinary semantic memory with two
differences from every other item: `source: human` and a write-time enforcement rule (not merely a trust
score) that a `source: human` item cannot be silently overwritten by a `source: inference` item — only
superseded by another explicit human write or an explicit user confirmation. This is currently untested
anywhere in the field (lane 11 flags it as aspirational everywhere checked) — building it for real would be
a genuine, if narrow, first.

**Control:** harness-owned, fully. This is the one place the model's judgment must not be the final word —
the entire point of a constitution item is that it resists being reasoned around.

### 2.3 Objective Ledger / Task Ledger

**What exists, and it's better than the research literature found anywhere else:** `objectives`/
`objective_tasks` SQLite tables (`src/storage/migrations.ts:151-179`) on the autonomy path; on the chat
path, `src/plans/state.ts` + `src/storage/transcript.ts:287` restores plan/criteria state on every `Agent`
construction, and — uniquely, verified by an actual end-to-end test — survives both context compaction
*and* a SQLite close/reopen cycle (`src/storage/plan-state.test.ts`). Lane 11 named persistent task memory
"the clearest gap" in the entire external literature (not MemGPT, Letta, Mem0, Zep, A-MEM, or PROJECTMEM
implement it distinct from ephemeral working memory) — ShelraCode's chat path already has a working,
tested instance of exactly this.

**Gap:** it only exists on one of the two kernels. `objective_tasks` is FK'd only to autonomy objectives;
chat-mode plan steps have no SQL table of their own (recovered by replaying `tool_results`, not stored as
rows) — a real but lower-priority gap than the kernel split itself (§2.7).

**Recommendation:** don't rebuild this — port the working pattern from `src/plans/state.ts` to be the one
task-ledger implementation both kernels read and write, rather than inventing a third schema.

**Control:** harness-owned (the ledger row is written on every step transition, not on model request);
model-owned only for the *content* of a step description or blocker note.

### 2.4 Decision Ledger

**What exists:** nothing. Confirmed by the forensic audit's full-text search (`discretion|commitment|
behavioral diff|silent violation|undeclared choice` → zero files) and its gap-matrix row ("Decision memory:
No — the largest clean gap found"). This is the layer that *is* the selected thesis's artifact.

**Schema, evidence-grounded (lane 11 §3, §4; MADR 4.0.0 fetched directly):**

| Field | Source of the recommendation |
|---|---|
| `id`, `title`, `context` | MADR's context/problem field |
| `decision`, `consequences` | MADR |
| `alternatives_considered[]` | MADR's "considered options" — the field every general-purpose agent-memory system lacks |
| `rejection_reason` (per alternative) | MADR, extended — the specific field lane 11 found nowhere in MemGPT/Letta/Mem0/Zep |
| `valid_from`, `valid_until` | Zep's bitemporal event-time pair |
| `created_at`, `expired_at` | Zep's bitemporal transaction-time pair — **kept genuinely distinct** per lane 11's P1 finding (a decision can be transactionally distrusted without asserting we know when reality changed) |
| `supersedes` / `superseded_by` | MADR's literal field; Governed Shared Memory's supersession primitive |
| `source` (human / inference / oracle-derived) | Provenance model, §2.6 |
| `confidence` | SAGE / SSGM pattern |
| `evidence_ref` | Points into the Evidence Store, §2.4.1 — the field the selected thesis and lane 11 §2.8 both independently flag as unimplemented anywhere |

**Control:** the model proposes a decision record (drafts context/alternatives/rejection-reason); the
harness's write gate (§3) decides whether it's admitted, and owns the temporal fields — the model does not
get to set `valid_from`/`superseded_by` directly, only to trigger a supersession event the harness records.
This is the single most important instance of "harness > prompt" in this whole architecture: a discretion
record whose supersession the model itself could silently rewrite would defeat the entire point of the
thesis.

#### 2.4.1 Evidence Store

**What exists:** nothing — lane 11 §2.8 found no memory system anywhere (general-purpose or coding-
specific) stores a claim paired with its proof; every system stores the claim's text and, at best,
extraction provenance, never the evidentiary artifact itself. This is the same gap `08_SELECTED_THESIS.md`
already named ("evidence invalidation barely exists as a research field") — lane 11 confirms it's absent
at the memory-schema level too, independently.

**Recommendation:** a minimal record — `claim`, `evidence_type` (test run / diff hash / commit SHA / CI
run ID), `evidence_ref` (a re-fetchable pointer, not a copy), `checked_at`, `still_valid` (nullable —
unset until re-checked). The re-check is what makes this different from an ordinary memory item: a
decision's evidence should be periodically or triggerably re-validated against the pointer, not trusted
forever from the moment it was written. No source in any lane found a system that does this — building it
is genuinely novel relative to everything researched.

### 2.5 Memory Engine

**What exists:** `src/memory/store.ts` — flat files under `.shelra/memory/`, a write cap that refuses
over-limit writes rather than corrupting (`MEMORY_INDEX_MAX_BYTES=25*1024`, `MEMORY_INDEX_MAX_LINES=200`),
auto-injection for coding-classified turns only. **Gap:** no temporal fields, no provenance/trust
differentiation between a test result and an LLM-generated summary (lane 11 P3 — provenance-weighting is
only built as a security mechanism industry-wide, never as ordinary quality hygiene), no write gate beyond
the size cap (admits everything under the cap, no novelty/contradiction check).

**Recommendation:** add a deterministic pre-LLM write gate (SAGE pattern, §3), the temporal fields from
§2.4's table (applicable to every memory type, not just decisions), and a `source` field on every write
that the retrieval layer can weight by — test result and runtime observation outrank LLM-generated summary
by default, always, not only under an adversarial threat model.

### 2.6 Context Retrieval Engine

**What exists, and it's already the right architecture per lane 13:** `src/context/compiler.ts` —
deterministic disk-scan + index-file based, no embeddings anywhere in the tree. This matches the strongest
finding in lane 13 exactly: lexical/agentic retrieval wins for code, independently confirmed by production
convergence (Anthropic, Cursor) and an academic result (>90% of vector-RAG quality, no vector database).
**Do not add embeddings for code retrieval** — this would be building the thing the evidence says to avoid.

**Gap:** no retrieval path exists yet for the Decision Ledger once it's built. Lane 13's second finding
applies here: graph/temporal retrieval (Zep's pattern) wins for decision/supersession queries specifically,
on thinner evidence than the code-retrieval finding (one vendor paper, not yet reproduced) — this is why
§4 of this document's companion benchmark doc treats it as something to validate before committing, not
something to assume.

**Control:** model-owned for query formulation (what is this task actually asking); harness-owned for the
retrieval mechanism selection (lexical for code paths, graph for decision paths — a deterministic routing
rule based on what's being queried, not a model choice per query).

### 2.7 Agent Runtime — the kernel split is the architecture's biggest current liability

**What exists:** two kernels that have never referenced each other — `AgentKernel` (`src/agent/kernel.ts`,
chat path: completion gate, hooks, checkpoints, all independently verified) and `AutonomyKernel`
(`src/autonomy/kernel.ts`, `--autonomous`/Bench: well-designed `CheckSpec`/`StopReason` vocabulary, but
zero hooks, zero checkpoints, both grep-confirmed absent). The new Shelra Bench harness wires to the
weaker one.

**This is not a memory-architecture gap — it's a precondition for everything above being trustworthy.** A
Decision Ledger write-gate, a Constitution's un-overridable trust, a Task Ledger's cross-restart recovery —
none of these mean anything if half the execution paths through the product don't fire the hooks or
checkpoints that would make the guarantee real. Every ledger and every gate in this document must be
reachable from **one** kernel, not reimplemented per-kernel or silently absent from one of them.

**Recommendation, evidence-based, not invented for this document:** the forensic audit's own open question
1 names the two honest options — port the chat path's hardening into `AutonomyKernel`/`KernelDeps`, or
rebuild Bench's executor on `Agent.processMessage()`. This document takes no position on which; it only
insists the memory/continuity layers above are built against **whichever one wins**, once, not against both
speculatively.

### 2.8 Skills Runtime, Model Router — no changes recommended

Both already match what the research found to be the validated pattern: two-tier progressive disclosure
for skills (`src/utils/skills.ts`), cost/budget-aware routing (`src/models/budget.ts`,
`src/intelligence/openrouter.ts`). Lane 05/13 both treat these as COMMODITY-but-correctly-built; nothing
in this extension's research changes that assessment.

### 2.9 Execution Runtime → Verification Engine → Repair Engine

**What exists:** chat path has a real verification gate (`describeVerificationEvidence`,
`MAX_VERIFICATION_RETRIES=3`) but no first-class "repair" concept — a failed verification triggers a
nudge, not a tracked repair record. Autonomy path has its own separate, unconnected verification
implementation (`src/autonomy/acceptance.ts`) and a `repairs[]` field on `Objective` that Bench instruments
for measurement but chat mode has no equivalent of.

**Recommendation:** a repair attempt is itself an episodic-memory-worthy event and, when it changes a
prior decision's status, a Decision Ledger supersession — don't build "repair tracking" as a fourth,
separate ledger; route it through the Task Ledger (a repair is a task) and the Decision Ledger (a repair
that changes an earlier choice is a supersession) rather than inventing new storage.

### 2.10 Checkpoint Engine

**What exists:** wired on the chat path only (`src/tools/file.ts:47`, `checkpoints` table). Zero calls on
the autonomy path's file-mutation code (`src/exec/files.ts`), grep-confirmed. Same asymmetry as §2.7 — not
a separate problem, a symptom of the same one.

### 2.11 Project Timeline

**What exists:** nothing queryable — the closest analogs are `messages`/`tool_calls`/`tool_results` tables
(chat) and `src/autonomy/journal.ts`'s `events.jsonl` (autonomy), unreconciled (forensic audit,
architectural debt item 3).

**Recommendation:** don't build this as a fourth storage system. It should be a *read-only, derived view*
over the Decision Ledger + Task Ledger + Episodic memory, not its own source of truth — exactly the
distinction lane 11's bitemporal model exists to support (query "what did we believe as of date X" against
the existing timestamps, rather than maintaining a separate timeline table that can drift from the ledgers
it's supposed to summarize).

### 2.12 Benchmark / Telemetry

**What exists:** genuinely substantial (`src/bench/`, `bench/`, new SQLite `benchmark_*` tables) — but
measures the wrong kernel (§2.7) and has no scenario yet that exercises any layer in this document, because
none of these layers exist yet either. See `13_LONG_HORIZON_BENCHMARK_DESIGN.md`.

---

## 3. The one design decision everything else depends on: a single write gate

Every ledger in §2 (Constitution, Objective, Task, Decision, Evidence, ordinary Memory) is written through
**one deterministic gate**, not five separate ad hoc admission checks. This is not an aesthetic choice —
it's the direct implication of two independent findings converging:

- Lane 11 §6: the most-replicated 2026 finding (3+ independent papers) is that memory systems fail at the
  write decision, not retrieval, and the fix everywhere it's studied is a cheap deterministic-or-density
  filter that defers only ambiguous cases to an LLM.
- Lane 14: the largest security gap found industry-wide is that no major vendor ships a *mandatory*
  write-approval gate for memory writes triggered by agent-fetched content, as opposed to an explicit user
  command — meaning the same mechanism that lane 11 recommends on quality grounds is, if built as a real
  harness-enforced gate, also closing the sharpest gap lane 14 found on security grounds.

One gate, two jobs. It sits between "the model proposes a write" and "the write lands in any ledger,"
decides admit / merge / discard / escalate-to-user deterministically for the clear cases, and only invokes
the model for genuinely ambiguous ones. This is the layer where "harness > prompt" is not a principle to
aspire to — it is the entire mechanism, or the mechanism does not exist.

---

## 4. Sources of truth

| Fact type | Authoritative source | Why |
|---|---|---|
| What the code currently does | The repository itself (git) | Consistent with lane 05's own finding that Claude Code's memory docs state architecture/file paths "should be re-derived from the codebase," not remembered — re-deriving is cheaper and can't go stale |
| What was decided and why | Decision Ledger | The one thing the repository alone cannot answer — git shows *what* changed, not *why it was chosen over the alternative* |
| Whether a decision is still true | Evidence Store's `still_valid` re-check, not the Decision Ledger's own `confidence` field | A decision shouldn't grade its own staleness — lane 14 found the closest general benchmark for this (STALE) puts the best model at only 55.2% self-detection |
| What the user actually wants right now | Intent Layer, `source: human` only | Never inferred, never model-summarized without an explicit confirmation step |
| Whether a task is done | Verification Engine's deterministic `CheckSpec` result where one exists; `modelJudged` escape hatch only where no oracle exists (per `08_SELECTED_THESIS.md` design law 3: "start only where a cheap oracle already exists") | Mirrors the selected thesis's own rule, applied to verification generally, not just discretion-checking |

---

## 5. What this document does not resolve

The kernel split (§2.7) is a precondition, not a memory-architecture question, and this document
deliberately does not pick a side. Whether the Decision Ledger's retrieval should actually use graph
methods (§2.6) is an open empirical question this document defers to the benchmark in
`13_LONG_HORIZON_BENCHMARK_DESIGN.md` §1. Nothing here should be built before `10_PHASED_PLAN.md` Phase 1
resolves whether the underlying thesis is worth building for at all.
