# Shelra agent interface reconstruction

Status: Gates 0-8 complete. Gate 9 first vertical slice implemented. Gates 10-13
remain limited by the terminal-only product and the lack of a live provider fixture.

This document records the evidence and decisions behind the reconstruction. Shelra
is a Bun/OpenTUI terminal application, not a browser frontend. The repository has no
web UI package, CSS or Tailwind pipeline, Storybook, or Playwright UI harness.

## Gates 0-2: repository, UI, and runtime reality

### Repository shape

- Single package, TypeScript, Bun runtime, React 19 through @opentui/react.
- OpenTUI owns the terminal renderer.
- src/ui/app.tsx is the interactive shell: conversation, composer, keyboard routing,
  and modal composition.
- src/index.ts constructs Agent, configures the runtime, and mounts App.
- SQLite session, transcript, usage, objective, and checkpoint storage lives under
  src/storage/.
- The autonomous objective runtime is under src/autonomy/ and has a separate journal.
- references/ and ShelraCode/ are forensic references and are out of product scope.

### Existing UI inventory

| Surface | Current reality | Classification |
| --- | --- | --- |
| Home and shell | Hero, composer, cwd, version footer | Working |
| Conversation | Persisted entries and streaming assistant output | Working |
| Composer | Multiline input, paste blocks, file mentions, queue, interrupt | Working |
| Mode/model/sandbox/recap/wallet | Keyboard-driven modal pickers | Working |
| Slash commands | Filtered menu and direct handlers | Working |
| Custom sub-agents | Reusable sub-agent configuration editor | Working as configuration |
| Live sub-agent activity | One transient Agent.onSubagentStatus line | Partially working |
| Background delegations | Durable records and chat notifications | Partially working |
| Plans | generate_plan result and plan questions | Partially working |
| Tasks | task calls/results inline in chat | Partially working |
| Changed files and diffs | Bounded inline file-tool diffs | Working |
| Terminal and process output | Tool-specific inline summaries | Partially working |
| Verification | Host Agent.runVerify and autonomous verifier | First slice connected |
| Completion gate | Kernel and Stop-hook persistence | First slice projected |
| Sessions | SQLite and --session/latest resume | No in-app picker |
| Workspace navigation | cwd only | Missing |
| Context | Model-window meter and current-turn summary | Partially working |
| Memory | File-backed module, tested | Backend only and not in context assembly |
| Checkpoints | Pre-mutation snapshots | Backend only and no UI restore |
| Skills | Prompt discovery and /skills output | Backend/chat-only |
| Errors | Friendly inline errors | Structurally summarized in first slice |

### Important flow traces

Prompt flow:

PromptBox -> App.handleSubmit -> processMessage -> Agent.processMessage ->
host context and research -> provider stream -> tool execution -> StreamChunk and
ProcessMessageObserver -> transcript persistence -> TUI.

The observer contract carries step, research, tool start/finish, and error events.
The first slice consumes those events directly. Assistant prose is not a state source.

Task and agent flow:

task or delegate tool -> Agent task/delegation runner -> transient SubagentStatus ->
ToolResult -> persisted chat entry. The UI now keeps a bounded activity projection,
while the existing inline result remains available.

Verification flow:

/verify -> Agent.runVerify -> verify orchestration and host evidence -> kernel
verification/completion state -> persisted assistant result and inspector evidence.
The interactive coding path stops at review until this host operation runs.

Resume flow:

Agent hydrates the transcript and restores the latest compatible lightweight
interactive objective index. App restores the latest plan from persisted tool
results. Detailed activity and compiled context are not claimed as persisted because
the current storage contract does not contain them.

### Fake or disconnected UI findings

No broad fake-progress timer or hardcoded runtime agent roster was found. The main
problems were missing projections:

- The old generic "Planning next moves" label did not identify the real phase.
- Context showed only a percentage and remaining tokens.
- Plans, tasks, sub-agents, and diffs were scattered through chat.
- Verification and completion did not have a visible boundary.
- Memory and checkpoints could be mistaken for available UI actions even though their
  current interactive connections are incomplete.

