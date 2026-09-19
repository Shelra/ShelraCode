# Phase 0 current state

## Scope and evidence method

This began as an evidence-only audit. The implementation now records the
controlled migration slices applied after that audit. The target is this
repository; `ShelraCode/` is a nested checkout used as the local reference.
Conclusions distinguish observed implementation from a proposed migration
decision.

## Repository snapshots

| Repository | Location | Branch / commit | Worktree |
|---|---|---|---|
| Target (this repository) | `D:\\PROYECTS\\shelra` | `main` | migration changes are intentionally uncommitted; nested `ShelraCode/` reference checkout is ignored |
| Reference (`yosoyjavieruiz/ShelraCode`) | `D:\\PROYECTS\\shelra\\ShelraCode` | `main`, `ce4890e6d2def1ed50bd4ced197e6e2f2dad59c9` | clean |

Target has about 145 files / 31k source lines; Shelra has about 166 files / 58k source lines and 161 test files. Both are single TypeScript CLIs with ESM package metadata. Target is MIT (`LICENSE`); Shelra is Apache-2.0 (`LICENSE`). No `NOTICE` or `COPYING` file was found in either checkout. License composition must be preserved when code is later adapted.

## Instructions inspected

Target instructions are in `AGENTS.md` (Bun commands and runtime notes). Target has `.agents/skills/{agent-browser,agent-desktop,find-skills}`.

Shelra instructions are in `ShelraCode/AGENTS.md`, `ShelraCode/CLAUDE.md`, `ShelraCode/src/providers/AGENTS.md`, `ShelraCode/src/router/AGENTS.md`, and `ShelraCode/src/tui/AGENTS.md`. They require evidence-first work, local-first/privacy gates, normalized provider boundaries, a core layer independent of TUI/providers, strict tool and path controls, host-owned verification, and no production changes while auditing. Relevant `.claude/skills` and `.agents/skills` were read, including repository intelligence, local-model agentics, coding-agent architecture, agent verification, provider adapters, routing, hardware fit, and release-gate guidance. The newer source checkout is therefore authoritative for Shelra behavior; its public README is not used as a substitute.

## Package/runtime facts

Target `package.json` is now `shelra` 1.1.7, exposes `shelra`, builds with
`tsc`, typechecks with `tsc --noEmit`, and tests with Vitest while excluding
the nested reference checkout. It uses a direct OpenAI-compatible SDK for
local runtimes.
Shelra `package.json` is `shelra` 0.1.1 and remains the source authority for
local orchestration. Its source does not contain a Hugging Face catalog, GGUF
download manager, embedded inference engine, or explicit model load/unload API;
local execution is through runtime adapters.

## Architectural answers

