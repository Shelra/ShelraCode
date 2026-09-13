# Feature reconciliation matrix

Classification is a Phase 0 recommendation based on code inspection. “ADAPT” means preserve the user-facing behavior while changing its backend. “DEFER” means retain behind an explicit capability until its provider-independent implementation is proven.

| Feature | Target evidence | Shelra evidence | Decision | Reason |
|---|---|---|---|---|
| React/OpenTUI shell | `src/ui/app.tsx`, `src/index.ts:59-106` | Shelra has a separate Solid/OpenTUI TUI | KEEP GROK IMPLEMENTATION | Product constraint; target interaction is the foundation. |
| Transcript/Markdown/streaming | `src/ui/markdown.tsx`, `src/ui/app.tsx:4232+`, `StreamChunk` | Shelra `AppEvent`/presentation adapters | MERGE BEST OF BOTH | Keep target rendering; consume normalized events. |
| Composer/keyboard/resize | `src/ui/app.tsx:3822-4002` | Shelra TUI is unrelated | KEEP GROK IMPLEMENTATION | Preserve focus, queue, slash, scroll and responsiveness. |
| Slash commands/modals | `src/ui/app.tsx:2240+` and modal components | Shelra CLI commands/settings are different | KEEP + ADAPT | Keep patterns; map model/runtime/settings actions. |
| MCP | `src/mcp`, `src/ui/app.tsx` MCP modal/tool rendering | Shelra has provider-independent tool/runtime policy | MERGE BEST OF BOTH | Retain target UI and route execution through policy. |
| LSP | target LSP tools and diagnostics views | Shelra workspace/evidence tools | MERGE BEST OF BOTH | Target diagnostics presentation is mature; Shelra containment/evidence is stronger. |
| Headless | `src/index.ts:110-155` | Shelra CLI/control-plane path | KEEP + ADAPT | Same application/kernel events without TUI. |
| Verification | `src/verify/orchestrator`, `Agent.verify()` | Shelra verifier/objective proof/completion gate | REPLACE WITH SHELRA | Host-owned truthful completion is stronger; preserve target UI flow. |
| Sessions/resume | target `SessionStore`, target DB and transcript | Shelra durable task runtime/checkpoint/resume | MERGE BEST OF BOTH | Preserve chat resume; add durable task identity/checkpoints. |
| Schedules/daemon | target schedule tools/daemon and modal | product docs say background daemon is not v0.1, though target code exists | DEFER | Keep behind capability and audit lifecycle/privacy before enabling. |
| Sub-agents/delegation | target `DelegationManager`, task/delegate tools and views | Shelra bounded subagent coordinator and tests | MERGE BEST OF BOTH | Preserve target presentation; Shelra controls context and parent completion. |
| Computer/desktop tools | target `src/tools/computer.ts`, agent-desktop UI | no equivalent local-first core evidence | DEFER | Retain only behind explicit capability; do not imply local support. |
| Telegram | target bridge and Telegram tools | no product-equivalent local evidence | DEFER | Requires provider-independent auth/runtime story and privacy review. |
| Image/video generation | target Grok Imagine media tools and `.grok/generated-media` | no local media runtime evidence | REMOVE OR DEFER | Remove only after UI capability state exists; no fake backend. |
| Web/X search | xAI response tools in `src/grok/tools.ts:59-84` | no equivalent required for local coding | REMOVE XAI / ADAPT GENERIC | X search is xAI-specific; generic search is a separate optional capability. |
| xAI Batch | `src/grok/batch.ts`, Agent batch path | no generic batch contract | REMOVE XAI / DEFER GENERIC | Do not preserve an xAI-only flag after provider removal. |
| x402 wallet/payment | target wallet/payment modules and approval UI | no Shelra payment evidence | REMOVE | No local-first product need; retain generic approval pattern. |
| Structured tool output | target AI SDK tools/zod schemas | Shelra normalized tools, schema validation and envelope recovery | MERGE BEST OF BOTH | Keep useful target schemas; host validates and executes. |
| Install/update/uninstall | target install manager, Grok repo/assets | Shelra installation tests/scripts | MERGE BEST OF BOTH | Preserve mature lifecycle only after rename matrix and license review. |
| Pricing/quota | target static Grok prices and xAI batch economics | Shelra quota/privacy/cost policy | REPLACE WITH SHELRA | Model metadata must be provider-neutral; no paid escalation by default. |
| API key modal | target xAI key modal | local runtime discovery/config | ADAPT | Same modal pattern becomes runtime/provider setup; no mandatory remote key. |

