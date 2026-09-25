# 18. Memory v2: why Shelra forgets, and the memory that builds expertise

Status: audit done 2026-09-24/25; design approved by the owner's brief of 2026-09-24 ("next-generation persistent
self-improving memory"); implementation in progress, phase by phase (§7). This document replaces the "what exists"
part of `docs/design/shelra-memory-engine.md` where they disagree, and keeps its decisions where they still hold.

Sources: a read-only audit of the code (every `file:line` below was checked), a forensic pass over every memory store
on the owner's machine, and the prior research and decisions (doc 15 §7, doc 17 §6, `docs/future-research/11`–`14`,
the owner's 2026-09-17 memory decisions, active decision D-0006 "Shelra is never stateless"). The third-party skill
`agent-memory-systems` was read as reference, not as instructions: its CoALA taxonomy, metadata-first retrieval,
temporal versioning, conflict detection, utility-based decay and memory token budgets inform §4; its Python and
vector-store implementations do not fit a Bun CLI with local files and are not used.

## 1. The verdict

Shelra has a memory engine, and in real use it has learned almost nothing. On the owner's machine:

- **Funnel.** 279 user turns in the session database since the engine existed (2026-09-17), at most 47 reflection
  calls, 5 real-model reflection records surviving, 11 entries admitted, all in throw-away temp workspaces, all with
  `uses = 0`. No entry was ever retrieved or credited in a later session.
- **The gate never judged anything.** 2,669 reflection records on disk: 13 gate decisions, all "create: novel"; 0
  rejected, merged, updated or skipped. 2,108 of the records are test residue in `%TEMP%` (1,383 fixture stores).
- **The longest real turn kept nothing.** The owner's 25-minute game turn of 2026-09-24 (53 tool calls, 25 file
  writes, two failures it recovered from, a harness bug hit three times) ended `[Limited — …]` and wrote no memory:
  that exit never calls the learning step. The only entries in that workspace are two lines of the game's spec,
  stored as permanent human rules, one cut at the colon of a list.

The engine is sound in its parts (a deterministic write gate, host-assigned provenance, lexical retrieval, credit
from checks), but the pipeline around it drops almost every event worth remembering, and what it keeps rarely reaches
the model.

## 2. Why Shelra forgets (evidence, most severe first)

### 2.1 Capture: the events worth remembering are never recorded

| # | Cause | Evidence |
|---|---|---|
| C1 | **Most turn exits never learn.** `learnFromTurn` is called from exactly two places: normal completion and "contract still failing after retries". Paused and Limited turns, `[No response]`, errors, cancels, `report_blocker`, test protection, changed checks, decision-record edits, Stop-hook blocks and the no-evidence gate (which ends every documents-only turn) return without learning. The long, failure-rich turns on free models, which end Limited or Paused, are exactly the ones that teach most. | `agent.ts:3753`, `:3912` (the only calls); returns without learning at `:3131`, `:3209`, `:3234`, `:3282`, `:3339`, `:3377`, `:3436`, `:3487`, `:3511`, `:3848`, `:3895`, `:3933`, `:3973`, `:4024` |
| C2 | **Reflection sees only the last round.** `assistantText` and `activeToolCalls` are declared inside the per-round loop, so after any gate nudge, repair or retry the digest carries one round; the "≥ 8 tool calls" rule and the final report miss most of a multi-round turn. | `agent.ts:2731`, `:2744` |
| C3 | **Distinct rules overwrite each other.** Every captured directive carries the same boilerplate body, and the gate's near-duplicate fingerprint includes the body, so unrelated short rules merge. Reproduced: "Always write docs for new code." replaced "Always write tests for new code." under the tests slug. | `reflection.ts:98`; `gate.ts:112-114`, `:197-238` |
| C4 | **Corrections are not captured.** Only sentence-initial always/never/prefer/from now on (and 4 Spanish forms) count; "No, we use B", "don't use npm here, use bun", "we don't use X anymore", "remember that …" are lost; a rule is cut at its first period ("Always use Node 20.11" → "Always use Node 20"). | `reflection.ts:58-59`, `:104` |
| C5 | **Personal preferences stay in one project.** Every captured directive goes to project scope ("always answer in Spanish" must be repeated in each repository). | `agent.ts:2567-2571` |
| C6 | **Failed reflection loses the lesson.** A 429, a timeout or an abort in the one reflection call drops every model-derived candidate; nothing retries later, unlike the turn's own resilience. | `reflection.ts:360-412`; `agent.ts:4051-4058` |
| C7 | **Episodes are never kept.** What happened (request, outcome, what failed, what fixed it) lives only in the session database, per session, and is never searched: recaps are UI-only, compaction summaries and the attempt journal are per session or per turn. | `agent.ts:1174-1177`, `:1597-1645`; `attempt-journal.ts` |
| C8 | **Saturation drops new knowledge silently.** 40 entries per type, then every new one of that type is skipped; no eviction, consolidation or expiry; directive skips are not even audited. | `gate.ts:33`, `:241-248`; `store.ts:349-358` |
| C9 | **Updates overwrite without history, contradictions coexist.** An update replaces body, title, source in place; `supersedes` exists in the schema and no writer sets it; a contradicting fact worded differently lives next to the old one. | `store.ts:367-396`; no caller sets `supersedes` |
| C10 | **The learning signal never fires in practice.** Credit changes only when the host contract passes or fails, which needs checks the project states; the test projects state none, so nothing is ever credited or promoted. | `agent.ts:3747`, `:3901`; `skills.ts:68-73` |

