# Long-horizon memory and continuity

Extension research, run 2026-09-14/15, additive to the September 2026 mission. It does **not** reopen
the selected thesis (`08_SELECTED_THESIS.md`, "the record of machine discretion as executable checks").
It asks a different question the original mission didn't: *can a coding agent preserve a project's
intent, decisions and state across months or years without re-explaining itself, and does that survive
being audited against the current codebase?* Evidence lives in `research/lanes/11-15.md` and second-wave
sections appended to `research/lanes/05-commodity-map.md` and `research/lanes/09-economics.md`.

Five external research lanes (memory taxonomy, durable harness mechanics, context retrieval, memory
security, plus deepened competitive and economics passes) and one internal forensic audit of ShelraCode
itself.

---

## 1. Executive summary

1. **The memory-systems literature independently re-derives the selected thesis's gaps.** Nobody outside
   this mission connects agent-memory research to ADR practice; decision memory (choice, alternatives,
   rejection reason, supersession) is absent from every general-purpose memory system found, and evidence
   memory (a claim stored with its proof, re-verifiable rather than merely re-assertable) was not found
   implemented anywhere. Both land on exactly the object `08_SELECTED_THESIS.md` already named. This is
   convergence from a fifth, unrelated angle, not new information that changes the thesis.
2. **"A memory feature" is now firmly off the differentiation list, more firmly than the original mission
   found.** Procedural/auto memory was already COMMODITY as of 2026-09-08 (lane 05). The second wave found
   the field moved further in six days: Cursor Projects shipped 2026-09-10 claiming multi-month
   continuity; a 94k-star Apache-2.0 tool (`claude-mem`) already logs a typed `decision` observation.
   Cross-session *project* state moved from "nobody" to "contested — no longer empty."
3. **What remains genuinely unserved is narrower than "memory": a retention policy that doesn't conflate
   derived state with raw transcript, and staleness invalidation driven by repository evidence instead of
   a clock.** Claude Code's own docs (lane 12) show a default 30-day sweep that deletes plan/task files
   alongside raw transcripts, keeping only CLAUDE.md and auto memory. Nobody splits "what we decided" from
   "what was said." Nobody invalidates a memory against a git diff or a test run.
4. **ShelraCode's own forensic audit is the most consequential finding in this batch.** The chat execution
   path (`src/agent/agent.ts`) already has a real completion gate, checkpoints, and cross-restart plan
   persistence that is genuinely end-to-end tested (SQLite close/reopen, live compaction) — ahead of what
   the research literature says is "the clearest gap" (task memory, lane 11 §2.5). But the selected thesis
   itself has **zero implementation footprint anywhere in the codebase** (a full-text search for
   discretion/commitment/behavioral-diff/silent-violation/undeclared-choice across `src/` returns nothing),
   and the new, uncommitted benchmark harness (`src/bench/`) measures task completion through the weaker,
   unhardened `AutonomyKernel` path — not the hardened path the harness-reconstruction doc spent twenty
   sections building. This needs attention before more benchmark work is built on top of it.
5. **Local-first long-horizon memory is economically fine; the one real cliff is dense-vector retrieval,
   and it's avoidable.** Measured (not estimated) on real hardware: a SQLite-backed store stays under
   60 MB RSS and sub-millisecond writes at 1M items; a ten-year distilled memory store for a single project
   is ~14 MB. The only mechanisms that cross the 8 GB/local-hardware budget at that scale are brute-force
   vector scans and naive `LIKE` search — both structurally avoidable (lexical index + optional reranking).
   Storage was never the constrained resource; the assembled context pack's token cost is (~$1,000/yr at
   frontier prices vs ~$0.0004/yr of disk for the same items).
6. **No published benchmark tests retrieval, memory, or verification over a corpus whose defining feature
   is supersession** — multiple past decisions, one current one, and the requirement to retrieve the right
   one. Lane 13 confirmed this is absent from the RAG/agent-memory literature; it is also, not
   coincidentally, exactly the shape of corpus the selected thesis's own artifact would produce. This is
   the cleanest available benchmark target if this direction is pursued further.

---

## 2. Relationship to the selected thesis

The four lanes that converged on machine discretion in September did so from requirements engineering,
future-SE trajectory, IR theory, and market gaps. This extension approaches the same territory from
agent-memory systems research and finds the identical hole from a fifth direction:

