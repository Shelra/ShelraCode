# Phase 0 risk register

| ID | Risk | Severity | Evidence / confidence | Mitigation and validation |
|---|---|---:|---|---|
| R1 | UI and Agent are coupled to xAI types and wording | High | `src/ui/app.tsx`; `src/agent/agent.ts:535-710`; high confidence | Phase 1 normalized seam; architecture non-leak test; four-width UI contract. |
| R2 | Target has two request paths (stream and xAI batch) | High | `src/agent/agent.ts:956-1150,1575-1770,1824+`; high | Model batch as capability; remove xAI batch only after local path and headless parity. |
| R3 | Target file writes/Bash lack Shelra-grade common containment/stale protection | Critical | `src/tools/file.ts:1-127`, `src/tools/bash.ts:33-161`; high | Shelra execution broker/workspace tools/checkpoints; path, stale-edit and destructive-command tests. |
| R4 | Shelra live kernel is a 6k-line hub with dormant parallel core code | High | `ShelraCode/src/agent/loop.ts:936+`, audit docs; high | Integrate through interfaces; do not copy `src/core` or create a second runtime; ownership map test. |
| R5 | Shelra real local-model capability is unproven | High | `ShelraCode/docs/STATUS.md`; test output; high | Keep status UNPROVEN, run measured probe only with an installed model, never advertise from metadata alone. |
| R6 | No local download/GGUF/load/unload manager was found | Medium | source-wide search and runtime types; medium-high | Treat lifecycle as a separate future capability; endpoint adapters must work without it. |
| R7 | LM Studio could accidentally become a hidden dependency | High | `src/runtimes/discovery.ts:14-86` shows it is one generic adapter; high | Keep Ollama/generic endpoints equal; no mandatory setup or LM Studio-specific UI. |
| R8 | Context migration could dump repositories or starve models | High | target Agent compaction vs Shelra capsule/compiler; high | Bounded context tests, inspectable packets, objective relevance and secret exclusion. |
| R9 | Model capability flags may be mistaken for empirical ability | High | target static registry; Shelra docs/tests; high | Capability evidence with provenance/freshness; route gates and executable probes. |
| R10 | Completion could be claimed from model text | Critical | target done path vs Shelra objective proof/completion gate; high | Host verification, diff review, completion-gate tests and false-completion fixtures. |
| R11 | Two persistence writers/task authorities can diverge | High | Shelra audit: dead `saveAgentTask` vs live `saveAgentRuntime`; medium-high | Choose one ledger/runtime writer; migration/resume tests and DB audit. |
| R12 | In-memory target transcript/UI state may be confused with durable task state | High | target Agent/App state; high | Keep conversation/session ownership separate from Shelra task ledger; resume integration test. |
| R13 | Provider error/event translation can break streaming UI | High | target AI SDK full stream vs Shelra normalizer; high | Deterministic fake provider, event-order tests, cancellation/error snapshots. |
| R14 | xAI-only search/media/STT/payment controls could remain as fake UI | High | `src/toolset/tools.ts`, `src/toolset/media.ts`, audio/payment modules; high | Capability registry, explicit unsupported states, feature matrix and global search. |
| R15 | Branding/path rename can lose user settings/sessions | Critical | legacy config-directory paths across settings/storage/hooks/verify; high | Superseded: legacy-path compatibility (one-way reader, mirror, migration marker) was removed; state is written only under `.shelra`/`~/.shelra`. |
| R16 | License obligations could be lost when adapting code | High | target MIT `LICENSE`, Shelra Apache-2.0 `LICENSE`; high | Preserve notices/attribution, document composition, audit copied files before Phase 2+. |
| R17 | Target verification commands can scan the nested reference checkout and fail under the wrong runtime | High | after install, typecheck/build pass; canonical Vitest run discovered `ShelraCode/` plus target failures; high | Exclude nested checkout or use an isolated target worktree for target tests; keep canonical and focused results separate. |
| R18 | Target tests have Bun/Node and fixture failures | Medium | focused run: 47 files pass, 5 fail; `bun:sqlite`, delegation, vision and instruction failures; high | Classify environment versus product failures; fix or document before migration gates; do not claim green. |
| R19 | Shelra suite retains one environment-sensitive version assertion | Medium | after install: 941 pass, 1 skip, 1 fail; expects Bun 1.3 while host is 1.4.1; high | Update the fixture only in a later authorized maintenance change; keep audit status red. |
| R20 | UI baseline is not captured at required widths | Medium | no target PTY fixtures; authenticated model unavailable; high | Add PTY/snapshot harness before Phase 1 UI mutation; mark current baseline UNPROVEN. |
| R21 | Integrating all Shelra directories creates duplicate/parallel architecture | High | source has dormant core and multiple service areas; high | Reuse only proven live path; interface ownership table; delete temporary bridges by phase. |

## Post-audit update

The original Phase 0 entries above record the state observed before local runtime
implementation. The default target path now uses the app-managed llama.cpp
adapter and Hugging Face downloader (`src/runtimes/managed-llama.ts`,
`src/models/huggingface.ts`). No package-manager runtime or third-party desktop
runtime is part of normal startup. The remaining high risks are truthful small
model capability measurement, full coding-task verification, and deliberate
removal of explicit xAI compatibility modules in a breaking release.
