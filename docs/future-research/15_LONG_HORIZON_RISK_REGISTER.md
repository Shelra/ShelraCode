# Long-horizon risk register

Consolidated from `research/lanes/11-15.md` and the second-wave sections of lanes `05` and `09`. Each risk
states likelihood/impact as the evidence supports them (not invented), the evidence, and the mitigation
already implied by `12_LONG_HORIZON_TARGET_ARCHITECTURE.md` / `14_LONG_HORIZON_IMPLEMENTATION_ROADMAP.md`
where one exists.

---

## R1 — The base-rate falsifier fails and none of this has a purpose

**Likelihood:** unknown — this is precisely what `10_PHASED_PLAN.md` Phase 1 exists to determine.
**Impact:** total, for everything in this extension's architecture/roadmap/benchmark docs.
**Evidence:** `08_SELECTED_THESIS.md`'s own falsifier 1: if fewer than ~5% of merged PRs silently violate a
stated commitment, the discretion-record problem is imaginary, and the Decision Ledger this extension
designs has no artifact to store.
**Mitigation:** none needed beyond what already exists — Phase 1 of `10_PHASED_PLAN.md` gates everything
here explicitly. This register exists to remind future readers of that gate, not to work around it.

---

## R2 — The supersession-retrieval gap closes before Shelra builds anything

**Likelihood:** medium — the field's absorption lag has been measured elsewhere in this mission at 19 days
to 8 months for shipped-feature copying; a *research* gap (no benchmark exists) could close faster than a
*product* gap, since it only requires someone publishing an eval, not shipping infrastructure.
**Impact:** medium — loses first-mover benchmark credit, not the underlying architecture's validity.
**Evidence:** lane 13, confirmed independently: no benchmark anywhere tests retrieval over a
supersession-shaped corpus, as of 2026-09-14.
**Mitigation:** `14_LONG_HORIZON_IMPLEMENTATION_ROADMAP.md` Phase 2 sequences this immediately after Phase
1, specifically to reduce this window.

---

## R3 — An incumbent ships the retention/staleness split first

**Likelihood:** medium-high — lane 05's second wave found the absorption lag has compressed to 19-26 days
for the two most recent examples measured in this mission (self-hosted execution environments,
cross-session agent messaging). The retention-split gap is conceptually simple once named.
**Impact:** high for differentiation, low for product validity — Shelra would still benefit from building
it even if it's no longer unique, per the same logic that "commodity" features (skills, hooks, checkpoints)
are still necessary to ship even though they don't differentiate.
**Evidence:** `11_LONG_HORIZON_MEMORY_AND_CONTINUITY.md` §9 — Cursor Projects shipped mid-research
(2026-09-10), five days before this register was written, claiming multi-month continuity.
**Mitigation:** none that changes the roadmap — this is named as a falsifier in
`11_LONG_HORIZON_MEMORY_AND_CONTINUITY.md` §11 item 2, tracked, not defended against.

---

## R4 — Task memory doesn't generalize past ShelraCode's own n=1 implementation

**Likelihood:** unknown — `src/storage/plan-state.test.ts` proves survival through compaction and a
SQLite close/reopen, but that's a structural test, not a test under realistic multi-year, multi-kernel,
adversarial-content conditions.
**Impact:** medium — would mean `12_LONG_HORIZON_TARGET_ARCHITECTURE.md` §2.3's "port the working pattern"
recommendation needs rework rather than a straightforward port.
**Evidence:** lane 11 named persistent task memory the field's clearest gap and found it nowhere else;
ShelraCode's own instance is genuinely novel and therefore genuinely untested at scale.
**Mitigation:** `13_LONG_HORIZON_BENCHMARK_DESIGN.md` Scenario 4 (cross-restart reconstruction, extended to
both kernels) is designed specifically to surface this before it's load-bearing for the Decision Ledger.

---

## R5 — Memory poisoning via persistent write (security)

**Likelihood:** demonstrated, not hypothetical. **Impact:** high — persistent memory converts a one-turn
prompt-injection bug into a standing compromise.
**Evidence:** lane 14 — OpenAI patched a ChatGPT memory-persistence exploit (2024); Google confirmed a fix
for a Gemini long-term-memory attack (2025); MemGhost (arXiv:2607.05189, July 2026) demonstrates 71-87.5%
success planting false persistent memories via a single fetched email, targeting exactly the
MEMORY.md/AGENTS.md-in-system-prompt pattern this repository uses. A live instance of the adjacent
injection class (forged harness syntax in fetched content) was caught first-hand during this very research
pass.
**Mitigation:** `14_LONG_HORIZON_IMPLEMENTATION_ROADMAP.md` Phase 6 — a mandatory, provenance-triggered
write-approval gate, explicitly named as ahead of what any production vendor currently ships.

