> Evidence for docs/architecture/20-LONG-HORIZON-AUDIT.md. Round 1 forensic lane: every store that crosses a session boundary, its writer and its reader, at commit 45f87d1. Kept as written by its lane on 2026-10-02, with local paths removed; the audit document, not this file, states the conclusions.

# Forensic state map: can Shelra hold one project for a year?

Lane: forensic code. Scope: the live path only (`src/index.ts` -p / `src/ui` → `Agent.processMessage` in
`src/agent/agent.ts` → providers → tools → completion gate → memory). Repository state: `main` at `45f87d1`, clean.
Every claim is file:line in the repository. "Probe" = a read-only Bun script run from a scratch folder that imports
repo modules into a temp workspace (no repo writes); its output is quoted where used.

Legend for "Reaches the model": **SP** = injected into the system prompt; **TR** = returned by a tool the model must
call; **MSG** = put into the message list; **UI** = only shown in the terminal UI; **CLI** = only a `shelra …`
command; **GATE** = used by host logic, never shown; **WO** = write-only (no reader on the live path, grep-proven).

## Key findings (detail and evidence below)

1. Nothing task-shaped outlives a session. The plan, requirements, acceptance criteria and step statuses live only in
   that session's `tool_results` (transcript.ts:302-322). No store holds an objective, phase, task list, blocker or
   commit link that a new session reads (D).
2. Even inside one session the plan stops working after the turn that published it: `planState.structured` is reset
   every turn (agent.ts:2724), so `update_plan_step` answers "No plan is published" (tools.ts:1421-1427). The old
   criteria commands still join every later turn's contract (agent.ts:4053-4060).
3. A fresh session that says "continúa" gets no repository context, no research, no diagnosis, and is told "treat it
   as new here, and do not assume earlier work on it" (probe, B.3). An interrupted turn shows up only when the new
   request repeats its words, or when the model calls `memory_list`.
4. A crash or SIGINT loses the whole in-flight round from the transcript (up to 400 steps; in round 1 the user
   message too). The 20 s live save keeps only request, files, failures and counts. Nothing stops side effects from
   running twice (H).
5. Write-only stores: the `checkpoints` table (full file pre-images, unbounded, read only by a test-only function),
   the `objectives` rows (read only to restore the UI of the same session, then thrown away), the `objective_tasks`
   table (never written), `sessions.status` (always `'active'`), `Episode.summary` (never printed),
   `swallowed-errors.jsonl`. These reach the CLI or UI but never the model: `history.jsonl`, `reflections.jsonl`,
   `versions/`, the session recap (a model call after every round), traces (A).
6. Standing user rules are capped. At most 40 per type are stored and none is ever evicted, so the 41st is skipped
   quietly. The prompt shows 1,500 characters of them, then 12 pointers, then a count (probe: 42 stated, 40 stored,
   17 shown in full) (F).
7. Each part keys to a different folder. Memory uses the launch folder, sessions use the git root, and the ledger
   prompt, proposals, AGENTS.md, skills and the context packet use the shell's current cwd, which carries across
   turns. After a `cd`, decisions drop out of the prompt while the gate still enforces them (E, G).
8. The decision ledger can only supersede. It cannot retire a decision, detect two that contradict each other, or
   record the alternatives that were rejected. Memory keeps a separate `decisions` type, written by the model,
   unapproved and unenforced, with no link to the ledger (E).
9. Compaction summaries are written by the turn's own (free) model. The host keeps only the acceptance criteria
   verbatim. Goal, steps, failed approaches and decisions survive only if that model keeps them (C.2).

---

## A. Durable stores the live path writes

### A.1 SQLite `~/.shelra/shelra.db` (`src/storage/db.ts:23-40`, WAL, schema `src/storage/migrations.ts`)

| Table (schema line) | Written by (call site) | When | Fields of note | Read back by / reaches model |
|---|---|---|---|---|
| `workspaces` (migrations.ts:34-41) | `ensureWorkspace` (storage/workspaces.ts:24-60) from `new SessionStore(cwd)` (agent.ts:731, :1378, :1394) | every Agent construction / new or resumed session | `scope_key` = **git root, else realpath of cwd** (workspaces.ts:62-66), `last_seen_at` | keys sessions; GATE/CLI only |
| `sessions` (migrations.ts:43-57) | `createSession` (sessions.ts:52-75), `touchSession` (sessions.ts:193-201), `setModel/setMode/setTitle/setRecap` | session create; every completed round (agent.ts:2623) | `status` is written `'active'` (sessions.ts:61) and **never updated anywhere** (grep `SET status` hits only tool_calls/benchmarks); `recap_*`; `cwd_at_start/cwd_last`; timestamps | `openSession` on `-s`/`latest` (sessions.ts:33-50); `listSessions` for `shelra sessions` and TUI /resume (sessions.ts:95-127, index.ts:2183, app.tsx:2648). `status` is WO |
| `sessions.recap_text` | `refreshSessionRecap` (agent.ts:1757-1787): an extra model call (8 s cap) after **every completed round** (agent.ts:3656, :3732), default on (settings.ts:716-718) | per round | model-written prose recap | **UI banner only** (app.tsx:714, :4893) and the next recap prompt (agent.ts:1801). Never sent to the working model |
| `messages` (migrations.ts:59-66) | `appendMessages` (transcript.ts:114-205) via `appendCompletedTurn` (agent.ts:2596-2625) — the only caller besides delegation notices (agent.ts:1872) | **at the end of each model round** (agent.ts:3654), on recovered interruptions (agent.ts:1514, :1704), on text-only fallbacks (agent.ts:3730, :4797) | full ModelMessage JSON, `seq`, `created_at`; no retention | resume: `loadTranscriptState` (transcript.ts:96-104) in constructor (agent.ts:735-737) and `openSavedSession` (agent.ts:1423-1425) → **MSG**, same session only |
| `tool_calls`, `tool_results` (migrations.ts:68-88) | same `appendMessages` (transcript.ts:155-198); results normalized by `extractToolResultFromOutput` (tool-results.ts:3-44, keeps `plan`/`planUpdate`, drops `blocker`) | per round | args, output JSON, success | (a) `loadPersistedPlanState` (transcript.ts:302-322) → plan restore (agent.ts:1064-1080) → **GATE**; (b) `buildChatEntries` → UI |
| `compactions` (migrations.ts:118-131) | `appendCompaction` (transcript.ts:226-239) from `compactOnce` (agent.ts:2509) | when context ≥ ~85% of window | `first_kept_seq`, model-written `summary`, `tokens_before` | `loadLatestCompaction` (transcript.ts:64-76) → `buildEffectiveTranscript` (transcript-view.ts:18-45) → **MSG** (as a `system` message) on resume of the same session |
| `usage_events` (migrations.ts:90-101) | `recordUsageEvent` (usage.ts:26-61) via `recordUsage` (agent.ts:1809-1827) | per model call | tokens, cost, model | budgets + UI (usage.ts:63-121); not knowledge |
| `objectives` (migrations.ts:151-167) | `persistKernelIndex` → `upsertObjectiveIndex` (agent.ts:1113-1134, objectives.ts:57-93), ~10× per turn (agent.ts:2725-2727, :2973, …) | per turn; **one row per turn** (kernel id = `randomUUID()` per turn, kernel.ts:41, new kernel agent.ts:2718) | `request` = the raw user message of that turn (e.g. "continúa"), `phase`, `blocker`, `run_dir=NULL`; mutations/observations NOT stored | only `getLatestObjectiveForSession` in `loadPersistedKernel` (agent.ts:1082-1103), same session, used by the UI's `getKernelState` (app.tsx:734) and **discarded at the next turn** (`this.kernel = null`, agent.ts:2675). `shelra objectives` reads the autonomy journal instead (index.ts:2079-2084 → autonomy/presentation.ts:162-170). Effectively **WO for the model** |
| `objective_tasks` (migrations.ts:169-179) | `upsertObjectiveTask` (objectives.ts:133-159) has **zero callers** (grep: only its definition and the re-export at storage/index.ts:37) | never | status/attempts/last_error | `listObjectiveTasks` has no caller either. **Dead table** |
| `checkpoints` (migrations.ts:181-196) | `recordCheckpoint` (objectives.ts:216-243) via `onToolCheckpoint` (agent.ts:1136-1156) before every write/edit/delete | every file-tool mutation | full `previous_content` pre-image, `reason`, session, workspace; **no retention or pruning** (only DELETE in storage is benchmarks.ts:503) | `getLatestCheckpoint` is used only by `revertLatestCheckpoint` (tools/checkpoint.ts:18-44), whose only importer is its test (`src/tools/checkpoint.test.ts:11`); `listCheckpointsForSession` has no caller. `restore_file` uses the in-memory per-turn `AttemptJournal` instead (agent.ts:1163-1195, :2677). **WO, unbounded** |
| `benchmark_*` (migrations.ts:211-389) | bench only | — | — | not on the chat path |

