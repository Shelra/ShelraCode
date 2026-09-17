# Lane 15 — ShelraCode forensic audit: long-horizon continuity mechanisms

Internal repo audit, not external research. SOURCE fields below are `file:line` citations against
`D:\PROYECTS\shelra` as of 2026-09-15, HEAD `af7e7bd` plus the uncommitted working tree (`git status`
snapshot reproduced at the end of this file). Every subsystem was read directly and cross-checked with
`grep`-verified import/call sites — no claim here is taken from README/doc/comment text without an
independent code check. Where `docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md` ("doc 14") is cited,
it is cited as a *hypothesis to verify*, and the verification result is stated explicitly.

## 1. Summary

ShelraCode has a genuinely more complete long-horizon continuity stack than the ground rules'
skepticism would predict, but it is fragmented across **three unconnected efforts**, and the newest
one (uncommitted, this working tree) does not implement the mission's own selected thesis. (1) A
hardened interactive-chat path (`src/agent/agent.ts`, HEAD) has a real completion gate, cross-turn and
cross-restart plan/criteria persistence, memory tools with a write cap, checkpoints, and hook firing —
all independently verified below, not merely doc-claimed. (2) A separate, older `--autonomous` path
(`src/autonomy/kernel.ts`) has its own well-designed deterministic acceptance-check vocabulary
(`CheckSpec`, `StopReason`, `modelJudged` escape hatch) but still fires zero hooks and has zero
checkpoint protection on its own file-mutation path (`src/exec/files.ts`) — both gaps confirmed absent
by direct grep, not merely repeated from doc 14. (3) The entire uncommitted working tree (`src/bench/`,
`bench/`, `src/plans/`, new SQLite `benchmark_*` tables) is a substantial, genuinely wired benchmark/eval
harness ("Shelra Bench") — but it drives task execution through path (2), the weaker autonomy kernel,
not the hardened path (1) that the rest of this same session's own doc spent twenty sections hardening.
Separately, `src/intent/{arms,corpus,experiment,probes,scoring}.ts` — the pre-empted experiment the
user's memory file references — has zero importers anywhere in `src/`: confirmed dead code, not wired
to anything. Most importantly for the mission's selected thesis (`docs/future-research/08_SELECTED_THESIS.md`,
"the record of machine discretion... making a machine's undeclared choices visible"): a full-text search
for `discretion|commitment|behavioral diff|silent violation|undeclared choice` across `src/` returns
zero files. Nothing in the current codebase — committed or uncommitted — extracts, records, or checks
behavioral commitments against a diff. The acceptance/plan/bench machinery being actively built is a
different, adjacent thing: agent self-benchmarking, not discretion tracking. There is also no retention
or lifecycle policy anywhere in the persistence layer (SQLite tables, `.shelra/memory/`, the autonomy
journal) — everything accumulates forever, in contrast to Claude Code's documented split between
swept ephemeral state and retained memory (lane 12 finding).

## 2. Subsystem-by-subsystem trace

Columns: exists / imported / called / **on default path** (plain `shelra` chat, no flags) / persisted /
retrieved / changes agent behavior / tested / verified end-to-end (a test that exercises the real
mechanism through a realistic boundary — process restart, SQLite close/reopen, a live turn loop — not
just a pure-function unit test).

