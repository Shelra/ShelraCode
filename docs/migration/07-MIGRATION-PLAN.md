# Phased migration plan

The audit was completed first and implementation is now proceeding in small
coherent slices. Each phase leaves the target buildable, preserves user work,
runs focused checks after meaningful changes, and attempts `bun install`,
`bun run typecheck`, `bun run test`, and `bun run build`. A red check is
recorded as red in `10-IMPLEMENTATION-STATUS.md`.

## Phase 1 — provider-independent seam

### Objective
Separate the Grok UI/application from xAI model objects while keeping the current provider working.

### Why this phase exists
The target UI is coupled to `XaiProvider`, Grok model metadata, AI SDK stream parts and credential wording. Local runtimes cannot be added safely until those objects stop crossing the application boundary.

### Current implementation
`src/agent/agent.ts:535-710,1824-1980` owns xAI provider creation, messages, tool registry, compaction, streaming and observer events. `src/grok/client.ts:43-117` exposes xAI SDK types and title/recap calls.

### Target implementation
Introduce provider-neutral model/request/event/usage/failure interfaces and an adapter that maps the existing xAI path into them. Keep target `StreamChunk` as a temporary UI bridge.

### Files involved
`src/grok/client.ts`, `src/agent/agent.ts`, `src/types/index.ts`, `src/ui/app.tsx`, target provider tests, and new seam modules under a provider-independent application/provider path.

### Interfaces introduced
Normalized model metadata, request, stream event, tool call/result, usage, cancellation and typed failure; application events that do not expose AI SDK or xAI objects.

### Code reused from ShelraCode
`src/providers/types.ts`, `stream-normalizer.ts`, and event conventions from `src/shared/events.ts`.

### Code retained from Grok
React/OpenTUI components, Agent façade/API, session/transcript behavior, tool activity rendering, headless observer and current xAI adapter implementation.

### Code deleted
None initially.

### Temporary compatibility layer
XAI adapter plus mapping from normalized provider events to target observer/`StreamChunk` events. Deletion is planned after Phase 6.

### Tests required
Fake provider stream ordering, malformed tool envelopes, usage/error/cancel mapping, provider-object non-leak architecture test, title/recap adapter tests, interactive/headless regression.

### UI regression risks
Event ordering, streaming re-render, tool approval and cancellation.

### Runtime risks
AI SDK type differences, context-limit retry behavior, batch path divergence.

### Rollback/recovery strategy
Keep the old xAI call behind the adapter until all seam tests and authenticated/manual smoke checks pass; revert only the seam files if needed.

### Acceptance criteria
Same visible UI/headless behavior; current provider still works with credentials; no xAI SDK object crosses the new boundary; normalized event tests green.

### Evidence
Target coupling: `src/grok/client.ts:1-117`, `src/agent/agent.ts:1824-1980`; Shelra contract: `ShelraCode/src/providers/types.ts:13-118`.

## Phase 2 — local model foundation

### Objective
Discover and stream from local runtimes through the target UI.

### Why this phase exists
Local-first is the product decision; LM Studio must remain optional.

### Current implementation
Target has only static Grok models and xAI provider creation. Shelra has runtime adapters/discovery but no model download or lifecycle manager.

### Target implementation
Adapt Shelra control-plane/runtime/provider adapters and expose normalized local candidates, health, context and capabilities through existing target model-selection/modal patterns.

### Files involved
Shelra `src/runtimes/*`, `src/providers/*`, `src/cli/control-plane.ts`, `src/hardware/*`; target Agent/application seam, model modal, settings and tests.

### Interfaces introduced
Runtime discovery result, normalized local model summary, health/capability probe and route input.

### Code reused from ShelraCode
Ollama, generic local OpenAI-compatible, LM Studio/llama.cpp endpoint adapters, provider normalizer, control plane and llmfit hardware integration.

### Code retained from Grok
Model picker UX, modal focus/keyboard behavior, transcript and headless output.

### Code deleted
None until local smoke proves replacement; static Grok registry remains as compatibility metadata.

### Temporary compatibility layer
Dual model source (xAI static + local discovered) and a selected-runtime adapter. Delete after Phase 6.

### Tests required
Fake local endpoint discovery/stream/tool calls, cancellation, unavailable runtime, model picker, context metadata, no-credential startup, local smoke when a model is actually loaded.

### UI regression risks
Picker content/labels, empty/no-runtime states and modal sizing.