### 2.2 Retrieval: what is stored does not reach the model

| # | Cause | Evidence |
|---|---|---|
| R1 | **Standing rules compete with facts on word overlap.** A human rule with no word in common with the request scores 0 and is neither expanded nor listed; reproduced: "Never touch the generated folder" did not appear for "yes, do it". There is no always-on tier for the user's rules. | `retrieval.ts:138-139`, `:148`, `:188` |
| R2 | **The query is the raw message.** A follow-up ("yes, do it", "continúa") retrieves nothing, and what the previous turn retrieved is gone (the system prompt is rebuilt each turn). | `agent.ts:2578` |
| R3 | **The tokenizer is ASCII-only.** Spanish requests ("configuración del módulo" → `configuraci`, `dulo`) barely match English memories; no plural folding. | `gate.ts:94-100` |
| R4 | **The store follows a drifting cwd.** Scope is `projectMemoryScope(bash.getCwd())`, and a `cd sub` persists: later reads and writes go to `sub/.shelra/memory`, which a session started at the root never sees. The task contract already guards this with the turn-start root; memory does not. | `agent.ts:2567`, `:2578`, `:4049` |
| R5 | **Retrieved once per turn.** Files the model discovers or edits mid-turn do not bring related memory in. | `agent.ts:2576-2616` |
| R6 | **Long entries are never expanded.** The gate admits 6,000 characters; expansion skips any body over ~2,880. | `gate.ts:36`; `retrieval.ts:181-182` |
| R7 | **Superseded and stale facts are not filtered.** Retrieval never reads `supersedes`; recency uses `modified`, not `lastConfirmed`. | `retrieval.ts:76-86`, `:131` |
| R8 | **No explanation.** Nothing records which memories a turn received or why; turns that do not qualify for reflection leave no audit record. | `reflection.ts:355` (returns before the audit) |

### 2.3 Data hygiene

Test fixtures never remove their temp stores (1,383 in `%TEMP%`); the repository's own `.shelra/memory` holds
fake-provider residue with `uses = 158`, which a real turn in this repository would inject.

## 3. The current pipeline (as the code runs it)

```
EVENT (user message, turn outcome)
  ↓ capture ........ directives (regex, always/never/prefer) → project store, no audit      reflection.ts:76-105
  ↓ retrieval ...... raw message → lexical rank → ≤ 4 bodies (3,000 chars) + 12 pointers     retrieval.ts:113-219
  ↓ context ........ system prompt (rebuilt per turn), AGENTS.md, skills, decisions, memory  prompts.ts:162-228
  ↓ agent .......... rounds, tools, gates
  ↓ turn end ....... ONLY on 2 of ~15 exits: learnFromTurn                                   agent.ts:3753, :3912
  ↓ qualification .. verified change | failing change | failure→recovery | ≥ 8 tool calls   reflection.ts:107-119
  ↓ reflection ..... one bounded model call (last round only) + deterministic failure pairs  reflection.ts:352-451
  ↓ gate ........... reject | update | skip | create                                          gate.ts:143-249
  ↓ storage ........ <cwd>/.shelra/memory: MEMORY.md, topic files, history.jsonl, reflections.jsonl
  ↓ credit ......... ±1 only when stated checks ran; promotion to .agents/skills at credit ≥ 2
```