| Subsystem | Exists | Imported | Called | Default path | Persisted | Retrieved | Behavior-changing | Tested | Verified E2E |
|---|---|---|---|---|---|---|---|---|---|
| `AgentKernel` completion gate | Yes `src/agent/kernel.ts:38,102` | Yes `agent.ts:115` | Yes, 9 transition + 7 `evaluateCompletion` sites in `agent.ts` (per doc 14 §8.11, spot-checked) | **Yes** — every `processMessage()` call | Yes, `objectives` table (`migrations.ts:151-162`) | Yes, `agent.ts:1036 getKernelState()` | Yes — blocks/nudges before "done" (`agent.ts:2670-2680`, `MAX_VERIFICATION_RETRIES=3` at `agent.ts:155`) | Yes `completion-gate.test.ts`, `stop-hook.test.ts` | Yes — `stop-hook.test.ts` drives a real `Agent.processMessage()` turn through a mocked provider and asserts the persisted row |
| `AutonomyKernel` / `Objective` ledger | Yes `src/autonomy/kernel.ts`, `types.ts:183` (`Objective`), `:25` (`StopReason`), `:40` (`CheckSpec`), `:89` (`modelJudged`) | Yes, `src/autonomy/runtime.ts` | Yes, `runObjective()` | **No** — only `--autonomous` CLI / `shelra objectives` / (new) `shelra bench` | Yes, `objectives`/`objective_tasks` tables + file journal (`src/autonomy/journal.ts`) | Yes, `upsertObjectiveIndex` | Yes, within its own path | Yes, `kernel.test.ts`(agent)/`kernel-events.test.ts`(autonomy) | Partial — no test drives it through a real CLI invocation end-to-end |
| Hooks (`Stop`/`PreToolUse`) | Yes `src/hooks/executor.ts` | Yes, `agent.ts` | Yes, chat path only | Yes for chat | N/A (transient) | N/A | Yes — exit-2/JSON block (`executor.ts:6` `BLOCKING_EXIT_CODE=2`, `:186-191` decision aggregation) | Yes | Partial |
| Hooks from `AutonomyKernel` | **No** — `grep "fireHook\|executeEventHooks\|executePreToolHooks\|hooks/" src/autonomy/kernel.ts` returns zero matches (verified this session) | — | — | — | — | — | **No** — the weaker path stays invisible to any hook-based policy tooling | No | No |
| Checkpoints (chat mode) | Yes `src/tools/file.ts:47 snapshotForCheckpoint` | Yes, `grok/tools.ts` | Yes, on `write_file`/`edit_file`/`delete_file` | Yes | Yes, `checkpoints` table (`migrations.ts:181-197`) | Yes, `revertLatestCheckpoint` | Yes, `/revert` | Yes | Partial |
| Checkpoints (autonomy mode) | **No** — `grep "checkpointBeforeMutation\|recordCheckpoint\|onCheckpoint" src/exec/files.ts` returns zero matches (verified this session) | — | — | — | — | — | No | No | No |
| Plan/criteria cross-restart recovery | Yes `src/plans/state.ts` (new, untracked), `resolvePlanResults`/`resolvePlanState` | Yes, `src/storage/transcript.ts:287 loadPersistedPlanState` | Yes, `agent.ts:896 restorePersistedPlanState()` in constructor, `:1079` definition | **Yes** — runs on every `Agent` construction when `persistSession !== false` | Yes, replayed from `tool_results`/`tool_calls` (immutable history, independent of the compacted view) | Yes | Yes — `activeAcceptanceCriteria`/`activePlanSteps` seed the completion gate before any turn runs | Yes, `src/storage/plan-state.test.ts` (untracked) | **Yes** — genuinely appends messages + a compaction row to a real SQLite DB, closes it, reopens it, and asserts step status/evidence survive both compaction and the close/reopen cycle |
| Compaction survival of structured plan data | Yes `src/agent/compaction.ts:243 appendActiveCriteriaBlock` | Yes, `Agent.compactOnce()` | Yes | Yes | Yes, appended verbatim into the persisted summary text | Yes | Partial — only acceptance criteria, not full per-step status, survive as *structured* fields; the rest is prose | Yes, `compaction-plan-survival.test.ts` | Yes, forces a real compaction through a live turn loop with a tiny context window |
| Project/agent memory (`src/memory/`) | Yes `src/memory/store.ts`, `types.ts` | Yes, `agent.ts`, `grok/tools.ts` (8 files import memory functions, verified this session) | Yes, `memory_write`/`memory_read`/`memory_list`/`memory_delete` tools + automatic index injection | **Partial** — auto-injected only for coding-classified turns (`agent.ts:460,485 formatMemoryIndexPromptSection`); purely conversational turns use `buildConversationSystemPrompt` (`agent.ts:492`) which omits it entirely | Yes, flat files under `.shelra/memory/` | Yes | Yes | Yes, `store.test.ts`, `memory-context.test.ts` | Partial |
| Memory write cap / anti-corruption | Yes, `store.ts:26-27 MEMORY_INDEX_MAX_BYTES=25*1024, MEMORY_INDEX_MAX_LINES=200`, `:183-190` refuses over-cap writes rather than truncating | Yes | Yes | Yes | Yes | Yes | Yes (refuses instead of corrupting) | Yes | Yes |
| `src/intent/*` (pre-empted experiment) | Yes, 5 files, `arms.ts`, `corpus.ts`, `experiment.ts`, `probes.ts`, `scoring.ts`, ~92KB total | **No** — `grep "from \"../intent/\|from \"./intent/\|src/intent\"" src/` returns zero matches anywhere outside the directory itself | No | No | No | No | **No** | Only its own files | No |
| Shelra Bench (`src/bench/`, `bench/`, `scripts/bench-dashboard.ts`) | Yes, untracked, ~8 files + design docs | Yes, `src/index.ts:17-21,62`, `src/ui/app.tsx:89` | Yes, real `shelra bench` CLI command (`index.ts:1439-1441`), `/bench` UI modal (`slash-menu.ts:14`, `app.tsx:2862`) | **No** — opt-in command, not the default chat path | Yes, new `benchmark_*` tables (`migrations.ts:211-389`, uncommitted, `LATEST_DB_VERSION` 4→8) | Yes, `src/storage/benchmarks.ts` accessors + UI modal | Yes, for benchmark runs only | Yes, `manifest.test.ts`, `runner.test.ts` | Partial |
| Shelra Bench's execution path | — | `src/bench/shelra-executor.ts:1 import { runObjective } from "../autonomy/runtime"` | Yes, `:38-46` calls `runObjective(...)` directly | — | — | — | **Bench measures path (2), not path (1)** — see contradiction §5.1 | — | — |
| Intelligence cost/budget routing | Yes, `src/models/budget.ts`, `src/intelligence/openrouter.ts` `maxCostUsd`/`reservedCostUsd` | Yes, `agent.ts`, `index.ts`, `intelligence/openrouter.ts`, `providers/openrouter.ts` | Yes | Yes, `SHELRA_MAX_SESSION_COST_USD`/`--max-cost` | Session-scoped, not persisted historically per-role | Yes | Yes — reservation blocks over-budget calls | Yes | Partial |
| Hardware/local-cloud routing | Yes, `src/hardware/profile.ts`, `src/router/local-first.ts` | Yes, `startup/orchestrator.ts`, `setup/onboarding.ts`, `index.ts`, `models/manager.ts`, `models/recommendation.ts`, `ui/startup.tsx` | Yes | Yes, on `--local`/onboarding | No | Yes | Yes | Yes | Partial |
| Decision memory (structured) | **No** dedicated type/module found anywhere in `src/` | — | — | — | — | — | — | — | — |
| Discretion/commitment tracking (selected thesis) | **No** — zero matches for `discretion\|commitment\|behavioral diff\|silent violation\|undeclared choice` across all of `src/` | — | — | — | — | — | — | — | — |
| Retention/lifecycle policy for any store | **No** — zero matches for `retention\|prune\|expire\|ttl\|cleanup\|garbageCollect` in `src/memory/`, `src/plans/`, `src/autonomy/journal.ts` (checked directly; broader repo-wide grep hits were all false positives in unrelated files) | — | — | — | — | — | — | — | — |

