# Lane 12 sources — Durable harness mechanics and long-horizon resume

All accessed 2026-09-14 or 2026-09-15 during this lane's research session, as noted. Primary before
secondary throughout; two entries are marked UNVERIFIED/secondary where a primary fetch could not be
completed this session.

## Claude Code (primary — code.claude.com; `docs.claude.com` 301-redirects here)

1. **How Claude remembers your project** (memory) — Anthropic — code.claude.com/docs/en/memory — accessed
   2026-09-14. Evidences: CLAUDE.md hierarchy/precedence/load order, auto memory note types, storage
   location, load budget (200 lines/25KB), machine-locality, retention-sweep exemption, subagent memory
   isolation, "context not enforced configuration" framing, managed CLAUDE.md vs settings enforcement table.
2. **Hooks reference** — Anthropic — code.claude.com/docs/en/hooks — accessed 2026-09-14. Evidences: full
   hook event list (SessionStart/SessionEnd/Setup, UserPromptSubmit/Stop/StopFailure,
   PreToolUse/PostToolUse/PostToolUseFailure/PostToolBatch/PermissionRequest/PermissionDenied, PreCompact/
   PostCompact, SubagentStart/SubagentStop, and more), which events can deterministically block (exit code
   2), common input fields, version gates.
3. **Explore the context window** (context-window) — Anthropic — code.claude.com/docs/en/context-window —
   accessed 2026-09-14. Evidences: exact "what survives compaction" table (CLAUDE.md/auto memory/plan
   re-injected from disk; up to 5 recently-modified files re-read; path-scoped rules and nested CLAUDE.md
   reload on file touch; skill bodies re-attached with 5K/25K token caps; skill *description index* does
   NOT reload), auto-compact threshold pointer, `/autocompact` override.
4. **Manage sessions** (sessions) — Anthropic — code.claude.com/docs/en/sessions — accessed 2026-09-14.
   Evidences: `--continue`/`--resume`/`/resume`/`--from-pr` mechanics, exact list of what a resumed session
   restores and does not restore (the crash/mid-flight-tool admission is here), permission-mode-on-resume
   table, transcript storage path and format, default ~30-day `cleanupPeriodDays` retention, resume-from-
   summary dialog behavior, `/branch`.
5. **Checkpointing** — Anthropic — code.claude.com/docs/en/checkpointing — accessed 2026-09-14. Evidences:
   per-turn file snapshot mechanism (last 100 kept), `/rewind` menu options, ~30-day snapshot retention tied
   to the same sweep, explicit limitations (Bash changes, subagent edits, external changes, symlinks,
   mid-turn messages), "not a replacement for version control."
6. **Skills** (progressive disclosure) — Anthropic — code.claude.com/docs/en/skills — accessed 2026-09-14.
   Evidences: description-always-loaded/body-on-invocation model, `disable-model-invocation`, content
   persistence and deduplication on re-invocation, post-compaction re-attachment rules (5K/skill, 25K total,
   oldest dropped, truncation keeps file start), version-gated feature history.
7. **Keep Claude working toward a goal** (`/goal`) — Anthropic — code.claude.com/docs/en/goal — accessed
   2026-09-14. Evidences: `/goal` as a session-scoped prompt-based Stop hook wrapper, evaluator verdicts
   (met/not yet met/impossible), resume behavior (condition carried, turn count/timer/token baseline reset,
   restored on every resume route as of v2.1.239), background-work check-in cadence, error handling
   (unrecoverable vs retry/pause).
8. **Track todos** (Agent SDK todo-tracking) — Anthropic — code.claude.com/docs/en/agent-sdk/todo-tracking —
   accessed 2026-09-14. Evidences: `TodoWrite`/`TaskCreate`/`TaskGet`/`TaskUpdate`/`TaskList` tool set,
   model-availability gating, todo lifecycle (pending → in_progress → completed/deleted), confirmation that
   these are transcript tool-calls with no separately-documented persistent store.
