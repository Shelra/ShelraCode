# Long-horizon implementation roadmap

Phased build order for `12_LONG_HORIZON_TARGET_ARCHITECTURE.md`, organized by dependency and risk, per the
mission's own rule against arbitrary dates. Phase 0 is independent of everything else in this extension and
should happen regardless of what's decided about the memory-layer direction. Every phase from 1 onward is
gated on `10_PHASED_PLAN.md` Phase 1 (the selected thesis's own base-rate falsifier) — nothing here should
be built if that falsifier fails, because the Decision Ledger has no purpose independent of the thesis it
would store.

---

## Phase 0 — Course-correct the working tree (do this regardless of the falsifier's outcome)

**Goal:** resolve the three forensic-audit findings that are about code already in the working tree, not
about the memory-layer direction.

**Why:** `research/lanes/15-shelracode-forensic-audit.md` found (1) Shelra Bench measures the un-hardened
`AutonomyKernel`, not the hardened chat path the harness-reconstruction doc spent twenty sections building;
(2) the selected thesis has zero implementation footprint despite in-flight work inviting the reading that
it's progress toward it; (3) `src/intent/*` is confirmed dead code. None of these are new work to design —
they're decisions to make about work already committed or in progress.

**Actions:**
- Decide and document (in `docs/design/shelra-bench-architecture.md`, which currently doesn't mention
  which kernel it drives at all): either port `AgentKernel`'s hooks/checkpoints into `AutonomyKernel`, or
  rebuild Bench's executor on `Agent.processMessage()`. Either is acceptable; silence is not.
- Decide and document whether the `AcceptanceCriterion`/`CheckSpec` machinery in `src/autonomy/kernel.ts`
  is meant as infrastructure the Decision Ledger's oracle-checking would later sit on, or a separate,
  parallel concern (measurement integrity only). This determines whether Phase 1 below extends existing
  code or writes new code.
- Delete or explicitly archive `src/intent/{arms,corpus,experiment,probes,scoring}.ts` (~92KB, zero
  importers).

**Dependencies:** none. **Risk:** low — this is cleanup and a documentation decision, not new behavior.
**Tests:** none new required; existing test suite should be unaffected by the deletion (zero importers,
grep-confirmed).
**Rollback:** trivial (revert the deletion commit; the doc-tradeoff decision has no code to roll back).

---

## Phase 1 — Decision Ledger schema + write gate (gated on the base-rate falsifier)

**Goal:** the storage layer for the selected thesis's artifact — the piece `08_SELECTED_THESIS.md` and
`10_PHASED_PLAN.md` deliberately left open.

**Why:** lane 11's sharpest finding — decision memory is absent from every general-purpose agent-memory
system, present only in mature ADR practice (MADR) that hasn't merged with agent-memory research. This is
the schema in `12_LONG_HORIZON_TARGET_ARCHITECTURE.md` §2.4, built once, not iterated per-kernel.

**Dependencies:** Phase 0's kernel decision (the ledger must be reachable from whichever kernel wins, not
built against both). `10_PHASED_PLAN.md` Phase 1 passing.

**Files affected:** a new `decisions` SQLite table (`src/storage/migrations.ts`, new migration version);
a new `src/decisions/` module mirroring `src/memory/store.ts`'s structure; the write gate itself (new,
shared by every ledger per architecture doc §3 — this is the one piece of genuinely new infrastructure,
not a port of something that exists).

**Risks:** building a write gate that's too permissive reproduces Mem0's documented duplicate-risk gap
(lane 11 §6); too aggressive reproduces the unmeasured false-negative risk lane 11 P2 flags for exactly
this category. Mitigated by Phase 2 (below) validating the gate before it's load-bearing for anything else.

**Tests:** the write gate's admit/merge/discard/escalate decision must be deterministic and unit-testable
without a live model call for the clear cases (per the SAGE pattern) — only the ambiguous-case path should
require a mocked/live model in tests, mirroring how `completion-gate.test.ts` already mocks the provider
for the existing chat-path gate.

**Acceptance:** a decision can be written, superseded, and queried by supersession chain without a model
call for any of those three operations except the initial drafting of alternatives/rejection-reason.

**Rollback:** new table, new module — additive; disabling is a matter of not calling the new write path,
no migration reversal needed unless the table itself needs removing.

---

## Phase 2 — Supersession-retrieval benchmark (before further retrieval investment)

**Goal:** `13_LONG_HORIZON_BENCHMARK_DESIGN.md` Scenario 1, run against Phase 1's real Decision Ledger
once it has enough content to be non-trivial, or a synthetic ledger shaped like it if not.

