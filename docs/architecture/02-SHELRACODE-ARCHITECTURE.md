# ShelraCode architecture audit

## Product and layering rules

`ShelraCode/AGENTS.md`, `CLAUDE.md`, and `docs/ARCHITECTURE.md` define a local-first, privacy-aware, hardware-aware coding agent for ordinary hardware. Privacy and cost policy are gates before model quality; strict-zero never silently uses paid or unverified routes; provider-specific protocol objects stop at adapters; core services do not import TUI code; verification and completion are host-owned.

The checkout contains a newer execution architecture than its public-facing description. The live path is `src/tui/app.tsx` -> control plane/router/context/security/checkpoint -> `src/agent/loop.ts:936`, while `src/core/swe-core.ts` and `src/core/legacy-agent-runner.ts` are dormant/test-only parallel code. `src/agent/loop.ts` is a 6,356-line hub, so migration should adapt interfaces around it rather than copy the file wholesale.

## Control plane

`src/cli/control-plane.ts:49-82` defines the `ControlPlane` boundary for root/state path/settings/database/hardware/providers/logger and hardware, runtime and model discovery. `openControlPlane` (`:216-269`) opens SQLite, hardware detection, provider registry, runtime adapters, settings and logging. `discoverModels` (`:311-508`) combines llmfit recommendations, local runtime models, hardware facts, provider catalogs/health/quota, cached capability evidence and optional executable probes. `src/cli/commands.ts:133-237` exposes doctor, models and providers views of those facts.

This is the appropriate application-level entry point for the existing shell: it can supply a route and execution profile without exposing provider SDK objects to React components.

## Runtime/provider boundaries

`src/runtimes/types.ts:25-36` defines `LocalRuntimeAdapter` with `detect`, `health`, `listModels`, normalized capabilities and an optional `provider()`. `src/runtimes/discovery.ts:14-86` always creates an Ollama adapter, optionally a generic local OpenAI endpoint, and generic LM Studio/llama.cpp-compatible adapters. Defaults are localhost endpoints (`11434`, `1234/v1`, `8080/v1`); environment variables can override them.

`src/providers/types.ts:13-118` is the normalized provider contract: messages, tool calls, usage, `ProviderEvent`, typed failure codes, health, quota, `NormalizedModelRequest`, `ProviderAdapter` and profile. `src/providers/stream-normalizer.ts:144-230` quarantines malformed/tool-shaped text and emits normalized text, reasoning, tool call, usage, done and typed protocol errors. `src/providers/openai-compatible.ts` implements SSE/model discovery/error normalization for local-compatible endpoints.

The provider registry also contains optional Groq/OpenRouter/OpenCode/Zen cloud adapters. Their use is policy-gated and does not make cloud execution the product default. Source status explicitly marks real local-model evaluation as UNPROVEN.

## Hardware, models and routing

`src/hardware/llmfit.ts:1-262` parses machine-readable `llmfit --json system` and coding recommendations, with a basic profile fallback. No internal HF catalog, GGUF scanner/download manager, embedded llama.cpp runtime, or load/unload lifecycle was found. LM Studio is only one generic endpoint adapter and is not required by the architecture.

`src/router/task-analysis.ts` classifies SEARCH, EXPLAIN, SMALL_EDIT, MULTI_FILE_EDIT, TEST_GENERATION, DEBUGGING, REFACTOR, ARCHITECTURE, REVIEW and COMMAND. `src/router/turn-policy.ts` recognizes greeting, repository, read-only, plan, review and mutation modes. `src/router/router.ts` applies privacy, required capability, cost, executable tools, context, health, quota and score gates in that order; structured rejection reasons are retained. Strict-zero excludes paid/unverified candidates, while local routes stay eligible.

## Context and small-model assistance

`src/context/repository-snapshot.ts`, `repository-intelligence.ts:654+`, and `repository-queries.ts` build deterministic manifests, language/instruction facts, declarations/imports, related tests and targeted symbol/path/diagnostic queries. `src/context/context-capsule.ts:1282-1343` compiles a bounded capsule containing task requirements, repository evidence, legal actions, structured patches, budgets and output constraints. `src/context/context-compiler.ts`, `context-budget.ts`, and `src/agent/compaction.ts` keep context bounded and rehydrate anchors after compaction.

`src/agent/loop.ts:880-934` gives a host-controlled work-unit directive: one staged target, supporting evidence, and exactly one legal read or mutation action. The model proposes; the host advances targets and controls tools. This is the main Shelra thesis for 3B/4B/7B models.

## Kernel, safety and truthfulness

`src/agent/loop.ts:936+` initializes restored runtime/ledger state, execution profile, verification plan, task contract, constraints and context packet. At `:4185+` it consumes normalized provider events, validates tool calls and executes them through host policy. Duplicate calls, malformed envelopes and multiple mutations are bounded/recovered (`:4673+`, `:4784+`).

Workspace tools in `src/tools/workspace.ts` use `ToolExecutionContext`; `src/security/execution-broker.ts:157+` enforces containment, process/network/secret policy and model authority; `src/tools/permissions.ts` and permission grants implement approval. `src/checkpoint/checkpoint.ts:56+` records hashes/content and stale-edit protection. `src/agent/loop.ts:5777+` runs host verification, records evidence and sends bounded observations back to the model. Completion is short-circuited only after verification, criteria and final diff review (`:5896+`); completion proof and recovery live in `objective-proof.ts`, `objective-review.ts`, `completion-gate.ts`, `recovery.ts`, `resume-policy.ts`, `task-graph.ts` and `task-ledger-codec.ts`.

## State ownership and known gaps

The task ledger/runtime snapshot and SQLite storage own durable task state. The control plane owns settings, hardware, discovery and routing. The kernel owns action/observation/verification state. The TUI owns presentation state. Existing audit docs identify a dead legacy `saveAgentTask` writer beside live `saveAgentRuntime`, non-durable `pendingMutations` in the live loop, unused calibration modules, and an UNPROVEN real local-model matrix. These are migration risks and should not be hidden by importing the tree wholesale.

## Reuse decision

Reuse/adapt the normalized provider/runtime interfaces, control-plane discovery, repository intelligence/context compiler, execution broker, permission/checkpoint services, task ledger/recovery, verification and completion gate. Keep the target React/OpenTUI shell. Do not copy `src/tui`, `src/core`, or every Shelra directory; establish interfaces and migrate one execution path at a time.