### A.2 Files under `<root>/.shelra/memory/` (project scope)

`<root>` = `this.bash.getRootCwd()` = the folder Shelra was **launched in**, not the git root: `new BashTool(options.cwd ??
process.cwd())` with no `root` option (agent.ts:683-686) ⇒ `rootCwd = start` (bash.ts:59-64); memory uses it
(agent.ts:2848-2849, tools.ts:196). Memory dir = `<root>/.shelra/memory` (store.ts:65-71); a `.gitignore` of `*` is
written on first use (store.ts:77-89), so **memory never travels with the repository**.

| File | Written by | When | Fields | Read back / reaches model |
|---|---|---|---|---|
| `MEMORY.md` (index) + `<slug>.md` topic files | `writeMemoryEntry` (store.ts:401-469) via the gate (`admitCandidates`, reflection.ts:565-648) or the `memory_write` tool (tools.ts:811-878); counters by `recordMemoryUse` (store.ts:756-771), `recordRecall` (:734-745), `creditMemoryUse` (:778-789), `confirmMemoryEntry` (:792-805) | directives each turn (agent.ts:2858-2883), reflection at turn end (agent.ts:4840-4847), failure lessons mid-turn (agent.ts:4948-4962), consolidation (consolidate.ts:129-131) | frontmatter: `type, modified, created, source (human/observed/inference/web), confidence, lastConfirmed, relatedFiles, tags, uses, recalls[], importance, lastUsed, credit, supersedes, revision, status, supersededBy, validUntil` (types.ts:62-107). No scope beyond project/user; no branch, no session, no task id | **SP every turn** via `memoryContextFor` (prompts.ts:223-247, agent.ts:2886-2888); **TR** via `memory_list` (tools.ts:729-760) and `memory_read` (tools.ts:762-809) |
| `versions/<slug>.r<N>.md` | `keepVersion` (store.ts:475-490) on a body rewrite | update | old body, ≤10 per slug (store.ts:473) | `readMemoryVersions` only in `shelra memory show` (memory/cli.ts:140). **CLI-only / WO for model** |
| `history.jsonl` | `appendHistory` (store.ts:315-328), rotates at 1 MB keeping newest half (store.ts:51, :319-322) | every write/supersede/archive/recall | `{at,event,slug,source,type,revision,detail}` (types.ts:179-196) | `readMemoryHistory` only in memory/cli.ts:148. **CLI-only** |
| `reflections.jsonl` | `appendReflectionAudit` (store.ts:881-894), same rotation | every capture/reflection/consolidation/unlearned turn | why memory changed, raw model text | `readReflectionAudit` only in memory/cli.ts:193 (stats). **CLI-only** |
| `archive.jsonl` | `archiveMemoryEntry` (store.ts:516-553), append-only | consolidation fade (consolidate.ts:133-139) or "make room" (reflection.ts:588-594) | slug/title/hook/at/reason | `listArchivedEntries` (store.ts:566-585) → `memoryContextFor` "faded" pointers ≤2 (prompts.ts:235, retrieval.ts:509-528) → **SP**; `memory_read` restores (tools.ts:791) |
| `episodes.jsonl` | `appendEpisode` (episodes.ts:154-160) from `learnFromTurn` (agent.ts:4836-4838), `recordUnlearnedTurn` (agent.ts:4998), `recoverInterruptedTurns` (episodes.ts:268-272); rotates at 4 MB keeping newest half (episodes.ts:82, :145-151) | end of every agent-mode turn that did work | `{at, session, outcome, request (≤600), summary (≤600), files (≤25), failures (≤6: command,error,fixedBy), toolCalls, note (≤300), model}` (episodes.ts:53-66, :126-143) | (a) `episodeLessons` ≤2 lines (episodes.ts:431-474) in `memoryContextFor` (prompts.ts:238-242) → **SP, only on lexical match**; (b) `memory_list` last 3 (tools.ts:739, :754-757) → **TR**; (c) consolidation (consolidate.ts:56). The `summary`, `session` and `model` fields are **never printed** to the model or CLI: `lessonLine` (episodes.ts:391-409) omits them; grep `episode.summary` = 0 hits. **`summary` is WO** |
| `live/<session>.json` | `saveLiveEpisode` (episodes.ts:200-209) from `keepMemoryCurrent` (agent.ts:4940-4971) | on a tool result, first one immediately then ≤ every 20 s (`LIVE_SAVE_MS`, agent.ts:335, :4964-4967; `liveSavedAt` reset to 0 per turn, agent.ts:2939) | Episode minus outcome, plus `pid`; files = **file-tool mutations only** (agent.ts:2945; shell changes are merged only into the final digest, agent.ts:2953-2957) | removed at turn end (agent.ts:2664); `recoverInterruptedTurns` (episodes.ts:262-280, called agent.ts:2854) → interrupted episode; `liveEpisodes` (episodes.ts:247-256) → `memory_list` "in progress" (tools.ts:740, :750-753) |
| `pending-reflections.jsonl` | `queuePendingReflection` (episodes.ts:314-340), ≤20 kept | Limited/Paused/error exits (agent.ts:5005-5007) or a failed reflection call (agent.ts:4864) | clipped digest | `takePendingReflection` in `reflectDeferred` (agent.ts:4878-4907) → reflection model, not the working model |
| `consolidation.json` | `consolidateMemory` (consolidate.ts:125-126) | ≤ once per 20 h (consolidate.ts:29) | `lastRun` | consolidation scheduler only |
| `skill-proposals/<slug>.md`, `declined.json` | `proposeProceduresAsSkills` (skills.ts:85-140) from `learnFromTurn` (agent.ts:4867) | procedure with credit ≥2 | rendered SKILL.md | **CLI** (`shelra memory skills/promote`, skills.ts:143-192); on approval → `.agents/skills/<slug>/SKILL.md` → `discoverSkills` (skills.ts:198-215) → **SP** skills catalog |
| `agents/<name>/` scope | `agentMemoryScope` (store.ts:109-111) | **never** (zero callers) | — | dead |

