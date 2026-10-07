# Memory, intent and context audit

This assessment combines implementation inspection with the real-Agent scripted memory harness, a killed process and fresh sessions, adversarial compaction tests, real concurrent writers and a 92-query retrieval dataset. An ideal scripted reflection model does not measure hallucination rates of live models. The live complexity ladder uses fresh projects; it is not a continuity benchmark.

## What survives, and what does not

| Mechanism | Store / modules | Written when | Retrieved when | Limits and failure modes |
| --- | --- | --- | --- | --- |
| Conversation | SQLite; `storage/transcript.ts`, `transcript-view.ts` | Persisted messages and completed provider steps | Resume/load transcript | In-flight unfinished SDK steps are not a transactional turn; compaction can replace effective history |
| Working objective | `AgentKernel`, objective index | Start and lifecycle updates | Instance / persisted inspection | Current request is distinct from earlier unresolved objectives; no comprehensive task dependency graph |
| Plan / criteria | Tool results; `plans/state.ts`; episode snapshots | Publish/update and closing episode | Resume; continuation adopts newest open plan | Model-authored and optional; snapshot caps 20 steps / 12 criteria; open list caps three plans |
| Standing user statements | Markdown index/topic files; `memory/apply.ts`, `gate.ts` | Explicit rules/facts/corrections without a model call | Every request, bounded context | Recognized natural-language patterns; not arbitrary formal constraints |
| Durable project facts | `.shelra/memory/`; `store.ts`, `reflection.ts` | Qualified verified changes, recovered failures, substantial investigations | Lexical relevance against request, paths and prior short follow-up | Reflection chooses candidates; gate validates provenance, secrets, injection shape and duplicates |
| Failure knowledge | Host observations and episodes; `recovery.ts`, `episodes.ts` | Once a failure is demonstrably overcome; every working turn gets an episode | Similar requests; first-session orientation | Unresolved failure is not falsely learned as a solution; orientation preferentially includes paid-for failure lessons |
| Work in progress | `memory/live/<session>.json` | Periodically while a turn works | Other sessions; startup crash recovery | Overwritten, then removed at end; cannot restore an external process or roll back partial source edits |
| Deferred reflection | `pending-reflections.jsonl` | No answering model / bounded failed reflection | Later successful responding turn | Queue capped at 20; three attempts; not an unlimited durable work queue |
| Architectural decisions | `docs/decisions/`; `ledger/` | User-approved proposals | Active scoped decisions injected, checks join contract | File-based lifecycle; runtime checks only cover recorded scope and check programs |
| Documentation orientation | `.shelra/memory/docs-index.json`; `docs-index.ts` | Refresh/index discovery | README description, up to three related documents, instruction pointer | Mostly pointers/snippets; stale detection by named missing paths and superseded terms is heuristic |
| User preferences | User-wide memory directory | Explicit conversational preference capture | Requests across projects | Deliberately shared; distinguish this from accidental project contamination |
| Retrieval/use evidence | Metadata / reflection audit / trace recall | Injection, actual memory read, command success, project checks | Ranking/explanation and consolidation | Being present in a successful turn is correlated credit, not proof of causal usefulness |
| Summaries | SQLite checkpoints; `agent/compaction.ts` | Context pressure / forced recovery | Effective transcript | Generated summary can distort goals; current objective and published criteria now independently retained |

There are no retrieval embeddings or vector database in this path. Ranking is lexical, with rare-word weighting, paths, Spanish/English terms, source trust, staleness, use and credit. `dynamics.ts` fades unused inference; `consolidate.ts` archives eligible entries and combines repeated failures. Human statements and credited/important lessons are protected from ordinary fading. Superseded topics retain their files and replacement metadata; they should not be treated as current.

## Answers to the memory audit questions