## 3. Gap matrix

Per the mission's audit template. Evidence is `file:line`. "Shelra Today" reflects the **current working
tree** (committed + uncommitted); where the two differ materially, both are stated.

| Row | Shelra Today | Evidence | Maturity | Missing | Priority |
|---|---|---|---|---|---|
| Intent persistence | Partial | `src/autonomy/types.ts:183` (`Objective.request`, verbatim original request) is autonomy-only; chat path has `activeAcceptanceCriteria` (`src/agent/agent.ts:896,1079`) session-scoped and now restart-durable via `src/plans/state.ts` + `src/storage/transcript.ts:287` (uncommitted) | Working prototype | No single intent record shared by both execution paths; no versioning (v1→v2 intent drift) | High |
| Specifications | Partial | `src/autonomy/types.ts:40` `CheckSpec` union (deterministic, `modelJudged:true` escape hatch); chat path's `generate_plan.acceptanceCriteria` (`src/grok/tools.ts`, schema `.min(1)`) | Working prototype, two vocabularies | No shared spec type between `Objective.acceptance` and `Plan.acceptanceCriteria`; bench adds a third (`src/bench/types.ts:133-139 BenchmarkAcceptanceCriterion`) | Medium |
| Task ledger | Partial | `objectives`/`objective_tasks` tables, `src/storage/migrations.ts:151-179` (committed, HEAD) | Working prototype | `objective_tasks` FK'd only to autonomy objectives, not to chat-mode plan steps (`activePlanSteps` has no SQL table of its own — recovered by replaying `tool_results`, not stored as rows) | Medium |
| Verification | Partial-to-yes on chat path | `src/agent/agent.ts:3109 describeVerificationEvidence`, `:2670-2680` gate, `:155 MAX_VERIFICATION_RETRIES=3` | Production-tested on chat path (`completion-gate.test.ts`) | Per-criterion causal linkage stays "turn co-occurrence," not proof (doc 14 §18, independently plausible given the design — not re-verified line-by-line this pass); autonomy path verification (`src/autonomy/acceptance.ts`) is a parallel, unconnected implementation | Medium |
| Repair loops | Partial | `src/autonomy/types.ts` has a `repairs[]` field on `Objective`; `src/bench/types.ts:39 BENCHMARK_FAILURE_TYPES` includes `repair_failure`; `BenchmarkBehavior.repairsAttempted/repairsSucceeded` (`src/bench/types.ts:110-111`) | Instrumented for measurement, not for chat-mode | Chat path (`agent.ts`) has no first-class "repair" concept — a failed verification triggers a *nudge*, not a tracked repair record | Medium |
| Session resume | Yes | `src/agent/agent.ts:888-899` constructor reloads `messages`/`messageSeqs`/plan state/kernel from SQLite on `--session latest`/`<id>` | Production | Automatic resumption is deliberately not enabled (doc 14 §21, consistent with the constructor code read this session — a fresh invocation always starts a new session unless explicitly selected) | Low (by design) |
| Compaction survival | Partial-to-yes | `src/agent/compaction.ts:243 appendActiveCriteriaBlock`; `src/storage/plan-state.test.ts` (untracked) proves criteria + step status survive compaction AND SQLite close/reopen | Working, E2E-tested for criteria/steps | Full per-step evidence trail and free-text plan rationale still compress to prose in the LLM-generated summary, not structured fields | Medium |
| Project memory | Yes (chat path only) | `src/memory/store.ts:26-27` (caps), `agent.ts:460,485` (auto-injection for coding turns) | Working, tested (`store.test.ts`, `memory-context.test.ts`) | No confidence/staleness metadata (`last_confirmed_at`/`expires_at` — absent, confirmed by the same grep that found zero retention/expire hits in `src/memory/types.ts`); not available to conversational turns; autonomy path (`--autonomous`) never reads or writes it (no import of `../memory/store` in `src/autonomy/`) | Medium |
| Episodic memory | Partial | `messages`/`tool_calls`/`tool_results` tables (`migrations.ts:59-88`) are the de facto episodic store for chat; `src/autonomy/journal.ts` (`events.jsonl` per run) for autonomy | Working | No unified episodic query surface across the two; no summarized "what happened last session" beyond compaction prose | Medium |
| Decision memory | No | Full-repo search found no dedicated type/module (no `src/decisions/`, no ADR schema); the closest analog is free-text `memory_write` topic files, which a model may or may not choose to use, with no enforced "alternatives considered" schema | Absent as a structured concept | Everything: a decision type, capture point, linkage to the code it affected | High |
| Agent memory | Partial | `src/memory/store.ts`'s per-agent scope exists (`.shelra/memory/agents/<name>/`, per doc 14 §8, structurally consistent with `MemoryScope` in `types.ts`) but doc 14 itself states it is unused; not independently re-verified as wired to any subagent call site this pass | Built, not wired | Confirm/wire per-agent memory into `runTask`/`runDelegation` | Low-medium |
| Skills | Partial | `src/utils/skills.ts:51 reviewSkillContent`, `:198 discoverSkills`, `:223 formatSkillsForPrompt` | Working, two-level disclosure (name+description always, full body on demand) | No bundled scripts/references/assets third tier (doc 14 §14 claim, structurally consistent with only `SKILL.md` body being read) | Low |
| Checkpoints | Partial | `checkpoints` table (`migrations.ts:181-197`); `src/tools/file.ts:47 snapshotForCheckpoint` (chat path only) | Working on one path | Autonomy path (`src/exec/files.ts`) has zero checkpoint calls — confirmed by direct grep this session, not carried over from the doc | High (asymmetry between the two execution paths) |
| Context retrieval | Partial | `src/context/compiler.ts` (imported by `agent.ts`, confirmed this session) assembles turn context from workspace scanning + classification; `formatMemoryIndexPromptSection` adds memory index | Working, deterministic (not semantic/embedding-based) | No semantic/vector retrieval anywhere in `src/` (no embeddings, no vector store found in the directory scan) — retrieval is disk-scan + index-file based only | Medium |
| Temporal knowledge | No | No `valid_from`/`supersedes`/versioned-fact concept found in `src/memory/types.ts`, `src/storage/migrations.ts`, or `src/autonomy/types.ts` | Absent | A way to represent "this was true, then changed" beyond overwrite-in-place (`memory_write` upserts, `objectives` rows update in place) | Medium |
| Provenance | Partial | Strong in the new bench schema: `repository_commit`/`repository_dirty`/`repository_diff_hash`/`configuration_fingerprint` (`migrations.ts:233-236,229`, uncommitted); weak elsewhere — chat-mode memory entries carry a writer-supplied `modified` timestamp only (doc 14 §8) | Uneven across subsystems | No provenance (who/what decided this — model vs. user vs. hook) on `objectives`/`checkpoints`/memory rows | Medium |
| Cost routing | Yes | `src/models/budget.ts`; `src/intelligence/openrouter.ts` `reservedCostUsd`, `maxCostUsd`, role-based `ROLE_TIMEOUT_MS` (uncommitted diff) | Working, tested | Historical cost is session-scoped in the ledger; no persisted per-role spend history queryable across sessions outside `usage_events` (which is per-message, not per-role-aggregated) | Low |
| Hardware routing | Yes | `src/hardware/profile.ts`, `src/router/local-first.ts`, wired into `startup/orchestrator.ts`, `setup/onboarding.ts`, `index.ts` | Working, tested | N/A — this is a comparatively mature subsystem for this codebase's age | Low |