### A.3 User-level files `~/.shelra/`

| Store | Writer | Reader |
|---|---|---|
| `~/.shelra/memory/` (user-wide memory) — `userMemoryScope()` = `{workspace: homedir}` so the dir is `~/.shelra/memory` (store.ts:118-120 + :65-71) | directives tagged `user-wide` (agent.ts:2863-2866, PERSONAL regex reflection.ts:99-100); **also the model** via `memory_write scope:"user"` (tools.ts:830-839, source forced to `inference`, tools.ts:851) | **SP every turn in every project** (`listUserMemoryRecords`, prompts.ts:232), marked `[user-wide]` (retrieval.ts:436, :455) |
| `~/.shelra/logs/sessions/<session>.jsonl` (turn trace) | `startTurnTrace` (utils/session-trace.ts:194-246), written as events happen; kept 14 days (session-trace.ts:33) | **CLI only** `shelra trace` (index.ts:2235-2277). Most complete crash record, never given to a model |
| `~/.shelra/logs/swallowed-errors.jsonl` | `recordSwallowedError` (utils/diagnostics.ts:8, :21-24) | **no reader in src** (grep). **WO** |
| `~/.shelra/delegations/<basename-sha1(cwd)>/<id>.json/.md` | `DelegationManager.start/complete/fail` (delegations.ts:55-131, :199-222, :224-229) | `consumeNotifications` at the start of the **next turn, in any later session** (agent.ts:2711 → :1865-1889) → **MSG** (persisted `system` message, transcript.ts:207-209); `delegation_read` **TR** |
| `~/.shelra/AGENTS.md` | the user | `loadCustomInstructions` (instructions.ts:40-42) → **SP** in every project |

### A.4 Repository files

| Store | Writer | Reader |
|---|---|---|
| `docs/decisions/NNNN-*.md` (ledger) | `proposeDecision` (ledger/store.ts:273-325) from the `propose_decision` tool (tools.ts:708-727 → agent.ts:888-947); `approveDecision`/`rejectDecision` (ledger/store.ts:355-375) from the TUI panel (agent.ts:911-942, app.tsx:2899-2923) or `shelra decisions approve/reject` (ledger/cli.ts:59) | **SP** every turn (prompts.ts:190 → ledger/prompt.ts:17-32) and **GATE** (agent.ts:2680, :4035-4040, :4093-4097). Versioned in git with the code |
| `.agents/skills/<slug>/SKILL.md` | `approveSkillProposal` (skills.ts:163-176), CLI only | **SP** catalog (skills.ts:223-231); body on demand via `read_file` |
| `.shelra/objectives/<id>/` | autonomy runtime only (`--autonomous`, retiring) | `shelra objectives` (index.ts:2079). Not written by the chat path (agent.ts imports nothing from `src/autonomy`) |

---

## B. What a fresh session (no `-s`) sends on its first request

Construction: no `-s` ⇒ `openSession(undefined)` ⇒ `createSession` (sessions.ts:34-36); headless creates one per run
(index.ts:1015-1020), the TUI one per launch (index.ts:470-475). `this.messages=[]`, `previousRequest=undefined`
(agent.ts:629, set only at :2922-2924), `checkBaselineCarry=null` (agent.ts:599), no running processes.

### B.1 Assembly order (agent.ts:2669-2997, then per round :3179-3307)

1. Hooks `SessionStart`, `UserPromptSubmit` fire; **their output is discarded** (agent.ts:2699, :2708 `.catch(()=>{})`, no result used) — hooks cannot inject context.
2. **Delegation notices** from any earlier session's finished background explore jobs → `system` messages, persisted (agent.ts:2711, :1865-1875).
3. User message (vision-expanded) pushed (agent.ts:2731-2737). **Not persisted yet** (seq null; persisted at round end).
4. **Pre-work diagnosis** (agent mode, `wantsDiagnosis`, not a short follow-up — pre-work.ts:33-36): host runs the project's checks, injected as fake `bash` tool-call/result pairs (agent.ts:2742-2782). ≤ `MAX_CHECKS`, bounded by `DIAGNOSIS_TIMEOUT_MS`.
5. **Research pre-task** (agent mode, `wantsResearch`: ≥3 search terms and not a short follow-up — research/pre-task.ts:44-50): one search, injected as a fake `search_web` pair (agent.ts:2798-2841).
6. `compileContextPacket(this.bash.getCwd(), …)` (agent.ts:2844).
7. Memory: `recoverInterruptedTurns` (agent.ts:2854), directive capture (agent.ts:2858-2883), daily `consolidateMemory` (agent.ts:2885), `memoryContextFor(root, userMessage, packet.files, previousRequest)` (agent.ts:2886-2888). `recordMemoryUse` on expanded (agent.ts:2932).
8. System prompt (agent.ts:2979-2997) = `buildSystemPrompt(getCwd(), …)` (prompts.ts:158-206) ⧺ `contextPacket.promptAppendix` ⧺ `runningProcessesNote` (empty in a new process, agent.ts:5425-5437), through `applyModelConstraints` (prompts.ts:478-492).
9. Each round: `compactForContext` (agent.ts:3185) then `messagesForContext` (agent.ts:3194-3202); tools re-created per round (agent.ts:3204-3243); `provider.stream` with `maxSteps = maxToolRounds` (default 400, agent.ts:255, :3301). Stale tool results are cleared per step **in the request only** (local-provider.ts:216-218 → stale-tool-results.ts:100-140).