1. Saved: explicit user statements, admitted facts, plan/checkpoint state, messages, observations, outcome episodes, recovered failures, live work, deferred reflections and document metadata. Different stores hold different subsets.
2. Not guaranteed saved: every discovered fact, every unresolved question, complete tool input/output in an interrupted unfinished step, a full repository graph, complete unbounded objectives, external resource ownership or the model's hidden reasoning.
3. Saving occurs at statement capture, tool/lifecycle persistence, periodic live saves and closing reflection/episode paths. These are separate writes.
4. Human wording is authoritative. The host identifies recognized standing statements and observed lessons; the model proposes inferred facts; a deterministic gate admits them. A confidence score is not independent truth verification.
5. Project memory is rooted at the session project, not the shell's latest directory. User-wide preferences and SQLite sessions live separately.
6. `memoryContextFor` combines lexical retrieval, episodes, open plans, documentation and returning-user orientation.
7. Ranking uses lexical rarity/relevance, paths, cross-language terms, provenance, staleness, use, credit and importance. It is not a semantic retrieval model.
8. Related-file timestamps/paths and supersession metadata signal staleness. These cannot detect every changed architectural assumption or changed business requirement.
9. Supersession removes old statements from the current index view; explicit correction outranks inference. Arbitrary contradictory prose may evade matching.
10. Store writes replace/merge topics through admission rules. The audit serializes index mutations, but body/index/history are not a single crash-atomic transaction.
11. Slugs, admission similarity and consolidation reduce duplicates. They do not prove semantic deduplication for differently worded facts.
12. The physical index is bounded (200 entries); low-value inference can be archived. JSONL logs rotate and retrieval is bounded. The 5,000-entry benchmark tests ranking beyond that physical index size, not a 5,000-topic disk store.
13. Repository changes mark related facts/documents possibly stale; no automatic whole-store revalidation against a new architecture occurs.
14. Yes, documentation can disappear from effective body context: only a few documents are selected, others remain pointers or undiscovered. Retrieval success is imperfect.
15. Memory includes useful architecture/conventions/procedures, not solely errors. First-session fallback orientation prioritizes failure lessons and recent work; durable positive project orientation can still miss facts without matching terms.

## Empirical results

The 11 scenario suite drives `Agent.processMessage` in new processes. It evolves a fixture from JSON files to SQLite to DuckDB, changes business objectives, moves modules, kills an active refactor, resumes work, changes documents, adds unrelated work, and queries memory under another model identity. Separate cases cover correction, project isolation, procedures, failed approaches, consolidation and noise.

| Result | Before | After first memory repair | After closing-plan repair |
| --- | --- | --- | --- |
| Scenario suite | 10/11 | 10/11 | **11/11** |
| Cold-start project recall | 11/12 assertions | 11/12 | **12/12** |
| Cross-session continuation | 6/6 | 6/6 | 6/6 |
| Supersession / correction / isolation / docs / stale docs | Passed | Passed | Passed |

The missing fact was the remaining `src/reports` refactor. Initial investigation found two real `openPlans` errors: claimed steps counted as complete and unverified untracked plans retired. Fixing those did not repair cold-start recall. The decisive defect was `learnFromTurn` receiving a digest without the current plan on normal closing paths. It wrote that episode, set the turn learned, and cleanup deleted the live plan. The new regression proves a pending plan survives a normal closing episode; final benchmark now retrieves it after restarting. This sequence is retained to distinguish a hypothesis from a confirmed root cause.

Evidence: `bench/long-horizon/results/memory-evals-audit-20261004.json`, `...-after.json`, `...-final.json`, `...-hardened.json`; `src/agent/compaction-plan-survival.test.ts`; `src/memory/episodes.test.ts`. The hardened rerun after the final lock correction again passes 11/11, with 12/12 cold-start assertions.

