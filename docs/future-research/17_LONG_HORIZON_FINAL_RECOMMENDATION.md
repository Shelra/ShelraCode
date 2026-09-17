# Long-horizon extension — final recommendation

Direct answers, in the format this extension was asked to close with. Evidence for every claim below is in
`11_LONG_HORIZON_MEMORY_AND_CONTINUITY.md` through `16_LONG_HORIZON_SOURCES.md` and the underlying
`research/lanes/11-15.md`; this document doesn't re-argue, only states the conclusions plainly.

---

## Should ShelraCode make long-horizon project continuity a core product pillar?

**Not as an independent pillar. Yes, as the storage layer the already-selected thesis needs, and only if
that thesis survives its own falsifier.**

Not a plain yes: "memory" as a general capability is commoditizing faster than the original mission
measured six days earlier — procedural/auto memory was already COMMODITY on 2026-09-08; by 2026-09-14
Cursor Projects had shipped multi-month continuity and a 94k-star open-source tool was already logging
typed decision observations. A pillar built on "we remember your project" would be racing incumbents on
their own ground, in a category with 19-day to 8-month absorption lag measured elsewhere in this mission.

Not a plain no either: the memory-systems research, approached from a direction the original mission never
touched, independently rediscovers the exact object `08_SELECTED_THESIS.md` already selected — a decision/
discretion ledger with alternatives, rejection reasons, and supersession, paired with evidence that can go
stale and be re-checked. Nobody in the field builds this. That's not a memory feature; it's the thesis's
missing half.

---

## Why?

Because the two questions collapse into one once the evidence is in front of you. "Should we build memory"
is the wrong question — the field already answered it (yes, and it's commodity). "Should we build the
specific memory that a discretion ledger requires" is a question nobody else is even asking, confirmed by:
decision memory absent from MemGPT/Letta/Mem0/Zep despite 15-year-old standardized ADR practice (MADR)
existing to borrow from; evidence memory (claim + re-checkable proof) not found implemented anywhere,
general-purpose or coding-specific; and no benchmark anywhere testing retrieval over a corpus whose
defining feature is supersession — which is exactly the corpus shape this ledger would produce.

---

## What is the strongest differentiator?

**The write gate, built as one mechanism serving two jobs nobody else has combined.** The most-replicated
2026 finding in agent-memory research (3+ independent papers) is that memory systems fail at the write
decision, not retrieval — a cheap deterministic filter should decide admission, deferring only ambiguous
cases to a model. Separately, the largest security gap found industry-wide is that no vendor ships a
*mandatory* approval gate for memory writes triggered by agent-fetched content. These are the same
mechanism, built once: a harness-owned write gate that is simultaneously a quality control and the
industry's first real defense against exactly the injection-persistence attack class a live subagent in
this research caught in the act, mid-fetch, during its own work.

Second: supersession-aware retrieval, once benchmarked and built, would be a capability with literally no
published comparison to lose to — the gap isn't "we do it better," it's "nobody has measured whether their
approach does it at all."

---

## What should we stop building?

- **Chasing "memory" as a generic, undifferentiated feature** — three-tier storage, semantic-fact
  extraction, basic write-time dedup are all COMMODITY now; building them as differentiation is building
  what the field already agreed to hold constant, the same trap lane 05's original report found for agent
  harnesses generally.
- **Letting Shelra Bench measure `AutonomyKernel`** without an explicit decision about whether that's
  intentional — right now it silently measures the un-hardened path while the hardened one goes untested,
  and nobody has said whether that's a scoping choice or an oversight.
- **Carrying `src/intent/*`** as apparent research-readiness when it's confirmed dead code (zero importers,
  ~92KB) left over from the pre-empted experiment.
- **Building embedding-based retrieval for code** — the evidence (production convergence across at least
  two major vendors plus an independent academic result) says this is actively the wrong choice, not
  merely an unnecessary one. ShelraCode's existing `src/context/compiler.ts` already made the right call
  here; don't undo it.

---

## What should we build first?

**Immediately, independent of the falsifier (Phase 0 in `14_LONG_HORIZON_IMPLEMENTATION_ROADMAP.md`):**
decide and document the kernel tradeoff Shelra Bench currently hides; decide whether the acceptance/
`CheckSpec` machinery is meant as the thesis's future oracle infrastructure or a separate concern; delete
or archive `src/intent/*`. None of this requires the falsifier to resolve first — it's about code already
in the working tree, not new direction.

**If and only if `10_PHASED_PLAN.md` Phase 1 passes:** the Decision Ledger schema plus its write gate
(Phase 1 of `14_LONG_HORIZON_IMPLEMENTATION_ROADMAP.md`), immediately followed by the supersession-
retrieval benchmark (Phase 2) before any further retrieval engineering — build the thing, then find out in
the cheapest possible way whether the harder retrieval mechanism (graph/temporal) was ever necessary.

---

## What must be proven by benchmark before we invest further?

1. **The base-rate falsifier itself** — unchanged, still gates everything, still the cheapest and most
   decisive test in the whole mission (`08_SELECTED_THESIS.md`: under ~5% silent commitment violations in
   real merged PRs, the thesis is dead, and so is everything in this extension built on top of it).
2. **Supersession-aware retrieval** (`13_LONG_HORIZON_BENCHMARK_DESIGN.md` Scenario 1) — does lexical
   search alone resolve "which decision is current" correctly, or is the more expensive graph/temporal
   mechanism actually earning its complexity? This is the single most consequential open question raised
   across all five new lanes, and the cheapest one left to close.
3. **Kernel parity** (`13_LONG_HORIZON_BENCHMARK_DESIGN.md` Scenario 3) — does the hooks/checkpoints gap
   between `AgentKernel` and `AutonomyKernel` produce a measurable reliability difference, or is it a
   structural gap without a behavioral consequence? This determines how urgently Phase 5 (kernel
   reconciliation) needs to move ahead of the memory-layer work rather than run alongside it.

Nothing past these three should consume further engineering time in this direction until each has an
answer.
