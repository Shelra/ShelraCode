# Long-horizon benchmark design

What to measure before building further on `12_LONG_HORIZON_TARGET_ARCHITECTURE.md`, and what to measure
once pieces of it exist. Grounded in gaps the research actually found — not the brief's scenario list
applied mechanically. Every scenario below states the specific evidence gap it closes and the existing
benchmark/methodology it borrows from, per the mission's own rule against inventing metrics unnecessarily.

None of this substitutes for `10_PHASED_PLAN.md` Phase 1 (the base-rate falsifier). Scenario 1 is the
cheapest, highest-leverage thing to build *if* Phase 1 passes and work continues into the memory layer.

---

## 0. Why not just adopt an existing benchmark

Lane 05 catalogued the current frontier: SWE-bench Verified (retired by its own author, contaminated),
SWE-bench Pro, Terminal-Bench 4.0, SWE-Cycle, SWE-EVO, ChainSWE. All of them measure single-session or
short-chain task completion. **None tests memory, decision retrieval, or continuity across a gap of time**
— the exact thing this extension researched. ChainSWE is the closest relative (chained, dependent bugs;
48% of downstream failures traced to the agent's own accumulated state, under-edits outnumbering over-edits
nine-to-one) and its methodology — chronologically ordered tasks mined from real project history — is the
right pattern to borrow, not a benchmark to adopt wholesale, because it still doesn't test supersession.

---

## 1. Supersession-aware retrieval (build first)