### B.2 Inside `buildSystemPrompt` (prompts.ts:203), in this order, with caps

| # | Section | Source | Cap |
|---|---|---|---|
| 1 | Mode prompt (agent/plan/ask) | prompts.ts:59-145; agent step 2 says "Check memory_list once for prior findings" (prompts.ts:63) | fixed |
| 2 | Sandbox section | prompts.ts:444-476 | fixed |
| 3 | CUSTOM INSTRUCTIONS | `loadCustomInstructions(cwd)` (instructions.ts:75-98): `~/.shelra/AGENTS.md`, then `AGENTS.override.md` or `AGENTS.md` from git root down to cwd (instructions.ts:37-58). **CLAUDE.md is not loaded** (only its command table is read by check discovery, contract/discover.ts:76) | **uncapped** |
| 4 | DECISIONS | `activeDecisions(cwd)` (ledger/store.ts:244-246) → `formatDecisionsForPrompt` | ≤30 decisions, rule clipped 240 chars; `why`/`evidence` not shown (ledger/prompt.ts:4-5, :22-26) |
| 5 | PROJECT MEMORY | `buildMemoryContext` (retrieval.ts:349-487) over project+user records, plus episode lessons | reminders due (all cued); standing rules ≤1,500 chars of hooks (retrieval.ts:95, :379-391); ≤4 expanded bodies within 3,000 chars and ≥60% of best score (retrieval.ts:87-100, :394-412); ≤12 pointers, rest counted (retrieval.ts:94, :416-421); ≤2 faded (retrieval.ts:526); ≤2 episode lessons × 420 chars (episodes.ts:376-377); "Nothing saved matches…" note (retrieval.ts:564-575) |
| 6 | AGENT SKILLS | `discoverSkills(cwd)`: `~/.agents/skills` + `.agents/skills` from cwd up to git root (utils/skills.ts:174-215) | uncapped count |
| 7 | CUSTOM SUB-AGENTS | `~/.shelra/user-settings.json` (prompts.ts:147-156) | uncapped |
| 8 | APPROVED PLAN | `this.planContext` — set by the TUI in-process, cleared after one turn (agent.ts:811-814, :2999) | — |
| 9 | cwd, scratch line, today | prompts.ts:174-176 | — |
| + | HOST-COMPILED REPOSITORY CONTEXT | context/compiler.ts:262-298: stated checks, git branch, ≤12 uncommitted files + shortstat, **last 3 commits**, files the request names (≤12), whole file list if ≤40 files else ≤8 related tests | ≤8,000 chars (compiler.ts:9); **empty when the request classifies as "conversation"** (compiler.ts:264-266) |

### B.3 What a fresh session does NOT receive (unless the user resumes that exact session)

- **The previous objective / requests**: no store holds them for injection. Episodes keep `request` but surface only on lexical overlap; the reflection prompt forbids storing "the task itself" (reflection.ts:356).
- **The previous plan, requirements, acceptance criteria, step statuses**: only in that session's `tool_results` (transcript.ts:302-322); restored only for that session (agent.ts:738, :1426).
- **The last verdict** (`[Not verified — …]`, `[Checked by Shelra …]`): stored by `recordVerdict` inside the session transcript (agent.ts:1725-1747); a fresh session sees it only as an episode `note` (≤300 chars, shown ≤110 and only for non-verified outcomes, episodes.ts:407) when lexically matched.
- **The final answer of the last turn** ("next: write tests"): stored as `Episode.summary` but never printed (episodes.ts:391-409).
- **The recap**: UI only (app.tsx:4893).
- **Kernel state, objectives rows, check-baseline carry, allowed check kinds, previous request**: in-memory or same-session only (agent.ts:599, :606, :629, :1082-1103).
- **Git state** when the request reads as conversation ("continúa", "what were we doing?") — no context packet (compiler.ts:264-266).