**Why:** this is the single highest-leverage open experiment named across all five research lanes — it
decides whether `12_LONG_HORIZON_TARGET_ARCHITECTURE.md` §2.6's graph/temporal retrieval recommendation is
worth building or whether lexical-only (already built, §2.6's "no changes recommended" baseline) suffices.

**Dependencies:** Phase 1 (needs a real or realistic-synthetic Decision Ledger to test against).

**Risk:** low to the product (it's a measurement, not a behavior change) but high-leverage for Phase 3's
scope — a wrong call here (building graph retrieval unnecessarily, or skipping it when it was needed)
wastes the most engineering effort of any single decision in this roadmap.

**Acceptance:** a clear answer to "does lexical-only retrieval correctly resolve supersession, or does it
need graph/temporal augmentation" — either answer is a pass for this phase; the phase fails only if the
experiment can't be run cleanly (e.g., not enough real decision volume to be meaningful, in which case the
synthetic-corpus fallback from the benchmark doc applies).

---

## Phase 3 — Evidence Store

**Goal:** `12_LONG_HORIZON_TARGET_ARCHITECTURE.md` §2.4.1 — pair a decision (or any memory item) with a
re-checkable proof, not just an assertion.

**Why:** lane 11 §2.8 confirms this gap exists nowhere in the field, independently corroborating the
selected thesis's own "evidence invalidation barely exists as a research field" finding. Sequenced after
Phase 1 because evidence records are meaningless without decisions to attach them to.

**Dependencies:** Phase 1 (Decision Ledger must exist for `evidence_ref` to point at anything).

**Files affected:** new `evidence` table; a re-check mechanism (`checked_at`, `still_valid`) that can be
triggered on demand or on a schedule — this is genuinely novel infrastructure, no existing pattern in the
codebase to port.

**Risk:** medium — re-checking evidence against a live repository state (has this test's result changed,
has this commit been reverted) requires deciding what triggers a re-check (every session start? on
retrieval? on a schedule?), which is a real design question the research didn't settle (lane 14's STALE
benchmark finding — 55.2% best-model self-detection — argues for a mechanical trigger, not model
self-assessment).

**Tests:** Benchmark Scenario 6 (evidence staleness detection) is this phase's acceptance test, not a
separate unit-test suite invented after the fact.

**Rollback:** additive table; disabling means evidence_ref simply goes unpopulated, decisions still function
without it (evidence is an enrichment, not a dependency of the Decision Ledger's core operation).

---

## Phase 4 — Retention-policy split

**Goal:** `11_LONG_HORIZON_MEMORY_AND_CONTINUITY.md` §7's recommendation — separate raw-transcript
retention (cheap to discard) from derived-state retention (cheap to keep, keep it).

**Why:** the forensic audit found no retention policy exists on any store today (unbounded growth); lane
12/lane 05's second wave found Claude Code's single-knob sweep conflates the two in a way that silently
deletes plan/task state alongside transcripts — a cautionary example of what not to copy, not a model to
follow.

**Dependencies:** none technically (could run independent of Phases 1-3), but sequenced after them because
the "derived state" side of the split only matters once there's meaningful derived state (Decision Ledger,
Evidence Store) to protect — before that, it's just SQLite table pruning.

**Risk:** low. This is a policy decision plus a scheduled sweep, not new architecture.

**Tests:** Benchmark Scenario 7 (retention-split correctness) — can the system still answer "what are we
building, why, what's left" using only retained state after raw transcript expires.

**Acceptance:** raw transcript can be pruned/compressed per a configurable policy without any Decision
Ledger, Evidence Store, or Task Ledger row being affected.

**Rollback:** trivial — a sweep that isn't run yet has changed nothing; once run, rollback means restoring
from the backup the sweep should take before deleting (a policy detail to specify at build time, not
deferred).

---

## Phase 5 — Kernel reconciliation (may move earlier depending on Phase 0's decision)

**Goal:** resolve the two-kernel split for real, per whichever option Phase 0 committed to.

**Why:** every phase above assumes "the one kernel both ledgers are reachable from" — if Phase 0 punted on
choosing (documented the tradeoff but didn't resolve it), this phase is where it actually gets resolved,
and it should happen before Phase 1's write gate needs to be called from two different code paths with two
different behaviors.

**Note on sequencing:** this phase is listed 5th only because it may already be resolved by Phase 0's
decision. If Phase 0 explicitly defers the kernel question, this phase must move before Phase 1, not after
— the roadmap's ordering assumes Phase 0 actually decides, not merely documents.

---

## Phase 6 — Mandatory write-approval gate (security hardening)

**Goal:** close the largest gap lane 14 found industry-wide — no major vendor ships a mandatory (not
advisory) approval gate for memory writes triggered by agent-fetched content, as distinct from an explicit
user command.

**Why:** this is the same write gate from Phase 1, extended with a provenance check: does this candidate
memory/decision trace back to agent-fetched web/MCP content rather than a user instruction or a
deterministic tool result? If so, require explicit confirmation before admission, regardless of how
confident the gate's novelty/contradiction check is.

**Dependencies:** Phase 1's write gate must exist first — this phase adds a provenance-triggered branch to
it, not a new mechanism.

**Risk:** medium — over-triggering the approval requirement defeats the point of automatic memory (every
write needs a human); under-triggering leaves the gap open. No existing benchmark measures this tradeoff
(lane 14 found the concept only in a hobbyist PR thread, no production numbers to calibrate against) — this
is genuinely first-of-its-kind if built, which is exactly why it's sequenced last: it's the highest-payoff,
least-validated piece.

**Tests:** MemGhost-style injected-content scenarios (lane 14 cites a 71-87.5% success rate against
systems without this gate) — a regression suite that attempts exactly this class of attack and confirms
the gate catches it.

---

## What's deliberately not phased

The Project Timeline (architecture doc §2.11) and Agent Memory scoping (§2.6 forensic finding — doc-claimed
unused, not independently re-verified) are not given phases here because they're derived views or
already-built-but-unverified, respectively — neither requires new storage or a gated rollout, just a
targeted follow-up check (Timeline: build as a query, not a phase; Agent Memory: grep for
`agentMemoryScope`/`MemoryScope` usage in `runTask`/`runDelegation`, per the forensic audit's own open
question 5).
