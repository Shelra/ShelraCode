# Lane 12 — Durable harness mechanics and long-horizon resume

Researcher: durable-harness-researcher. Written 2026-09-15; sources accessed 2026-09-14/2026-09-15
(full list in `research/sources/12-durable-harness.md`). This lane does not reopen the mission's selected
thesis (`docs/future-research/08_SELECTED_THESIS.md`). It builds on `research/lanes/05-commodity-map.md`
(general competitive commodity map; flags cross-session state as an open problem) without re-deriving it,
and is complementary to `research/lanes/11-memory-taxonomy.md` (what memory *types* should exist — not
this lane's question) and `research/lanes/07-reality-alignment.md` (reconciliation/observability).

**Question:** what do today's best-documented coding-agent harnesses actually persist across a session
boundary or a compaction event, and what does durable-execution research say a long-horizon autonomous
system's runtime must own rather than merely request of the model?

**Method note:** `docs.claude.com` now 301-redirects to `code.claude.com/docs/en/*`; all Claude Code
citations below use the live `code.claude.com` URLs. The arXiv Atom API returned HTTP 429 on every call
this session (consistent with lanes 01/04/05/11's experience this mission); arXiv discovery ran through
WebSearch plus direct `arxiv.org/html` and `arxiv.org/abs` fetches. WebSearch itself hit a session rate
limit mid-run and recovered after a reset; where a fact rests only on a WebSearch synthesis rather than an
opened primary document, it is marked accordingly and confidence is downgraded. Two apparently-official
Codex doc mirrors (`doc.jarvisuni.com/openai/codex/...`, `codex-docs.com`) surfaced repeatedly in search
results; both are unofficial third-party mirrors, not `openai.com` or `learn.chatgpt.com` properties, and
are not cited below except where independently corroborated by `learn.chatgpt.com/codex/hooks` (the real
OpenAI-owned Codex docs domain as of this session) or GitHub.

---

## 1. Summary (10 lines)

1. Claude Code's own documentation states outright that crash recovery is not replay: "a tool that was
   still running when the previous process ended... doesn't finish or run again when you resume; Claude
   continues without its output." This is the opposite of what "durable execution" means in the
   distributed-systems literature this lane also covers, and no coding-agent harness found here does
   otherwise.
2. Anthropic's own docs draw the harness-enforced/model-requested line explicitly and repeatedly: CLAUDE.md
   and auto memory are "context, not enforced configuration... To block an action regardless of what Claude
   decides, use a PreToolUse hook instead," and separately, "Settings rules are enforced by the client
   regardless of what Claude decides to do."
3. The one guardrail meant to hold across a long unattended run — the auto-mode classifier's own stated
   boundaries — is itself not durable: it is "re-read... from the transcript on each check," so it can be
   deleted by the exact compaction event a long `/goal` run is most likely to trigger.
4. What *does* survive a Claude Code compaction is narrow and named precisely: project-root CLAUDE.md,
   auto memory, the plan-mode plan, up to five recently-modified files, path-scoped rules and nested
   CLAUDE.md that re-trigger on file access, and invoked-skill bodies (capped at 5,000 tokens/skill, 25,000
   total). Task/todo state is conspicuously absent from that list.
5. Auto memory is the one Claude Code artifact explicitly exempted from the 30-day transcript-retention
   sweep and is explicitly machine-local, never synced. The two facts together mean the "project memory
   that survives a long gap" story holds only on one person's one machine — not across a team, not across
   Claude Code's own other surfaces (web, VS Code, desktop each keep separate session history).
6. Every other production harness with public docs (Codex, Cursor, Cline, OpenCode, Gemini CLI) follows the
   same shape: an appendable transcript plus a periodic LLM-authored summary, not an event log with
   deterministic replay. Cline's Memory Bank — often cited as the community's memory pattern — is not a
   harness feature at all; it is prompt text the user copies into custom instructions, entirely
   model-requested with zero runtime enforcement.
7. Codex shipped native `PreCompact`/`PostCompact` hooks between an April 2026 feature request (explicitly:
   "Codex does not expose a post-compaction hook") and this session's fetch of the live docs, which list
   both as established features with no version note — an absorption gap of roughly four to five months,
   consistent with lane 05's collapsing-lag finding.
8. The distributed-systems term this lane is implicitly borrowed from has a precise, decades-old meaning
   that none of these harnesses satisfy: Temporal's durable execution requires deterministic replay of an
   Event History with all non-determinism — explicitly including LLM/AI invocations — pushed into
   non-replayed Activities. Every coding-agent harness in this lane puts the LLM call *inside* the
   replay-equivalent path and cannot guarantee determinism, which is why none of them replay; they
   summarize instead.
9. A 2026 research paper (AgentRewind) that does implement environment+context checkpointing with
   agent-triggered rewind measures the cost of *not* doing this: +25.6 percentage points of task success
   over a plain "continue" baseline on an 82-task coding benchmark (87.8% vs 62.2%). No shipping vendor
   publishes an equivalent number for its own default compaction behavior.
10. The restart test for Claude Code specifically, worked through against its own documented defaults, is
    sharp and testable: after six months of absence, a returning user gets CLAUDE.md unchanged, auto memory
    fully intact (exempt from the sweep), and — because session transcripts, checkpoints, and scheduled
    tasks all fall under the documented default `cleanupPeriodDays` of ~30 days — nothing else. No
    `/resume`, no `/rewind`, no active goal, no todo list. The product is designed to bet everything on
    CLAUDE.md plus a small distilled memory file, not on session continuity.

---

## 2. Claude Code long-horizon mechanism table

All rows sourced from `code.claude.com/docs/en/*`, fetched 2026-09-14/15 (full citations in the sources
file). "OBSERVED TODAY" unless noted.

| Mechanism | What persists | Store / scope | What is lost | Source |
|---|---|---|---|---|
| CLAUDE.md hierarchy | Full file content; managed policy → user → project → local, concatenated root-to-cwd, `CLAUDE.local.md` last within each level | Four fixed filesystem locations (managed policy path, `~/.claude/CLAUDE.md`, `./CLAUDE.md` or `./.claude/CLAUDE.md`, `./CLAUDE.local.md`); re-read from disk every session | Nothing that isn't a disk-editing mistake — it is not itself a record of past sessions, only standing instructions | `en/memory` |
| Auto memory | 4 note types (`user`, `feedback`, `project`, `reference`) in `MEMORY.md` + topic files; `modified` ISO-8601 timestamp per note (v2.1.214+) | `~/.claude/projects/<project>/memory/`, one directory per git repo, shared across all worktrees, **machine-local, never synced** | First 200 lines / 25KB of `MEMORY.md` load at session start — the rest, and all topic files, load only on demand; skips anything derivable from the codebase or already in CLAUDE.md | `en/memory` |
| Session resume (`--continue`/`--resume`/`/resume`) | Full conversation incl. tool calls/results; model (with exceptions); agent; permission mode (with a documented exception table); active goal (turn count/timer/token baseline reset); non-expired scheduled tasks | `~/.claude/projects/<project>/<session-id>.jsonl`, JSONL, internal format "changes between versions" | A tool still mid-flight when the process died "doesn't finish or run again... Claude continues without its output"; `--mcp-config`/`--settings`/`--plugin-dir`/`--fallback-model`/mid-session `--add-dir` must be re-passed; background Bash/monitor tasks not restored | `en/sessions` |
| Context compaction (auto or `/compact`) | Structured LLM-written summary (intent, concepts, files+snippets, errors+fixes, pending tasks, current work); **re-injected from disk**: project-root CLAUDE.md, auto memory, the plan-mode plan; **re-read**: up to 5 most-recently-modified files (>5K-token files come back as a reference, not content); path-scoped rules / nested CLAUDE.md reload only as matching files are re-touched; invoked-skill bodies re-attached (5K tokens/skill, 25K total, oldest dropped first) | In-conversation; nothing written to a separate compaction store | Full tool outputs and intermediate reasoning; the skill *description* listing itself does not reload — only bodies of skills already invoked; a rule/nested-CLAUDE.md not yet re-triggered by a file touch | `en/context-window` |
| Checkpoints / `/rewind` | Per-turn-start file snapshots, last 100 kept; conversation + code jointly or separately restorable; summarize-from/up-to-here | Saved with the session; default ~30-day retention tied to `cleanupPeriodDays` | Bash-command file changes (`rm`/`mv`/`cp`); subagent edits except a foreground forked skill; external/concurrent-session edits; symlinked/hard-linked paths; messages that joined a running turn mid-stream | `en/checkpointing` |
| Skills progressive disclosure | `description` (≤1,536 chars) loads every turn; full body loads only on invocation and then persists in context; a re-invocation with identical rendered content is deduplicated, not re-sent | In-context once invoked; unchanged on disk | Non-invoked bodies never load; post-compaction, the *description index itself does not reload* — only already-invoked bodies, capped and truncated from the end | `en/skills` |
| `/goal` | Condition text carried over every resume route (session picker included, as of v2.1.239) | Session-scoped; implemented as a session-scoped prompt-based Stop hook | Turn count, timer, token-spend baseline all reset on resume; an already-achieved or cleared goal is not restored | `en/goal` |
| Task tracking (`TodoWrite`/`TaskCreate`/`TaskUpdate`/`TaskList`/`TaskGet`) | Structured tool calls visible in the transcript | No store independent of the transcript itself | **INFERRED**: not named anywhere in the documented "what survives compaction" table (contrast with the plan file, which *is* explicitly named) — its post-compaction fate depends on whether the LLM-written summary's "pending tasks" prose happens to capture it | `en/agent-sdk/todo-tracking`; absence confirmed against `en/context-window` |
| Auto-mode classifier boundaries | Conversational statements the classifier treats as scope limits | Not stored as a rule; **"re-read... from the transcript on each check"** | Can be deleted outright if compaction removes the message that stated the boundary; the docs' own fix is "for a hard guarantee, add a deny rule instead" | `en/permission-modes` |
| Transcript/checkpoint retention | — | `~/.claude/projects/<project>/`, default `cleanupPeriodDays` ≈ 30 days, configurable | Everything above tied to the transcript (resume, checkpoints, scheduled tasks) ages out by default well inside a "months-long gap"; auto memory is explicitly *excluded* from this sweep | `en/memory` ("excludes the memory files... from that retention sweep"), `en/sessions`, `en/checkpointing` |

---

## 3. Comparable mechanisms in other harnesses

Lane 05 already maps who ships checkpoints/hooks/memory/subagents at a capability level; this section is
the resume/compaction/task-persistence *mechanics* lane 05 didn't need.

| System | Mechanism | What persists | Store / scope | What is lost / caveat | Source |
|---|---|---|---|---|---|
| Codex (OpenAI) | Hooks incl. `PreCompact`/`PostCompact` | Both exist as of this session's fetch; matcher on `trigger` (`manual`/`auto`); `PreCompact` can veto compaction (`continue:false`), `PostCompact` cannot undo it; `SessionStart` fires with `source:"compact"` after a root-session compaction so hooks can react | Hook config in settings; session logs at `~/.codex/sessions/*.jsonl` with structured `event_msg`/`context_compacted` entries | GitHub issue #19061 (opened 2026-04-23): "Codex does not expose a post-compaction hook, so external memory systems have to use brittle workarounds" — i.e. as late as April 2026 this did not exist. Exact ship date **NOT FOUND**; bounded between 2026-04-23 and this session's fetch (2026-09-15) of `learn.chatgpt.com/codex/hooks`, which shows it as an established, unversioned feature | `learn.chatgpt.com/codex/hooks`; GitHub `openai/codex#19061`, `#17148` |
| Codex | Session resume | Full history stored to JSONL | `~/.codex/sessions/` | Precise resume-restoration parity with Claude Code (model/permission-mode/task state) **NOT independently verified this session** — WebSearch-synthesis only, downgraded confidence | WebSearch synthesis, medium confidence |
| Cursor | Checkpoints | Snapshots of all modified files, auto-created before "significant changes," restorable via chat timeline | "Stored locally and separate from Git" | Explicitly scoped to undoing Agent changes, not long-term storage; restoring reverts files only, doesn't remove conversation messages | `cursor.com/docs` (checkpoints page) |
| Cursor | Memories | Existence confirmed by lane 05 and by a beta-feature forum thread (Settings → Rules → Memories); mechanics — write trigger, storage format, scope — **NOT FOUND** in this session's fetches: `docs.cursor.com/context/memories` and `docs.cursor.com/memories` both 308-redirect to the generic docs root rather than resolving to page content | UNVERIFIED beyond existence | `cursor.com/docs/context/rules` (confirms Rules ≠ Memories, no memory mechanics); community-forum thread, secondary source only |
| Cline | Checkpoints | Full file-state snapshot after every tool use, via **a shadow git repository separate from the project's own git history**; three restore modes (files / task / both); captures files not tracked by the project's own git | `.git`-shaped shadow repo alongside the project | Enabled by default; explicit performance cost on large repos ("checkpoints may use significant storage and slow down Cline") | `docs.cline.bot/features/checkpoints` |
| Cline | Memory Bank | Six markdown files (`projectbrief.md`, `productContext.md`, `activeContext.md`, `systemPatterns.md`, `techContext.md`, `progress.md`) read at the start of every task | Plain files in the repo, via user-authored `.clinerules/` | **Entirely model-driven, not harness-enforced**: "the custom instructions embed the behavior directly into Cline's prompt" — there is no runtime code that guarantees the files are read or written; it is a prompting convention the user installs, structurally identical to what Claude Code's docs call "context, not enforced configuration" | `docs.cline.bot/prompting/cline-memory-bank` |
| OpenCode | Compaction (v2, checkpoint-based) | Auto-triggers at `min(input limit − 20K buffer, context limit − max(32K output reserve, buffer))` — e.g. 108K of a 128K-token model; summary keeps objective/decisions/blockers/next-moves/files; recent context retained separately up to `keep.tokens` (default 15,000), with tool results abbreviated to 2,000 chars | Earlier messages "remain stored permanently but excluded from active model context" — an append-only log, but the *summary*, not the log, is what future calls see | Everything not captured in the free-text checkpoint fields or the retained tail is functionally gone from the model's view even though it's still on disk | `opencode.ai/v2/docs/compaction` |
| Gemini CLI | Session persistence + manual named checkpoints | Automatic: full prompt/response/tool-execution/token-usage history, plus "assistant thoughts and reasoning summaries (when available)"; resumable via `--resume`/`-r` or an interactive `/resume` Session Browser. Separately, named checkpoints via `/resume save [name]` / `/resume resume [name]` for explicit branch points | `~/.gemini/tmp/<project_hash>/chats/`, one history tree per project | Documentation gives **no compaction/summarization mechanism** — only a hard `maxSessionTurns` cap to bound context growth, with no automatic compression described | `geminicli.com/docs/cli/session-management/` |

---

## 4. Durable-execution / event-sourcing research relevant to long-running agents

### 4.1 What "durable execution" actually guarantees, and why no coding-agent harness in this lane provides it

```
CLAIM: Durable execution (as the term is defined by its originating practitioner literature) requires
deterministic replay of a persisted event log to exactly reconstruct pre-failure state, and explicitly
requires that non-deterministic operations — including LLM calls — be excluded from the replayed code path.
No coding-agent harness surveyed in this lane satisfies this definition; all of them substitute either
"continue without the missing result" or an LLM-authored lossy summary.
LABEL: OBSERVED TODAY
CONFIDENCE: high
EVIDENCE: Temporal's own docs: a Workflow's Event History is "a complete and durable log of everything that
has happened in the lifecycle of a Workflow Execution"; on failure, a Worker "uses the Event History to
replay the code and recreate the state of the Workflow Execution to what it was immediately before the
crash. It then resumes progress from the point of failure as if the failure never occurred." The
determinism requirement is explicit: Workflow code must make "the same Workflow API calls in the same
sequence, given the same input," and "to handle non-deterministic operations like API calls, LLM/AI
invocations, database queries, and other external interactions, put them in Activities. Activities execute
outside the replay path." By contrast, Claude Code's own sessions doc states plainly that "a tool that was
still running when the previous process ended, for example in a crash, doesn't finish or run again when you
resume; Claude continues without its output" — the LLM call and its tool effects are inside the
non-replayed path by construction, because the LLM call *is* the workflow.
SOURCE: "Introduction to Temporal" — Temporal Technologies — docs.temporal.io/evaluate/understanding-temporal
— accessed 2026-09-15; "Workflow definitions" — docs.temporal.io/workflow-definition — accessed 2026-09-15;
"Manage sessions" — code.claude.com/docs/en/sessions — accessed 2026-09-14.
COUNTEREVIDENCE: This is an apples-to-oranges comparison in one respect: Temporal workflows orchestrate
deterministic business logic around non-deterministic Activities, while a coding agent's entire value is
the non-deterministic LLM step itself, so pushing "the LLM call" into a non-replayed Activity is close to
pushing the whole agent out of the replay boundary — there may be no useful deterministic "workflow" left to
replay. This is a structural reason durable execution in the Temporal sense may not transfer cleanly to
agent orchestration, not merely an implementation gap.
OPEN QUESTION: Is there a decomposition of a coding-agent task into a deterministic outer workflow (file
edits, test runs, git operations — all Activities) with the LLM call itself made replay-safe by recording
its output as an Activity result? AgentRewind (§4.2) is the closest attempt found, but it checkpoints
context wholesale rather than decomposing the loop into Temporal-style Activities.
```

### 4.2 Research that does implement checkpoint/restore for LLM agents, with measured numbers

```
CLAIM: A 2026 paper implementing explicit environment-plus-context checkpointing with agent-triggered
rewind measures a large task-success gain over the "just keep going" baseline every shipping harness uses
by default.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: AgentRewind records two aligned checkpoint components at each decision boundary — agent context
(message history/reasoning state) and environment state (workspace filesystem, captured via git commits) —
and exposes `backtrack_candidates` / `backtrack_commit` tools that let the agent itself decide to rewind,
attaching a memory summary of the abandoned branch. On the 82-task MettleBench benchmark (tasks drawn from
Terminal-Bench 2.0, ProgramBench, SWE-bench, ProjectEval, GitTaskBench) with GPT-5.4: task success 87.8%
(AgentRewind) vs 62.2% ("Continue" baseline), +25.6 pp; checklist progress 94.3% vs 81.4%, +12.9 pp. On
Terminal-Bench 2.0 (89 tasks): 83.1% vs 78.7%, +4.4 pp. The paper explicitly excludes external effects
(network requests, external service calls) from what it checkpoints — an acknowledged, unresolved gap
matching Claude Code's own "Bash command changes not tracked" limitation for its `/rewind`.
SOURCE: "AgentRewind: Recoverable Execution for Long-Horizon LLM Agents" — Zhuang, Chen, Duan, Zheng, Li,
Zhang — arXiv:2608.14380v1 — 2026-08-14 — https://arxiv.org/html/2608.14380 — accessed 2026-09-15.
COUNTEREVIDENCE: Single paper, one model family (GPT-5.4) reported in the fetched excerpt, and the larger
gain (MettleBench) is on a benchmark assembled by the same research effort rather than an independently
audited leaderboard (cf. lane 05's finding on the general unreliability of self-reported benchmark
composites). The Terminal-Bench 2.0 gap (+4.4 pp) is far smaller and closer to noise than the MettleBench
figure, suggesting the benefit is task-composition-dependent.
OPEN QUESTION: Does the +25.6 pp gap replicate on an audited, independently-run benchmark, and does it hold
for a harness's own *default* compaction behavior (lossy summary) as the baseline, rather than an
undefined "Continue"?
```

```
CLAIM: A 2026 paper formalizes a long-running LLM agent's full runtime state as a deterministic transition
system whose state vector is strictly larger than the visible conversation transcript, and this formalism
matches — almost field-for-field — what this lane found empirically inside Claude Code's own documentation.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: "Let the runtime state be Rt∈ℛ (comprising the KV cache, working memory, uncommitted tool
plans — all reconstructible components)," with each transition Rt = F(Rt−1, ot; θ). The paper separately
names compressed summaries (model-authored context compaction), plaintext memory (long-term memory
re-injected at session start), and pending tool plans as state components beyond the transcript. This maps
directly onto Claude Code's own documented compaction table (§2): the summary ≈ compressed summaries; auto
memory ≈ plaintext memory; the todo/plan state ≈ pending tool plans — except Claude Code's docs name and
guarantee re-injection only for the first two, leaving pending tool plans (task tracking) as the one
component this lane could not confirm survives compaction (§2, task-tracking row).
SOURCE: "Forgetting Without Restarting: Execution-State Unlearning for Stateful LLM Agents" — Yao, Wei,
Huang, Qian, Chen, Lu, Wu, He — arXiv:2609.04875v1 — 2026-09-04 —
https://arxiv.org/html/2609.04875 — accessed 2026-09-15.
COUNTEREVIDENCE: The paper's primary purpose is unlearning (removing a target observation's influence), not
persistence per se, so its state formalism is a means to that end and has not been independently validated
as a complete state model by other groups. KV-cache-level reconstruction assumes a level of runtime access
(direct cache manipulation) that no commercial coding-agent CLI in this lane exposes to a user or even to
its own hook system.
OPEN QUESTION: Would a coding-agent vendor ever expose enough of this internal state (KV cache, uncommitted
tool plans as a typed object rather than free-text) for a third party to build the kind of surgical
recovery this paper describes, or does the API-boundary abstraction make it structurally unavailable
outside the model provider?
```

### 4.3 Event sourcing as the general pattern, and its acknowledged cost

```
CLAIM: Event sourcing — the general pattern durable execution specializes — is explicitly documented as
costly and unnatural even by its own advocate, which is relevant context for why no production coding-agent
harness adopts it wholesale for conversation state.
LABEL: OBSERVED TODAY (pattern definition; foundational, pre-2024, cited for definitional precision per
mission source-hygiene rules)
CONFIDENCE: high
EVIDENCE: "Capture all changes to an application state as a sequence of events... every change to the state
of an application is captured in an event object, and these event objects are themselves stored in the
sequence they were applied." Reconstruction: "discard the application state completely and rebuild it by
re-running the events from the event log on an empty application" — which also enables temporal queries
("the application state at any point in time"). Acknowledged costs: "packaging up every change to an
application as an event is an interface style that not everyone is comfortable with, and many find to be
awkward... not a natural choice"; replaying all events to compute current state "is inherently slow,
particularly with large event volumes, necessitating caching strategies like snapshots"; and interfacing
with non-event-sourced external systems "get[s] the worst of both" in implementation complexity.
SOURCE: "Event Sourcing" — Martin Fowler — martinfowler.com/eaaDev/EventSourcing.html — accessed 2026-09-15.
COUNTEREVIDENCE: None found against the pattern's validity; the counterevidence here is practical, not
theoretical — the cost profile explains, without excusing, why vendors chose lossy LLM summarization
(cheap, "natural," no snapshot-caching engineering) over event sourcing (expensive, correct, engineering-
heavy) for conversation state.
OPEN QUESTION: PROJECTMEM (cited in lane 11, arXiv:2606.12329) independently arrived at "a deterministic,
append-only, idempotently-replayable event log" specifically for coding-agent project memory — the single
strongest evidence found across this mission that event sourcing is being reinvented, piecemeal, for this
exact domain, but as a single-author 207-event self-study with no controlled benchmark. Does it survive
scale?
```

### 4.4 An implemented recovery-aware architecture, for comparison against coding-agent task tracking

```
CLAIM: A 2026 empirically-evaluated architecture for LLM-based workflows demonstrates what a durable task
ledger looks like when a team treats job state as a first-class, queryable, orphan-detecting finite-state
machine rather than as free-text inside a conversation transcript — the shape no coding-agent harness in
this lane's §2/§3 tables uses for its own todo/task tracking.
LABEL: OBSERVED TODAY
CONFIDENCE: medium
EVIDENCE: AgentR persists four categories of state in PostgreSQL: a six-state finite automaton
(not-started/in-progress/completed/failed/re-initiated/failed-orphan) for every job; research artifacts;
job metadata with timestamped transitions; and ACID token-cost/financial logs. Mechanisms named explicitly:
"explicit processing state transitions, retries with exponential backoff, orphan job detection,
credit-aware pre-checks, ACID token-cost logging." Empirically measured on a development snapshot (10
projects, 44 papers, 130 background jobs, 72 LLM usage logs): 99.2% job completion rate, per-stage
latencies of 9.0s/18.9s/25.4s.
SOURCE: "AgentR: A Stateful and Recovery-Aware Software Architecture for LLM-based Auditable Workflows" —
Samanta, Saha, Ghosh, Buyya — arXiv:2608.15264v1 — 2026-08-15 — https://arxiv.org/html/2608.15264 —
accessed 2026-09-15.
COUNTEREVIDENCE: Applied to literature-review pipelines, not coding agents; an arXiv preprint, not
peer-reviewed; the evaluation snapshot is small (130 jobs) and self-reported by the same team that built
the system.
OPEN QUESTION: Would retrofitting Claude Code's `TaskCreate`/`TaskUpdate` onto an AgentR-shaped
finite-state table (instead of transcript tool-calls) change the task-tracking row's documented-compaction
status in §2 from "absent from the survives-compaction table" to "explicitly guaranteed"? This looks like a
cheap, concrete, testable build.
```

---

## 5. Harness-enforced vs model-requested — evidence table

Per the "harness > prompt" scope question: which mechanisms are enforced by runtime code the model cannot
bypass, versus merely requested in a prompt/instruction the model may or may not follow?

| Mechanism | Enforcement | Evidence |
|---|---|---|
| CLAUDE.md / auto memory content | **Model-requested.** Anthropic's own words: "Claude treats them as context, not enforced configuration. To block an action regardless of what Claude decides, use a PreToolUse hook instead." | `en/memory` |
| `permissions.deny` rules (settings files) | **Harness-enforced.** "Settings rules are enforced by the client regardless of what Claude decides to do." | `en/memory` (managed CLAUDE.md vs settings table) |
| `PreToolUse` hook, exit code 2 or `permissionDecision:"deny"` | **Harness-enforced.** The only universally-blocking mechanism across tool calls; deterministic exit-code semantics. | `en/hooks` |
| Auto-mode classifier's conversational "boundaries" | **Model-requested, disguised as enforcement.** Not stored as a rule; "re-read... from the transcript on each check," so compaction can silently delete it. The docs' own remedy is to convert it into a `permissions.deny` rule — i.e. to move it from this row to the row above. | `en/permission-modes` |
| `/goal` completion verdict | **Hybrid.** The *continuation mechanism* (a Stop hook forcing another turn) is harness-enforced; the *verdict itself* ("is the condition met") is delegated to a separate small model reading the transcript — a second model judging the first, not a deterministic check. | `en/goal` |
| Plan-mode edit blocking | **Harness-enforced, with a documented bypass.** Edits "stay blocked until you approve the plan" — except in sessions with bypass-permissions available, where "Claude is still instructed to plan without editing, but a file edit or shell command it attempts during planning runs without prompting." | `en/permission-modes` |
| Checkpoint file snapshots | **Harness-enforced capture, but with unenforced gaps.** Automatic and independent of model cooperation for direct file-editing tools, but explicitly does not cover Bash-driven file changes, subagent edits, or external changes — gaps a determined or careless agent step can walk straight through. | `en/checkpointing` |
| Cline Memory Bank | **Entirely model-requested.** "The custom instructions embed the behavior directly into Cline's prompt" — no runtime code verifies the six files are read or updated; it is a convention, not a mechanism. | `docs.cline.bot/prompting/cline-memory-bank` |
| Cline checkpoints (shadow git repo) | **Harness-enforced.** Automatic commit to a shadow repo after every tool use, independent of the model choosing to do so. | `docs.cline.bot/features/checkpoints` |
| Temporal Workflow replay/determinism | **Harness (platform)-enforced, structurally.** A replay that emits a different Command sequence than the stored Event History is a hard determinism violation the platform detects and rejects — the strongest form of enforcement in this table, and the one no coding-agent harness's compaction/resume path attempts. | `docs.temporal.io/workflow-definition` |
| OpenCode compaction trigger (95%-of-context threshold, or the documented `min(...)` formula) | **Harness-enforced trigger, model-authored content.** *When* compaction fires is a hardcoded numeric threshold; *what* the resulting checkpoint says is written by the model and is exactly as reliable as any other LLM summary. | `opencode.ai/v2/docs/compaction` |

---

## 6. Restart-test assessment per system

*"If a user stops for six months and returns, what does the documented mechanism actually reconstruct, and
what is explicitly out of scope per the vendor's own docs?"*

**Claude Code.** Reconstructed, unconditionally: CLAUDE.md at every scope (it's just a file; never expires).
Reconstructed, with high confidence: auto memory (`MEMORY.md` + topic files) — explicitly exempted from the
retention sweep ("`MEMORY.md` and topic files stay until you or Claude edits or deletes them"), so a
6-month gap does not touch it, *provided the user returns on the same machine* (auto memory is documented
as machine-local and never synced). **Not reconstructed by default**: the session transcript, and therefore
`/resume`/`--continue`, checkpoints/`/rewind`, the active `/goal`, and scheduled tasks — all of these live
under the same `cleanupPeriodDays` retention sweep, documented default "about 30 days," roughly a sixth of
the six-month gap in the test. Unless the user proactively raised `cleanupPeriodDays`, this session-level
state is gone. The net effect: Claude Code's actual long-horizon story is not "resume your work," it is
"CLAUDE.md plus a small distilled-memory file survive; everything else is designed to be reconstructible
from the codebase and git history, which is explicitly why auto memory "skips anything it can derive from
the codebase, such as architecture, file paths, or debugging fixes."

**Codex.** Session history persists to `~/.codex/sessions/*.jsonl`; retention policy, and whether Codex
exempts any artifact from cleanup the way Claude Code exempts memory, is **NOT FOUND** in the sources
fetched this session. `PreCompact`/`PostCompact` hooks exist (§3) but their interaction with a months-long
gap specifically was not documented in what was fetched. **UNVERIFIED** overall for the 6-month case.

**Cursor.** Checkpoints are explicitly scoped as short-lived, session-level undo, "not a replacement for
version control" (language nearly identical to Claude Code's own checkpointing caveat) — nothing in the
fetched docs suggests checkpoints are expected to, or documented to, survive a multi-month gap. Memories'
mechanics could not be independently confirmed this session (§3); restart-test verdict for Cursor is
**UNVERIFIED** beyond "rules and any committed AGENTS.md/`.cursor/rules` survive, because they're files."

**Cline.** Memory Bank is model-requested markdown files committed like any other project file — if the
user or team actually populated them, they survive a 6-month gap exactly as well as the repository does,
because they *are* the repository (no separate expiring store documented). Checkpoints (the shadow git
repo) are explicitly framed as session-level undo, not long-term memory, and no retention policy for the
shadow repo across a multi-month gap was found in this session's fetch — **UNVERIFIED**.

**OpenCode.** "Earlier session messages remain stored" per the compaction doc, implying an append-only local
log with no stated expiry — but whether that log, or the generated checkpoint, is what a new session
actually re-reads after a long gap (as opposed to only within one continuous session) is **NOT FOUND** in
the compaction page fetched; OpenCode's session-level resume/restore semantics across a genuine restart
were not confirmed this session.

**Gemini CLI.** The one system in this lane with the sharpest documented contrast: automatic session history
at `~/.gemini/tmp/<project_hash>/chats/` plus a `/resume` Session Browser gives it, on paper, the most
complete conversational restart story of the group — but the docs state no compaction/summarization
mechanism exists at all, only a hard `maxSessionTurns` cap. **INFERRED**: for a session that ran long
enough to approach that cap before the gap began, there may be nothing coherent left to resume into six
months later; for a short session, the full transcript should still be there, unless a retention/cleanup
policy (not found in the pages fetched) removes it.

---

## 7. Contradictions with common belief

**1. "Claude Code implements crash-safe, resumable execution — if it crashes, resuming picks up exactly
where it left off."** Anthropic's own docs contradict this directly: "a tool that was still running when
the previous process ended, for example in a crash, doesn't finish or run again when you resume; Claude
continues without its output." This is not durable execution in the sense the term has carried since
Temporal/Cadence — there is no replay, no guarantee the missing tool result is ever recovered, and no
detection that anything was lost beyond the model noticing the gap in its own transcript.

**2. "Claude Code remembers your project."** It remembers your project on the one machine where the work
happened. Auto memory is explicitly documented as machine-local and never synced across machines or cloud
environments, and Claude Code's own desktop app, VS Code extension, and web surface each "maintain their
own session history" (from the Sessions doc) rather than sharing one memory store. A fresh clone of the
same repository on a new laptop, or a teammate opening the same repo, gets zero auto memory — only whatever
was committed to CLAUDE.md.

**3. "CLAUDE.md and hooks are both 'configuration' Claude follows."** They occupy opposite ends of the
enforcement spectrum by Anthropic's own explicit framing: CLAUDE.md/auto memory are "context, not enforced
configuration," while settings-file rules "are enforced by the client regardless of what Claude decides to
do." The auto-mode classifier's safety boundaries sit in an uncomfortable middle that looks like enforcement
to a user but is documented as re-derived from the transcript each time — and therefore losable to
compaction — until manually promoted to a real `permissions.deny` rule.

**4. "Task/todo tracking is durable agent state."** Every vendor markets a visible, structured todo list as
evidence the agent is tracking long-horizon work reliably. In Claude Code specifically, the todo/task tools
are transcript tool-calls with no documented separate store, and — unlike the plan-mode plan, which
Anthropic explicitly names as "re-injected from disk" after compaction — task state does not appear in the
documented compaction-survival table at all. The most legible piece of "I'm tracking your long task" UI is
the one piece of state this lane could not confirm survives the exact event (compaction) that most
threatens a long task.

---

## 8. Problems nobody is talking about

**1. No coding-agent vendor publishes what its own default compaction drops, or how often that loss
matters.** Every harness in §3 replaces old context with an LLM-authored summary, and no vendor publishes a
measured rate of "the constraint stated 40 turns ago survived compaction." The one number found in this
lane that gets close — AgentRewind's +25.6 percentage points of task success over a plain-continue baseline
on MettleBench — comes from a research paper building an alternative to default compaction, not from any
vendor measuring its own shipped default. This is the compaction-era sibling of lane 07's finding that
LLM-authored acceptance sets admit only 19–42% of correct solutions: the summarizer is graded by nobody.

**2. The task ledger — the state a long-horizon agent most needs to survive a compaction or a crash — is
the one piece of state no coding-agent harness in this lane persists outside the transcript.** AgentR (§4.4)
shows what this looks like done properly outside the coding-agent domain: a typed, timestamped,
orphan-detecting finite-state-machine table in a durable store. Claude Code's `TaskCreate`/`TaskUpdate` and
every competitor's equivalent live only as structured tool calls inside the same lossy-summarization path as
everything else. Nobody in this space has shipped the equivalent of Temporal's Event History or AgentR's
job table for "what was I in the middle of."

**3. Auto-mode's safety boundary is documented as non-durable, and the fix requires a user to notice.** "The
classifier re-reads them from the transcript on each check, so a boundary can be lost if context compaction
removes the message that stated it" is a startlingly direct admission in a permission-and-safety document.
The prescribed fix — add a `permissions.deny` rule instead — requires the user to (a) know this distinction
exists, (b) notice a boundary was stated only conversationally, and (c) manually escalate it before a long
unattended `/goal` run reaches a compaction event. Nobody measures how often step (b) fails silently.

**4. "Durable execution" is being used informally by this exact research community (per the search results
surfaced while sourcing §4) to describe LLM-agent checkpointing that satisfies none of the term's original,
precise guarantees** — deterministic replay, exclusion of non-determinism from the replayed path, a
platform-verified Event History. Every coding-agent harness and most of the 2026 papers found (AgentRewind,
AgentR) checkpoint *state snapshots* (context + filesystem, or a job table), which is a different and
weaker guarantee than *event-log replay*. This is a live terminology collision: an engineer who hears
"Claude Code has checkpointing" and assumes Temporal-grade guarantees will be wrong in a way none of the
vendor docs flag for them.

**5. Long-horizon continuity is being solved twice, independently, in different vocabularies, with no
apparent cross-citation.** PROJECTMEM (lane 11, arXiv:2606.12329) reinvents an event-sourced log
specifically for coding-agent project memory; AgentR (§4.4) independently reinvents a finite-state job table
with orphan detection for LLM research workflows; Temporal (§4.1) has had the general pattern productionized
for fifteen-plus years outside the agent space entirely. None of the coding-agent-specific 2026 papers
surveyed in this lane cite Temporal, Cadence, or the event-sourcing literature by name, despite solving a
structurally identical problem.

---

## 9. Open questions for the second wave

1. **What is Codex's actual retention/cleanup policy for `~/.codex/sessions/`, and does anything in it get
   exempted from cleanup the way Claude Code exempts auto memory?** Not found this session; would complete
   §6's Codex row.
2. **Does Cursor Memories have documented write triggers, storage format, and scope comparable to what this
   lane established for Claude Code auto memory?** The official page 308-redirects to a generic docs root
   in two attempts this session; a targeted fetch of whatever `cursor.com/docs/beta/memories` or equivalent
   resolves to would settle it.
3. **Build the retrofit named in §4.4's open question**: replace Claude Code's (or any harness's)
   transcript-embedded `TaskCreate`/`TaskUpdate` calls with an AgentR-shaped external finite-state table, and
   measure whether task-completion accuracy on a long, compaction-heavy session improves — this is the
   cheapest concrete experiment this lane identified.
4. **Does the AgentRewind gap (+25.6 pp on MettleBench) replicate against a harness's own default
   compaction as the baseline** (rather than an undefined "Continue" strategy), and does it replicate on an
   independently-audited benchmark rather than one assembled by the same research group?
5. **Is there a decomposition of the coding-agent loop into a genuine Temporal-style deterministic outer
   workflow with the LLM call boxed as a single Activity result**, so that at least the *orchestration*
   (which files were touched, which commands ran, in what order, with what results) is genuinely replayable
   even though the LLM's own reasoning is not? This lane found no existing attempt at exactly this decomposition.
6. **How often does an auto-mode classifier boundary actually get lost to compaction in practice**, and how
   often do users who hit this ever convert it to a `permissions.deny` rule as the docs recommend? This is
   measurable from real usage telemetry a vendor has and nobody outside the vendor does.
7. **What does OpenCode, Cline, and Cursor actually reconstruct after a genuine multi-month gap** (not a
   same-session resume)? §6 left three of six systems UNVERIFIED for exactly this question; each requires a
   targeted primary-source fetch or a live behavioral test this lane's tools could not run (no filesystem
   access to another vendor's installed CLI to test empirically).
8. **Why does no 2026 coding-agent-continuity paper found in this lane cite Temporal, Cadence, or the
   event-sourcing literature**, despite several (PROJECTMEM, AgentR) independently reinventing pieces of it?
   Is this a genuine knowledge gap between the distributed-systems and LLM-agent research communities, or
   did this lane's search simply miss the cross-citing paper?
