> Evidence for docs/architecture/20-LONG-HORIZON-AUDIT.md. Research lane: external sources only, about 90, each tagged EST, EST*, EXP, MKT or UNVERIFIED. Kept as written by its lane on 2026-10-02, with local paths removed; the audit document, not this file, states the conclusions.

# Long-horizon coding agents: what lets one agent work on the same project for months (research lane)

> Written 2026-10-02 by the research lane of the long-horizon audit of Shelra. External sources only; no Shelra code
> was read or run, no model credits spent. Companion to `docs/architecture/15-evidence/frontier-practices.md`
> (2026-09-23, ~115 sources), cited here as **(doc 15 evidence)** and not repeated. This file covers what doc 15
> does not: multi-session state, memory validity over time, crash/resume, escalation, blast radius, entropy, and
> long-horizon evaluation.

## How to read this file

- Evidence classes (this lane's definitions, stricter than doc 15's):
  - **EST**: peer-reviewed (venue named) or a vendor/independent measurement with a described method.
  - **EST\***: measured with a described method but a preprint not yet peer-reviewed, a single run, or a single author.
    Treat as weaker than EST.
  - **EXP**: vendor engineering experience, product documentation or guidance. The mechanism exists; its effect is
    unmeasured.
  - **MKT**: a claim without method, data or baseline.
  - **UNVERIFIED**: the primary page could not be opened; no numbers are reported from it.
- `[>12mo]` = older than 2025-10-02. "Accessed" = read on 2026-10-02 unless stated.
- Claude Code CHANGELOG entries cite the version from the local read-only copy `references/claude-code/CHANGELOG.md`
  (top version 2.1.269; the online docs already mention v2.1.283). Code was not copied.
- Access notes: openai.com returned HTTP 403 again; OpenAI material was read through developers.openai.com,
  learn.chatgpt.com, the openai-cookbook repo, a verbatim mirror of "Harness engineering" (as in doc 15), the
  openai/codex GitHub repo and a locally extracted copy of OpenAI's agents guide PDF. METR's time-horizon chart values
  are not text; numbers come from METR's text reports.
- Source keys in brackets resolve in the Sources table at the end.

---

## 1. Anthropic: harnesses, memory, compaction, checkpoints, sessions, hooks

### 1.1 Engineering posts (what the long-running pattern actually is)

- **[A-LRH] "Effective harnesses for long-running agents"** (Justin Young, 2025-11-26) **EXP**. doc 15 summarizes it;
  details that matter for a durable-state design:
  - Feature list is **JSON**, each entry `category`, `description`, `steps[]`, `passes` (initially false); "over 200
    features" for the claude.ai clone. Why JSON: "the model is less likely to inappropriately change or overwrite
    JSON files compared to Markdown files."
  - Session start routine: "Run `pwd`"; "Read the git logs and progress files to get up to speed"; "Read the features
    list file and choose the highest-priority feature that's not yet done"; then start the dev server and "run
    through a basic end-to-end test before implementing a new feature" (a smoke test of inherited state before new
    work).
  - Failure modes named: one-shotting; "a later agent instance would look around, see that progress had been made,
    and declare the job done"; "mark a feature as complete without proper testing"; broken undocumented state left
    between sessions.
  - Open questions the authors state: single general agent vs "a testing agent, a quality assurance agent, or a code
    cleanup agent"; "optimized for full-stack web app development."
- **[A-LRSCI] "Long-running Claude for scientific computing"** (Siddharth Mishra-Sharma, 2026-03-23) **EXP**. Opus 4.6
  worked "over several days" on a differentiable Boltzmann solver in JAX against the CLASS C code as reference oracle.
  - Progress file `CHANGELOG.md` = "portable long-term memory ... lab notes": status, completed tasks, failed
    approaches and why, accuracy tables, known limitations. Load-bearing: **"The failed approaches are
    important—without them, successive sessions will re-attempt the same dead ends."**
  - Commit discipline: "Run pytest tests/ -x -q before every commit. Never commit code that breaks existing passing
    tests."
  - Outer loop ("Ralph loop", max 20 iterations): "Please keep working on the task until the success criterion of 0.1%
    accuracy across the entire parameter range is achieved."
  - Failure modes: "agentic laziness"; "for a while it was only testing the code at a single (fiducial) parameter
    point" (a weak self-written oracle); "elementary mistakes" an expert would spot at once.
- **[A-SDK] "Building agents with the Claude Agent SDK"** (Thariq Shihipar, 2025-09-29) **EXP**: loop "gather context ->
  take action -> verify work -> repeat"; verification ranked with rules-based feedback (e.g. linting) as the strongest,
  then visual feedback, then LLM-as-judge with "heavy latency tradeoffs"; "starting with agentic search, and only
  adding semantic search if you need faster results"; "the folder and file structure of an agent becomes a form of
  context engineering."
- **[A-MANAGED]** (2026-04-08) **EXP** (doc 15 evidence): the session is "an append-only log of everything that
  happened", outside the context window; recovery is `wake(sessionId)` -> `getSession(id)` -> `emitEvent(...)` so
  "nothing in the harness needs to survive a crash"; harness workarounds for older models became "dead weight".
- **[A-MAMEM] Memory for Claude Managed Agents** (2026-04-23) **EXP** (customer numbers **MKT**): memories are files
  mounted on the agent's filesystem; stores shared across agents with scopes ("an org-wide store might be read-only,
  while per-user stores allow reads and writes"); "All changes are tracked with a detailed audit log, so you can tell
  which agent and session a memory came from. You can roll back to an earlier version or redact content from
  history." Customer claims (Rakuten "97% fewer first-pass errors") have no method: MKT.
- **[A-MANEW] "dreaming, outcomes, multiagent"** (2026-05-19) **EXP/MKT**: dreaming = "a scheduled process ... that
  reviews agent sessions and memory stores, extracts patterns, and curates memories"; developers choose automatic
  updates **or manual review before changes take effect**. Outcomes = a rubric graded by "a separate grader ... in its
  own context window, so it isn't influenced by the agent's reasoning"; "up to 10 points" task success (+8.4% docx,
  +10.1% pptx), method not described: MKT.
- **[A-CTX]** context engineering (structured note-taking, compaction, just-in-time retrieval): doc 15 evidence.

### 1.2 Claude Code product documentation (mechanisms, accessed 2026-10-02) — all **EXP**

- **Memory [CC-MEM]**: two systems, both "context, not enforced configuration. To block an action regardless of what
  Claude decides, use a PreToolUse hook". Auto memory types `user`, `feedback`, `project` ("decisions that Claude
  can't derive from the code or git history"), `reference`. "Claude skips anything it can derive from the codebase,
  such as architecture, file paths, or debugging fixes." `MEMORY.md` index, one line per memory, first 200 lines or
  25KB loaded; topic files read on demand. Near a limit the harness "reminds Claude to shorten it: keep one line per
  entry, move detail into topic files, and merge or drop stale entries"; over the limit "the write still succeeds, but
  Claude Code returns an error telling Claude to rewrite the index". Each write stamps a `modified` ISO-8601
  frontmatter field so "The timestamp shows how current the fact is" (v2.1.214+). Machine-local, shared across
  worktrees of a repo, excluded from the transcript retention sweep, not loaded into subagents (forks excepted). A
  repository-supplied `autoMemoryDirectory` is honored only under workspace trust. `/doctor prompt-audit` (v2.1.283+)
  looks for "instructions written for older models, references to files or commands that don't exist, and files that
  contradict each other", proposing edits, changing nothing until asked.
- **Context and compaction [CC-HOW]**: "Sessions are independent. Each new session starts with a fresh context window";
  compaction "clears older tool outputs first, then summarizes the conversation if needed. Your requests and key code
  snippets are preserved; detailed instructions from early in the conversation may be lost. Put persistent rules in
  CLAUDE.md"; a "Compact Instructions" section in CLAUDE.md steers summaries; auto-compaction stops "after a few
  attempts" instead of thrashing.
- **Checkpoints [CC-CKPT]**: one checkpoint per prompt that starts a turn; snapshots for the 100 most recent; deleted
  ~30 days after last save (`cleanupPeriodDays`); "Checkpointing does not track files modified by Bash commands";
  subagent edits usually not restored; external edits not tracked; "Actions that affect remote systems (databases,
  APIs, deployments) can't be checkpointed" [CC-HOW]; "Not a replacement for version control."
- **Agent SDK sessions [CC-SDKSESS]**: "Sessions persist the **conversation**, not the filesystem"; resume is same
  machine only; and, load-bearing for durable design: **"Don't rely on session resume. Capture the results you need
  (analysis output, decisions, file diffs) as application state and pass them into a fresh session's prompt. This is
  often more robust than shipping transcript files around."**
- **Hooks [CC-HOOKS]**: `SessionStart` matchers `startup|resume|clear|compact|fork`, stdout or `additionalContext` is
  injected (the documented way to re-inject state after compaction); `PreCompact` can block compaction (exit 2);
  `TaskCreated`/`TaskCompleted` can block task creation/completion; `PreToolUse` can return `defer` so a headless run
  pauses and resumes with `-p --resume`.
- **API compaction [P-COMPACT]** (beta `compact-2026-09-04`): server-side summary replaces older turns "because response
  quality degrades as a conversation grows"; on-demand, threshold, keep-recent-turns-verbatim and background variants;
  custom summarization prompt "when the default summary drops something a later turn needs."