9. **Choose a permission mode** (permission-modes) — Anthropic — code.claude.com/docs/en/permission-modes —
   accessed 2026-09-14. Evidences: plan mode mechanics and edit-blocking (with the bypass-permissions
   caveat), auto-mode classifier, and the load-bearing line: "Boundaries are not stored as rules. The
   classifier re-reads them from the transcript on each check, so a boundary can be lost if context
   compaction removes the message that stated it. For a hard guarantee, add a deny rule instead."

## Codex (OpenAI)

10. **Hooks** — OpenAI — learn.chatgpt.com/codex/hooks — accessed 2026-09-15. Evidences: full Codex hook
    event list including `PreCompact`/`PostCompact` (matcher on `trigger`: manual/auto; `PreCompact` can
    veto via `continue:false`, `PostCompact` cannot), `SessionStart` firing with `source:"compact"` after a
    root-session compaction. Presented as an established, unversioned feature at time of fetch.
11. **ChatGPT & Codex changelog** — OpenAI — learn.chatgpt.com/docs/changelog (redirect target of
    developers.openai.com/codex/changelog) — accessed 2026-09-15. Evidences: most recent entry
    2026-09-11 (v26.908); Codex CLI 0.154.0 (2026-09-09) "refresh skills and hooks after external plugin
    upgrades"; Codex CLI 0.153.0 (2026-09-03) "Treat bundled cleanup hooks as built-ins," "Refine hook
    activity rendering in the TUI." No entry explicitly dated for the first shipment of `PreCompact`/
    `PostCompact` — ship date bounded only by items 12/13 below, NOT FOUND precisely.
12. **"Add a post-compaction hook for deterministic memory reinjection"** — GitHub issue, `openai/codex`
    #19061 — opened 2026-04-23, closed (closing comment/date/linked PR not visible in fetch) —
    github.com/openai/codex/issues/19061 — accessed 2026-09-15. Evidences: as of 2026-04-23, "Codex does
    not expose a post-compaction hook, so external memory systems have to use brittle workarounds";
    requester compares directly to Claude Code: "Claude Code already has a hook for this class of workflow,
    but Codex currently does not."
13. **"Pre and PostCompact hooks"** — GitHub issue, `openai/codex` #17148 — opened 2026-04-08, open at
    fetch time — github.com/openai/codex/issues/17148 — accessed 2026-09-15. Evidences: as of 2026-04-08,
    only SubAgentStart/SessionStart/pre-post-tool-use/stop hooks existed; PreCompact/PostCompact were a
    request, not yet shipped.
14. Codex session storage (`~/.codex/sessions/*.jsonl`, `context_compacted` event type) and the general
    claim that memory-plugin hooks fire at `UserPromptSubmit`/`Stop`/`PreCompact` — WebSearch synthesis only,
    **not independently fetched from a primary Codex doc this session**; used only as a secondary,
    lower-confidence pointer in §3, not as a standalone claim block. Medium-low confidence.

## Cursor