- Lane 11 (memory taxonomy): "the agent-memory research community and the decision-record practice
  community have not merged, despite solving adjacent problems" — MADR (a 15-year-old, standardized ADR
  format with a literal `superseded by` field) has essentially no representation in MemGPT, Letta, Mem0,
  or Zep's schemas.
- Lane 11 again: evidence memory (claim + proof) is unimplemented anywhere found, which the report states
  explicitly connects to — not duplicates — the selected thesis's own "evidence invalidation barely exists
  as a research field" finding (`08_SELECTED_THESIS.md`, problem statement).
- Lane 15 (forensic audit): the codebase's actual gap matrix names "Decision memory: No — the largest
  clean gap found relative to the mission's own audit template," and its own open question asks directly
  "does this map onto the selected thesis's own artifact... rather than being pursued as a separate
  feature?"

**Read together: a decision/discretion ledger is not a competing idea to the selected thesis — it is the
selected thesis's storage layer, described independently by researchers who never saw it.** This extension
does not change what Shelra should build. It supplies a concrete, evidence-backed answer to *how to store
and retrieve it durably* — the part `08_SELECTED_THESIS.md` and `10_PHASED_PLAN.md` deliberately left open.

---

## 3. ShelraCode today — the forensic audit (act on this first)

Full detail and file:line citations: `research/lanes/15-shelracode-forensic-audit.md`. Audited against
the working tree as of 2026-09-15 (HEAD `af7e7bd` plus uncommitted changes), not documentation.

**What's real and better than expected**, independently verified (not doc-claimed):

- `AgentKernel` completion gate blocks/nudges before "done," on every turn, with a real retry cap
  (`src/agent/agent.ts:155,2670-2680`), proven by a test that drives a real turn through a mocked provider.
- Plan/acceptance-criteria state survives both compaction *and* a SQLite close/reopen cycle — a genuine
  end-to-end test, not a unit test (`src/storage/plan-state.test.ts`, untracked). This is a working
  instance of lane 11's "clearest gap" (task memory) that the general research literature could not find
  anywhere else.
- Checkpoints with revert exist and are wired on the chat path (`src/tools/file.ts:47`,
  `checkpoints` table).