The first slice addresses the first four. It leaves unavailable subsystems explicit.

## Gate 3: bounded product research

The external pass used current official documentation and primary references:

- Claude Code explains the agentic loop as gathering context, taking action, and
  verifying results. Its documentation also covers interruption, resume/fork,
  checkpoints, permissions, commands, and memory.
- Claude Code separates instructions, skills, subagents, MCP, and hooks. Shelra
  should not flatten all of these into one generic activity feed.
- VS Code documents changed-file review, grouped tool details, steering while an
  agent runs, checkpoints, and adjacent chat/changes surfaces.
- Linear documents explicit status categories and chronological activity. Shelra
  needs a small stable phase vocabulary, not an unbounded telemetry stream.
- Vercel's deployment inspector pairs a status with logs and evidence. Shelra's
  evidence view follows the same information relationship without copying its UI.
- OpenTUI supports flexbox-like boxes, selectable inputs, and scrollboxes, which
  supports a compact terminal control surface.

Sources used:

- https://code.claude.com/docs/en/how-claude-code-works
- https://code.claude.com/docs/en/memory
- https://code.claude.com/docs/en/commands
- https://code.visualstudio.com/docs/agents/run/review-code-edits
- https://code.visualstudio.com/docs/agents/run/chat-view
- https://code.visualstudio.com/learn/foundations/reviewing-and-controlling-agent-changes
- https://linear.app/docs/project-status
- https://linear.app/docs/initiative-and-project-updates
- https://vercel.com/docs/deployments/overview
- https://vercel.com/docs/logs
- https://github.com/anomalyco/opentui

## Gates 4-6: product model and interaction model

### Core product graph

workspace
  -> session
    -> original request and current runtime objective
    -> host runtime phase
    -> plan, when a structured plan was actually emitted
    -> tasks and agents, when runtime events/results actually exist
    -> bounded activity
    -> changed files and diffs
    -> verification state
    -> context estimate and selected files
    -> completion gate

The UI projects existing facts. It does not add a third task system or infer
completion from generated assistant text.

### Navigation decision

There is no persistent sidebar. Chat remains primary. A compact status strip answers
"what is happening?" during work. Ctrl+I or /status opens one control surface:

1. Overview: intent, phase, current activity, counts, model, and session boundary.
2. Plan: the latest structured plan result, or an honest empty state.
3. Activity: bounded observer events with source, status, and detail.
4. Evidence: changed files, context inputs, verification, and completion state.

The inspector is hidden by default and does not expose private model reasoning.

### State vocabulary

| Runtime fact | User-facing label |
| --- | --- |
| no kernel, not working | Idle |
| turn started before kernel exists | Starting turn |
| frame | Framing request |
| discover | Inspecting project |
| analyze | Understanding request |
| plan | Planning |
| act | Working |
| observe | Observing result |
| reflect | Summarizing |
| verify | Verifying |
| review | Verification needed |
| complete | Verified complete |
| blocked | Blocked |
| cancelled | Cancelled |
| non-terminal restored phase while not running | Paused: phase |

review is deliberately not rendered as done. Coding completion requires host proof.

### Design system

The existing monochrome theme remains the source of truth. The first slice adds
semantic status tokens only:

- black background, dark panel, element surface, and existing border hierarchy;
- high-contrast primary text and muted metadata;
- blue active, amber attention/verification-needed, green passed, red failed;
- status words and ASCII markers always accompany color;
- existing OpenTUI box and scrollbox spacing; no nested card dashboard;
- no new fonts, gradients, decorative graphs, or motion.

## Gates 7-8: surface specification and implementation plan

### Session status strip

- Purpose: answer the current-work question without opening a modal.
- Data: Agent kernel snapshot, observer activity, active tools, active sub-agent,
  persisted chat diffs, and context summary.
- Actions: Ctrl+I and /status open the inspector. Esc closes the inspector first and
  interrupts only when it is not open.
