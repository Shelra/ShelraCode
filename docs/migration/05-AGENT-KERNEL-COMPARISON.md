# Agent-kernel comparison

## Side-by-side evidence

| Concern | Grok CLI | ShelraCode live path | Future decision |
|---|---|---|---|
| Turn classification | UI mode (`agent/plan/ask`) and prompt heuristics in `src/agent/agent.ts` | `src/agent/turn-policy.ts` plus `router/task-analysis.ts` classify greeting, repository, read-only, plan, review, mutation and task shape | Adapt Shelra policy behind the Grok application seam. |
| Context | Full model message history with xAI context estimate/compaction in `src/agent/agent.ts:682-710`, `1911+` | Repository snapshot/intelligence, bounded context capsule/compiler and compaction anchors | Shelra host context compiler becomes authoritative; retain target transcript. |
| Provider abstraction | `XaiProvider`, AI SDK `streamText`, xAI batch types | `ProviderAdapter`, normalized messages/events/failures | Introduce normalized adapter in Phase 1; xAI is a temporary implementation. |
| Streaming | AI SDK full stream mapped to `StreamChunk`/observer callbacks | normalized provider events and `AppEventBus` | Preserve target event ordering through a bridge. |
| Tool calling | AI SDK ToolSet from `src/grok/tools.ts`; provider search/media/payment tools | typed workspace tools and normalized tool calls, schema validation and host execution | Keep target presentation; route execution through Shelra host boundary. |
| Tool execution | Bash/file tools execute from Agent; file paths lack general containment/stale guard | `ExecutionBroker`, workspace tools, permissions, containment, secret/network policy | Shelra broker owns execution after integration. |
| Permissions | x402 approval and selected sandbox/command checks | typed permissions, grants, requestApproval and strict-zero | Preserve approval UI; adapt request/decision events. |
| Checkpoints | session/transcript persistence; no general mutation checkpoint | SQLite checkpoint hashes/content and stale-edit protection | Use Shelra checkpoint before mutation. |
| Recovery | context-limit retry, cancellation, tool errors, delegation paths | typed recovery, task graph, bounded retries, non-progress watchdog and resume policy | Use Shelra recovery state; expose target error/activity views. |
| Task decomposition | task/delegate tools and plans; model controls most loop | task ledger/graph, staged work units and host advancement | Shelra task graph/ledger owns task state. |
| Small-model support | static model metadata; no host evidence compiler | one legal action per staged target, bounded reads, evidence and capability profiles | Required for local-first product; integrate in Phases 3-4. |
| Verification | `runVerifyOrchestration` through target `Agent.verify()` | host tests, evidence, objective proof/review and completion gate | Shelra verifier owns truth. |
| Completion | model finish plus target done event; verify is a separate flow | host criteria + verification + final diff review; blocks false completion | Host completion gate is authoritative. |
| Persistence | `SessionStore`, target DB and in-memory messages; Grok paths | SQLite task runtime/ledger/checkpoints/settings; audit notes identify a dead legacy writer | Keep conversation persistence; add one authoritative task store. |
| UI events | target `StreamChunk` and `ProcessMessageObserver` | shared `AppEvent` bus (`shared/events.ts`) | Map normalized kernel events to target UI events first; later converge. |
| Headless | same target Agent with text observer | CLI/control plane can run the same kernel | Preserve command surface and use same application service. |

## Recommended ownership

Conversation history remains an application/session concern so the Grok transcript and resume UX stay stable. Task state belongs to Shelra's task ledger/runtime snapshot. The kernel owns planning/action/observation/recovery state. The control plane owns discovery, policy and route selection. The execution broker owns permissions, path/process/network containment. Verification and completion gates are host services. The React UI renders events and requests approvals; it never decides a task is complete.

## Evolve versus replace

The target `Agent` should become a façade/application service rather than be deleted in one step. Keep its public methods used by `App` and headless mode, first replace its model call with the normalized adapter, then delegate context, task execution and verification to Shelra services. Shelra's `src/agent/loop.ts:936+` is the source of kernel behavior, but it must be integrated through typed inputs/outputs. Copying its TUI or retaining the target loop as a second implementation would create divergent safety and completion semantics.

## Required boundary tests

Before local routing is enabled, tests must prove: provider SDK objects do not cross the seam; normalized text/tool/usage/done/error ordering is stable; malformed tool envelopes are rejected; UI approval/cancel maps to host decisions; transcript persistence is provider-neutral; a fake provider can execute a disposable coding task through read -> edit -> test -> completion; and a model completion string alone cannot pass the gate.