- A memory write cap that refuses over-limit writes rather than silently truncating or corrupting
  (`src/memory/store.ts:26-27,183-190`) — a harness-enforced boundary, exactly the "harness > prompt"
  pattern lane 12 found Anthropic itself documents (settings-file rules "enforced by the client regardless
  of what Claude decides to do").

**What needs attention before more work is built on top of it:**

1. **The new benchmark harness measures the wrong kernel.** `src/bench/shelra-executor.ts` drives every
   task through `runObjective()` — the older `AutonomyKernel` path, which fires zero hooks and has zero
   checkpoint calls (both grep-confirmed absent) — not the hardened `Agent.processMessage()` path item 1-3
   above describe. Any score Shelra Bench produces right now describes the un-hardened path. Neither
   `docs/design/shelra-bench-architecture.md` nor any other doc states this tradeoff explicitly.
2. **The selected thesis has zero implementation footprint**, committed or uncommitted, despite the
   in-flight `src/plans/`, `src/bench/`, `src/autonomy/acceptance.ts` work inviting the reading that it's
   progress toward it. `src/bench/scoring.ts`'s intent score is ordinary stated-criteria pass-rate — ​a
   different, legitimate goal (measurement integrity) from the thesis's goal (surfacing undeclared
   choices). If the acceptance/`CheckSpec` machinery is meant as infrastructure the thesis product would
   later sit on (using benchmark-owned oracles as the thesis's own "start only where a cheap oracle
   exists" precondition), nothing in the working tree says so.
3. **`src/intent/*` (~92KB, 5 files) is confirmed dead code** — zero importers anywhere in `src/`. This is
   the pre-empted experiment `shelra-future-research-mission.md` already flagged; it should be deleted or
   explicitly archived rather than left to silently inflate the codebase's apparent research-readiness.
4. **No retention policy exists on any store.** Every SQLite table and every `.shelra/memory/` file
   accumulates forever — the mirror-image risk of Claude Code's documented 30-day sweep (lane 12), and
   neither is a chosen policy. §7 below gives a specific, evidence-based recommendation for what the
   policy should actually be (not "copy Claude Code's sweep" — see why in §7).
5. **Two unconnected kernels, and a third consumer that picked the weaker one.** `AgentKernel` (chat) and
   `AutonomyKernel` (`--autonomous`, now also Bench) have never referenced each other. This predates this
   extension's research but the new Bench work makes the split load-bearing for the first time — a
   benchmark result is now a claim about the product's real behavior only if it runs the hardened path.

None of this blocks the mission's phased plan (`10_PHASED_PLAN.md` still gates on the base-rate falsifier).
It is a course-correction for work already in the working tree, independent of whether the long-horizon
memory direction below is pursued further.

---

## 4. Target memory taxonomy

Full evidence: `research/lanes/11-memory-taxonomy.md`. Evaluated against ten candidate categories from
research and shipping systems, not designed from first principles.

| Category | Verdict | Evidence |
|---|---|---|
| Semantic (durable facts) | Validated, foundational | Universal across MemGPT/Letta/Mem0/Zep/A-MEM |
| Episodic (what happened) | Validated; unit-of-storage is a real open design choice | Zep/PROJECTMEM store raw events; Generative Agents consolidates in-stream |
| Procedural / skills | Validated as category, immature as evaluated | `SKILL.md` is COMMODITY (lane 05); governance/lifecycle is not — ShelraCode's `src/utils/skills.ts` already does two-tier progressive disclosure |
| Agent memory (isolated/shared) | Validated, nascent | Governed Shared Memory's 4-level scope hierarchy; ShelraCode's per-agent scope exists but doc-claimed unused, not independently re-verified this pass |
| Failure memory | Validated, active 2026 cluster | 5 independent papers converge within months; PROJECTMEM's deterministic pre-action gate is the strongest single implementation found |
| **Decision memory** (ADR-style) | **Absent from agent-memory research; mature elsewhere (MADR)** | The sharpest gap in lane 11 — see §2 above |
| **Task memory** (objective/plan/blockers, durable) | **Absent everywhere researched** — except ShelraCode's own chat path (§3) | Not MemGPT, Letta, Mem0, Zep, A-MEM, or PROJECTMEM implement it distinct from ephemeral working memory |
| **Evidence memory** (claim + proof) | **Not found implemented anywhere** | Same field the selected thesis already flagged as barely-researched, confirmed absent at schema level too |
| User preference vs project requirement | Not distinguished anywhere in a published schema | Only one shipping system (cited by lane 05, mechanics out of scope for lane 11) even splits the note types |
| Project constitution | Not a distinct category — folds into semantic memory + provenance | Best modeled as semantic memory with human-authored source class and (aspirationally) un-overridable trust — no system found actually enforces that asymmetry |

**Temporal fields, evidence-ranked** (full table `research/lanes/11-memory-taxonomy.md` §3): `created_at`,
`valid_from`/`valid_until` (event-time — when a fact was/stopped being true), `expired_at` (transactional
time — when the *system* stopped trusting it, a **distinct field nobody actually uses distinctly**, per
lane 11's sharpest unaddressed finding, P1), `supersedes`/`superseded_by` (MADR's literal field, and
Governed Shared Memory's supersession primitive), `confidence`, `scope`/`owner`. Zep is the existence
proof that full bitemporal modeling is not academic overhead: it carries all four timestamps and posts the
best accuracy *and* latency numbers of any system in the lane.

**The write gate matters more than retrieval.** The single most-replicated 2026 finding (3+ independent,
mutually-uncited papers) is that memory systems fail at the write decision, not retrieval: over-admission
degrades recall, under-gating admits contamination, and a cheap deterministic-or-density novelty filter
(SAGE) recovers 2.5–3.4× cost with minimal quality loss by deferring only ambiguous cases to an LLM. This
is the same "harness > prompt" principle already validated in §3 and §6 — the decision of what becomes
permanent memory belongs to deterministic code, not the model's own judgment that something is "worth
remembering."

---

## 5. Retrieval: lexical for code, graph/temporal for decisions, no embeddings by default

Full evidence: `research/lanes/13-context-retrieval.md`. The evidence does not favor one retrieval method
universally — it splits cleanly by corpus shape:

- **Code retrieval: lexical/agentic search wins, confirmed independently of production convergence.**
  Anthropic, Cursor, and (per lane 05) several others deprecated or never built embedding-based codebase
  indexing, citing operational reasons (staleness, security, reliability) — not quality. An independent
  academic result (Amazon Science, AAAI 2026) corroborates the quality side directly: agentic keyword
  search reaches >90% of vector-RAG performance with no vector database. ShelraCode's own
  `src/context/compiler.ts` is already deterministic disk-scan + index-file based, with no embeddings
  anywhere in the tree (confirmed by the forensic audit) — this is the validated choice, not a gap.
- **Decision/supersession retrieval: graph/temporal wins, on thinner evidence.** Zep's temporal knowledge
  graph beats both full-context stuffing and MemGPT on accuracy *and* cost/latency simultaneously — but
  only demonstrated for conversational memory, one vendor-authored paper, not yet reproduced or tested on
  a decision-ledger-shaped corpus.
- **Semantic/embedding search is a fallback, not a default** — for fuzzy conceptual queries neither
  lexical nor graph retrieval resolves. Demoting it to fallback status is consistent with both the
  competitive evidence and lane 09's economics (§7): it's also the only mechanism in the whole stack that
  produces a real hardware cliff.
- **Progressive disclosure is the validated pattern for injecting the minimum sufficient context.**
  Anthropic's Agent Skills (metadata always loaded, ~100 tokens; full body only on trigger, capped) is a
  concrete, dated, production example lane 13 verified directly rather than assumed from lane 05's report.

**The open gap that matters most for this project specifically:** no benchmark anywhere tests retrieval
over a corpus whose defining feature is supersession. This is not a general RAG limitation being
rediscovered — it is the exact shape of the corpus a discretion/decision ledger produces, and nobody has
built the eval for it.

---

## 6. Durable harness: what survives a restart, and who's allowed to say "done"

Full evidence: `research/lanes/12-durable-harness.md`. Claude Code is the best-documented production case
study, verified from primary docs, not memory.

**The harness-enforced / model-requested line, drawn explicitly by the vendor itself:**

| Enforced by runtime (harness-owned) | Requested of the model (model-owned) |
|---|---|
| `permissions.deny` rules ("enforced by the client regardless of what Claude decides") | CLAUDE.md / auto memory content ("context, not enforced configuration") |
| `PreToolUse` hook exit-code-2 blocking | The auto-mode classifier's own safety boundary — re-derived from the transcript on each check, and **losable to the exact compaction event a long unattended run is most likely to trigger** |
| Compaction *timing* (hardcoded threshold, e.g. OpenCode) | Compaction *content* (an LLM summary, exactly as reliable as any other LLM output) |

**The restart test, answered concretely for Claude Code:** a user returning after six months gets
CLAUDE.md and auto memory intact (auto memory is explicitly exempted from the retention sweep) — but only
on the same machine, since it's documented as machine-local and never synced. Everything session-shaped —
`/resume`, `/rewind` checkpoints, active `/goal`, scheduled tasks, **and task/todo state** — falls under
the same default ~30-day sweep and is gone. Lane 05's second wave sharpened this further: the sweep
deletes `plans/` ("Plan files written during plan mode") and `tasks/` ("Task lists written by the task
tools") by name, on the same clock as raw transcripts, while `history.jsonl` (every prompt typed) is kept
indefinitely. **The product preserves who you are and what you asked, and discards what it was doing** —
a deliberate design bet, not an oversight (Anthropic's own memory docs state architecture, file paths and
debugging fixes are expected to be re-derived from the codebase and git history, not remembered).

**No coding-agent harness with public docs implements durable execution in the distributed-systems
sense** — deterministic event-log replay with the LLM call excluded from the replayed path (the pattern
Temporal uses). Every harness examined puts the LLM call inside the "workflow" itself, which is
structurally why none of them replay; they summarize instead. One 2026 research system (AgentRewind) that
implements real checkpoint+rewind measures +25.6pp task success over plain-continue on an 82-task
benchmark — a cost of default lossy compaction that no shipping vendor measures for its own product.

**ShelraCode's own chat path is, on this specific axis, ahead of what the research found elsewhere**: its
plan/criteria persistence is proven to survive both compaction and a real SQLite close/reopen (§3) — closer
to genuine state durability than Claude Code's documented behavior, which explicitly does not attempt this
for task state. The gap is that this only exists on one of Shelra's two execution kernels (§3, item 5).

---

## 7. Economics: local-first is fine; the vector-search cliff is the only thing to avoid

Full evidence and raw measurements: second-wave section of `research/lanes/09-economics.md`. Measured, not
estimated, on real hardware (Ryzen 5 4600H, 31.4 GB RAM, NVMe) plus a real 9-day-old running agent's own
SQLite store (160 sessions, 864 messages).

**The cost cliff is not storage.** SQLite holds 1M items in 58 MB resident memory with 0.8–2.8 ms writes,
flat regardless of scale. It is dense-vector retrieval: a disk-streamed brute-force scan degrades starting
around 21,000 items on the target 8 GB / 1 GB-budget hardware profile. Naive `LIKE` search is next
(~33,000 items). Every other mechanism measured — FTS5 lexical search, disk footprint, context-pack
assembly — has headroom to 350,000–200,000,000 items.

**Projected against this project's own measured accumulation rate (~3,500 distilled items/year):** a
ten-year store crosses only the two avoidable mechanisms (naive vector scan, naive `LIKE`) — both fixed at
zero marginal cost by using the lexical index that's already the right retrieval choice per §5, or a cheap
binary-quantization/rerank step if embeddings are ever added for the fallback case. A three-year distilled
store is ~13 MB, answered in under a millisecond.

**Consolidation cost depends entirely on what gets consolidated.** Distilling raw transcript into records
measured at 0.18% of token spend in the real agent's own history, with 130 of 157 maintenance calls
already running on a free/local model at $0. But the *choice* of consolidating raw transcript through a
frontier model, rather than distilled records through a cheap one, is a 409× cost multiplier (measured
against Anthropic's own documented compaction billing) — the same distinction §3's retention
recommendation turns on.

**Direct implication for the retention-policy gap named in §3 and §6:** don't copy Claude Code's single
`cleanupPeriodDays` knob, which conflates privacy-motivated transcript deletion with the very different
question of whether derived project state (decisions, task status) should persist. The measured economics
say the split costs almost nothing to implement and almost nothing to run: raw transcript can be pruned or
compressed aggressively (its dollar cost, not its byte cost, is what's high — the ~$1,000/yr context-pack
assembly number is diluted, not saved, by keeping it around), while distilled structured state (decisions,
task ledger rows, evidence records) is cheap enough at any realistic multi-year scale to simply keep,
governed by the supersession model in §4 rather than a clock.

**Embedding cost, if the fallback case in §5 is ever built, is not a constraint**: 1M items of embeddings
costs $0–$4 depending on provider tier. The real cost there is re-index time when the embedding model
changes (hours locally), not the embeddings themselves.

---

## 8. Security: the write gate is also the security boundary

Full evidence: `research/lanes/14-memory-security.md`. Persistent memory converts a one-turn
prompt-injection bug into a standing compromise — demonstrated, not hypothetical: OpenAI patched a
ChatGPT memory-persistence exploit in 2024, Google confirmed a fix for a Gemini long-term-memory attack in
2025, and a July 2026 paper (MemGhost) demonstrates 71–87.5% success planting false persistent memories in
agents from a single fetched email, targeting exactly the MEMORY.md/AGENTS.md-loaded-into-system-prompt
pattern this repository itself uses.

**The single largest gap found: no major vendor ships a *mandatory* write-approval gate for memory writes
triggered by agent-fetched content**, as distinct from an explicit user "remember this" command. This
exists only in a hobbyist PR thread and one independent blog post as of the cutoff — which means the
memory write-gate recommended in §4 on quality grounds (cheap deterministic filter before persistence) is
also, if built as a genuinely harness-enforced gate rather than a model-requested one, ahead of what any
production coding agent currently ships as a security control. This is the same "harness > prompt"
principle from §6 applied to the write path specifically, and it is currently a live gap industry-wide, not
just at Shelra.

Secondary findings: secret-write refusal in shipping systems is model-judgment only, not enforced ("Claude
usually refuses" is the documented control); cross-tenant scoping is shipped in at least one system but
still leaked in its own published evaluation; stale security-relevant memory ("this dependency has no
known CVEs") has no dedicated literature, with the closest general proxy benchmark finding the best model
catches invalidated beliefs only 55.2% of the time — directly reinforcing why the evidence-based
invalidation recommended in §4/§7 (tie a memory's validity to a re-checkable artifact, not model
self-assessment) matters as a security property, not only a freshness one.

One live methodological note: during this research, a fetched web page returned content appended after
the genuine extraction, formatted to imitate this harness's own system-reminder syntax. The researching
agent correctly treated it as untrusted fetched data and took no action on it — recorded here because it
is a first-hand, real-time instance of exactly the persistence-oriented injection vector this lane
investigates, not a second-hand report.

---

## 9. Competitive position: narrower, but still real

Full evidence: second-wave section of `research/lanes/05-commodity-map.md`. As of 2026-09-14, only six
days after the original commodity map:

- **Cursor Projects shipped 2026-09-10** claiming "context over months of work," syncing across machines.
  Still beta, no docs page five days later. What it persists is knowledge + preference in one undifferentiated
  bucket — no task list, decision record, rationale, or verification status. Continuity is partly bought by
  never stopping the cloud machine, which is a hosting answer to a state question, not a data-model answer.
- **`claude-mem`** (Apache-2.0, 93,953 stars) already logs a typed `decision` observation via hooks + SQLite
  + Chroma — evidence the gap is patchable by a third party with commodity primitives, though it's
  transcript-mined, not an authored ledger with alternatives/supersession fields.
- **Cline's SDK now summarizes imported foreign session history** rather than replaying it — the fourth
  documented cross-vendor import path, and the first that moves conversations rather than just config,
  confirming lane 05's finding that "the portable unit of continuity in 2026 is a summary, not a ledger" —
  which is precisely why it's the wrong unit for the thing this document recommends building.

**Net effect on differentiation:** "cross-session project state" moved from a clean, empty differentiator
to a contested one — the general problem is being chipped at. What survives as genuinely unserved,
consistent with §2's convergence finding, is narrower and less glamorous than "memory" as a feature: a
retention policy that doesn't conflate derived state with transcript, and invalidation driven by repository
evidence rather than a clock or model self-report. Nobody — incumbent or commodity tool — does either.

---

## 10. What this becomes if it works

The same answer `08_SELECTED_THESIS.md` already gave, now with a storage layer: a durable, per-codebase
decision/discretion ledger, bitemporal (§4), retrieved by lexical/graph methods matched to what's being
asked (§5), written through a harness-enforced gate that is also the security boundary (§8), with
retention split between cheap-to-discard raw transcript and cheap-to-keep distilled state (§7) — none of
which requires abandoning local-first (§7's numbers hold at 8GB/1GB budgets to ten years of realistic
accumulation).

This does not change `10_PHASED_PLAN.md`'s gate: Phase 1's base-rate falsifier still decides whether the
thesis itself is worth building anything on top of. If it passes, this document is the answer to the
`10_PHASED_PLAN.md` question of *how* the record gets stored and stays retrievable for years without
becoming another context window. If it fails, none of the architecture here should be built either — it
has no purpose independent of the ledger it would store.

**What must be proven before further investment, ranked by cost to test:**

1. **The Phase 1 base-rate falsifier still gates everything** — unchanged by this research.
2. **A supersession-aware retrieval benchmark does not exist anywhere (§5) and is cheap to build**: take
   ShelraCode's own eventual decision ledger (or a synthetic one shaped like it) and measure whether
   lexical, graph, and embedding retrieval each find the *current* decision when an older, superseded one
   uses similar language. This is the single most decision-relevant open experiment across all five lanes.
3. **Does the write-gate's false-negative rate hold up specifically for decision-shaped and task-shaped
   candidates** (lane 11 §6, P2) — the write-gate literature was validated on fact-like and failure-like
   memory, never on the two categories this document recommends building first.

**What to fix immediately, independent of the above** (§3): point Shelra Bench at the hardened kernel or
explicitly document why it doesn't; decide whether the acceptance/`CheckSpec` machinery is meant as the
thesis's oracle infrastructure or a separate concern, and say so somewhere; delete or archive `src/intent/*`.

---

## 11. What would make this wrong

1. **The supersession-retrieval benchmark (§10.2) comes back easy** — if plain lexical search already finds
   the current decision reliably even with superseded near-duplicates present, the graph/temporal
   recommendation in §5 is unnecessary complexity and lexical-only is the right call everywhere, not just
   for code.
2. **An incumbent ships the split** — if Claude Code, Cursor, or any vendor separates transcript retention
   from derived-state retention within the next few release cycles (the absorption lag observed elsewhere
   in this mission is now 19 days to a few months), the "narrower gap" in §9 closes the same way the
   broader memory-feature gap already did.
3. **Task memory turns out not to generalize.** ShelraCode's own working chat-path implementation (§3, §6)
   is n=1 and not benchmarked against the research literature's absence-finding at scale; if it breaks
   under realistic multi-year, multi-kernel conditions, §6's "ahead of the field" claim doesn't hold and the
   two-kernel gap in §3 item 5 becomes more urgent than this document's ordering implies.