1. **Where does the UI depend on xAI?** `src/ui/app.tsx` imports the static model registry, displays xAI credential text, validates `xai-` keys, and exposes update/Telegram paths. The UI also consumes target-specific `Agent`, `ToolResult`, `ToolCall`, and model types. It does not call the SDK directly, but it is coupled to provider-owned vocabulary and state.
2. **Smallest replacement boundary:** the call made by `src/agent/agent.ts` around `streamText` (currently `src/agent/agent.ts:1824-1980`) plus title/recap generation in `src/toolset/client.ts:43-117`. The boundary must own normalized model metadata, request/stream events, tool calls/results, usage, cancellation, and typed failures. Tool execution and UI events must remain outside provider adapters.
3. **Evolve or replace the loop?** Evolve the existing shell and session-facing `Agent` façade, while adapting Shelra's live `src/agent/loop.ts:936-6030` as the future execution kernel. Do not port Shelra's TUI and do not keep two long-lived agent loops.
4. **Stronger existing tools:** mature terminal UX, MCP/LSP presentation, session resume, command palette/slash flows, media/computer views, and existing stream-to-UI observer events (`src/agent/agent.ts:114-158`).
5. **Stronger Shelra tools:** normalized provider events, deterministic repository intelligence, bounded context capsules, runtime discovery, privacy/cost routing, execution broker, permissions, checkpoints, task ledger/recovery, host verification, and completion proof.
6. **Features to survive unchanged:** OpenTUI React shell, transcript/Markdown, composer and keyboard behavior, scrolling/resizing, slash menu/modal patterns, MCP/LSP UI, headless entry point, session persistence shape where compatible, and tool activity rendering.
7. **Features fundamentally xAI-dependent:** `@ai-sdk/xai` model creation, static xAI model/pricing registry, X/web search tools, xAI batch HTTP, xAI image/video media, xAI STT, x402 wallet/payment integration, and API-key-only startup. Each needs a capability decision before removal.
8. **Normalized events:** adopt the provider-independent shape already present in `ShelraCode/src/providers/types.ts:32-60` (`text.delta`, `reasoning.delta`, `tool.call`, `usage`, `done`, `error`) and bridge it to the target's UI-facing `StreamChunk`/observer events during Phase 1.
9. **Conversation state:** currently target `Agent.messages` plus `SessionStore` own the model transcript; `App` owns a derived chat-entry view and transient stream/UI state. Future application state should remain above the kernel and serialize provider-neutral messages.
10. **Task state:** target has ad hoc in-memory loop state and delegation/session records. Shelra's `task-state.ts`, `task-runtime-state.ts`, and task ledger should own durable task state once the kernel is introduced.
11. **Verification owner:** target `Agent.verify()` delegates to `src/verify/orchestrator`; Shelra's host verifier and verification plan should own it. A model may propose criteria but cannot certify them.
12. **Completion owner:** host evidence, verification, objective proof, and completion gate; never an assistant completion string.
13. **Capability measurement:** Shelra has runtime discovery plus optional executable capability probes and cached `ModelCapabilityEvidence` in `src/cli/control-plane.ts:311-508`; target currently trusts static xAI metadata.
14. **Context size:** target estimates xAI context in `Agent.getContextUsage()` and compacts messages; Shelra uses model-aware budgets, context capsules, bounded repository evidence, and compaction anchors.
15. **Weak models:** give them one staged target/legal action at a time, bounded reads, typed tools, recovery and verification feedback. Shelra's work-unit directive is in `ShelraCode/src/agent/loop.ts:880-934`.
16. **Runtime discovery:** use Shelra `createLocalRuntimeAdapters`/`discoverLocalRuntimes` (`ShelraCode/src/runtimes/discovery.ts:14-86`) through the control plane; LM Studio remains an optional OpenAI-compatible endpoint.
17. **Hardware recommendation:** Shelra's `src/hardware/llmfit.ts:1-262` parses `llmfit` system/recommendation output and falls back to a basic OS/CPU/RAM profile. It is an integration, not an internal model-fit matrix.
18. **Download/management:** not implemented in the local Shelra checkout. Discovery/listing and health exist; no evidence supports claiming automatic Hugging Face/GGUF download or load/unload.
19. **Local checkout vs public architecture:** the checkout contains the live 6k-line kernel, normalized provider layer, runtime adapters, durable ledger/checkpoints, privacy-aware routing, evaluation harness, and extensive tests. Existing docs explicitly mark real local-model evaluation as UNPROVEN and identify dormant `src/core` and several empty/legacy areas.
20. **Settings paths:** write only Shelra settings/state under `~/.shelra`/`.shelra`. The earlier one-way compatibility reader and migration marker for old settings directories have been removed.
21. **UI preservation:** keep `src/ui` and its React/OpenTUI component/state model; replace its provider-facing inputs at the `Agent`/application seam and map normalized events back to the same presentation events.
22. **Temporary compatibility:** a provider adapter behind the normalized provider contract, a target `Agent` façade over Shelra task execution, and feature capability flags. Each has a deletion phase.
23. **Deletion timing:** adapter after Phase 6 local execution proof; façade/bridges after Phase 7 reconciliation; old names and paths in Phase 8; all dead code in Phase 9.
24. **Likely final tree:** target `src/ui`, command and presentation components retained; provider/runtime/router/context/agent/security/checkpoint/verification services adapted from Shelra under provider-independent boundaries; xAI-specific modules removed or isolated by capability; one authoritative kernel and one normalized event model.