### Runtime risks
Endpoint protocol differences, tool support claims, unloaded models, hardware mismatch.

### Rollback/recovery strategy
Keep xAI route selectable and local route opt-in until local stream/cancel/error tests pass.

### Acceptance criteria
Local runtime/model discovery, selection, streaming, cancellation and error rendering work; provider-neutral metadata reaches UI; no LM Studio requirement.

### Evidence
Shelra runtime contract/discovery: `ShelraCode/src/runtimes/types.ts:25-36`, `src/runtimes/discovery.ts:14-86`; target picker: `src/ui/app.tsx` model modal state.

## Phase 3 — control plane and bounded context

### Objective
Make host-owned turn classification, scope and evidence selection feed local turns.

### Why this phase exists
Small local models need reduced intent, scope, evidence and context rather than repository dumps.

### Current implementation
Target sends the transcript to xAI with a context meter/compaction helper; repository tools are model-selected.

### Target implementation
Use Shelra turn policy/task analysis, repository snapshot/intelligence/queries, context capsules, instruction discovery, context budget and compaction. Keep simple chat tool-free and provide bounded evidence for repository/coding work.

### Files involved
Shelra `src/router/turn-policy.ts`, `task-analysis.ts`, `src/context/*`, `src/agent/compaction.ts`; target Agent/application context handoff and debug/UI status surfaces.

### Interfaces introduced
Turn classification, execution scope, evidence packet, context capsule and inspectable context diagnostics.

### Code reused from ShelraCode
Deterministic repository intelligence, bounded selection, privacy redaction and compaction anchors.

### Code retained from Grok
Transcript and context meter presentation pattern.

### Code deleted
Only duplicated/unbounded context plumbing after equivalence is demonstrated.

### Temporary compatibility layer
Target context builder can fall back to existing compaction for unsupported turns; delete when capsule coverage is complete.

### Tests required
Greeting zero tools, repository evidence relevance, bounded large-repo context, secret exclusion, coding scope and compaction/resume.

### UI regression risks
Context meter/status text and tool visibility.

### Runtime risks
Overly narrow evidence causing weak-model failure; incorrect instruction scope.

### Rollback/recovery strategy
Feature-gate host context per turn; preserve old prompt construction for a failed classification while logging evidence.

### Acceptance criteria
Conversation remains lightweight; repository questions gather relevant evidence; coding turns receive bounded context; context is inspectable.

### Evidence
Shelra context: `ShelraCode/src/context/context-capsule.ts:1282-1343`, `repository-intelligence.ts:654+`; target compaction: `src/agent/agent.ts:1531+`.

## Phase 4 — Shelra agent kernel

### Objective
Move action control, permissions, checkpoints, recovery, verification and completion to one Shelra kernel.

### Why this phase exists
Changing the model URL alone would not provide safe small-model coding.

### Current implementation
Target Agent runs AI SDK tools directly; file and Bash tools lack a single broker/checkpoint/completion authority.

### Target implementation
Adapt `ShelraCode/src/agent/loop.ts`, task ledger/graph, workspace tools, execution broker, permissions, checkpoints, recovery, verifier, objective proof/review and completion gate behind the target Agent façade.

### Files involved
Shelra `src/agent/*`, `src/tools/workspace.ts`, `src/security/*`, `src/checkpoint/*`, `src/verification/*`; target Agent/tool/event bridge and UI approval/result mapping.

### Interfaces introduced
Task request/state snapshot, legal action/tool authority, observation, checkpoint, verification result, completion decision and recovery outcome.

### Code reused from ShelraCode
Host-controlled work units (`src/agent/loop.ts:880-934`), normalized event consumption (`:4185+`), execution broker, stale-edit checks, ledger, host verification and completion gate (`:5777-6030`).

### Code retained from Grok
Agent façade method names, session transcript, tool result views, approval modal and headless observer.

### Code deleted
Duplicate target mutation/verification authority only after disposable coding acceptance passes.

### Temporary compatibility layer
Target tool names mapped to Shelra workspace tool names; target observer maps `AppEvent` to `StreamChunk`. Delete after Phase 7.

### Tests required
Fake-model read/edit/test task, path containment, stale edit, permission denial/approval, checkpoint rollback, repeated-call watchdog, failed verification, resume and false-completion cases.

### UI regression risks
Tool names/results and approval timing; transcript ordering when host verification feeds observations.