## 4. Architectural debt found

1. **Two unconnected kernels, and now a third consumer that picks the weaker one.**
   `src/agent/kernel.ts` (`AgentKernel`, chat) and `src/autonomy/kernel.ts` (`AutonomyKernel`,
   `--autonomous`) never reference each other (doc 14 §2.1, independently confirmed this session: no
   `autonomy` import in `agent.ts`'s kernel usage). The new, uncommitted `src/bench/shelra-executor.ts:1,38`
   wires the benchmark harness to `runObjective()` — i.e., to the weaker of the two paths, the one
   without hooks (§2, row 4) or checkpoints (§2, row 6). Any benchmark score this harness produces will
   not reflect the hardening documented at length in `docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md`
   §8-22, because that hardening lives entirely in the path Bench does not execute.

2. **`src/intent/{arms,corpus,experiment,probes,scoring}.ts` is confirmed dead code.**
   ~92KB across 5 files, zero importers anywhere in `src/` (verified by grep, not assumed). This matches
   the user's own memory note ("pre-empted experiment") — it is very likely the artifact of the earlier
   research mission's intent-gap experiment that was stopped before integration. It should either be
   deleted or explicitly marked archived; as-is it is exactly the kind of "plausible-looking but dead"
   module doc 14 itself warns about elsewhere (its own removal of the xAI batch path, §14 Phase 0).

3. **Persistence has three parallel "what happened" stores with no single reconciliation point.**
   (a) SQLite `messages`/`tool_calls`/`tool_results` for chat; (b) the autonomy file journal
   (`src/autonomy/journal.ts`, `events.jsonl` per run under `.shelra/objectives/<id>/`); (c) the new,
   uncommitted `benchmark_events`/`benchmark_task_results` tables, which reference "the journal
   directory" (`objectiveRunDir` field, `src/bench/types.ts:249`) as an external pointer rather than
   folding autonomy-run detail into SQL. Reconstructing "what did the agent actually do" for a given
   objective requires reading two different storage technologies (SQLite + flat JSON/JSONL) and,
   for a bench run, a third indirection through `objective_run_dir`.

4. **No retention policy on any store.** SQLite tables (`messages`, `tool_results`, `objectives`,
   `checkpoints`, `benchmark_*`) and `.shelra/memory/` files have no expiry, sweep, or archival
   mechanism anywhere in `src/` (confirmed absent by grep in the relevant modules). Every session,
   every checkpoint's full previous file content (`checkpoints.previous_content`, `migrations.ts:188`),
   and every benchmark run accumulates indefinitely. This is a real long-horizon-continuity risk in the
   opposite direction from Claude Code's documented 30-day sweep (lane 12): unbounded growth rather than
   silent loss, but neither is a chosen policy — Shelra simply has none.

5. **Two reasoning-effort control paths, one real.** `reasoningEffortByModel` (per-model `/models`
   picker) vs. `/effort` (session-wide) — doc 14 §14 Phase 2 item 2 says this was "wired in," changing
   it from dead to precedence-ordered; not re-verified independently this pass, flagged as a doc claim
   worth a follow-up spot-check rather than repeated as fact.

6. **Compatibility/legacy surface still present**: `GROK_*` env var fallback (`AGENTS.md:66`,
   `.env.example` diff) for the pre-rebrand name, and `src/grok/` as a directory name for what is now
   the live tool-execution path (`src/grok/tools.ts` is not legacy — it is the actual production tool
   set; the directory name itself is inherited from the original fork and is the kind of naming debt
   that makes "is this dead" audits harder than necessary, exactly the ambiguity doc 14 had to resolve
   by hand for `src/grok/client.ts`, which *was* dead and was removed).

## 5. Contradictions between docs/comments and actual behavior

**5.1 — The benchmark harness does not measure the thing the harness-reconstruction doc spent 20
sections hardening.**
CLAIM: Shelra Bench (`src/bench/`, uncommitted) evaluates the un-hardened `--autonomous`/`AutonomyKernel`
execution path, not the interactive-chat path that `docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md`
documents receiving a completion gate, checkpoints, memory-tool wiring, cross-turn/cross-restart plan
persistence, and reasoning-effort control.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: `src/bench/shelra-executor.ts:1` imports `runObjective` from `../autonomy/runtime`, and
`:38-46` calls it directly as the task executor. `src/autonomy/kernel.ts` fires zero hook events
(grep-confirmed, no `fireHook`/`executeEventHooks`/`hooks/` reference in the file) and its file-mutation
path (`src/exec/files.ts`) has zero checkpoint calls (grep-confirmed). Doc 14's own "Known limitations"
section (line ~1404-1406 in the committed portion) already states "`AutonomyKernel` does not yet fire
`TaskCreated`/`TaskCompleted`/`Stop` hook events itself" — so the doc itself flags the gap; the
contradiction is that the *new* benchmark work, built in the same working tree, chose to measure through
that flagged-as-weaker path rather than the hardened one, without stating this tradeoff anywhere in
`docs/design/shelra-bench-architecture.md` (read in full — it discusses SQLite reuse and scoring
philosophy at length but never mentions which execution kernel it drives).
SOURCE: src/bench/shelra-executor.ts:1,38-46; src/autonomy/kernel.ts (grep, no hook calls); src/exec/files.ts (grep, no checkpoint calls); docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md (Known limitations section)
COUNTEREVIDENCE: none found — this was checked directly, not inferred from a doc claim.
OPEN QUESTION: is this an intentional near-term scoping decision (bench the simpler path first) or an
oversight? Nothing in `docs/design/shelra-bench-*.md` states it either way.

**5.2 — The mission's selected thesis has zero implementation footprint, despite user memory framing the
current uncommitted work as related to it.**
CLAIM: `docs/future-research/08_SELECTED_THESIS.md` — "the record of machine discretion... making a
machine's undeclared choices visible" — is not implemented anywhere in `src/`, committed or uncommitted,
despite the user's own memory file (`shelra-selected-thesis.md`) summarizing it as "machine-discretion
record as executable checks" in a way that invites reading the new `src/plans/`, `src/bench/`,
`src/autonomy/acceptance.ts` work as progress toward it.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: A full-text search across `src/` for `discretion|commitment|behavioral diff|silent
violation|undeclared choice` returns zero files. `src/bench/scoring.ts`'s `calculateIntentScore`
(lines 18-26) computes "intent fidelity" as the fraction of *stated* acceptance criteria that passed —
standard task-completion scoring, not extraction of undeclared choices from a diff against an external
oracle (OpenAPI/RFC/ADR/EARS/IaC policy, per the thesis's own "design law 3"). The new
`AcceptanceCriterion`/`CheckSpec` machinery in `src/autonomy/kernel.ts` (uncommitted diff) is about
letting a *benchmark* supply deterministic oracle checks so the model's own acceptance-writing can't
grade its own homework — a legitimate and different goal (measurement integrity) from the thesis's goal
(surfacing decisions nobody asked the model to make).
SOURCE: src/bench/scoring.ts:18-26; src/autonomy/kernel.ts (uncommitted diff, AcceptanceCriterion/CheckSpec additions); docs/future-research/08_SELECTED_THESIS.md:9-19
COUNTEREVIDENCE: none found.
OPEN QUESTION: is the current bench/plans work meant as *infrastructure* the thesis product would later
sit on top of (e.g., using benchmark-owned oracles as the "cheap oracle" precondition the thesis's design
law 3 requires), or a separate, parallel effort? Nothing in the working tree states this relationship.

**5.3 — Doc 14's own claim about the completion gate having "zero observers" is now stale within the
same document, and the document does not flag its own supersession clearly at the point of the claim.**
CLAIM: §2.2 of doc 14 states "`getKernelState()`... has zero callers anywhere in `src/`" as a
present-tense finding, but by §9.5 (later in the same document) and independently by this session's own
grep, `getKernelState()` has real callers.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: `grep "getKernelState()" src/` (this session) finds `src/agent/agent.ts:1036` (definition),
`src/ui/app.tsx:671,1667` (two real call sites wiring it into UI state), and
`src/agent/observer.test.ts:90` (a test asserting on it). §2.2's claim is explicitly time-stamped to the
document's own earlier phase and later self-corrected in §9.5's prose — this is not a hidden
contradiction, but it is exactly the kind of doc content the ground rules warn against trusting at face
value without independent verification, since §2.2 alone (if read out of context, e.g. by a future
contributor skimming just that section) would misstate current behavior.
SOURCE: src/agent/agent.ts:1036; src/ui/app.tsx:671,1667; src/agent/observer.test.ts:90; docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md §2.2 vs §9.5
COUNTEREVIDENCE: doc 14 does self-correct later in the same file, so this is a mild internal-consistency
issue rather than a live misrepresentation.
OPEN QUESTION: none — resolved by reading further in the same document, flagged here only because the
ground rules require checking doc claims against code rather than assuming the first mention is current.

## 6. Open questions

1. Is `src/bench`'s use of `AutonomyKernel` (§5.1) a deliberate near-term choice, and if so, is there a
   plan to either (a) port the hardening from `agent.ts` into `AutonomyKernel`/`KernelDeps`, or
   (b) rebuild Bench's executor on top of `Agent.processMessage()` instead? This determines whether
   Bench's future scores are meaningful evidence about the product's actual default behavior.
2. Given zero implementation footprint for the selected thesis (§5.2), is there a next concrete step
   planned (e.g., a `commitment_extract`/`commitment_check` module, an oracle-source integration for
   OpenAPI/ADR-bearing repos) or is the mission currently in a research-only holding pattern per the
   user's memory note ("research-only mission... pre-empted experiment")?
3. Should `src/intent/*` (dead, §4.2) be deleted now, or is it intentionally kept as a reference/seed for
   a future revival of the pre-empted experiment? As-is it silently inflates the codebase's apparent
   research-readiness.
4. Is the absence of any retention/expiry policy (§4.4) an accepted tradeoff for a single-user local tool,
   or a gap that should get a policy once SQLite/`.shelra/memory/` size becomes a real operational concern
   (multi-year usage, per this mission's own framing)?
5. `src/memory/store.ts`'s per-agent memory scope (`.shelra/memory/agents/<name>/`) is structurally
   present but doc 14 states it is unused; this pass did not independently re-verify whether any call
   site now uses it (time-boxed out) — worth a targeted follow-up grep for `agentMemoryScope`/
   `MemoryScope` usage in `runTask`/`runDelegation`.
6. Decision memory (gap matrix row "Decision memory": No) is the largest clean gap found relative to the
   mission's own audit template — no ADR-like structure exists anywhere. Worth asking whether this maps
   onto the selected thesis's own artifact (a decision *is* often exactly a discretionary choice made
   explicit) rather than being pursued as a separate feature.

---

### Appendix: git status at time of audit (for reproducibility)

```
Committed HEAD: af7e7bd (branch main)
Modified (uncommitted): .env.example, README.md, docs/migration/14-AGENT-HARNESS-RECONSTRUCTION.md,
  package.json, src/agent/agent.ts, src/agent/compaction.ts, src/agent/{cross-turn-criteria,observer}.test.ts,
  src/autonomy/{acceptance,kernel,runtime}.ts + acceptance.test.ts + kernel-events.test.ts, src/index.ts,
  src/intelligence/{openrouter,types}.ts + openrouter.test.ts, src/mcp/runtime.ts,
  src/providers/{auxiliary,types}.ts, src/runtimes/local-provider.ts + .test.ts,
  src/storage/{index,migrations,transcript}.ts + migrations.test.ts, src/utils/side-question.ts
Untracked (new): bench/, docs/design/shelra-bench-{architecture,reference,ui}.md, scripts/bench-dashboard.ts,
  shelra-bench.sh, src/bench/, src/intelligence/types.test.ts, src/plans/, src/storage/benchmarks.ts + .test.ts,
  src/storage/plan-state.test.ts, src/ui/bench-modal.tsx + .test.tsx
Also present but out of this audit's uncommitted-work scope (unrelated in-flight lane work, noted for
completeness only): research/lanes/{05-commodity-map (modified), 11..14 (new)}, research/sources/{05 (modified), 11..14 (new)}
```