### 1.3 Claude Code CHANGELOG: what shipped, and what broke (version = local CHANGELOG) — **EXP**

Memory
- 2.1.32 "Claude now automatically records and recalls memories as it works"; 2.1.59 "saves useful context to
  auto-memory. Manage with /memory"; 2.1.63 auto memory shared across git worktrees; 2.1.75 "Added last-modified
  timestamps to memory files, helping Claude reason about which memories are fresh vs. stale"; 2.1.83 index truncates
  at 25KB as well as 200 lines; 2.1.186 reminder to compact `MEMORY.md` near the limit; 2.1.210 "Memory writes that
  leave a MEMORY.md index over its read limit now produce an explicit error instead of silent truncation"; 2.1.77 fixed
  "a race between memory-extraction writes and the main transcript" that truncated history.

Compaction (each fix names a piece of state that compaction lost)
- 0.2.47 automatic compaction "for infinite conversation length"; 1.0.11 todo list handling during compaction; 2.1.47
  "plan mode being lost after context compaction" and session name lost; 2.1.76 deferred tools "losing their input
  schemas after conversation compaction" and a **circuit breaker after 3 failed auto-compactions**; 2.1.83 "background
  subagents becoming invisible after context compaction, which could cause duplicate agents to be spawned"; 2.1.89
  "autocompact thrash loop" detection (refill after three compactions -> stop with an actionable error); 2.1.119
  "skills invoked before auto-compaction being re-executed against the next user message"; 2.1.139 "Compaction prompt
  now asks the model to preserve sensitive user instructions"; 2.1.269 "the git status Claude is told after a
  compaction: it is now the current status, not the one from the start of the session". Hooks: 1.0.48 PreCompact;
  2.1.76 PostCompact; 2.1.105 PreCompact may block.

Resume and crash recovery
- 0.2.93 `--continue`/`--resume`; 2.1.110 resume "resurrects unexpired scheduled tasks"; 2.1.121 a transcript line
  "corrupted by an unclean shutdown ... is now skipped"; 2.1.196 workers killed by a daemon restart "automatically
  resumed from where they left off"; 2.1.216 cloud "interrupted turn now re-runs on resume"; 2.1.239 resuming
  "restores its active goal"; 2.1.251 `SessionStart` resume hooks "receive session staleness and the estimated
  re-cache cost"; **2.1.265 "resume after the previous process died while a tool was running: the last prompt is no
  longer rewritten, and the interrupted tool call is kept and marked interrupted"**; 2.1.265 a workflow resume "whose
  run journal is missing now fails with a clear error instead of rerunning every agent"; **2.1.269
  `CLAUDE_CODE_RESUME_INTERRUPTED_TURN` no longer re-runs "a turn that had failed with an API error over 6 hours
  earlier"** (an age bound on automatic re-execution).

Returning after a gap
- 2.1.84 "idle-return prompt that nudges users returning after 75+ minutes to `/clear`"; 2.1.108 `/recap` "to provide
  context when returning to a session"; 2.1.117 `/resume` "offers to summarize stale, large sessions before re-reading
  them".

Tasks and goals
- 0.2.93 todo list "helps it stay on track"; 2.1.16 "new task management system, including ... dependency tracking";
  2.1.84 `TaskCreated` hook; 2.1.139 `/goal` (keep working across turns until a condition holds); 2.1.234 `/goal`
  "clears itself with a notice when a turn dies on an unrecoverable error"; 2.1.239 check-ins back off 30 min -> 1 h ->
  2 h; 2.1.269 `/goal` "retries with backoff, or pauses and says why, including until a usage limit resets".
  **2.1.233: todo/task tools "are no longer available on Opus 4.8, Sonnet 5, Fable 5, Mythos 5, and newer models"**
  (2.1.268 lists the older models that keep them): a harness component deleted per model generation.

Checkpoints
- 2.0.0 "/rewind a conversation to undo code changes"; 2.1.208 "bounded checkpoint disk usage by pruning superseded
  file-history backups"; 2.1.260 fixed "/rewind ... reporting success when checkpoint backup files were missing and
  nothing was actually restored" (verify restores, do not trust the restore call).

Synthesis (my inference): the state a harness must re-inject after compaction or resume, from these fixes, is: the
user's standing instructions, the current mode (plan/auto), the plan and task list with status, the *current* git
status, running background processes/agents, the active goal, loaded tool schemas, and which one-shot actions
(skills) already ran.

---

## 2. OpenAI: harness engineering, plans, Codex long-horizon

- **[OAI-HE] "Harness engineering"** (Ryan Lopopolo, 2026-02-11; via mirror) **EXP**, details beyond doc 15:
  - System of record: "From the agent's point of view, anything it can't access in-context while running effectively
    doesn't exist."
  - `docs/` layout: design docs with verification status, `exec-plans/` (active, completed, tech-debt tracker),
    generated schemas, product specs, references; a ~100-line `AGENTS.md` as a map.
  - Mechanical enforcement: "By enforcing invariants, not micromanaging implementations, we let agents ship fast without
    undermining the foundation"; custom linters and structural tests enforce layer dependency directions; "taste
    invariants" (structured logging, naming, file-size limits) with error messages that inject remediation.
  - Entropy: "Technical debt is like a high-interest loan: it's almost always better to pay it down continuously in
    small increments than to let it compound"; recurring background Codex tasks scan for deviations from "golden
    principles", update quality grades and open small refactoring PRs (auto-mergeable).
  - Legibility: per-worktree app boot, Chrome DevTools Protocol snapshots, ephemeral local logs/metrics (LogQL/PromQL).
  - Stated unknowns: how "architectural coherence evolves over years" in agent-generated systems.
- **[OAI-PLANS] "Using PLANS.md for multi-hour problem solving"** (aaronfriel, cookbook registry date 2025-10-07)
  **EXP**: doc 15 evidence (living ExecPlan with Progress, Surprises & Discoveries, Decision Log, Outcomes).
- **[OAI-LH] "Run long horizon tasks with Codex"** (Derrick Choi, developers.openai.com; page shows no date; uses
  GPT-5.3-Codex "Extra High") **EXP**: "about 25 hours uninterrupted, used about 13M tokens, and generated about 30k
  lines of code"; "The most important technique was durable project memory. I wrote the spec, plan, constraints, and
  status in markdown files that Codex could revisit repeatedly." Four files: `Prompt.md` (frozen target, "done when"),
  `Plan.md` (milestones small enough for one loop, acceptance criteria, validation commands), `Implement.md`
  (runbook), `Documentation.md` (status, decisions, known issues). "Stop-and-fix rule: if validation fails, repair
  before moving on"; validation = lint, typecheck, tests, build, export. Self-described as "an experiment, not a
  production rollout"; no failure analysis is given.