### Runtime risks
Behavior changes in edit semantics, process isolation and task persistence.

### Rollback/recovery strategy
Run kernel behind an explicit execution flag and preserve target Agent path until the disposable task and full boundary suite are green.

### Acceptance criteria
Actual disposable coding task reaches host-verified completion or truthful block; model cannot self-certify; recovery and preservation work.

### Evidence
Shelra kernel: `ShelraCode/src/agent/loop.ts:936+`; safety: `src/security/execution-broker.ts:157+`; completion: `src/agent/loop.ts:5777+`.

## Phase 5 — local-first router

### Objective
Make privacy/cost/local availability/capability/context/health/quota routing authoritative.

### Why this phase exists
The product must default local and must not silently spend money.

### Current implementation
Target selects from Grok static model IDs and optional API/batch flags.

### Target implementation
Adapt Shelra router/control-plane decisions and measured capability evidence; local candidates precede optional free routes, paid routes require explicit policy.

### Files involved
Shelra `src/router/*`, `src/cli/control-plane.ts`, provider/runtime candidate types; target model picker/settings/status and Agent route handoff.

### Interfaces introduced
Route request/decision/rejections, privacy/cost policy, execution profile and capability evidence.

### Code reused from ShelraCode
Gate ordering, strict-zero, circuit breaker/quota, capability probes and progressive execution.

### Code retained from Grok
Model-selection modal and status presentation pattern.

### Code deleted
Static price/capability assumptions that cannot be normalized.

### Temporary compatibility layer
Grok model IDs translated to route candidates; delete with xAI path in Phase 6.

### Tests required
Privacy/cost/local-first routing, no paid escalation, stale metadata, capability mismatch, local health failure fallback and explicit paid approval.

### UI regression risks
Selected model/status labels and route failure explanations.

### Runtime risks
False capability evidence and unusable local model selection.

### Rollback/recovery strategy
Keep route decision explainable and selectable; fall back only to eligible known routes.

### Acceptance criteria
Router considers real evidence, local is default, no silent paid escalation, weak models receive bounded profiles.

### Evidence
Shelra router rules in `ShelraCode/src/router/AGENTS.md` and control plane `src/cli/control-plane.ts:311-508`.

## Phase 6 — remove xAI execution dependency

### Objective
Remove xAI inference after local execution/kernel proof.

### Why this phase exists
Grok must stop being the intelligence/runtime dependency only after a working replacement exists.

### Current implementation
`@ai-sdk/xai`, Grok registry, API-key enforcement, batch, search, media, STT, pricing and x402 are live coupling points.

### Target implementation
Retain only provider-independent capabilities and local adapters; remove or explicitly defer xAI-only features.

### Files involved
`src/grok/*`, `src/agent/agent.ts`, `src/utils/settings.ts`, target tools/media/audio/batch/payment/wallet, CLI bootstrap and dependencies.

### Interfaces introduced
Capability registry and provider-neutral setup/error states.

### Code reused from ShelraCode
Provider/runtime registry and normalized errors/events.

### Code retained from Grok
UI patterns for model setup, search/media/activity only where a generic capability exists.

### Code deleted
xAI client, API-key requirement, static Grok-only registry/pricing, xAI batch/search/media/STT/payment execution if unsupported.

### Temporary compatibility layer
Old settings reader and migration diagnostics only; delete in Phase 9 after migration window.

### Tests required
Global xAI runtime search, no-key local startup, local/headless execution, unsupported capability honesty, package/build/license checks.

### UI regression risks
Credential modal and feature controls becoming empty or misleading.

### Runtime risks
Hidden xAI imports, persisted messages/config compatibility, lost title/recap behavior.

### Rollback/recovery strategy
Tag pre-removal commit; keep settings backup and migration report; re-enable adapter only if local gate regresses.

### Acceptance criteria
No runtime contacts xAI; no Grok credential required; local execution remains proven; unsupported features are honest.

### Evidence
Coupling inventory: `01-GROK-ARCHITECTURE.md` and `09-RENAME-MATRIX.md`.

## Phase 7 — feature reconciliation

### Objective
Resolve MCP/LSP/headless/verify/schedules/subagents/computer/Telegram/session/install/structured-output features.

### Why this phase exists
Feature parity should select the stronger implementation, not duplicate systems.

### Current implementation
Target has mature UX and many integrations; Shelra has stronger host safety/context/kernel services and fewer product integrations.