**Gap closed:** lane 13, confirmed independently: no benchmark anywhere — RAG, agent-memory, or coding —
tests retrieval over a corpus whose defining feature is that a current fact supersedes a similar-looking
past one. This is not a generic RAG limitation; it is the exact shape of corpus a Decision Ledger produces,
and it was named the single most decision-relevant open experiment across all five lanes (lane 11 open
question 3, lane 13's own top open question).

**Design:** construct a decision ledger, real or synthetic, with N decisions where M were later superseded
by a newer decision using deliberately similar language (e.g., "use SQLite for the objective store" →
later superseded by "use SQLite with WAL mode and X constraint for the objective store"). For a held-out
set of queries that should retrieve the *current* decision, measure:

- **Correct-current-retrieval rate** — did the top result name the live decision, not a superseded one?
- **Superseded-decision leakage** — how often does a superseded decision appear in the top-k at all?
- **By retrieval method** — lexical-only, graph/temporal (Zep-style), embedding-only, hybrid — per lane
  13's finding that no method is universally best; this benchmark is what would settle which one Shelra
  should actually build for this specific corpus shape rather than assuming.

**Falsifier for §2.6 of the architecture doc:** if plain lexical search already resolves supersession
correctly (e.g., because "current" decisions are trivially the most recent by timestamp and recency alone
suffices), the graph/temporal retrieval recommendation is unneeded complexity — this benchmark is designed
to find that out cheaply before building it.

---

## 2. Write-gate precision on decision- and task-shaped candidates

**Gap closed:** lane 11 §6, P2 — every write-gate result found (SAGE's 2.5–3.4× cost reduction, PROJECTMEM's
deterministic precheck, ConsistencyGate) was evaluated on fact-like or failure-like memory, where novelty/
contradiction is a well-posed question against an embedding space or event log. None was evaluated against
decision or task-state candidates, which don't naturally embed as single facts.

**Design:** feed the write gate a stream of candidate writes mixing ordinary facts, decision proposals, and
task-state updates (labeled ground truth: novel / duplicate / contradictory / ambiguous). Measure precision
and recall **per category**, not pooled — the concern is specifically that a gate tuned on fact-like data
silently underperforms on the two categories this architecture depends on most.

**What "good" looks like:** no established baseline exists (this is genuinely unmeasured territory per
lane 11) — the first useful result is simply *the number*, not beating a prior state of the art.

---

## 3. Kernel parity (ShelraCode-specific, cheapest to build, most urgent)

**Gap closed:** the forensic audit's contradiction 5.1 — Shelra Bench currently measures `AutonomyKernel`
(no hooks, no checkpoints) while the hardening documented in `docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md`
lives entirely in `AgentKernel` (the chat path). Nobody has quantified the actual completion-quality delta
between the two kernels — the forensic audit found the *structural* gap (hooks/checkpoints absent) but not
its *behavioral* consequence.

**Design:** run an identical task set through both kernels (holding model, prompt, and task fixed) and
measure completion-gate pass rate, retry count, and — the ChainSWE-relevant metric — failure rate on
*chained* tasks where task N depends on state task N-1 left behind. This directly tests whether the
checkpoint/hook gap (§2.7, §2.10 of the architecture doc) produces a measurable reliability difference, or
is a structural gap without a behavioral one (which would deprioritize reconciling the kernels).

**Precondition:** none — buildable today, independent of whether the memory-layer work proceeds, because
it tests infrastructure that already exists on both sides.

---

## 4. Cross-restart task reconstruction, extended to both kernels

**Gap closed:** `src/storage/plan-state.test.ts` already proves the chat path survives a SQLite close/
reopen — but as a structural test (do the rows survive), not an outcome test (does the *agent's subsequent
behavior* correctly use the restored state), and it doesn't exist for the autonomy path at all.

**Design:** start a multi-step task, kill the process mid-task, restart, and score whether the agent (a)
correctly identifies what was already done vs. still pending, (b) does not repeat completed work, (c) does
not silently drop an acceptance criterion that was active before the restart. Run on both kernels once §3
exists, to get the parity number for this specific failure mode rather than the aggregate one.

---

## 5. Decision drift under a live objective

**Gap closed:** mirrors the general pattern the original 50-section brief called "Scenario B" (a decision
superseded partway through a run; later tasks must honor the new one). Directly testable once the Decision
Ledger (§2.4 of the architecture doc) exists; not testable before.

**Design:** seed a decision, run several tasks that should respect it, supersede it mid-sequence, then run
further tasks. Score whether post-supersession tasks correctly retrieve and honor the *new* decision (this
is the applied version of Benchmark 1, on a live task stream instead of a static retrieval query set) and
— the harder, more interesting case — whether a task's own generated artifact (code, a memory write) ever
silently reasserts the superseded decision's content without being asked to reconsider it.

---

## 6. Evidence staleness detection

**Gap closed:** lane 14 found the closest general-purpose proxy (the STALE benchmark) puts the best model
at only 55.2% detection of invalidated beliefs — no security- or decision-specific staleness benchmark
exists. This is the applied test of the Evidence Store's `still_valid` re-check (architecture doc §2.4.1).

**Design:** seed decisions with evidence pointers (a test result, a commit SHA) where the underlying code
has since changed in a way that would invalidate the evidence (the test now fails, the commit was
reverted). Measure whether the system flags the decision as stale on its own, without being asked, versus
only when directly queried — the harder and more useful bar, since undetected staleness is the actual
failure mode this benchmark exists to catch.

---

## 7. Retention-split correctness

**Gap closed:** validates the `11_LONG_HORIZON_MEMORY_AND_CONTINUITY.md` §7 recommendation (prune/compress
raw transcript aggressively; keep distilled structured state) actually preserves what it claims to.

**Design:** run a task sequence, expire the raw transcript per whatever retention policy is chosen, then
test whether the system can still correctly answer the same "what are we building, why, what's left, what
was decided and why" questions the mission's own restart test (`00_RESEARCH_BRIEF` §49, informally: the
January-through-December startup scenario) demands — using only the retained distilled state. A failure
here means the retention split was cut in the wrong place.

---

## 8. What this benchmark suite deliberately does not include

No LLM-judge rubric scoring anywhere in scenarios 1-7 where a deterministic check is possible (supersession
retrieval, kernel parity, and reconstruction are all mechanically scoreable) — consistent with lane 05's
own finding that LLM-authored acceptance sets admit only 19-42% of correct solutions, and the selected
thesis's design law 3 ("start only where a cheap oracle already exists"). Where a scenario genuinely needs
judgment (decision drift's "did the artifact silently reassert a superseded decision" check), that should
route through the same `modelJudged` escape hatch already defined in `src/autonomy/types.ts:89` — not a new
scoring mechanism invented for this benchmark suite.