## 4. The target: memory that builds expertise

Principles (from the owner's brief, the skill, and the research):

1. **Store much, retrieve little.** Retrieval quality, not storage volume, is the product.
2. **The host records, the model distils.** Every turn leaves a deterministic episode; model reflection adds
   distilled knowledge when it can, and never blocks or loses the episode.
3. **Provenance and time on every fact.** Who said it (human > observed > inference > web), when it became true,
   whether something replaced it. The repository outranks memory: a fact the code contradicts is demoted.
4. **Guarantees in code, not prompts.** Always-on rules, budgets, scopes and supersession are host logic.
5. **Observable and reversible.** Every write and every retrieval can be explained; nothing changes Shelra's core
   behaviour silently; skill promotion asks the user.
6. **No new infrastructure without evidence.** Files in the project (inspectable, local, survive restarts) and the
   existing SQLite database; lexical retrieval made multilingual; embeddings only if the benchmark shows lexical
   misses that matter (§8).

### 4.1 Memory kinds (CoALA, mapped onto Shelra)

| Kind | What it holds | Where | Written by |
|---|---|---|---|
| Working | the current goal, plan, files touched, errors, verification state | the turn (not persisted as memory) | host |
| Rules | the user's standing rules and corrections, in their words | project store, or user store for personal preferences | host, from the user's messages |
| Semantic | stable project facts: architecture, modules, conventions, dependencies | project store | reflection (inference), host (observed) |
| Episodic | what happened: task, outcome, what failed and why, what fixed it | `episodes.jsonl` in the project store | host, every turn |
| Procedural | how work is done here: commands, workflows, verification steps | project store; promoted to skills with the user's approval | reflection, host (observed commands) |
| Decisions | the user's approved commitments | `docs/decisions` (the ledger, unchanged) | the user's yes |

### 4.2 Capture on every outcome

- Every turn that did work (a tool call, a changed file, a command) appends one **episode** (request, outcome, files,
  commands that failed and what fixed them, closing note, model, session, time), whatever way it ended: Limited,
  Paused, blocked, unverified, stopped, cancelled or answered. No model call; always written
  (`src/memory/episodes.ts`; `Agent.recordUnlearnedTurn` in the turn's `finally` for the exits that skip the
  learning step).
- Those exits also keep, at once, the lessons that need no model (a failed command and the command that got past it).
- When no model could finish the turn (Limited, Paused, no response) or could not run the reflection itself (a 429,
  a timeout), the digest is queued (`pending-reflections.jsonl`, at most 20) and reflected after the next turn's own
  reflection succeeds, one per turn. The lesson is deferred, never lost.
- The exits whose work the host does not trust (tests, checks or decision records changed, no evidence, a Stop hook,
  `report_blocker`) keep the episode and the host-observed lessons, but no model reflects on them: that rule from
  AGENTS.md stands.
- The digest spans every round of the turn.
- Directives: the rule text alone is the fingerprint (no boilerplate); corrections ("no, we use B", "we don't use X
  anymore", "don't …, use …", "remember that …", Spanish forms) are captured; the rule keeps its full sentence;
  personal preferences (language, tone, answer format) go to the user store.
- Every capture is audited, including the reason a turn did not reflect.

### 4.2a Capture while the turn works (M9, 2026-09-25)

Seen live 2026-09-25: a 48-minute turn of 292 tool calls wrote nothing to memory until the user cancelled it, and a
second session asked "what do you have in memory?" in the same project and heard "nothing". Memory is now kept fresh
during the turn, with no model call:

- A failure lesson is written the moment the turn gets past the failure (`Agent.keepMemoryCurrent`), not when it
  ends; the end of the turn proposes it again and the gate skips the identical entry. A lesson needs what got past the
  failure (`recoveryOf`, `src/memory/recovery.ts`): the same check passing later, with the commands in between that
  did something (inspections do not count), or another program given the same first argument (`bun install` for
  `npm install`, `Set-Location "D:\my game"` for `cd D:\my game`). The same command passing after nothing but edits is
  the code being fixed, not a trap, and a failure that never passed teaches nothing: the live session had paired an
  audit script that never passed with an unrelated `Select-String`.
- What the turn has done so far (request, files, failures, tool calls, model) is saved at its first tool result and
  then at most every 20 s, one file per session under `.shelra/memory/live/`, and removed once the turn writes its
  episode. The save names the process; a save whose process is gone is a turn that never ended, and the next turn in
  the project records it as an `interrupted` episode.
- `memory_list` shows, after the saved entries, the turns in progress in other sessions and the last three episodes:
  what the project did lately is memory too.

### 4.2b Memory that is applied, not only shown (2026-09-25)

Seen on the memory suite the same day (a free model): the recall session was given "Run scripts/build-messages.ts to
create src/generated/messages.ts before using t()", edited the locale file the catalog is built from, never ran the
script, and reported done with a stale catalog; retrieval had worked, the model did not act on it. When a turn that
changed files is about to end, the host looks at the how-to entries it was given (build, testing, procedure,
conventions) and the commands they name (`src/memory/apply.ts`: shell code blocks and inline code spans that read as
commands). An entry none of whose commands ran, directly or through the package script of the same name, is named
to the model once, with the files the turn changed: run what applies, or say in one line why it does not. The host
runs nothing a memory names, and asks at most once per turn.

### 4.3 Retrieval engine

Tiers, each with its own budget:

1. **Rules** (always on): every active human rule for this project and user, compact, within a fixed budget. A rule
   is never gated by word overlap.
2. **Relevant knowledge**: semantic and procedural entries ranked for the task.
3. **Relevant episodes**: the two or three most similar past episodes, as short lessons ("last time: X failed
   because Y; Z worked").
4. **Pointers**: the next entries by rank, loadable with `memory_read`.

Query = the current request, plus the previous request for a short follow-up, plus the files and plan of the turn.
Scoring = lexical relevance (multilingual tokens: Unicode letters, accents folded, light English/Spanish stemming,
bilingual keywords written at capture) + file overlap, multiplied by trust, validity (superseded and invalidated
entries are out; stale ones are marked), usefulness (credit, and whether retrieval preceded success) and recency of
confirmation. The store is keyed to the session's root folder, never to a drifting `cd`. Each retrieved item carries
the reason it was chosen (matched terms, tier, score components).

### 4.4 Time, correction and consolidation

- Fields: `status` (active | superseded | invalidated | archived), `validFrom`, `supersedes` / `supersededBy`,
  `lastConfirmed`, plus the existing `source`, `confidence`, `credit`, `uses`.
- A user correction supersedes the entries it contradicts (matched on the corrected subject); a newer fact from an
  equal or higher source supersedes an older one on the same subject instead of overwriting it; the old version stays
  readable ("what used to be true, and when it changed").
- Repository reality: an entry whose files are gone, or whose recorded command now fails, is demoted and marked.
- Consolidation replaces silent drops: past a cap, the lowest-utility inference entry is archived instead of the new
  one being refused; repeated episodes with the same failure become one lesson with a count.

### 4.5 Observability

- Trace events (`SHELRA_TRACE`): the memories a turn received, with tier and reason; every write decision.
- `shelra memory`: `list`, `show <slug>` (with its history), `why "<request>"` (the ranking and reasons),
  `stats` (the funnel from turns to episodes, reflections, admitted entries, retrievals and credit).

### 4.6 Memory that behaves like a person's (M8, 2026-09-25)

The owner asked for memory "as good and expert as human memory". What cognitive science knows about how people remember,
and what Shelra does with it (`src/memory/dynamics.ts`, `consolidate.ts`; practices of the `agent-memory-systems`
skill: decay by recency, frequency and importance, soft deletion, background consolidation, a budget per memory type):

| Human memory | Shelra |
|---|---|
| A memory used often and lately comes to mind first; unused, it fades along a power law (ACT-R base-level activation, Anderson and Schooler 1991) | each entry keeps the days it was recalled; its strength is ln Σ t^-0.5 over its creation, recalls and confirmations, and it ranks entries that are otherwise equal |
| Using a memory strengthens it (the testing effect); merely seeing it does not | an entry strengthens when it is used: the model reads it (`memory_read`), or the turn runs and passes the command it names (`reconfirmByPassingCommands`). Being shown to the model is exposure only (`uses`), so two look-alike entries shown together do not strengthen alike |
| Salient events are kept longer | `importance`: 1 for what the user said, higher for a failure that recurred; an important, credited or human entry never fades by disuse |
| Sleep turns the day's experiences into knowledge | once a day, before a turn's recall: a command that failed in several turns, and what got past it each time, becomes one observed lesson with its count; an inference nobody used for months, never credited or important, is archived |
| Forgetting is not losing: relearning is fast (savings) | an archived entry keeps its file and index line; a request that matches it is offered it ("faded from disuse but matching"), and reading it brings it back as active |
| Remembering to do something when a cue appears (prospective memory) | "recuérdame X la próxima vez que toquemos Y" keeps a reminder with its cue words; the request that names them gets it, once, and it is marked done |
| Knowing what one knows (metamemory) | shown entries are labelled firm or fading, and a request memory knows nothing about is told so, so a model does not assume earlier work that never happened |

Measured on a simulated project life (`bench/memory/life.ts`, 240 days, 46 entries; the control replays the same days
without dynamics). The simulation does what the product does: every request goes through `buildMemoryContext`, being
shown is exposure only, the agent can use a procedure only when it was shown, and using it (running the command it
names) strengthens every entry that names that command, by the store's own rule. A habit (needed every few days) ranks
above a look-alike note with the same index line in 99% of 795 requests (control 0%); all 20 never-used notes fade while
all rules, costly lessons, habits and rarely needed entries stay (the store goes from 46 to 26); all 20 faded notes are
offered back when a request asks about them. On the static retrieval benchmarks (no usage history) the dynamics change
nothing: v1 recall 91%, held-out v2 83%.

A first version of this simulation handed each recall to the entry it knew was needed, which the product cannot know;
the round-3 review caught it (with the product's signal as it then was, "habit first" fell to 0%). The fix was in the
product, not the simulation: a memory now strengthens when it is used, not when it is shown.

## 5. What stays from the 2026-09-17 decisions

Repo-local Markdown store; one deterministic write gate in front of every writer; host-assigned provenance with the
human veto; one bounded reflection call per qualifying turn (now also deferred instead of lost); lexical retrieval,
no embeddings for code; the decision ledger stays separate and approval-only; resilience (memory never fails a turn);
free models only for any measurement. Active decision D-0006 ("Shelra is never stateless") is served, not changed.

## 6. How it is proven

The owner's 18 acceptance criteria map onto three layers of evidence:

1. **Unit and scripted-agent tests** (fake model, temp workspaces, no network): restart and new-session survival,
   rule retention and no clobbering, corrections superseding, failure episodes retrieved for a similar task,
   architecture change superseding the old fact, project isolation, cwd drift, capture on every exit, explanations.
   Criteria 1–13, 15, 17.
2. **An offline memory benchmark** (`bench/memory/`, deterministic, no model): synthetic stores of 100 to 5,000
   entries across projects, gold-labelled queries in English and Spanish, follow-ups and superseded facts; measures
   precision@k, recall@k, MRR, contamination across projects, stale or superseded retrievals, latency and injected
   characters. Before/after numbers are committed. Criteria 5, 10–14, 16.
3. **Real-model evaluation** on free models, few runs: the memory suite (`bench/suites/shelra-memory-v0.1.json`)
   with memory kept versus wiped, plus scenarios for correction retention and failure avoidance. Criterion 18.

## 7. Phases

| Phase | Delivers | Proof |
|---|---|---|
| M1 (done 2026-09-25) | Capture on every exit + episodes + deferred reflection + cross-round digest; directive fingerprint fix, corrections, user-scope preferences; root-keyed store; audit of non-qualifying turns | `src/agent/memory-capture.test.ts` (Limited, drain, re-queue, Stop hook, root after `cd`, user-wide), `src/memory/episodes.test.ts`, directive tests in `src/memory/reflection.test.ts`; §2.1 C3 probe passes |
| M2 (done 2026-09-25) | Retrieval tiers (always-on rules), multilingual tokenizer, follow-up query, file signals, reasons; trace events | `bench/memory/` (blind dataset, 103 queries): at 5,000 entries per project recall 60% → 91%, precision 39% → 68%, rules shown 13% → 100%, Spanish → English 17% → 87%, follow-ups 8% → 81%, 430 → ~100 ms; `src/memory/terms.test.ts`, `retrieval.test.ts`, follow-up test in `src/agent/memory-capture.test.ts`; sub-agent shells keep the session root |
| M3 (done 2026-09-25) | Temporal fields, supersession, correction handling, repository-reality demotion, history of versions | `status`/`supersededBy`/`validUntil`; a superseded entry leaves the index, its file kept, and the newer one says "Replaces: … (true until …)"; a user's correction retires what it contradicts (index line only, never past failures or notes about the change itself), an inference never retires a human statement; `versions/` keeps the last 10 bodies of a rewritten entry. Benchmark: superseded facts shown as current 10 → 0, recall and precision unchanged or better. Tests in `store.test.ts`, `reflection.test.ts`, `retrieval.test.ts`. Repository-reality demotion stays the existing staleness mark |
| M4 (done 2026-09-25) | Episode retrieval as lessons; consolidation, utility-based archiving instead of silent drops; fixture hygiene | the two past attempts most like a request are shown as one-line lessons (outcome, what failed, what worked, files), repeated attempts counted once; a full type or index archives its least useful inference instead of refusing, never a human statement; the new test files remove their temp stores. Tests in `episodes.test.ts`, `reflection.test.ts`, `src/agent/memory-capture.test.ts` |
| M5 (done 2026-09-25) | `shelra memory` CLI (list, show, why, stats) | `src/memory/cli.ts`: `list [--all]`, `show <slug>` (versions, history, what replaced it), `why "<request>" [--previous] [--full]` (the same context a turn builds, each item with its tier, score and reasons), `stats` (turns → reflections → entries → uses → credit); `src/memory/cli.test.ts`; smoke-run on the built CLI path |
| M6 (done 2026-09-25) | Procedural: validated procedures proposed as skills, promoted on the user's yes | `src/memory/skills.ts`: a procedure credited in two passing turns is proposed under `.shelra/memory/skill-proposals/`; `shelra memory skills / promote / decline`; a declined revision is not proposed again; an update to an approved skill is proposed too. Tests in `reflection.test.ts`, `cli.test.ts`. The terminal UI does not show proposals yet (the UI is another session's area) |
| M7 (one sample, 2026-09-25) | Real-model evaluation on free models | the memory suite on `42da87a`, Nemotron free (`MEM-R3-nemotron-1`): 5/6; with memory both recall tasks passed (37 s and 30 s), without memory one passed (83 s) and one failed with a false completion. One sample, consistent with the 2026-09-17 tally (with 4/6, without 1/9); not proof |
| M8 (done 2026-09-25) | Memory that behaves like a person's (§4.6) | `dynamics.test.ts`, `consolidate.test.ts`, reminder and metamemory tests, `bench/memory/life.ts` |
| M9 (done 2026-09-25) | Capture while the turn works (§4.2a): lessons as they happen, the live save and its recovery, recent work in `memory_list`; lessons only from what got past a failure; index entries always one line; memory applied, not only shown (§4.2b) | memory-capture tests ("memory kept while a turn works"), `tools.test.ts` (recent work and turns in progress), `reflection.test.ts` and `store.test.ts` (the live 2026-09-25 cases) |
| Held-out check (2026-09-25) | A second dataset written blind after all tuning (`bench/memory/dataset-v2.json`, 3 new projects, 92 queries) | at 5,000 entries per project: the original engine recall 65%, precision 48%, rules 20%, superseded shown 8; round 2 recall 83%, precision 75%, rules 100%, superseded 0, noise 0. Weak: vague requests (43%), superseded subjects (67%) |

## 7a. Adversarial review of M1 and M2 (round 2, 2026-09-25)

Two reviewers read the committed range 276abaa..817d357 (correctness; safety, privacy and resilience), and a separate
skeptic tried to refute each finding with the code and, where it could, a probe. All 13 findings held; all are fixed,
each with a test that pins it:

| Finding | Fix |
|---|---|
| Episodes and pending digests kept keys, passwords, private keys and home paths that the gate would reject (high) | one redactor (`redactSecrets` + the trace's `redact`, home folder → `~`) on every stored field; `.shelra/memory/.gitignore` keeps the folder out of version control |
| A line of an @-attached file became the user's standing rule, even user-wide (high) | directives come from the typed text only (`typedText` drops `<attached_files>`) |
| Task remarks ("no, the bug is in …", "note that the output above …") became permanent human facts (high) | a task-local filter; "note that" and "ten en cuenta que" are no longer facts; corrections must state a convention |
| Two rules sharing their first 48 characters overwrote each other | a statement of the user's with a colliding generated name gets its own |
| A restated rule became a second rule, and "Node 18" then "Node 20" stood together | statements compared on their words alone: a rewording updates, a new value supersedes, a different rule stands |
| A short new request took the previous request's words, which outranked its own | the previous request is read in full only for a bare follow-up, at 0.4 for a qualified one ("ok, now in prod"), not at all for a new request |
| A second follow-up in a row lost the request it carried on | a follow-up keeps the request before it as the one memory is found for |
| A turn that ended in an error was recorded as verified or answered | the error exit leaves an `[Error — …]` note; its reflection is deferred |
| The deferred reflection held every turn up to 45 s, even a chat turn, and retried forever | it runs only after this turn's own reflection called the model and got an answer, 30 s at most; an item is dropped after three failed attempts, with an audit record |
| A deferred reflection of a turn cut Limited skipped the unverified confidence cap | any change nothing checked is capped at 0.4 |
| "Make the API respond in English" went to the user-wide store | only a preference addressed to Shelra ("answer me in Spanish") is user-wide |
| Ambiguous Spanish words (seguro, tema, programación, registro, ingreso, cifra) and "rerun" became coding terms; singular and plural did not meet | removed from the lexicon; plurals fold before -ing/-ed, and a doubled consonant with them |

The memory benchmark after the fixes: recall 91%, precision 70%, MRR 0.83, superseded shown 0, rules 100%, 35 ms p50 at
5,000 entries per project (`bench/memory/results/after-review2.json`).

## 7b. Adversarial review of M3 to M8 (round 3, 2026-09-25)

The same method as §7a over 817d357..f9add04: two reviewers, one skeptic per finding. All 13 findings held; all are
fixed, each with a test:

| Finding | Fix |
|---|---|
| The life simulation handed each recall to the entry it knew was needed; with the product's signal (every shown entry recalled) its result did not hold | a memory strengthens when it is used (`memory_read`, or the turn passes the command it names), not when it is shown; the simulation replays exactly that |
| The model could write a "reminder" with `memory_write`; shown as the user's own, and one in the user-wide store came back on every request | `memory_write` cannot write reminders; only the user's own project reminders are given |
| A cued reminder was crossed off before any model answered, so a turn cut Limited lost it | it is crossed off when the turn closes, and only if a model answered |
| One generic cue word ("module") fired a reminder; "when we work on it again" fired on the next unrelated request | generic words are not cues, a request must name half of the cue words, and a cue that only points at the conversation takes its words from the request before |
| The history kept the raw request a reminder was given with, keys included | it keeps the time only |
| Knowledge entries passed only the gate's narrow secret check; a password could end up in a lesson's file name | the gate refuses anything the redactor would change; what the host builds (statements, observed failures) is redacted before its name is made; a model's proposal with a secret is refused |
| The redactor missed Slack and Discord webhooks, npm tokens, `whsec_`, `glpat-`, `hf_`, SendGrid, Basic auth, signed-URL parameters, `mysql -p…` and PGP keys | all added |
| "Use Biome instead of ESLint" retired the Biome entries and the user's own Biome rule (the lexicon folds both into "lint"); "we don't use npm anymore, we use bun" retired nothing | a correction is matched on the words as written (`rawTerms`), and "anymore" is not part of its subject |
| "Never deploy on Fridays" then "Always deploy on Fridays" left both as standing rules | a rule whose sense, language or indentation is turned around replaces the old one; two rules that differ in any other word both stand |
| Consolidation made a test that went red then green into a permanent "keeps failing" lesson | the same command passing later is not a way around; consolidated lessons stay below the importance that never fades |
| An approved skill was proposed again after every passing turn | the skill file no longer carries counters that grow |
| `shelra memory stats` counted consolidations and reminders as reflections, archivals as writes | audit records carry their kind |

## 8. Decisions taken for the owner, and assumptions

- **No embeddings in v2.** The prior decision holds; the multilingual tokenizer and bilingual keywords address the
  measured misses. If the benchmark shows lexical retrieval missing what matters, a local embedding index is the next
  option and is the owner's call (a new dependency).
- **Skill promotion asks the user**, as decisions do: a promoted skill changes how Shelra works, which the brief says
  must never happen silently.
- **Memory stays local** (`.shelra/` is gitignored); committing it is a later, separate choice.
- **The execution plan.** The owner put memory ahead of the plan's F4–F5 work on 2026-09-24 ("vamos a enfocarnos en
  la memoria antes de continuar"); the paused F4 re-measure resumes afterwards.