---

## R6 — Secret retention via automatic memory write

**Likelihood:** mechanism is trivially constructible; actual production rate is undisclosed industry-wide.
**Impact:** high if it occurs (credential leaked into a durable, retrievable store), unknown frequency.
**Evidence:** lane 14 — Anthropic's own memory-tool docs state redaction is the developer's responsibility;
the platform's only built-in control is "Claude usually refuses" (soft, not enforced). No documented
in-the-wild case of a secret round-tripping specifically through a memory-write path was found by lane 14,
but the gap is structural, not merely unobserved.
**Mitigation:** not currently phased in `14_LONG_HORIZON_IMPLEMENTATION_ROADMAP.md` — flagged here as an
open item the roadmap does not yet address; a secret-detection pass at the write gate (Phase 1/6) would be
the natural place, and should be added explicitly before Phase 1 ships rather than assumed covered by the
provenance gate alone (provenance answers "who wrote this," not "does this contain a credential").

---

## R7 — The write gate's false-negative rate is worse for decision/task memory than for facts

**Likelihood:** unmeasured — this is exactly what Benchmark Scenario 2 exists to find out.
**Impact:** medium-high if unaddressed — a gate tuned on fact-like data (the only kind evaluated anywhere
in the literature) could silently over-reject or under-reject the two memory types this architecture is
built around.
**Evidence:** lane 11 §6, P2 — no source found evaluates write-gate precision on decision- or task-shaped
candidates specifically.
**Mitigation:** `13_LONG_HORIZON_BENCHMARK_DESIGN.md` Scenario 2, sequenced immediately after Phase 1 builds
the gate.

---

## R8 — Local-first economics assumption breaks at a scale not yet measured

**Likelihood:** low, per direct measurement, but the measurement has caveats worth restating as risk:
n=1 real agent (9 days of data), a synthetic benchmark corpus that under-indexes real code text by ~2×,
and consumer SSD $/GB pricing that was recorded as an unsourced assumption.
**Impact:** low — even the pessimistic reading (the synthetic corpus's 2× under-index) leaves multiple
years of headroom before any measured cliff, per lane 09's second wave.
**Evidence:** lane 09 second wave — measured, not estimated, cliffs at ~21,000-33,000 items for the two
avoidable mechanisms (naive vector scan, naive `LIKE`); a three-year distilled store is ~13MB.
**Mitigation:** none needed beyond what `12_LONG_HORIZON_TARGET_ARCHITECTURE.md` §2.6 already specifies
(no embeddings by default for code; lexical + optional reranking if the fallback embedding case is ever
built) — the risk is bounded by a design choice already made, not an open engineering problem.

---

## R9 — Kernel split makes any guarantee in this architecture false on one of the two paths

**Likelihood:** current state, not a future risk — confirmed today by the forensic audit.
**Impact:** high — every ledger and gate in `12_LONG_HORIZON_TARGET_ARCHITECTURE.md` assumes reachability
from one kernel; building against both speculatively, or against only one while Bench continues measuring
the other, would make benchmark results and product guarantees diverge.
**Evidence:** `research/lanes/15-shelracode-forensic-audit.md` — `AgentKernel` (chat) has hooks and
checkpoints; `AutonomyKernel` (autonomy/Bench) has neither, both grep-confirmed absent.
**Mitigation:** `14_LONG_HORIZON_IMPLEMENTATION_ROADMAP.md` Phase 0 (decide) and Phase 5 (execute) — this
is the roadmap's explicit precondition, not an accepted residual risk.

---

## R10 — Evidence re-check triggers are undecided and could either miss staleness or be too expensive

**Likelihood:** design-stage, not yet a live risk.
**Impact:** medium — a re-check that's too infrequent reproduces the STALE benchmark's 55.2% miss rate
finding; too frequent duplicates the cost lane 09 measured for full re-consolidation (409× multiplier when
done through a frontier model on raw content rather than distilled records).
**Evidence:** lane 14 (STALE benchmark); lane 09 second wave (consolidation cost asymmetry).
**Mitigation:** `14_LONG_HORIZON_IMPLEMENTATION_ROADMAP.md` Phase 3 names this as an open design question
rather than assuming an answer — flagged here so it isn't silently resolved by default behavior once code
is written.