Probe (temp workspace, one observed entry, one recovered interrupted turn "Implement the kart physics refactor in
src/kart.ts and add drift tests"):

```
classifyTurn/isShortFollowUp/wantsResearch:
  "continúa"            → terms ["continua"], follow-up=true,  class=conversation, research=false
  "sigue con lo que estabas haciendo" → terms ["estaba","haciendo"], class=conversation, research=false
memoryContextFor(ws,"continúa") →
  Other saved entries: - Build with bun …
  Nothing saved matches this request closely: treat it as new here, and do not assume earlier work on it.
memoryContextFor(ws,"continue the kart physics refactor") →
  Past attempts …: - 2026-10-03 · interrupted · "Implement the kart physics refactor in src/kart.ts and add drift
  tests" · `bun test` failed (…) · files: src/kart.ts · [Interrupted — …]
```

So a fresh "continue" after a crash is **told explicitly to assume no earlier work**; the interrupted work appears only
if the new request repeats its words, or if the model calls `memory_list` (3 most recent episodes, tools.ts:739).

---

## C. Resume and compaction

### C.1 Resume

- CLI: `-s, --session <id|latest>` (index.ts:1765) → `new Agent({session})` → `SessionStore.openSession` (sessions.ts:33-50): `latest` = most recently updated session **of this workspace** (git-root keyed, sessions.ts:77-89), or a new session if none; an id is looked up globally.
- TUI `/resume`: lists this workspace's sessions (or all) (app.tsx:2648) → `agent.openSavedSession(id)` (agent.ts:1392-1430). A chat from another workspace whose folder still exists is refused with a `cd` hint (agent.ts:1397-1402); one whose folder is gone continues **here**.
- What comes back: effective transcript (latest compaction summary + messages from `first_kept_seq`, transcript-view.ts:33-44); plan criteria/steps (agent.ts:1426 → :1064-1080); the last objective row as a kernel for the UI (agent.ts:1428).
- What does not: `previousRequest` (not reset or reloaded in `openSavedSession`, agent.ts:1392-1430 — it keeps the *previous session's* value in a TUI process), `checkBaselineCarry`, `previousAllowedCheckKinds`, the attempt journal, background processes, the turn's live save.
- **Plan progress cannot continue after a resume or even in the next turn of the same process**: `planState` is reset to `{structured:false}` at every turn start (agent.ts:2724); `createTools` reads it (tools.ts:356); `update_plan_step` then answers "No plan is published in this session… Nothing changed." (tools.ts:1421-1427). Meanwhile the old plan's criteria stay session-active: their commands join every later turn's contract when `commandBefore !== "passed"` (agent.ts:4053-4060), while the gate lists them to the model only if the plan came from this turn or the request is a short follow-up (agent.ts:4434-4435).
- The kernel restored on resume is thrown away at the first turn (agent.ts:2675, :2718).

### C.2 Compaction (`src/agent/compaction.ts`, `Agent.compactOnce` agent.ts:2472-2522)

- **Trigger**: before every round when the model's window is known (agent.ts:3183-3193): `estimate × 1.15 > window − reserve` (compaction.ts:379-385); reserve = 15% of window (min 2,048, max 50%), keep-recent = 35% of window (compaction.ts:357-377). Up to 3 passes, each halving keep-recent (agent.ts:2457-2467, compaction.ts:480-486). No manual command exists (no `/compact` in src; see I).
- **Cut**: last messages worth `keepRecentTokens`, never at a `tool` message; a split turn gets a separate prefix summary (compaction.ts:400-472, :113-126).
- **Summary**: **model-written by the turn's own model** (`this.modelId`, agent.ts:2499-2506; temperature 0.2, compaction.ts:557-565) in a fixed template: Goal, Constraints & Preferences, Progress (Done/In Progress/Blocked), Key Decisions, Next Steps, Critical Context (compaction.ts:69-100). Incremental: an existing summary is updated (compaction.ts:102-111, :546-551). Tool results are truncated to 2,000 chars in the serialized input (compaction.ts:27, :167-170).
- **Host-preserved verbatim**: only the active acceptance criteria (id, description, verification) appended after the prose (compaction.ts:243-254, agent.ts:2507). **Not preserved by the host**: plan goal, requirements, step statuses, failed approaches, decisions, the user's objective — those survive only if the model's summary keeps them.
- **Persistence**: `compactions` row + the summary becomes `messages[0]` (role `system`) (agent.ts:2509-2511). Old messages remain in `messages` (immutable history) but are never re-read once a compaction exists (transcript-view.ts:33-38). Nothing is written outside the session (no memory entry, no episode).
- Overflow ladder: `trimToRecentTurns` keeps the summary + last N user turns **in memory only** (agent.ts:2545-2559); persisted transcript untouched.
- A failed summarizer call is treated as an interruption of the round (agent.ts:4729-4734).

### C.3 Stale tool results (`src/providers/stale-tool-results.ts`)

Per generation (one `stream` call), once the request passes 160,000 chars, results older than the last 3 assistant
steps and >1,000 chars become a note; old `write_file`/`edit_file` text args too (stale-tool-results.ts:13-21,
:108-139). Never cleared: `generate_plan`, `task`, `delegation_read`, `paid_request` (:21). Request-only; the transcript
keeps everything (:11). State `{boundary}` lives per stream call (local-provider.ts:172), so it resets every round.

---

## D. Task state across sessions

| Candidate representation | Scope | Persisted? | Read by a NEW session? |
|---|---|---|---|
| `generate_plan` result (title, goal, requirements, acceptance criteria with `command`/`commandBefore`, steps with `satisfies`/`status`) (tools.ts:1241-1407) | session | yes, inside `tool_results` | **no** (only `loadPersistedPlanState(this.session.id)`, agent.ts:1059-1080) |
| `update_plan_step` updates incl. host-downgraded `claimed` (tools.ts:1409-1449; `resolvePlanResults` replays them, plans/state.ts:9-36) | session | yes, `planUpdate` in `tool_results` | no; and disabled after the publishing turn (C.1) |
| `objectives` rows (request, phase, blocker) | per turn, keyed to session | yes | no (same-session UI only) |
| `objective_tasks` (status, attempts, last_error) | — | never written | — |
| `AgentKernel` (objective, phase, scope, mutations, observations, attemptCount) (kernel.ts:17-29) | turn | only phase/blocker via objectives | no |
| `AttemptJournal` (pre-images for `restore_file`) | turn (agent.ts:2677) | no (checkpoints table is a WO copy) | no |
| Live save `live/<session>.json` | project root | yes, ≤20 s stale | indirectly: converted to an `interrupted` episode by the next agent-mode turn in that root (agent.ts:2854) |
| Episodes (`outcome`, `request`, `files`, `failures`, `note`) | project root | yes | **only by lexical match** (≤2 lessons, episodes.ts:431-474) or `memory_list` (3 most recent) |
| Requirement checklist / audit (agent.ts:3036-3037) | turn | no | no |
| `report_blocker` reason (tools.ts:1454-1465) | turn | text only (structured `blocker` dropped by tool-results.ts:8-22) | only as text in that session's transcript / episode note |
| Retries, interruption counts (agent.ts:3003-3008) | turn | no | no |
| Commit links | — | none anywhere (context packet shows last 3 commits, compiler.ts:96-99) | — |

Verdict: there is **no persistent representation of an objective, phase, task list, dependencies, blockers,
per-task evidence or acceptance criteria that outlives a session**. Everything task-shaped is session-scoped
(plan) or turn-scoped (kernel, audit, journal). The only cross-session task trace is the episode line.

---

## E. Decisions (the ledger, `src/ledger/*`)

- **Format** (ledger/store.ts:43-64): front matter `id: D-NNNN`, `title`, `status: proposed|active|superseded`, `source: user|agent|adr|instructions`, `scope` (globs), optional `check`, `proposed`, `approved`, `supersedes`, `superseded_by`; body = rule, `## Why`, `## Evidence`. No field for alternatives considered, owner, expiry or review date (types.ts:19-45). A file that says `active` without `approved` is read as `proposed` (store.ts:180-182).
- **Propose**: model tool `propose_decision` (tools.ts:708-727) → `proposeDecisionFromTool` (agent.ts:888-947) → `proposeDecision(this.bash.getCwd(), …)` (agent.ts:889-892). Validation: title ≤120, rule ≤1,500, check one line ≤300, ≤20 relative simple globs (store.ts:14-17, :278-293); `supersedes` must name an active decision (store.ts:295-300); duplicates detected **only by normalized title** among non-superseded decisions (store.ts:301-306).
- **Approve**: only the user — TUI panel (agent.ts:911-934, app.tsx:2899-2923) or `shelra decisions approve` (ledger/cli.ts:59). Headless has no approver ⇒ proposal waits (agent.ts:910-912). Approval of a superseding decision flips the old one to `superseded` + `superseded_by` (store.ts:355-365). `reject` deletes a proposal (store.ts:368-375).
- **Retirement without replacement**: none. CLI verbs are list/check/show/approve/reject (ledger/cli.ts:31-61). An active decision can only leave by being superseded.
- **Contradicting active decisions**: nothing detects them. Both are listed in the prompt; both checks join the contract if the change touches both scopes (agent.ts:4035-4040, :4093-4097); if the checks contradict, the turn can never pass and ends unverified.
- **Injection**: every turn's system prompt, ≤30 decisions, rule ≤240 chars (ledger/prompt.ts:4-5, :17-32). Read from `cwd = this.bash.getCwd()` (prompts.ts:190 via agent.ts:2982), while the gate's `turnDecisions` comes from the root (agent.ts:2680). After a `cd` into a subfolder (shell cwd persists across turns, bash.ts:98) the prompt loses the decisions that the gate still enforces, and new proposals are written under `<subfolder>/docs/decisions` (agent.ts:889).
- **Enforcement**: only decisions with a `check`, only when the turn mutated files inside `scope` and the change is not documents-only (agent.ts:3838-3839, :4027-4040). The check runs on the final code as a contract item (`kind: "decision"`, agent.ts:4093-4097); "could not run" is not a violation (judge.ts:54-69). Edits to ledger files outside `propose_decision` are sent back once (agent.ts:3949-4006).
- **Versus memory "decisions"**: `MemoryType` also has `decisions` and `architecture` (types.ts:17-24); `memory_write`'s description invites "an architecture decision" (tools.ts:813) and reflection may propose "a decision and the alternative rejected" (reflection.ts:355). These are `inference`, unapproved, unenforced, lexically ranked, can fade and be archived (dynamics.ts:70-74) or be superseded by a reflection (reflection.ts:613-630). No link or reconciliation between the two decision stores.

---

## F. Memory semantics (`src/memory/`)

### F.1 Knowledge classes vs. what exists

| Class | Distinct representation? | Where |
|---|---|---|
| Project identity | **No** (only AGENTS.md text, uncapped, instructions.ts) | — |
| User intent / objective | **No** (explicitly excluded from reflection, reflection.ts:356) | episodes keep the request text |
| Requirements | **No** (plan requirements are session-scoped) | — |
| Constraints | Partly: user rules (`preference`, tag `user-directive`, source `human`) and ledger decisions | reflection.ts:240-261, ledger |
| Architectural decisions + rationale + alternatives | Free-form `decisions`/`architecture` entries; ledger has rule/why/evidence, no alternatives | types.ts:17-24; ledger/types.ts:19-45 |
| Current state | **No** (git summary recomputed per coding turn, compiler.ts:72-101) | — |
| Task state | **No** (D) | — |
| Episodic history | Yes: `episodes.jsonl` | episodes.ts |
| Learned conventions / procedures | `conventions`, `build`, `testing`, `procedure` (+ skill promotion) | types.ts, skills.ts |
| Failures | `failure`, `known-problems`, `debugging`; host-observed lessons | reflection.ts:286-332, consolidate.ts:51-103 |
| User corrections | `conventions` + tags `user-directive`,`correction` | reflection.ts:205-212, :250-259 |
| Obsolete info | `status: superseded/archived/done` (+ `invalidated`, which **no code ever sets**: grep shows only types.ts:110, store.ts:139) | store.ts:516-715 |
| Temporary context | Only `reminder` (consumed once, `done`); sentences with "for now/today/hoy" are refused as rules (reflection.ts:93); no TTL for anything else | store.ts:638-658 |

### F.2 Subsystems

| Subsystem | Write path | Retrieval / ranking | Provenance & time | Supersession / invalidation | GC / caps |
|---|---|---|---|---|---|
| User directives | regex capture of the typed text, no model (reflection.ts:221-264), 5 per message, routed project vs user (agent.ts:2862-2879) | **standing-rule tier**: `source=human` and (`preference` or tag `user-directive`) (retrieval.ts:151-155), shown by hook within 1,500 chars, overflow becomes pointers (retrieval.ts:379-391, :419) | `human`, confidence 1, date in body | same rule with a new value / flipped always↔never / language swap → new entry supersedes (gate.ts:146-203); a correction retires entries whose index line names the corrected subject (reflection.ts:512-538, :613-630) | never faded/archived (dynamics.ts:71, reflection.ts:556-563). **Per-type cap 40 applies** (gate.ts:40, :421-429) and `makeRoom` can never evict a human entry ⇒ the 41st rule is silently skipped (audited only). Probe: 42 rules stated → 40 stored, last decision `skip: type "preference" already holds 40 entries`; prompt showed 17 in full, 12 listed, rest only counted |
| Model reflection | one bounded call when the turn qualifies (verified change, failing change, failure→recovery, ≥8 tool calls; reflection.ts:266-278), ≤5 candidates (reflection.ts:59), provider-structured JSON then 2 text tries (reflection.ts:686-732) | knowledge tier: rarity-weighted lexical relevance (EN/ES lexicon), path overlap, trust × strength × importance × staleness × credit (retrieval.ts:277-338) | `inference`, confidence capped 0.4 + tag `unverified` when unchecked (reflection.ts:736-745) | may name `supersedes` of an existing slug (reflection.ts:354, :613-630); an inference never retires a human entry (:624) | gate: reject secrets / injection-shaped / web directives (gate.ts:314-332); near-duplicate (Jaccard ≥0.6) **merges into the existing slug** (overwrite, old body to `versions/`) rather than superseding (gate.ts:386-419, store.ts:430) |
| Host-observed lessons | `deterministicFailureCandidates` mid-turn when a command passes after a failure (agent.ts:4948-4962) and at turn end (reflection.ts:759-764); `recurringLessons` in consolidation (consolidate.ts:51-103) | knowledge tier | `observed`, 0.6 / 0.9 | gate merge | as above |
| `memory_write` tool | model → gate → `writeMemoryEntry` (tools.ts:837-878) | — | forced `inference` (tools.ts:851) | **ignores `decision.supersedes` and `decision.full`**: a full type returns "Not saved… The existing entry … already covers this" (tools.ts:857-862) with no archive-to-make-room | index cap error message on overflow (tools.ts:864-869) |
| `memory_delete` tool | `deleteMemoryEntry` (tools.ts:880-904 → store.ts:837-861) | — | — | **hard delete with no source check**: the model can delete a human-stated rule; file removed (no version kept), history line only | — |
| Episodes | host, every agent-mode turn that did work (agent.ts:4836-4838, :4988-4998) | lesson match needs ≥2 query terms or half of them (episodes.ts:461); repeated requests collapse, failures weigh 1.2× (episodes.ts:441-469) | `at`, `session`, `model`, `outcome` | none (append-only log) | rotate at 4 MB, newest half (episodes.ts:82); lessons scan last 400 (prompts.ts:238) |
| Strength / fade | `recordRecall` on `memory_read` or a passing command the entry names (store.ts:734-745, :813-826); `uses` on injection (store.ts:756-771) | ACT-R activation (dynamics.ts:36-47), labels firm/fading (:62-67) | `recalls[]` ≤12 days (dynamics.ts:17) | — | archive when inference, unimportant, uncredited, >45 days, strength <0.2 (dynamics.ts:70-74), ≤20 per daily pass (consolidate.ts:35) |
| Credit | +1 when the contract passed with the entry expanded (agent.ts:4681-4682), −1 when the unverified exit fires (agent.ts:4298) | ×(1 + 0.08·credit), bounded (retrieval.ts:312) | — | — | — |
| Staleness | `detectStaleness`: a `relatedFiles` path missing or modified after `lastConfirmed`, or unconfirmed >180 days (retrieval.ts:125-145) | ×0.7, marked "MAY BE STALE" (retrieval.ts:318, :442) | `lastConfirmed` refreshed when a named command passes (store.ts:813-826) | **no invalidation**: stale entries stay current truth | — |

**Index caps**: 200 lines / 25 KB per scope (store.ts:48-49); a write over the cap is refused (store.ts:415-424);
`admitCandidates` then archives the least useful non-human current entry (reflection.ts:588-607). With only human
entries left, writes are refused. **Concurrency**: index rewrites are read-modify-write without a lock
(store.ts:408-457); two sessions on one root can drop each other's index line, leaving a topic file invisible to
retrieval and `listMemoryRecords` (store.ts:381-390) — inferred from code, not reproduced.

**Conflict resolution order** (gate.ts:304-431): safety rejects → human-vs-human relation → exact slug (human only
revised by human; lower trust skipped) → near-duplicate merge/skip by trust and confidence → per-type cap → create.

---

## G. Cross-project isolation

- **Memory root** = launch folder (bash.ts:59-64, agent.ts:683, :2848). **Sessions** = git root, else realpath (workspaces.ts:62-73). **Ledger** gate = launch folder (agent.ts:2680); ledger prompt/proposals, AGENTS.md chain, skills and the context packet = the *current shell cwd* (agent.ts:889, :2844, :2982). **Delegations** = `basename-sha1(current cwd)` (delegations.ts:224-229, :283-291).
  Consequences: launching in `repo/packages/a` creates `repo/packages/a/.shelra/memory` separate from `repo/.shelra/memory`, while `shelra -s latest` from either folder resumes the same git-root session list.
- **Crosses every project**: `~/.shelra/memory` user store (prompts.ts:232) — written by personal-preference directives **and by the model** via `memory_write scope:"user"` (tools.ts:830-839), so a model inference can follow the user into every repository as a `[user-wide]` entry; `~/.shelra/AGENTS.md` (instructions.ts:40-42); `~/.agents/skills` (skills.ts:199-206); custom sub-agents from `~/.shelra/user-settings.json` (prompts.ts:155); the global SQLite DB (sessions filtered by workspace except `--all`, sessions.ts:95-106).
- **Edge**: launching in the home directory makes `projectMemoryScope(home)` and `userMemoryScope()` the same folder `~/.shelra/memory` (store.ts:65-71, :105-120): project entries become user-wide.
- `openSavedSession` refuses another workspace's chat only while its folder exists (agent.ts:1397-1402).

---

## H. Interruption / crash

1. **What is on disk mid-turn**:
   - Transcript: only completed rounds. `appendCompletedTurn` runs when a round's stream resolves (agent.ts:3630-3656) or a recovered interruption saves its completed steps (agent.ts:1513-1518). A round may hold up to 400 tool steps (agent.ts:255, :3301), so a kill mid-round loses **all** of that round's messages — and, in the first round, the user message itself (it is persisted only by `appendCompletedTurn`, the sole `appendMessages` caller for user text, transcript.ts:114 / agent.ts:2617).
   - Live save: `live/<session>.json`, at the first tool result then ≤ every 20 s, only on tool-result events, agent mode with memory on (agent.ts:2852, :3512-3514, :4964-4967). Content: request ≤600, last-answer clip ≤600, file-tool mutations ≤25, ≤6 failures, tool-call count, model, pid (episodes.ts:126-143, :200-209). No plan, criteria, tool-call log, shell-made changes or commit info.
   - Objectives row (phase/blocker), checkpoints pre-images, session trace events — none read back for the model.
2. **Signals**: `SIGINT`/`SIGTERM` call `process.exit` after releasing local runtimes (index.ts:434-443); no turn flush, no episode, no `appendCompletedTurn` — same as a crash. The `finally` of `processMessage` (agent.ts:2660-2666) runs only for in-process exits (Esc, errors).
3. **Detection**: on the next **agent-mode turn in the same root, in any session**, `recoverInterruptedTurns` turns each save whose pid is not alive into an `interrupted` episode and deletes the save (agent.ts:2854, episodes.ts:262-280). `processAlive` uses `process.kill(pid,0)` (episodes.ts:220-229): a reused pid keeps a dead turn "alive" (not recovered, and listed as "in progress in another session" by `memory_list`).
4. **Is the next model told what was in progress and what remained?** Only (a) as a lesson line if the new request shares ≥2 terms (or half) with the old request/files/failures, and the line omits the last answer/next steps (episodes.ts:391-409); (b) via `memory_list` if the model calls it. A short "continúa" gets the "treat it as new here, and do not assume earlier work" note (probe in B.3). If the user resumes the killed session with `-s`, the transcript ends at the last completed round with no interruption marker; `interruptionContinuation` ("do not redo finished work", agent.ts:5412-5417) exists only for in-process interruptions.
5. **Duplicate side effects**: nothing prevents them. Tool calls are not journaled before execution, there are no idempotency keys, the checkpoint pre-images are never consulted, and the lost round's writes/commands are invisible to the transcript. A resumed or fresh model can re-run writes, migrations, commits or deploys.
6. **Esc (cancel)**: `discardAbortedTurn` removes the user message from memory only (agent.ts:1749-1755); rounds already persisted stay in SQLite, so a later resume shows a turn the live process forgot. The episode is still written as `cancelled` (agent.ts:4988-5021).

---

## I. Contradictions (docs vs code) and undocumented long-horizon behaviour

### I.1 Docs claim, code does otherwise

1. **README.md:199** "in `.shelra/memory/` at the project's root" — the root is the launch folder, not the repo root (bash.ts:59-64, agent.ts:683); sessions use the git root (workspaces.ts:62-66).
2. **README.md:203-204 / AGENTS.md "Persistent memory" ("the user's standing rules, facts and corrections reach every request")** — 1,500-char rule budget, overflow as ≤12 pointers then only a count (retrieval.ts:95, :379-391, :416-421); storage caps rules at 40 per type with no eviction of human entries (gate.ts:40, :421-429; reflection.ts:556-563). Probe: 42 → 40 stored, 17 in full.
3. **README.md:791** "Use `/compact` in TUI" — no such command in `src` (grep for `/compact` / `"compact"` returns nothing; compaction is only automatic, agent.ts:3183-3193).
4. **README.md:359** "`--session latest` picks up where you left off" — the transcript returns, but plan steps cannot be updated (agent.ts:2724, tools.ts:356, :1421-1427), the kernel is discarded (agent.ts:2675), and `previousRequest`/check baseline are lost (agent.ts:599, :629).
5. **`openSavedSession` doc comment (agent.ts:1386-1391)** "transcript, plan state and task kernel come back, and the next turn goes on from them" — same as 4.
6. **docs/architecture/18-MEMORY-V2.md §4.3** "Query = the current request, plus the previous request …, plus the files and plan of the turn" — no plan in the query (agent.ts:2888, prompts.ts:223-236).
7. **doc 18 §4.4** "Fields: `status` (active | superseded | invalidated | archived), `validFrom`…" — no `validFrom` (types.ts:62-107); `invalidated` is never set (grep).
8. **doc 18 §4.4** "a newer fact from an equal or higher source supersedes an older one on the same subject instead of overwriting it" — a near-duplicate inference/observation is merged into the same slug (overwrite + `versions/`), gate.ts:413-418, store.ts:430; supersession happens only for a reflection-named `supersedes`, a human new value, or a human correction (reflection.ts:613-619).
9. **doc 18 §4.4** "an entry whose files are gone, or whose recorded command now fails, is demoted and marked" — only files/age count (retrieval.ts:125-145); a failing command lowers `credit` of whatever was expanded, not "its" command (agent.ts:4298). The doc's own M3 row ("stays the existing staleness mark", doc 18 line 253) contradicts §4.4.
10. **AGENTS.md "Every turn that did work records an episode … however it ended"** — agent mode only (agent.ts:4834, :4991); a killed process records nothing unless a live save exists, and then only on the next agent-mode turn in that root (agent.ts:2852-2854).
11. **CLAUDE.md "active decisions go into every request"** — capped at 30 and read from the shell cwd, so they drop out of the prompt after a `cd` while the gate (root) still enforces them (prompts.ts:190, agent.ts:2680, :2982).
12. **storage/objectives.ts:4-12 and agent.ts:1105-1112** ("'what is this session doing right now' becomes a query against `objectives`") — no live-path or CLI reader queries it beyond the same-session UI restore; `shelra objectives` reads autonomy journals (index.ts:2079-2084).
13. **tools/checkpoint.ts:11-17** describes reverting from checkpoints — the function is imported only by its test; checkpoints are write-only and unbounded.
14. **memory/types.ts:117-120** documents agent-scoped memory — `agentMemoryScope` has no callers.
15. **AGENTS.md** says the live save/interrupted episode keeps memory fresh — true on disk, but the next model sees it only by lexical match (B.3 probe), and `Episode.summary` is never shown to anyone.

### I.2 Code behaviour that matters for a year and is not documented

- A fresh-session follow-up ("continúa", "sigue") is classified as conversation (no repository context, compiler.ts:264-266), skips research and diagnosis (pre-task.ts:46, pre-work.ts:35), and receives "treat it as new here, and do not assume earlier work on it" (retrieval.ts:564-575).
- An earlier turn's plan criteria commands keep joining the contract of every later turn in the same session, related or not, until another plan replaces them (agent.ts:4053-4060).
- The model can hard-delete a human-stated rule (`memory_delete`, tools.ts:880-904), bypassing the "only the human revises a human statement" rule that the gate enforces for writes (gate.ts:342-349).
- The model can write user-wide memory that appears in every project (tools.ts:830-839).
- A recap model call runs after every completed round (agent.ts:3656, :3732) but its output reaches only the UI.
- Finished background delegations from a previous session are injected into the next session as persisted `system` messages (agent.ts:1865-1875).
- Memory is git-ignored (store.ts:77-89) while the ledger is versioned: a clone or a second machine has the decisions but none of the episodes, rules or lessons.
- Growth without bound: `messages`/`tool_results` and `checkpoints` (full file pre-images) have no retention; `archive.jsonl` is append-only. Rotations that discard: history/reflections at 1 MB (newest half), episodes at 4 MB (newest half), traces 14 days.
- Hook outputs (SessionStart, UserPromptSubmit) are ignored, so a user cannot inject project state through hooks (agent.ts:2699, :2708).
- `sessions.status` stays `'active'` forever (sessions.ts:61; no update path).

---

## Appendix: probes (read-only on the repo)

Scripts were kept in the audit's scratch folder (not committed) and run with `bun run <file>`, with `SHELRA_USER_MEMORY_ROOT` pointed at a
scratch `home/`, `SHELRA_TRACE=off` and `SHELRA_DIAGNOSTICS_LOG=off`. They import repository modules and write only
to `ws/`, `ws2/` and `home/` next to the scripts:

- `probe.ts`: `searchTerms`, `isShortFollowUp`, `previousRequestWeight`, `classifyTurn` and `wantsResearch` on
  resume-style prompts.
- `probe2.ts`: a live save with a dead pid, then `recoverInterruptedTurns` and `memoryContextFor` for "continúa",
  "sigue con lo que estabas haciendo" and "continue the kart physics refactor" (B.3).
- `probe3.ts`: 42 directives starting with "Always …" through `extractUserDirectives` and `admitCandidates`, then the
  rule tier for an unrelated request (F.2).

Not run: a real-model turn, a kill during a live turn, two concurrent sessions writing `MEMORY.md`. The H and F.2
points about those come from reading the code.