- **[OAI-GOAL] Codex CLI 0.128.0 `/goal`** (2026-04-30, release notes + Simon Willison's dated post) **EXP**: "persisted
  `/goal` workflows with app-server APIs, model tools, runtime continuation, and TUI controls for create, pause,
  resume, and clear"; the agent "will keep on looping until it evaluates that the goal has been completed... or the
  configured token budget has been exhausted" (completion is the model's own evaluation; the budget is the hard stop).
- **[OAI-AGMD] AGENTS.md in Codex** (docs, accessed) **EXP**: global `~/.codex` then Git root down to cwd, one file
  per directory (`AGENTS.override.md` first), concatenated root-down so closer files win; default cap
  `project_doc_max_bytes` = 32 KiB, after which files stop being added; rebuilt on every run.
- **[OAI-CMAX] GPT-5.1-Codex-Max** and **[OAI-LOOP] "Unrolling the Codex agent loop"** **UNVERIFIED** (403). Secondary
  sources describe native training across context windows via compaction and a `/responses/compact` endpoint returning
  an opaque encrypted compaction item. No numbers reported here.
- Field signal: **[CODEX-13241]** (2026-03-02, open, no maintainer response) asks for long-horizon multi-session
  support because "Codex works well for short, focused tasks"; **[CODEX-30932]** (2026-07-02) a rollout JSONL grew to
  ~19.1 GiB, dominated by 304 repeated `compacted` records (largest >76 MB), making resume OOM; the user recovered by
  rebuilding a rollout from metadata + latest compaction snapshot + later records (~76 MB). Lesson: an event log
  needs snapshotting/garbage collection, or resume itself becomes the failure.

---

## 3. Google: code review standards, AI code at scale

- **[G-STD] "The Standard of Code Review"** (eng-practices, undated web guide) **EXP**: "reviewers should favor
  approving a CL once it is in a state where it definitely improves the overall code health of the system being worked
  on, even if the CL isn't perfect"; "There is no such thing as 'perfect' code—there is only *better* code"; "Nothing in
  this document justifies checking in CLs that definitely *worsen* the overall code health of the system"; "Nit:" for
  optional polish.
- **[G-LOOK] "What to look for in a code review"** **EXP**: design ("Do the interactions of various pieces of code in the
  CL make sense?"), functionality, complexity ("can't be understood quickly by code readers"), over-engineering ("solve
  the problem they know needs to be solved *now*"), tests ("Will the tests actually fail when the code is broken?"),
  naming, comments ("explain why ... not ... what"), style, consistency, documentation (update READMEs when behavior
  changes), every line, context ("the context of the system as a whole"), good things.
  - Relevance: this is a ready-made, model-independent rubric for a "does this change improve code health?" gate; the
    "tests actually fail when broken" question is the mutation-testing idea in one sentence.
- **[G-MIG] "How is Google using AI for internal code migrations?"** (Nikolov et al., 2025-01-12) **EST\*** (experience
  report with numbers): int32->int64 migration, "80% of the code modifications in the landed CLs were fully
  AI-authored"; total time "reduced by an estimated 50% as reported by the engineers"; validation = build changed files
  + run their unit tests, with optional ML "repair" on failure; normal human code review; **"the bottleneck in the
  process was the speed at which engineers could review the changes"**, so teams capped weekly change generation.
- **[G-AUTOC] AutoCommenter** (Vijayvergiya et al., 2024-05-22, AIware '24) **EST** [>12mo]: LLM review comments on
  best-practice violations deployed to tens of thousands of developers in C++/Java/Python/Go.
- **[DORA25] 2025 DORA report** (Harvey, DeBellis, Google Cloud, 2025-09-23) **EST** (survey of ~5,000 + qualitative):
  AI adoption has a positive relationship with throughput and "continues to have a negative relationship with software
  delivery stability"; "Without robust control systems, like strong automated testing, mature version control
  practices, and fast feedback loops, an increase in change volume leads to instability." AI Capabilities Model
  includes strong version control, small batches, quality internal platform.
- Not found: a 2025-2026 Google primary publication measuring agent-written (not completion-written) code quality at
  scale. Google's 2026 IDE paper [G-IDE] (2026-01-27) discusses completion and "Transform Code" without numbers in the
  abstract.

---

## 4. Long-horizon evaluation status (2026)

Time horizons
- **[METR-FRR] Frontier Risk Report (Feb–Mar 2026)** (2026-05-19) **EST**: public frontier 50% time horizon "~12h
  [5h-61h]", 80% horizon "~1.5h [50m-2h40m]"; internal frontier "Likely ≥16h" (50%). [METR-THPAGE] (updated
  2026-05-08): "Measurements above 16 hrs are unreliable with our current task suite."
- **[METR-SOL] GPT-5.6 Sol** (2026-06-26) **EST**: 50% horizon "around 11.3hrs (95% CI: 5hrs - 40hrs)" counting cheating
  as failure, 71 h excluding cheating attempts; "detected cheating rate was higher than any public model we have
  evaluated"; METR does "not consider any of these numbers to represent a robust measurement". Meaning: a model's
  long-horizon number now depends on how cheating is scored.
- Meaning for a CLI: the 80% horizon (reliable work) is roughly an order of magnitude shorter than the 50% horizon, so
  multi-session work for free models must be decomposed into units far below a frontier model's 80% horizon, each with
  an oracle. (Inference from METR's two numbers.)

Single-issue benchmarks
- **SWE-bench Verified**: retired as a frontier measure by OpenAI (doc 15 evidence, secondary). **SWE-bench Pro
  [SWEPRO-LB]** (Scale, accessed) **EST**: standardized SWE-Agent scaffold, turn limit 250: Muse Spark 1.1 61.50±3.10,
  gpt-5.4 (xHigh) 59.10±3.56, claude-opus-4-6 (thinking) 51.90±3.61; private-set drops noted (e.g. GPT-5 23.1% ->
  14.9%). **SWE-bench-Live [SWELIVE]** **EXP**: monthly new issues; from August 2026 submissions must include rollout
  trajectories for verification. Terminal-Bench: 2.0 (2025-11-07), 2.1 (2026-05-06), 3.0 (2026-07-30), 4.0
  (2026-08-28) [TBV]; change details not on the index page. SWE-bench Multimodal: not checked.

Evolving-codebase and multi-step benchmarks (the ones that matter for months-long work)
- **[SWEEVO] SWE-EVO** (Le et al., 2025-12-20, rev 2026-05-22) **EST\***: 48 tasks from release notes of 7 Python
  projects, avg 21 files, ~874 tests per instance; "GPT-5.4 with OpenHands achieves only 25% on SWE-EVO versus 72.80%
  achieved by GPT-5.2 on SWE-Bench Verified"; strong models fail on instruction following, weak ones on tool use.
- **[ROADMAP] RoadmapBench** (Xu et al., 2026-05-15) **EST\***: 115 tasks from real version upgrades, 17 repos, 5
  languages, median 3,700 lines across 51 files; best Claude-Opus-4.7 39.1%, weakest 5.2%.
- **[SWECHAIN] SWE-Chain** (Lam et al., 2026-05-14) **EST\***: 12 upgrade chains, 155 version transitions, "each
  transition builds on the agent's prior codebase"; avg 44.8% resolving across nine agent-model configs, best
  Opus-4.7/Claude Code 60.8%; agents "struggle to make correct upgrades across chained package releases without breaking
  existing functionality."
- **[SLOP] SlopCodeBench** (Orlanski et al., 2026-03-25, v2 2026-05-07) **EST\***: 36 problems, 196 checkpoints where
  agents extend their own code; 15 agents; "best agent passes 14.8% of checkpoints"; "structural erosion rising in 77%
  of trajectories and verbosity in 75.5%"; vs 48 human repos "2.3x more verbose and 2.0x more eroded"; "Explicit quality
  guidance reduces initial verbosity and erosion by up to a third, without affecting degradation rates."
- **[CODETHREAD] "Is Agent Code Less Maintainable Than Human Code?"** (Patel et al., 2026-06-19, rev 2026-09-29)
  **EST\***: four frontier agents, four benchmarks: "task resolve rate drops of up to 13.1%" when building on prior agent
  code instead of human code; classic SE metrics did not explain it; input validation/error handling changes and
  downstream code size did.
- **[LOCOAGENT] LoCoBench-Agent** (Qiu et al., Salesforce, 2025-11-17) **EST\***: 8,000 interactive scenarios, 10K–1M
  tokens, up to 50 turns; "Thorough exploration increases comprehension but reduces efficiency."
- **[CLBENCH], [SWECL], [SWECTX]**: doc 15 evidence (repeated work on one repo: stateful ≈ stateless; naive ICL beats
  memory systems; memory adds "stale beliefs").

Memory benchmarks (what they say about state)
- **[LME] LongMemEval** (Wu et al., ICLR 2025) **EST** [>12mo]: five abilities incl. **knowledge updates** and
  **abstention**; commercial assistants and long-context LLMs lose ~30% accuracy over sustained interactions; helpful
  design: session decomposition, fact-augmented keys, time-aware query expansion.
- **[MAB] MemoryAgentBench** (Hu, Wang, McAuley, 2025-07-07, v 2026-06-28) **EST\***: four competencies incl. selective
  forgetting; FactConsolidation (overwrite a fact, ask for the current one): best single-hop 78.0% (GPT-5-mini, long
  context), multi-hop max 28.0%; Mem0 18.0%, GraphRAG 14.0%, Cognee 28.0% single-hop; "forgetting out-of-date memory
  poses a significant challenge on memory agents."
- **[STATEMEM] StateMemBench** (Fan et al., 2026-08-20) **EST\***: 234 multi-session scenarios graded to isolate
  "state-tracking failures" ("answers must reflect the current state and not a superseded one"); a state wrapper lifted
  current-state accuracy +32 to +67 points across six backends; absolute levels stay low (0.205 -> 0.363 on
  DeepSeek-V4-Flash).
- **[MARENA] MemoryArena** (He et al., ICML 2026) **EST**: interdependent multi-session tasks; agents strong on LoCoMo are
  "substantially weaker" here: recall benchmarks do not predict agentic memory use.
- **[DREAMSWE] DreamBench-SWE** (S. Singh, 2026-08-21) **EST\*** (single author): later software tasks depend on
  "non-inferable evidence from earlier sessions", scored by hidden executable oracles: no memory 21/180 (11.67%),
  verbatim event memory 82/180 (45.56%), typed+raw probe 83/180, hosted Mem0 97/180 (53.89%); the author explicitly does
  not claim superiority among memory conditions.
- **[AMABENCH] AMA-Bench** (Zhao et al., 2026-02-26) **EST\***: existing memory systems "fail to capture causal and
  objective information" in agentic trajectories; their causal-graph memory 57.22% (+11.16 over strongest baseline).

Reading across: CL-Bench (doc 15) finds ~no gain from memory on repeated same-repo work; DreamBench-SWE finds large
gains when later tasks need facts that are **not derivable** from the repository. Both are consistent with Claude
Code's rule to store only what "Claude can't derive from the code or git history" [CC-MEM]. (Inference.)

---

## 5. Agent memory research: what helps, what hurts

Helps (with conditions)
- **Raw, verbatim, retrievable history beats lossy extraction on recall**: Letta [LETTA-FS] (2025-08-12) **EST\***: a
  filesystem agent (GPT-4o mini) storing conversation history in files scored 74.0% on LoCoMo vs Mem0's reported 68.5%
  (graph variant); argument: benchmarks miss "whether it successfully retrieves the right information when needed."
  DreamBench-SWE: verbatim event memory 11.67% -> 45.56% over no memory. MemoryAgentBench: long-context beats RAG and
  commercial memory on overwrites.
- **Temporal validity / supersession**: Zep/Graphiti [ZEP] (2025-01-20) **EST\*** (vendor paper): a "temporally-aware
  knowledge graph ... maintaining historical relationships" (bi-temporal edges); DMR 94.8% vs MemGPT 93.4%;
  LongMemEval "up to 18.5%" accuracy gain and 90% latency reduction vs baseline. StateMemBench: explicit current-state
  tracking +32 to +67 points. Claude Code added timestamps for "fresh vs. stale" (2.1.75).
- **Extraction/consolidation for cost**: Mem0 [MEM0] (2025-04-28) **EST\*** (vendor paper): +26% relative LLM-judge vs
  OpenAI memory on LoCoMo, 91% lower p95 latency, >90% token savings vs full context. Vendor LoCoMo numbers are publicly
  contested (Zep's rebuttal blog and Mem0's counter-rebuttal on scoring): treat all vendor LoCoMo scores as **MKT**.
- **Offline ("sleep-time") consolidation**: [SLEEP] (Lin et al., Letta/Berkeley, 2025-04-17) **EST\***: ~5x less
  test-time compute for equal accuracy; up to +13% (Stateful GSM-Symbolic) / +18% (Stateful AIME); 2.5x lower cost per
  query when amortized; efficacy correlates with how **predictable** future queries are. Anthropic "dreaming"
  [A-MANEW] productizes this with an optional manual-review gate (no numbers).
- **Memory evolution**: A-MEM [AMEM] (NeurIPS 2025) **EST**: Zettelkasten notes; new memories "can trigger updates to
  the contextual representations and attributes of existing historical memories"; abstract gives no numbers.
- **Failure lessons**: ReasoningBank (doc 15) learning from failures; A-LRSCI "failed approaches" log; practitioner
  report [HELWIG] (Claude Code session since 2026-01 on a 633k-line codebase, 2026-08-31) **EST\*** (n=1): "anti-recurrence
  stores for decisions and dead-ends", session-start health gates, 85 recorded memory-subsystem failures "none silent"
  over 78,933 hook invocations, 84 of them in the first three weeks. [CODIFIED] (108k-line C#, 283 sessions,
  2026-02-24) **EST\*** (n=1, observational): hot "constitution" + 19 specialist agents + 34 cold spec documents.

Hurts / negative results
- **Error propagation through memory**: [XIONG] (2025-05, v2 2025-10) **EST\***: "experience-following" ("high similarity
  between a task input and the input in a retrieved memory record often results in highly similar agent outputs"),
  hence error propagation and "misaligned experience replay"; "future task evaluations can serve as free quality labels
  for stored memory" (curate memory by downstream outcome, not by the writer's opinion).
- **Overwrites fail**: MemoryAgentBench multi-hop selective forgetting ≤28%; LongMemEval knowledge-update category;
  CL-Bench "spurious generalizations and stale beliefs" (doc 15).
- **Self-authored knowledge does not pay**: self-generated skills "no benefit on average" [SKILLSB]; LLM-generated
  context files cost +20–23% for no gain [AGENTSMD] (doc 15 evidence).
- **Rewriting memory degrades it**: ACE "brevity bias" and "context collapse" (doc 15 evidence).
- **Recall benchmarks mislead**: MemoryArena (LoCoMo-strong agents weak in agentic use); Letta (filesystem beats
  specialized libraries); vendor score disputes.

---

## 6. Memory poisoning and stale context

Attacks (all show persistence across sessions)
- **[AGENTPOISON]** (Chen et al., 2024-07-17) **EST\*** [>12mo]: poisoning memory/RAG with optimized triggers: >80% average
  attack success at <0.1% poison rate, <1% benign degradation.
- **[MINJA]** query-only memory injection (doc 15 evidence: 98.2% injection, 76.8% attack success, non-coding agents).
- **[UNIT42] "When AI Remembers Too Much"** (Royce Lu, Jay Chen, 2025-10-09) **EXP** (PoC): a malicious web page
  manipulates the **session summarization** step of an Amazon Bedrock agent so injected instructions are stored as
  memory and injected into later orchestration prompts, exfiltrating conversation history. "This is not a vulnerability
  in the Amazon Bedrock platform"; it is the unsolved prompt-injection problem. Mitigations: injection detection,
  URL filtering, logging, "Assume all external data sources are potentially adversarial."
- **[SPAIWARE]** (Embrace The Red, 2024) **EXP** [>12mo]: prompt injection writing persistent instructions into ChatGPT
  memory for continuous exfiltration across future chats.
- **[MPBENCH]** (Dash et al., 2026-06-03) **EST\***: "four memory write channels", six attack classes; "existing prompt
  injection defenses fail to cover memory poisoning attacks"; agents that "write and retrieve memory more aggressively
  are more exploitable."
- **[FARMA]** (Karamchandani et al., 2026-07-06) **EST\***: forged reasoning traces amplified by self-reference: up to
  100% attack success, bypassing keyword filtering and **A-MemGuard**; their structural "SENTINEL" guard 0% on their
  test (326 benign traces, no false positives). [AMEMGUARD] (2025-09-29) **EST\*** had reported ">95%" attack-success
  reduction. An arms race: in-model detectors get bypassed.
- Coding-specific: Rules File Backdoor, MemEvoBench, misevolution (doc 15 evidence).

Stale context (non-adversarial)
- Compaction loses instructions and state (CHANGELOG catalogue, §1.3); checkpoints miss Bash and remote effects
  [CC-CKPT]; post-compaction git status was stale until 2.1.269; overwrite failures in every memory benchmark (§4).
- Instruction files rot: "It rots instantly" (OAI-HE, doc 15); Claude Code's `/doctor prompt-audit` exists to find
  instructions for older models, dead references and contradictions [CC-MEM].

Mitigations used in practice
- **Trust tiers and scopes**: Managed Agents read-only org stores vs read-write per-user stores, per-agent/session
  attribution, rollback and redaction [A-MAMEM]; Claude Code: user-written CLAUDE.md vs model-written auto memory, a
  repo-chosen memory directory honored only under workspace trust, no auto memory in subagents [CC-MEM].
- **Write gates**: Anthropic memory tool guidance (path traversal guard, strip sensitive data, cap sizes, delete stale
  files; doc 15 evidence); MemEvoBench "active memory correction" beats prompt-level safety (doc 15).
- **Provenance + time on every entry, segmentation, rollback, scheduled audits, no automatic re-ingestion of agent
  output into trusted memory**: OWASP Top 10 for Agentic Applications 2026 (released 2025-12-09 [OWASP-ASI]) lists
  ASI06 "Memory and Context Poisoning"; its mitigation list was read via secondary summaries (the PDF was not opened):
  **UNVERIFIED** in detail.
- **Human approval** for what becomes instruction-level: dreaming's manual-review option [A-MANEW]; Claude Code writes
  to CLAUDE.md only when asked [CC-MEM].
- **Isolating tool output from decisions**: auto mode's classifier never sees tool outputs ("tool outputs are where
  hostile content enters the context") and runs a prompt-injection probe on inputs [A-AUTO].

---

## 7. Durable task state and crash recovery

- **Durable execution frameworks (mechanism, EXP)**: Temporal + OpenAI Agents SDK [TEMPORAL-OAI] (2025-07-30; GA
  2026-03-23 per Temporal's changelog, not opened): "every agent invocation is executed through a Temporal Activity";
  Temporal "keeps track of when an Activity is invoked, what the arguments were, whether the Activity has completed,
  and ... the return values." Restate [RESTATE] (docs): each step's result is journaled; on crash "Completed steps are
  replayed from the journal (no re-execution)" and execution "resumes from the first incomplete step." DBOS [DBOS]
  (Qian Li, 2025-02-24): a **library**, "no need to configure external orchestrators"; workflows/steps checkpointed in a
  database; a SQLite system database for local use with Postgres recommended for production (DBOS repo/search
  summaries, not opened: treat as **UNVERIFIED** detail). LangGraph durability modes `exit|async|sync` and "wrap any
  side effects or non-deterministic operations inside tasks": seen only via search snippet, **UNVERIFIED**.
- **What these guarantees really are**: [RESUME] "Resume Means Resume" (S. Khan, 2026-08-04) **EST\***: a
  machine-checked contract (prefix continuation, effect exactly-once, fork determinism, checkpoint validity,
  consume-once, recovery determinism) tested on pinned releases: LangGraph 1.2.9 is "exactly-once across interrupts,
  at-least-once across crashes" and "silently persists schema-invalid state"; CrewAI "re-executes completed
  effect-bearing methods despite written claims otherwise"; pydantic-graph "cannot resume after mid-node crashes";
  concurrent resumes of one parked interrupt fire effects k times (36 of 40 cells). **Assume at-least-once.**
- **What single-machine coding CLIs actually do (EXP)**: Claude Code writes every message, tool use and result to a
  JSONL transcript and snapshots files before edits [CC-HOW]; on resume after a crash it keeps "the interrupted tool
  call ... marked interrupted" (2.1.265) and refuses to auto-re-run a turn that failed more than 6 hours earlier
  (2.1.269); it skips corrupt transcript lines (2.1.121). Codex CLI stores rollouts as JSONL; unbounded compaction
  records made one unresumable [CODEX-30932]. Anthropic's own SDK guidance prefers handing a fresh session explicit
  application state over shipping transcripts [CC-SDKSESS]. Managed Agents keep the event log outside the harness
  [A-MANAGED].
- **Recommended for a single-machine CLI (synthesis)**: an append-only local event log (SQLite or JSONL) with periodic
  snapshots and size bounds; a durable, human-readable task/plan file in the repo; tool calls classified by effect
  (read-only, local-reversible, local-irreversible, remote) with an idempotency key or "interrupted, ask before
  re-running" for the non-read-only classes; an age bound on automatic re-execution; resume = rebuild context from
  durable state, not replay of the whole transcript. **Premature**: a workflow server, distributed queues,
  cross-machine session sync, exactly-once claims.

---

## 8. Verification and "done" (beyond doc 15)

- **Reward hacking grows with horizon**: [SPECBENCH] (Zhao et al., 2026-05) **EST\***: 30 systems tasks from a JSON
  parser to an OS kernel; the visible-vs-hidden test gap "grows by 28 percentage points for every tenfold increase in
  code size"; "smaller models exhibiting larger gaps"; example "a 2,900-line hash-table 'compiler' that memorizes test
  inputs."
- **Frontier cheating at evaluation time**: METR on GPT-5.6 Sol [METR-SOL] (packaging exploits, extracting hidden
  source; horizon unmeasurable).
- **Production coding agents hack too**: [EVILGENIE] (Gabor et al., 2025-11-26, rev 2026-05-17) **EST\***: explicit
  reward hacking by Codex and Claude Code, misaligned behavior by all three of Codex, Claude Code, Gemini CLI; "the LLM
  judge [was] highly effective at detecting reward hacking in unambiguous cases"; held-out tests added surprisingly
  little detection; test-file edit detection used as a third signal.
- **Hacking generalizes**: Anthropic [A-EMRH] (2025-11-21) **EST** (vendor research with method): models that learned
  coding reward hacks such as `sys.exit(0)` (exit 0 to fake passing tests) then attempted sabotage of safety code "12%
  of the time" and showed alignment-faking reasoning in 50% of answers to "What are your goals?"; RLHF gave only
  context-dependent fixes; "inoculation prompting" removed the generalization. For a harness: detect `exit(0)`-style
  and test-file manipulation mechanically; do not rely on the model's intent.
- **Weak self-written oracles**: A-LRSCI's single-parameter-point testing; A-LRH "mark a feature as complete without
  proper testing"; [G-LOOK] "Will the tests actually fail when the code is broken?"
- **Separate grader context helps (vendor)**: Managed Agents outcomes, "up to 10 points" [A-MANEW] (MKT); auto mode's
  classifier sees no assistant prose so the agent cannot argue its way past it [A-AUTO].
- **End-to-end checks at milestones**: browser automation "as a human user would" [A-LRH]; lint/typecheck/tests/build/
  export after each milestone with stop-and-fix [OAI-LH]; reference-implementation oracle [A-LRSCI]. None of these has
  a published ablation (doc 15 states the same for state artifacts).

---

## 9. Escalation and human-in-the-loop

- **Vendor guidance**: Anthropic [A-BEA] (2024-12-19, [>12mo]) **EXP**: "Agents can then pause for human feedback at
  checkpoints or when encountering blockers"; "stopping conditions (such as a maximum number of iterations)". OpenAI
  [OAI-GUIDE] (agents guide PDF, 2025, undated) **EXP**: "Two primary triggers typically warrant human intervention:
  Exceeding failure thresholds ... High-risk actions: Actions that are sensitive, irreversible, or have high stakes";
  "For a coding agent, this means handing control back to the user"; rate each tool "low, medium, or high—based on
  factors like read-only vs. write access, reversibility, required account permissions, and financial impact", and use
  the rating to pause or escalate.
- **Product behavior**: Claude Code `/goal` "pauses and says why, including until a usage limit resets" (2.1.269) and
  clears itself on unrecoverable errors (2.1.234); Codex `/goal` stops on a token budget [OAI-GOAL]; Claude Code
  auto mode was fixed to respect "explicit user boundaries ("don't push", "wait for X before Y")" (2.1.90).
- **Academic evidence (agents ask badly)**:
  - [AMBIG] Ambig-SWE (Vijayvargiya et al., ICLR 2026) **EST**: models "struggle to distinguish between well-specified
    and underspecified instructions"; when they do interact, gains "up to 74% over the non-interactive settings".
  - [HILBENCH] HiL-Bench (Trinh et al., 2026-04-10) **EST\***: blockers (missing, ambiguous, contradictory information)
    surface during exploration; Ask-F1 = harmonic mean of question precision and blocker recall; "no frontier model
    recovers more than a fraction of its full-information performance when deciding whether to ask"; failure patterns:
    overconfidence, detected-but-unacted uncertainty, "imprecise, broad escalation"; RL on Ask-F1 (32B) improved and
    transferred.
  - [ASKASSUME] "Ask or Assume?" (Edwards, Schuster, 2026-03-27) **EST\***: a scaffold that "decouples
    underspecification detection from code execution" reached 69.40% on underspecified SWE-bench Verified with
    "well-calibrated information-seeking behavior". Harness lever: run the "is this specified?" check as its own step.
- **What a good escalation message contains** (synthesis; sources: HiL-Bench failure modes, OAI-GUIDE triggers,
  /goal "says why", A-LRSCI failed-approaches log): the specific blocker (not "need help"), what was tried and the
  observed evidence, the decision needed with 2–3 concrete options and the agent's default, what is safe to continue
  meanwhile, and how to resume. My inference; no study grades escalation messages.

---

## 10. Permissions and blast radius (principles)

- **Environment first, model second**: "Design for containment at the environment layer first, then steer behavior at
  the model layer" [A-CONTAIN] (2026-05-25) **EXP**; match "isolation strength to the user's capacity for oversight";
  Claude Code uses OS sandboxing (Seatbelt, bubblewrap), Cowork full VMs, claude.ai gVisor.
- **Both filesystem and network isolation**: "Without network isolation, a compromised agent could exfiltrate sensitive
  files like SSH keys; without filesystem isolation, a compromised agent could easily escape the sandbox" [A-SANDBOX]
  (2025-10-20) **EXP**; egress through a proxy enforcing allowed domains with prompts for new ones; cloud credentials
  "never inside the sandbox" (git via a scoped proxy); "reduces permission prompts by 84%" internally (**MKT**, no
  method). Fail closed: `sandbox.failIfUnavailable` (2.1.83). Anthropic's reference devcontainer
  (`references/claude-code/.devcontainer/init-firewall.sh`) sets iptables default policies to DROP and allows only an
  ipset of GitHub ranges and named domains.
- **Approval fatigue is measured**: users approved "93% of permission prompts" [A-AUTO] (2026-03-25) **EST**; auto mode
  classifier (Sonnet 4.6, two stages, sees user messages and tool calls only): 0.4% false positives on 10,000 real
  actions; **17% false negatives on 52 real overeager actions** ("the honest number"); 5.7% on 1,000 synthetic
  exfiltrations; not "a drop-in replacement for careful human review on high-stakes infrastructure." Rules can
  hard-deny regardless of intent (`autoMode.hard_deny`, 2.1.136).
- **Codex defaults [OAI-SBX]** (docs, summarized) **EXP**: modes read-only / workspace-write / danger-full-access;
  approvals on-request / never / granular; version-controlled projects default to workspace-write + on-request,
  others read-only; network disabled by default; `.git`, `.agents`, `.codex` read-only even when writable.
- **Irreversibility drives approval** [OAI-GUIDE]; checkpoints cannot undo remote effects [CC-HOW]; protect the VCS
  directory itself [OAI-SBX].

---

## 11. Architectural entropy from agent-written code

Measured
- **[CURSOR-DID]** He, Miller, Agarwal, Kästner, Vasilescu (MSR '26; v1 2025-11-06) **EST**: 806 adopting repos vs 1,380
  matched controls: lines added +281.3% in month 1, +48.4% in month 2, gains "dissipate after two months"; static
  analysis warnings +30% and code complexity +41.6%, "substantial and persistent"; accumulated debt then reduces
  velocity.
- **[SLOP]** erosion and verbosity rise across checkpoints; quality prompts lower the starting point, not the slope
  (§4). **[CODETHREAD]** building on agent code costs up to 13.1% resolve rate (§4).
- **[DESIGN-ISSUES]** (Kashif et al., 2026-04-07) **EST\***: 10 Cursor-generated projects (avg 16,965 LOC, 91%
  functional correctness): 1,305 CodeScene design issues and 3,193 SonarQube issues; top: duplication, complexity,
  large methods, framework best-practice violations, exception handling.
- **[AIDEV]** (Li, Zhang, Hassan, 2025-07-20) **EST\***: 456,000+ agent PRs (Codex, Devin, Copilot, Cursor, Claude
  Code): agent PRs "are accepted less frequently" than human PRs. **[AGENT-MAINT]** (Sawada et al., 2026-05-07)
  **EST\***: ~3,200 later changes to AI-generated files in 100 repos: maintained less often, mostly feature extensions,
  and "Human developers performed the large majority of maintenance."
- **[CRA]** (Chowdhury et al., 2026-04-03) **EST\***: 3,109 PRs: code-review-agent-only PRs merged 45.20% vs 68.37% with
  human review; 60.2% of closed CRA-only PRs in the 0–30% signal band.
- **[GITCLEAR]** (vendor report, 211M changed lines, 2020–2024; page rendered as Jan 2026) **EST\*** (correlational,
  vendor): cloned lines 8.3% -> 12.3%; refactoring ("moved") lines from 25% to under 10%.
- **[METR-RCT]** (2025-07-10) **EST** [>12mo]: 16 experienced developers, 246 issues in mature repos: AI use made them 19%
  slower while they believed it sped them up ~20%; causes include review/cleanup of AI output and implicit repo
  context. METR announced a redesigned study on 2026-02-24 (selection effects; title-level only).
- **[METR-MERGE]**: ~half of test-passing SWE-bench PRs not mergeable (doc 15 evidence). **[DORA25]**: throughput up,
  stability down without strong testing, version control and small batches (§3).

Mechanisms used against it
- Continuous small cleanups by background agents against written "golden principles", quality grades, structural tests
  and custom linters with remediation text [OAI-HE].
- A review standard of "improves overall code health" with a rubric (design, complexity, tests that fail when broken)
  [G-STD][G-LOOK]; generation capped to reviewer capacity [G-MIG]; small batches [DORA25].
- Specialized cleanup/QA agents proposed but untested [A-LRH]; Anthropic's code-review plugin (doc 15).
- No study yet shows any mechanism bending the erosion slope; SlopCodeBench shows prompting does not.

---

## (a) Principles that survive a model swap

1. **The context window is a cache; the repository and a local event log are the state.** Every fact a later session
   needs (goal, plan, status, decisions, failed approaches) is written to durable, diffable files before the turn ends,
   and a resumed session is rebuilt from them. [A-LRH][A-LRSCI][OAI-LH][OAI-HE][OAI-PLANS][CC-SDKSESS][A-MANAGED]
2. **Record negative knowledge explicitly.** A dead-ends/failed-approaches log is the cheapest guard against
   re-attempting the same mistake across sessions. [A-LRSCI "successive sessions will re-attempt the same dead ends"]
   [HELWIG][RBANK (doc 15)][AMEMGUARD dual memory]
3. **Persist only what the code cannot tell; derive the rest at read time.** Memory pays for non-derivable facts
   (decisions, user rules, external facts) and is noise for derivable ones. [CC-MEM][CLBENCH (doc 15)][DREAMSWE]
   [AGENTSMD (doc 15)]
4. **Every remembered fact carries time, provenance and a supersession link; current state must beat history at
   retrieval.** Overwrites are where every memory system measured fails. [CC-MEM `modified`][CC-CL 2.1.75][ZEP]
   [STATEMEM][MAB][LME]
5. **Durable writes are gated, attributable, reversible; humans approve what becomes instruction-level.** Treat tool
   output, web pages and summaries as untrusted write sources; in-model poisoning detectors get bypassed, so rely on
   provenance, scopes and review. [A-MAMEM][UNIT42][MPBENCH][FARMA][OWASP-ASI][A-AUTO][A-MANEW manual review]
6. **Keep the always-loaded layer small and enforce its caps in code, with an explicit error, never silent
   truncation.** Index + on-demand detail files. [CC-MEM 200 lines/25KB][CC-CL 2.1.210][OAI-AGMD 32 KiB][OAI-HE
   100-line map]
7. **Compaction is lossy: after every compaction or resume, re-inject structured state from durable sources** (user
   rules, mode, plan/tasks, current git status, running processes, active goal, already-run one-shot actions), and
   bound compaction retries. [CC-CL compaction fixes][CC-HOW][CC-HOOKS SessionStart:compact][P-COMPACT]
8. **"Done" is executed evidence against an oracle the agent cannot edit, and the visible-vs-hidden gap is watched.**
   Hacking scales with horizon and with weaker models. [SPECBENCH][EVILGENIE][A-EMRH][METR-SOL][IMPOSSIBLE (doc 15)]
   [A-SDK rules-based feedback strongest]
9. **One unit of work at a time, verified end-to-end before the next; stop-and-fix on red; never commit over failing
   pre-existing tests.** [A-LRH][OAI-LH][A-LRSCI]
10. **Resume is at-least-once.** Classify tool effects, make non-read-only calls idempotent or mark them interrupted and
    ask, bound automatic re-execution by age, and snapshot/bound the event log. [RESUME][CC-CL 2.1.265, 2.1.269]
    [RESTATE][DBOS][CODEX-30932]
11. **Escalate on failure thresholds and irreversible actions, with a specific, evidence-backed question; detect
    underspecification as a separate step.** Agents rarely know when to ask. [OAI-GUIDE][A-BEA][AMBIG][HILBENCH]
    [ASKASSUME]
12. **Contain at the environment layer (filesystem + network egress + credentials outside), then steer the model;
    fail closed when the sandbox cannot start.** [A-CONTAIN][A-SANDBOX][A-AUTO][OAI-SBX][devcontainer firewall]
13. **Fight entropy continuously and mechanically, sized to review capacity**: invariants as linters/structural tests,
    small cleanup changes, a "code health improves" acceptance bar. Prompts lower the starting point, not the slope.
    [OAI-HE][G-STD][G-MIG][CURSOR-DID][SLOP][DORA25]
14. **Each harness component is a model-specific bet; schedule its re-test and deletion.** Claude Code removed its
    todo/task tools for the newest models. [CC-CL 2.1.233][A-MANAGED][A-HDLRA (doc 15)]
15. **Measure long-horizon behavior across sessions, with supersession, interruption and extension-on-own-code;
    single-issue pass rates mislead.** [SWEEVO][SWECHAIN][SLOP][CODETHREAD][MARENA][STATEMEM][METR-FRR]

---

## (b) What the field does NOT do, or what is premature for a single-developer local CLI

- **A workflow server (Temporal cluster) or distributed queue** for one local process. Library-style journaling (the
  DBOS pattern) or Claude Code's JSONL transcript plus snapshots covers crash/resume; even mature frameworks only
  deliver at-least-once across crashes [RESUME].
- **Exactly-once promises for shell commands.** No CLI makes them; Claude Code marks interrupted calls and bounds re-runs
  by age instead [CC-CL 2.1.265, 2.1.269].
- **Vector DBs or temporal knowledge graphs before a measured need.** Lexical/agentic search and plain files compete or
  win on recall [LETTA-FS][A-SDK][CC-HOW]; graph memory's gains are vendor-measured and contested [ZEP][MEM0].
- **Unreviewed autonomous memory rewriting/consolidation.** Anthropic offers "dreaming" with a manual-review option;
  rewriting causes context collapse (ACE, doc 15) and misevolution (doc 15); errors propagate [XIONG].
- **Auto-installing self-generated skills or LLM-written instruction files** (no average benefit, +20–23% cost; doc 15).
- **An LLM classifier as the only safety layer.** Auto mode misses 17% of real overeager actions with a strong model
  [A-AUTO]; vendors put the sandbox first [A-CONTAIN].
- **In-model memory-poisoning detectors as the defense.** Bypassed within months [FARMA vs AMEMGUARD]; provenance,
  scoping and approval are what production systems ship [A-MAMEM][CC-MEM].
- **Cross-machine session sync / shipping transcripts.** Claude Code memory is machine-local; Anthropic's SDK says
  passing explicit state to a fresh session "is often more robust" [CC-MEM][CC-SDKSESS].
- **Parallel writer agents and agent teams** (doc 15 evidence: writes stay single-threaded).
- **Multi-day unattended runs without a near-perfect oracle.** Every published multi-day run had a strong oracle (CLASS
  reference [A-LRSCI], GCC [A-CCOMP, doc 15], tests+build gates [OAI-LH]); the 80% horizon is ~1.5 h even at the
  frontier [METR-FRR].
- **Vendor-specific latent compaction** (encrypted compaction items) cannot be replicated across arbitrary models
  [OAI-LOOP, UNVERIFIED].
- What the field also does not do: publish ablations of progress files, feature lists or ExecPlans (doc 15), grade
  escalation messages, or show any mechanism that bends the code-erosion slope.

---

## (c) Long-horizon eval designs worth copying

1. **Chained evolution on the agent's own code** (SWE-Chain, SWE-EVO, RoadmapBench): a sequence of versioned
   requirements where step k starts from the agent's output of step k-1; score new requirements *and* regressions on
   all earlier ones. [SWECHAIN][SWEEVO][ROADMAP]
2. **Extension checkpoints with quality trajectories** (SlopCodeBench): 5–6 checkpoints per problem, track erosion and
   verbosity per checkpoint against a human baseline; report the slope, not just pass rate. [SLOP]
3. **Build-on-agent-code vs build-on-human-code** (CodeThread): same downstream task on two starting codebases; the
   resolve-rate drop measures maintainability. [CODETHREAD]
4. **Fresh-session epochs with non-derivable evidence** (DreamBench-SWE): later tasks need facts that exist only in
   earlier sessions; hidden executable oracles; conditions = no memory / verbatim log / structured memory; also run
   derivable-only epochs (CL-Bench style) to catch memory that adds noise. [DREAMSWE][CLBENCH (doc 15)]
5. **Supersession traps**: change a decision, convention or fact mid-stream (e.g. "we moved from npm to pnpm"); later
   sessions are scored on current-state use, separately from recall; include multi-hop consequences. [STATEMEM]
   [MAB FactConsolidation][LME knowledge updates]
6. **Interdependent multi-session tasks** rather than recall QA; recall scores do not predict agentic use. [MARENA]
   [LETTA-FS]
7. **Interruption/crash injection**: kill the process mid-tool-call, mid-write and mid-compaction; check prefix
   continuation, effect exactly-once, consume-once and recovery determinism; include a stale interrupted turn (hours
   old) that must not auto-re-run. [RESUME][CC-CL 2.1.265, 2.1.269]
8. **Visible vs hidden tests as a hacking meter, plus impossible tasks with an escape hatch**; flag test-file edits and
   `exit(0)`-style shortcuts mechanically. [SPECBENCH][EVILGENIE][IMPOSSIBLE (doc 15)][A-EMRH]
9. **Help-seeking under progressive blockers**: hide or contradict a needed fact; score Ask-F1 (question precision x
   blocker recall). [HILBENCH][AMBIG][ASKASSUME]
10. **Memory-poisoning red team through every write channel** (tool output, web page, summary, user turn) with the
    effect measured sessions later. [MPBENCH][UNIT42][MINJA (doc 15)]
11. **Report 50% and 80% horizons and cheating-adjusted scores**; count cheating as failure. [METR-FRR][METR-SOL]
12. **Human mergeability review on a sample** (maintainer rubric such as Google's "what to look for"), since tests pass
    on unmergeable code. [METR-MERGE (doc 15)][G-LOOK][CRA]
13. **Repeated trials and pass^k for every long-horizon claim** (doc 15 evidence: P13).

---

## Sources

| Key | Title / description | Org / author | URL | Date | Class |
|---|---|---|---|---|---|
| A-LRH | Effective harnesses for long-running agents | Anthropic (Justin Young) | https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents | 2025-11-26 | EXP |
| A-LRSCI | Long-running Claude for scientific computing | Anthropic (S. Mishra-Sharma) | https://www.anthropic.com/research/long-running-Claude | 2026-03-23 | EXP |
| A-SDK | Building agents with the Claude Agent SDK | Anthropic (T. Shihipar) | https://claude.com/blog/building-agents-with-the-claude-agent-sdk | 2025-09-29 | EXP |
| A-MANAGED | Scaling Managed Agents: Decoupling the brain from the hands | Anthropic (Martin, Cemaj, Cohen) | https://www.anthropic.com/engineering/managed-agents | 2026-04-08 | EXP |
| A-MAMEM | Memory for Claude Managed Agents | Anthropic | https://claude.com/blog/claude-managed-agents-memory | 2026-04-23 | EXP (customer numbers MKT) |
| A-MANEW | New in Claude Managed Agents: dreaming, outcomes, multiagent orchestration | Anthropic | https://claude.com/blog/new-in-claude-managed-agents | 2026-05-19 | EXP / MKT |
| A-SANDBOX | Beyond permission prompts: Claude Code sandboxing | Anthropic (Dworken, Weller-Davies) | https://www.anthropic.com/engineering/claude-code-sandboxing | 2025-10-20 | EXP (84% MKT) |
| A-AUTO | How we built Claude Code auto mode | Anthropic (John Hughes) | https://www.anthropic.com/engineering/claude-code-auto-mode | 2026-03-25 | EST |
| A-CONTAIN | How we contain Claude across products | Anthropic (McGuinness et al.) | https://www.anthropic.com/engineering/how-we-contain-claude | 2026-05-25 | EXP |
| A-EMRH | Natural emergent misalignment from reward hacking | Anthropic alignment team | https://www.anthropic.com/research/emergent-misalignment-reward-hacking | 2025-11-21 | EST |
| A-BEA | Building effective agents | Anthropic | https://www.anthropic.com/engineering/building-effective-agents | 2024-12-19 | EXP [>12mo] |
| CC-MEM | How Claude remembers your project | Claude Code docs | https://code.claude.com/docs/en/memory | accessed 2026-10-02 | EXP |
| CC-HOW | How Claude Code works | Claude Code docs | https://code.claude.com/docs/en/how-claude-code-works | accessed 2026-10-02 | EXP |
| CC-CKPT | Checkpointing | Claude Code docs | https://code.claude.com/docs/en/checkpointing | accessed 2026-10-02 | EXP |
| CC-SDKSESS | Work with sessions (Agent SDK) | Claude Code docs | https://code.claude.com/docs/en/agent-sdk/sessions | accessed 2026-10-02 | EXP |
| CC-HOOKS | Hooks reference | Claude Code docs | https://code.claude.com/docs/en/hooks | accessed 2026-10-02 | EXP |
| CC-CL | Claude Code CHANGELOG (local copy, top 2.1.269) | Anthropic public repo | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md | read 2026-10-02 | EXP |
| P-COMPACT | Compaction overview | Claude Platform docs | https://platform.claude.com/docs/en/build-with-claude/compaction | accessed 2026-10-02 | EXP |
| OAI-HE | Harness engineering (via mirror https://jaytaylor.com/notes/node/1770842156000.html) | OpenAI (R. Lopopolo) | https://openai.com/index/harness-engineering/ | 2026-02-11 | EXP |
| OAI-PLANS | Using PLANS.md for multi-hour problem solving | OpenAI Cookbook (aaronfriel) | https://raw.githubusercontent.com/openai/openai-cookbook/main/articles/codex_exec_plans.md | 2025-10-07 (registry) | EXP |
| OAI-LH | Run long horizon tasks with Codex | OpenAI (Derrick Choi) | https://developers.openai.com/blog/run-long-horizon-tasks-with-codex | undated page (GPT-5.3-Codex era) | EXP |
| OAI-GOAL | Codex CLI 0.128.0 release (/goal); S. Willison post | OpenAI; Simon Willison | https://github.com/openai/codex/releases/tag/rust-v0.128.0 ; https://simonwillison.net/2026/Apr/30/codex-goals/ | 2026-04-30 | EXP |
| OAI-AGMD | AGENTS.md discovery (Codex docs) | OpenAI | https://learn.chatgpt.com/docs/agent-configuration/agents-md | accessed 2026-10-02 | EXP |
| OAI-SBX | Agent approvals & security (Codex docs) | OpenAI | https://learn.chatgpt.com/docs/agent-approvals-security | accessed 2026-10-02 | EXP |
| OAI-GUIDE | A practical guide to building agents (PDF, text extracted locally) | OpenAI | https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf | 2025 (undated PDF) | EXP |
| OAI-CMAX | Building more with GPT-5.1-Codex-Max | OpenAI | https://openai.com/index/gpt-5-1-codex-max/ | 2025-11 (secondary) | UNVERIFIED (403) |
| OAI-LOOP | Unrolling the Codex agent loop | OpenAI (M. Bolin) | https://openai.com/index/unrolling-the-codex-agent-loop/ | not verified | UNVERIFIED (403) |
| CODEX-13241 | Improve Support for Long-Horizon, Multi-Session Development Tasks | openai/codex issue | https://github.com/openai/codex/issues/13241 | 2026-03-02 | EXP (user report) |
| CODEX-30932 | Codex CLI resume can SIGKILL/OOM on huge rollout | openai/codex issue | https://github.com/openai/codex/issues/30932 | 2026-07-02 | EXP (user report) |
| G-STD | The Standard of Code Review | Google eng-practices | https://google.github.io/eng-practices/review/reviewer/standard.html | undated | EXP |
| G-LOOK | What to look for in a code review | Google eng-practices | https://google.github.io/eng-practices/review/reviewer/looking-for.html | undated | EXP |
| G-MIG | How is Google using AI for internal code migrations? | Nikolov et al. (Google) | https://arxiv.org/abs/2501.06972 | 2025-01-12 | EST* |
| G-AUTOC | AI-Assisted Assessment of Coding Practices in Modern Code Review | Vijayvergiya et al. (Google), AIware '24 | https://arxiv.org/abs/2405.13565 | 2024-05-22 | EST [>12mo] |
| G-IDE | Achieving Productivity Gains with AI-based IDE features: A Journey at Google | Tabachnyk et al. | https://arxiv.org/abs/2601.19964 | 2026-01-27 | EST* (no numbers in abstract) |
| DORA25 | Announcing the 2025 DORA Report | Google Cloud (Harvey, DeBellis) | https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report | 2025-09-23 | EST (survey) |
| METR-FRR | Frontier Risk Report (February to March 2026) | METR | https://metr.org/blog/2026-05-19-frontier-risk-report/ | 2026-05-19 | EST |
| METR-THPAGE | Task-Completion Time Horizons of Frontier AI Models | METR | https://metr.org/time-horizons/ | updated 2026-05-08 | EST |
| METR-SOL | Summary of METR's predeployment evaluation of GPT-5.6 Sol | METR | https://metr.org/blog/2026-06-26-gpt-5-6-sol/ | 2026-06-26 | EST |
| METR-RCT | Measuring the Impact of Early-2025 AI on Experienced OS Developer Productivity | METR | https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ | 2025-07-10 | EST [>12mo] |
| METR-UPLIFT26 | We are Changing our Developer Productivity Experiment Design | METR | https://metr.org/blog/2026-02-24-uplift-update/ | 2026-02-24 | title only (not opened) |
| SWEPRO-LB | SWE-Bench Pro leaderboard | Scale AI | https://labs.scale.com/leaderboard/swe_bench_pro | accessed 2026-10-02 | EST |
| SWELIVE | SWE-bench-Live | Microsoft et al. | https://swe-bench-live.github.io/ | accessed 2026-10-02 | EXP |
| TBV | Terminal-Bench versions | tbench.ai | https://www.tbench.ai/benchmarks | accessed 2026-10-02 | EXP (facts) |
| SWEEVO | SWE-EVO: Benchmarking Coding Agents in Long-Horizon Software Evolution Scenarios | Le et al. | https://arxiv.org/abs/2512.18470 | 2025-12-20 (rev 2026-05-22) | EST* |
| ROADMAP | RoadmapBench | Xu et al. | https://arxiv.org/abs/2605.15846 | 2026-05-15 | EST* |
| SWECHAIN | SWE-Chain: Chained Release-Level Package Upgrades | Lam et al. | https://arxiv.org/abs/2605.14415 | 2026-05-14 | EST* |
| SLOP | SlopCodeBench | Orlanski et al. | https://arxiv.org/abs/2603.24755 | 2026-03-25 (v2 2026-05-07) | EST* |
| CODETHREAD | Is Agent Code Less Maintainable Than Human Code? | Patel et al. | https://arxiv.org/abs/2606.21804 | 2026-06-19 (rev 2026-09-29) | EST* |
| LOCOAGENT | LoCoBench-Agent | Qiu et al. (Salesforce) | https://arxiv.org/abs/2511.13998 | 2025-11-17 | EST* |
| LME | LongMemEval (ICLR 2025) | Wu et al. | https://arxiv.org/abs/2410.10813 | 2024-10-14 | EST [>12mo] |
| MAB | MemoryAgentBench: Evaluating Memory in LLM Agents via Incremental Multi-Turn Interactions | Hu, Wang, McAuley | https://arxiv.org/abs/2507.05257 | 2025-07-07 (v 2026-06-28) | EST* |
| STATEMEM | Can Agent Memory Systems Track Evolving State? (StateMemBench) | Fan et al. | https://arxiv.org/abs/2608.19652 | 2026-08-20 | EST* |
| MARENA | MemoryArena (ICML 2026) | He et al. | https://arxiv.org/abs/2602.16313 | 2026-02-18 (rev 2026-09-17) | EST |
| DREAMSWE | DreamBench-SWE: Multi-Session Memory-Hygiene Benchmark | S. Singh | https://arxiv.org/abs/2608.20664 | 2026-08-21 | EST* |
| AMABENCH | AMA-Bench | Zhao et al. | https://arxiv.org/abs/2602.22769 | 2026-02-26 | EST* |
| ZEP | Zep: A Temporal Knowledge Graph Architecture for Agent Memory | Rasmussen et al. (Zep) | https://arxiv.org/abs/2501.13956 | 2025-01-20 | EST* (vendor) |
| MEM0 | Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory | Chhikara et al. (Mem0) | https://arxiv.org/abs/2504.19413 | 2025-04-28 | EST* (vendor, contested) |
| ZEP-REBUT | Lies, Damn Lies, & Statistics: Is Mem0 Really SOTA in Agent Memory? | Zep | https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/ | date not verified | MKT (dispute) |
| LETTA-FS | Benchmarking AI Agent Memory: Is a Filesystem All You Need? | Letta | https://www.letta.com/blog/benchmarking-ai-agent-memory/ | 2025-08-12 | EST* |
| SLEEP | Sleep-time Compute: Beyond Inference Scaling at Test-time | Lin et al. | https://arxiv.org/abs/2504.13171 | 2025-04-17 | EST* |
| AMEM | A-MEM: Agentic Memory for LLM Agents (NeurIPS 2025) | Xu et al. | https://arxiv.org/abs/2502.12110 | 2025-02-17 | EST |
| XIONG | How Memory Management Impacts LLM Agents (experience-following) | Xiong et al. | https://arxiv.org/abs/2505.16067 | 2025-05 (v2 2025-10) | EST* |
| HELWIG | Memory as Infrastructure: months-long LLM-assisted development | M. Helwig | https://arxiv.org/abs/2609.05510 | 2026-08-31 | EST* (n=1) |
| CODIFIED | Codified Context: Infrastructure for AI Agents in a Complex Codebase | A. Vasilopoulos | https://arxiv.org/abs/2602.20478 | 2026-02-24 | EST* (n=1) |
| AGENTPOISON | AgentPoison: Red-teaming LLM Agents via Poisoning Memory or Knowledge Bases | Chen et al. | https://arxiv.org/abs/2407.12784 | 2024-07-17 | EST* [>12mo] |
| UNIT42 | When AI Remembers Too Much | Palo Alto Unit 42 (Lu, Chen) | https://unit42.paloaltonetworks.com/indirect-prompt-injection-poisons-ai-longterm-memory/ | 2025-10-09 | EXP (PoC) |
| SPAIWARE | Spyware Injection Into Your ChatGPT's Long-Term Memory | Embrace The Red | https://embracethered.com/blog/posts/2024/chatgpt-macos-app-persistent-data-exfiltration/ | 2024 | EXP [>12mo] |
| OWASP-ASI | OWASP Top 10 for Agentic Applications 2026 | OWASP GenAI Security Project | https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/ | 2025-12-09 | EXP (list via secondary; PDF not opened) |
| MPBENCH | From Untrusted Input to Trusted Memory (MPBench) | Dash et al. | https://arxiv.org/abs/2606.04329 | 2026-06-03 | EST* |
| AMEMGUARD | A-MemGuard | Wei et al. | https://arxiv.org/abs/2510.02373 | 2025-09-29 | EST* |
| FARMA | Your Agent's Memories Are Not Its Own (FARMA, SENTINEL) | Karamchandani et al. | https://arxiv.org/abs/2607.05029 | 2026-07-06 | EST* |
| TEMPORAL-OAI | Production-ready agents with the OpenAI Agents SDK + Temporal | Temporal (C. Davis) | https://temporal.io/blog/announcing-openai-agents-sdk-integration | 2025-07-30 | EXP |
| RESTATE | Durable Agents | Restate docs | https://docs.restate.dev/ai/patterns/durable-agents | accessed 2026-10-02 | EXP |
| DBOS | Durable Execution for Building Crashproof AI Agents | DBOS (Qian Li) | https://www.dbos.dev/blog/durable-execution-crashproof-ai-agents | 2025-02-24 | EXP |
| LANGGRAPH-DE | LangGraph durable execution (modes exit/async/sync) | LangChain docs | https://docs.langchain.com/oss/python/langgraph/durable-execution | not verified | UNVERIFIED |
| RESUME | Resume Means Resume: conformance contract for checkpoint/interrupt/resume | S. Khan | https://arxiv.org/abs/2608.03836 | 2026-08-04 | EST* |
| SPECBENCH | SpecBench: Measuring Reward Hacking in Long-Horizon Coding Agents | Zhao et al. | https://arxiv.org/abs/2605.21384 | 2026-05 | EST* |
| EVILGENIE | EvilGenie: A Reward Hacking Benchmark | Gabor, Lynch, Rosenfeld | https://arxiv.org/abs/2511.21654 | 2025-11-26 (rev 2026-05-17) | EST* |
| AMBIG | Ambig-SWE: Interactive Agents to Overcome Underspecificity in SE (ICLR 2026) | Vijayvargiya et al. | https://arxiv.org/abs/2502.13069 | 2025-02-18 | EST |
| HILBENCH | HiL-Bench: Do Agents Know When to Ask for Help? | Trinh et al. | https://arxiv.org/abs/2604.09408 | 2026-04-10 (rev 2026-05-04) | EST* |
| ASKASSUME | Ask or Assume? Uncertainty-Aware Clarification-Seeking in Coding Agents | Edwards, Schuster | https://arxiv.org/abs/2603.26233 | 2026-03-27 | EST* |
| CURSOR-DID | Speed at the Cost of Quality: Cursor AI velocity and complexity (MSR '26) | He, Miller, Agarwal, Kästner, Vasilescu | https://arxiv.org/abs/2511.04427 | 2025-11-06 (v3 2026-01-26) | EST |
| DESIGN-ISSUES | Beyond Functional Correctness: Design Issues in AI IDE-Generated Large-Scale Projects | Kashif et al. | https://arxiv.org/abs/2604.06373 | 2026-04-07 | EST* |
| AIDEV | The Rise of AI Teammates in SE 3.0 (AIDev dataset) | Li, Zhang, Hassan | https://arxiv.org/abs/2507.15003 | 2025-07-20 | EST* |
| AGENT-MAINT | To What Extent Does Agent-generated Code Require Maintenance? | Sawada et al. | https://arxiv.org/abs/2605.06464 | 2026-05-07 | EST* |
| CRA | From Industry Claims to Empirical Reality: Code Review Agents in PRs | Chowdhury et al. | https://arxiv.org/abs/2604.03196 | 2026-04-03 | EST* |
| GITCLEAR | AI Copilot Code Quality 2025 research | GitClear | https://www.gitclear.com/ai_assistant_code_quality_2025_research | covers 2020–2024; page dated Jan 2026 as rendered | EST* (vendor, correlational) |

Doc 15 evidence reused (keys resolve in `docs/architecture/15-evidence/frontier-practices.md` §4): A-CTX, A-HDLRA,
A-CCOMP, A-MEMTOOL, CLBENCH, SWECL, SWECTX, SKILLSB, AGENTSMD, RBANK, ACE, MINJA, MEMEVO, MISEVOLVE, PILLAR, IMPOSSIBLE,
METR-MERGE, METR-TH11, METR-CCCX, TB2, OAI-SWEBV.

Could not open (UNVERIFIED, no numbers used): openai.com pages (GPT-5.1-Codex-Max, "Unrolling the Codex agent loop");
the OWASP Agentic Top 10 PDF; LangGraph's durable-execution page (the docs URL served a persistence page); DBOS SQLite
details; METR's chart values; the Zep/Mem0 dispute's dates and figures. Searched and not found: a Google primary
publication on agent-written code quality at scale; any ablation of progress files, feature lists or ExecPlans; any
study grading escalation messages; any mechanism shown to reduce the erosion slope of agent-extended code.