| 92-query retrieval stress | Gold topics only | 100 distractors | 1,000 | 5,000 |
| --- | --- | --- | --- | --- |
| Body recall, final | 87% | 88% | 87% | 83% |
| Recall including pointers | 95% | 94% | 92% | 90% |
| Precision | 87% | 79% | 77% | 75% |
| MRR | 0.85 | 0.84 | 0.79 | 0.78 |
| Standing-rule recall | 100% | 100% | 100% | 100% |
| Forbidden facts | 0 | 0 | 0 | 0 |
| Retrieval p50 / p95, ms | 1.1 / 2.3 | 1.7 / 5.3 | 9.1 / 30.1 | 39.5 / 144.7 |

At 5,000 entries: vague-query recall 43%, superseded-query recall 67%, follow-up recall 75%, cross-language recall 78%; direct/path queries 100%. These are misses, not measured hallucinated memories. Ranking did not change, and its final recall/precision remain the same as baseline. A 100% rule score on this dataset does not establish that every real natural-language constraint will be recognized.

Evidence: `bench/memory/results/audit-20261004.json`, `audit-20261004-final.json`. Dataset timestamps are simulated fixture time, not wall-clock audit timestamps.

Five simultaneous Bun writers each wrote 20 distinct architecture topics. Before: only 20 of 100 remained indexed in all three repetitions; 28–39 writes threw. Final: 100/100 readable bodies and zero errors in all repetitions. Ten-repeat stress at each of 1/3/5 writers passes all 30 trials. The regression reads every body and checks that no writer monopolizes its whole twenty-write batch. Locking still bounds contention to one second and explicitly rejects unsaved writes. It introduces synchronous waiting and costs throughput: the latest final five-writer median is 2.041 seconds. It is a correctness repair.

The initial lock implementation was not sufficient. Its isolated passes were followed by 99/100 admitted entries in the full unsandboxed suite, even with all child exit codes zero. A deterministic owner-change test reproduced dead-owner cleanup removing a replacement live lock; recovery now compares the observed owner. The next full-suite run exposed unfair reacquisition: two waiters exceeded the existing one-second bound while another writer kept admitting its batch. Unique queued tickets prevent that starvation; the wait budget and full-suite concurrency were not relaxed. The complete root suite then passes. Intermediate failed artifacts remain in the audit directory, separate from earlier environment permission failures. Topic body, index and history still are not a single crash-atomic transaction; bounded busy rejection remains possible under a genuinely long owner operation.

A final isolated clock test showed the original wall-clock deadline could wait indefinitely if `Date.now` stopped advancing. The existing bound now uses `performance.now`; the worker returns explicit busy failure before its independent 2.5-second rescue bound. This does not remove synchronous waiting or prove arbitrary clock/fairness behavior. The short-lived static lock-reaper mutex has no abandoned-reaper recovery, a residual source-derived crash risk that the current killed-refactor fixture does not exercise.

## Intent stress and context limits

With the original objective 20 and 50 tool steps behind the retained suffix, a scripted summarizer returned an unrelated digital-clock goal. Before: the checkpoint contained only that incorrect goal. After: the host copy preserves the original invoice objective, zero-record constraint, no-network/no-dependency requirements and test requirement verbatim within its size bound. Existing acceptance-criterion preservation remains tested independently.

This proves survival in checkpoint input, not compliance by a live model. Oversized objectives retain an explicit head/tail excerpt; middle constraints can still be absent. Follow-up turns, independent open objectives and unresolved questions are not represented by a complete immutable project task contract. The live completion-guard reproduction is a second intent failure: an authoritative host repair instruction displaced the actual user's desired code change. Its fix belongs to check-role classification, not more summarization tokens.

No claim is made that a model can retain every decision for months. The repaired persistence defects and unchanged retrieval misses establish the remaining engineering work: persistent task identity/constraints, evidence-linked positive architecture orientation, explicit stale-fact revalidation and cross-turn acceptance tests under a real model.

Attachments have a separate continuity boundary from project facts. Binary local/downloaded images were valid before persistence but invalid after transcript JSON serialization according to the installed SDK schema. New attachments now use stable base64 strings; local/remote replay validity and exact bytes are covered by two regressions. Existing binary-object rows are not migrated, and the scripted memory suite does not evaluate live visual recall.