- States: idle, active phase, paused, verification-needed, blocked, cancelled, complete.
- Empty/loading/error states come from runtime facts; no timers or simulated tasks.
- Test: pure projection tests plus terminal smoke.

### Session inspector

- Purpose: inspect the state behind the conversation.
- Data: the same normalized view-model; no provider objects and no private reasoning.
- Actions: 1-4, Tab, arrows, and Esc.
- States: missing plan, no activity, no changed files, no verification evidence,
  and blocked/failed states are explicit.
- Test: pure projection tests, typecheck/lint, test suite, and terminal smoke.

### Dependency-aware implementation plan

1. Extend the runtime read seam with current context metadata and compatible resume
   state.
2. Pass typed observer events from App into Agent.processMessage.
3. Normalize events and changed files in a pure UI module.
4. Render the status strip and inspector from runtime snapshots.
5. Connect /status and direct host /verify.
6. Add projection and kernel restore tests.
7. Run format, lint, typecheck, tests, build, and terminal smoke.

## Gate 9: implemented vertical slice

- src/ui/observability.ts owns phase labels, completion status, bounded event upserts,
  and changed-file derivation.
- src/ui/session-inspector.tsx adds the status strip plus Overview, Plan, Activity,
  and Evidence views.
- App passes the existing ProcessMessageObserver contract to Agent.processMessage,
  retains bounded structured activity, exposes /status, preserves the latest plan,
  and closes the inspector before interrupting on Esc.
- Agent exposes host-compiled context metadata, clears stale turn state, restores a
  compatible lightweight objective, initializes the current kernel before context
  research, and makes /verify call Agent.runVerify.
- The live tool list now removes only the completed tool instead of clearing other
  active calls.
- Kernel snapshots can be restored without sharing mutable arrays.
- The status strip uses a compact two-line layout and the inspector abbreviates its
  tabs and metadata at narrow terminal widths.

The inspector intentionally does not manufacture task completion, criterion counts,
token evidence, memory entries, checkpoint actions, or repair phases unavailable from
the current interactive contract.

## Gates 10-13: current verification status

Completed:

- targeted formatting and Biome lint;
- TypeScript typecheck;
- full repository test script, including isolated suites;
- projection tests for phase/status, activity replacement/bounds, and changed files;
- kernel snapshot restore test;
- runtime observer contract test using a deterministic provider fixture;
- terminal help smoke for both source and built CLI;
- terminal TUI smoke for `/status`, inspector tabs, and Escape close behavior;
- `SHELRA_BUILD_SKIP_INSTALL=1 bun run build`.

Not yet demonstrated:

- a real provider-backed digital-clock workflow;
- interrupting a live model turn and comparing UI state with its answer;
- a delegated multi-agent run with live evidence;
- a failure/repair/reverification loop through the interactive path;
- restart/resume of an in-progress live turn;
- screenshot-based visual QA. There is no browser surface, and no visual terminal
  capture tool is available in this environment. These are limitations, not claims.

The existing `.grok/verify-artifacts` screenshots were also inspected. They are
digital-clock task outputs, not screenshots of the Shelra terminal UI, so they are
not counted as Shelra visual QA.

## Deliberate follow-up

- Unify interactive turns with the autonomous Objective ledger without creating a
  third state machine.
- Wire memory into context assembly before exposing editable memory controls.
- Wire autonomy file mutations into checkpoints.
- Add criterion-level interactive verification reports and repair/reverification
  events.
- Add an in-app session picker only after actions are connected to SessionStore.
- Add terminal snapshot/PTY coverage for narrow-width and large-data cases.

## Definition of done for the next milestone

During a real long-running coding task, without reading raw logs, a user must be
able to answer what is happening, why, what remains, whether something is wrong,
whether Shelra is fixing it, whether the result works, and which host evidence proves
it. The current slice establishes the control-surface seam; the live workflow and
criterion-level verification work remain before declaring the full reconstruction
complete.