### Target implementation
Apply `06-FEATURE-MATRIX.md` decisions with capability flags and one owner per subsystem.

### Files involved
Target `src/mcp`, `src/lsp`, `src/tools`, `src/daemon`, `src/telegram`, install/update, UI modals; Shelra corresponding service interfaces.

### Interfaces introduced
Feature capability/health, provider-independent tool registry and shared task/session events.

### Code reused from ShelraCode
Safety, context, permissions, verification, bounded subagent and persistence services.

### Code retained from Grok
Target commands, UI, MCP/LSP and headless surface where implementation is mature.

### Code deleted
Duplicate feature owners and unsupported controls.

### Temporary compatibility layer
Capability adapters with explicit deletion issue/phase.

### Tests required
Feature integration, headless parity, subagent bounded context, MCP/LSP permissions, schedule privacy and install smoke.

### UI regression risks
Slash menu entries and modal availability.

### Runtime risks
Background process persistence, credentials and cross-platform tools.

### Rollback/recovery strategy
Disable individual capability flags without removing the shell.

### Acceptance criteria
Every exposed feature has a working backend or an honest disabled/deferred state; no duplicate agent loop.

### Evidence
`06-FEATURE-MATRIX.md` and target/source feature paths.

## Phase 8 — ShelraCode brand migration

### Objective
Rename public product identity only after runtime architecture is stable.

### Why this phase exists
Brand changes otherwise obscure behavioral regressions and persisted-state migration.

### Current implementation
Grok names exist in package/bin, CLI text, config paths, env vars, docs, installers, assets and persisted locations.

### Target implementation
Use the authoritative local Shelra naming (`ShelraCode`, `shelra`, `SHELRA_*` as confirmed by source) with one-way compatibility readers.

### Files involved
Package/lock/README, CLI/install/update, settings/storage paths, UI strings/logo, hooks/daemon/verify/LSP paths and tests.

### Interfaces introduced
Identity constants and migration/versioned settings resolver.

### Code reused from ShelraCode
Existing `product/identity.ts` and settings migration tests where compatible.

### Code retained from Grok
No behavioral UI changes; only labels/paths after contract tests.

### Code deleted
Old write paths and dead aliases after migration window.

### Temporary compatibility layer
Read old `.grok`/`GROK_*` settings; write only Shelra paths. Delete in Phase 9 when safe.

### Tests required
Rename matrix, old settings migration, new-state write path, CLI/bin/install snapshots, global searches and UI contract.

### UI regression risks
Text width/logo/help snapshots.

### Runtime risks
Lost user configuration/session state and update channel errors.

### Rollback/recovery strategy
Copy/backup old settings, version migrations, retain read-only legacy parser.

### Acceptance criteria
New installs use Shelra identity; old settings migrate without destruction; no accidental search/replace damage.

### Evidence
`09-RENAME-MATRIX.md`, target `src/utils/settings.ts`, install manager, Shelra `src/product/identity.ts`.

## Phase 9 — delete migration debt

### Objective
Remove dead xAI adapters, bridges, duplicate loops/types, dependencies and temporary flags.

### Why this phase exists
ShelraCode must own one coherent architecture.

### Current implementation
Compatibility layers introduced in Phases 1-8.

### Target implementation
One provider/event model, one kernel, one task/completion authority, one settings writer and one feature owner.

### Files involved
All migration adapters, dead target Grok modules, tests, package metadata and docs.

### Interfaces introduced
None; this phase closes the contract.

### Code reused from ShelraCode
Only proven services remaining in the final ownership map.

### Code retained from Grok
Target UI and mature integrations selected by the feature matrix.

### Code deleted
Obsolete adapters, xAI code, duplicate types/loops, unused dependencies, stale config and flags.

### Temporary compatibility layer
None after the documented migration window.

### Tests required
Full typecheck/test/build, fake provider integration, local smoke, PTY widths/states, global Grok/xAI search and license audit.

### UI regression risks
Dead imports may have hidden UI paths; run actual application smoke.

### Runtime risks
Unexpected persisted-state or update compatibility.

### Rollback/recovery strategy
Use phase tags and retained migration backups; delete in small commits.

### Acceptance criteria
No runtime xAI contact/key requirement; one coherent local-first architecture; all remaining Grok occurrences intentional and documented.

### Evidence
Global search commands and phase acceptance evidence above.