## Phase 0 conclusion and implementation handoff

The target's strongest asset is the React/OpenTUI experience and its mature
presentation-oriented `Agent` observer contract. Shelra's strongest asset is
the host-controlled local-first execution system. The implemented seam is
between the target `Agent`/UI and provider execution, with normalized events,
local runtime adapters, bounded context, hardware fit, and a host completion
gate. xAI compatibility remains isolated for the explicit deferred removal
work recorded in `10-IMPLEMENTATION-STATUS.md`.

## Post-audit implementation verification (2026-09-06)

The controlled implementation pass completed the provider seam, local runtime
discovery, bounded context compiler, hardware-aware local router, host kernel
state, workspace guard, canonical Shelra settings writes, and UI-preserving
CLI wiring. `bun run typecheck`, `bun run build`, and the focused migration
suite pass. The canonical target run reports 58 passing files and 264 passing
tests after excluding the Bun-native SQLite suite; that suite passes separately
under `bun test`. An isolated delegation fixture can still intermittently
leave a Windows temporary cwd locked during cleanup.

No local model server was available for an end-to-end inference smoke, so local
model execution is still UNPROVEN in this checkout. The default application
path does not select xAI or an xAI endpoint. The xAI-only adapter, its static
model catalog, the xAI media tools and the legacy artifact paths have since been
removed.

## Initial audit verification run (2026-09-06, Bun 1.4.1)

Dependencies were installed from both lockfiles without tracked changes. Target `bun run typecheck` **PASS** and `bun run build` **PASS**. Target `bun run test` is **RED**: Vitest recursively discovered the nested `ShelraCode/` checkout (and its dependencies), then reported 170 failed and 45 passed files; target-only `bunx vitest run src` reduced this to 47 passed files, 5 failed files, 314 passed tests and 5 failed tests. The focused failures include the Vitest/Node inability to import `bun:sqlite`, two delegation fixture path failures, two vision-input assertions, one instruction-order assertion, and one nested dependency suite. This nesting is itself a migration/repository-layout hazard.

Shelra `bun run typecheck` **PASS** and `bun run build` **PASS**. Shelra `bun run test` is **PARTIALLY VERIFIED / RED**: 941 pass, 1 skip, 1 fail across 943 tests. The remaining failure is the existing `RunTests returns a structured verification result for a passing command` assertion expecting Bun output containing `1.3`, while this environment reports `1.4.1`.

`bun dist/index.js --help` **PASS** and confirms the command surface at audit time. A PTY startup smoke at 80 columns reached the existing sandbox choice and then the “Add API key” modal, showing the target OpenTUI path is launchable without credentials; the interactive process was terminated after capture. `node dist/index.js` under Node 24 fails before startup because the compiled CLI imports `package.json` without a JSON import attribute; the repository's documented runtime is Bun, so this Node result is recorded as a compatibility issue rather than a target Bun runtime result. No authenticated model, local model, or paid service was used.

The startup baseline above predates the final local-first startup pass. The current target renders `src/ui/startup.tsx` before the chat tree, runs `src/startup/orchestrator.ts`, and mounts chat only after a provider-neutral health probe. Static xAI model metadata has been removed; installed model identity comes from `src/runtimes/discovery.ts`. If no model exists, the same screen enters onboarding and can install a reviewed GGUF from Hugging Face through the Shelra-managed llama.cpp path. This workspace now contains a SHA-verified Qwen GGUF and a real local generation probe; the complete autonomous coding loop remains **UNPROVEN**.