15. **Checkpoints** — Cursor (Anysphere) — cursor.com/docs (chat/checkpoints page, exact slug not preserved
    in the fetch tool's URL echo) — accessed 2026-09-15. Evidences: local, git-independent snapshot storage,
    auto-creation before significant changes, restore-files-only-keeps-messages behavior, explicit "use Git
    for permanent... long-term storage" framing.
16. **Rules** — Cursor (Anysphere) — cursor.com/docs/context/rules — accessed 2026-09-15. Evidences: Rules
    ≠ Memories (explicit statement that this page does not cover memories); four rule scopes (Project/User/
    Team/AGENTS.md); used to establish that Cursor's official Memories mechanics page could not be resolved
    this session (`docs.cursor.com/context/memories` and `docs.cursor.com/memories` both 308-redirected to
    the generic docs root rather than memories-specific content).
17. Cursor Memories beta existence — community forum thread ("0.51: 'Memories' feature," forum.cursor.com)
    and lane 05's prior finding — **secondary source only**, cited in lane report §3 as confirming existence
    but not mechanics; NOT independently verified by primary fetch this session.

## Cline

18. **Checkpoints** — Cline — docs.cline.bot/features/checkpoints — accessed 2026-09-15. Evidences: shadow
    git repository separate from the project's own git history, commit-after-every-tool-use, three restore
    modes (files/task/both), captures files not tracked by the project's real git, default-enabled,
    documented performance cost on large repos.
19. **Cline Memory Bank** — Cline — docs.cline.bot/prompting/cline-memory-bank — accessed 2026-09-15.
    Evidences: six-file structure (projectbrief/productContext/activeContext/systemPatterns/techContext/
    progress.md), read-at-start-of-every-task behavior, update triggers, and the central finding that this
    is "model-driven" — "the custom instructions embed the behavior directly into Cline's prompt" via
    user-copied `.clinerules/` files, with no runtime enforcement.

## OpenCode

20. **Compaction** — OpenCode (Anomaly / sst) — opencode.ai/v2/docs/compaction — accessed 2026-09-15.
    Evidences: exact v2 checkpoint-based auto-trigger formula (`min(input limit − buffer, context limit −
    max(output reserve, buffer))`, worked example at 108K of 128K), checkpoint content fields (objective/
    decisions/blockers/next-moves/files), `keep.tokens` retained-tail default (15,000), 2,000-character tool-
    result abbreviation cap, "earlier messages remain stored permanently but excluded from active model
    context."

## Gemini CLI (Google)

21. **Session management** — Google — geminicli.com/docs/cli/session-management/ — accessed 2026-09-15.
    Evidences: automatic full-history session recording (prompts, responses, tool executions, token usage,
    reasoning summaries), storage path `~/.gemini/tmp/<project_hash>/chats/`, `--resume`/`-r`/`/resume`
    Session Browser, named checkpoints via `/resume save`/`/resume resume`, `maxSessionTurns` as the only
    documented context-growth control (no compaction/summarization mechanism described on this page).
22. A separate WebSearch synthesis describing `/chat save <tag>`/`/chat resume <tag>` as *the* resume
    mechanism — superseded in this report by item 21's primary fetch, which documents both the older named-
    checkpoint command family and a newer automatic `--resume`/`/resume` browser; the two are not
    necessarily in conflict (older + newer commands coexisting) but item 21 is the authoritative source used.

## Durable execution / event sourcing / recovery-aware architectures

23. **Introduction to Temporal** (understanding-temporal) — Temporal Technologies — docs.temporal.io/
    evaluate/understanding-temporal — accessed 2026-09-15. Evidences: Event History as "a complete and
    durable log," Worker replay reconstructing pre-crash state "as if the failure never occurred" — the
    canonical durable-execution definition this lane's §4.1 contrasts against every coding-agent harness.
24. **Workflow definitions** — Temporal Technologies — docs.temporal.io/workflow-definition — accessed
    2026-09-15. Evidences: the determinism requirement ("same Workflow API calls in the same sequence,
    given the same input"), explicit exclusion of "API calls, LLM/AI invocations, database queries" from
    Workflow code — pushed into Activities instead — and the replay-comparison mechanism that detects
    non-determinism.
25. **Event Sourcing** — Martin Fowler — martinfowler.com/eaaDev/EventSourcing.html — accessed 2026-09-15.
    Foundational pattern reference (pre-2024; cited for definitional precision per the mission's source-
    hygiene rule, not as a dated recency claim). Evidences: capture-all-changes-as-events definition,
    replay-to-reconstruct-state mechanism, and the pattern's own acknowledged costs (awkwardness, replay
    performance requiring snapshot caching, complexity interfacing with non-event-sourced external systems).
26. **AgentRewind: Recoverable Execution for Long-Horizon LLM Agents** — Zhuang, Chen, Duan, Zheng, Li,
    Zhang — arXiv:2608.14380v1 — submitted 2026-08-14 — https://arxiv.org/html/2608.14380 — accessed
    2026-09-15. Evidences: aligned context+environment(git-commit) checkpointing, agent-triggered
    `backtrack_commit`/`backtrack_candidates` tools, measured gains on MettleBench (82 tasks: 87.8% vs 62.2%
    success, +25.6pp) and Terminal-Bench 2.0 (89 tasks: 83.1% vs 78.7%, +4.4pp) against a plain-continue
    baseline; explicit exclusion of external effects (network/service calls) from what is checkpointed.
    arXiv preprint; not confirmed peer-reviewed.
27. **Forgetting Without Restarting: Execution-State Unlearning for Stateful LLM Agents** — Yao, Wei, Huang,
    Qian, Chen, Lu, Wu, He — arXiv:2609.04875v1 — submitted 2026-09-04 —
    https://arxiv.org/html/2609.04875 — accessed 2026-09-15. Evidences: formal deterministic-transition-
    system model of agent runtime state (Rt = F(Rt−1, ot; θ)), state components named explicitly — KV cache,
    working memory, uncommitted tool plans, compressed (model-authored) summaries, plaintext long-term
    memory — and the "clean prefix is literally a prefix of the contaminated cache" counterfactual-splicing
    claim for targeted forgetting without full restart. arXiv preprint; not confirmed peer-reviewed.
28. **Turn: A Language for Agentic Computation** — Muyukani Kizito — arXiv:2603.08755 — submitted
    2026-03-07 — https://arxiv.org/abs/2603.08755 — accessed 2026-09-15. Evidences: a compiled,
    actor-based language for agentic software with an "isolated context window, persistent memory, and
    mailbox" per actor and a Rust-based bytecode VM; cited cautiously in §4 discussion as a solo-author,
    unreviewed implementation, not a claim-block source — full `VmState` contents (program counter/call
    stack/heap/etc.) were referenced in initial search-result synthesis but could **not** be confirmed in
    the fetched abstract content; treated as UNVERIFIED for that specific detail and not asserted in the
    lane report.
29. **AgentR: A Stateful and Recovery-Aware Software Architecture for LLM-based Auditable Workflows** —
    Samanta, Saha, Ghosh, Buyya — arXiv:2608.15264v1 — submitted 2026-08-15 —
    https://arxiv.org/html/2608.15264 — accessed 2026-09-15. Evidences: six-state finite-automaton job
    tracking in PostgreSQL, Redis/BullMQ queueing, orphan-job detection, ACID token-cost logging, measured
    on a 130-job development snapshot (99.2% completion rate, per-stage latencies 9.0s/18.9s/25.4s). arXiv
    preprint; not confirmed peer-reviewed; evaluation is a self-reported development snapshot, not a
    controlled benchmark.

## Cross-referenced, not independently re-fetched this session

30. **`research/lanes/05-commodity-map.md`** — this mission, lane 05 — cited for the general competitive
    commodity map (checkpoints/hooks/memory/subagents as commodity-by-2026) and the collapsing-absorption-
    lag finding this lane's Codex hook timeline (items 12/13) extends.
31. **`research/lanes/07-reality-alignment.md`** — this mission, lane 07 — cited for the Kubernetes/GitOps
    reconciliation analogy this lane's Temporal discussion (§4.1) parallels, and for the "authored acceptance
    sets admit 19-42% of correct solutions" comparison drawn in §8.1.
32. **`research/lanes/11-memory-taxonomy.md`** — this mission, lane 11 — cited for PROJECTMEM
    (arXiv:2606.12329, an independently-arrived-at event-sourced design for coding-agent project memory),
    referenced in §4.3/§8.5 without re-deriving lane 11's full memory-type taxonomy, per this lane's
    explicit scope exclusion.

## Explicitly excluded / flagged as untrustworthy

- `doc.jarvisuni.com/openai/codex/hooks.html` and `codex-docs.com` — surfaced repeatedly in WebSearch
  results as apparent OpenAI/Codex documentation but resolve to unofficial third-party domains, not
  `openai.com` or `learn.chatgpt.com`. Not cited as sources anywhere in the lane report; any fact that
  appeared to originate from them was either dropped or independently re-confirmed against
  `learn.chatgpt.com/codex/hooks` before use.
