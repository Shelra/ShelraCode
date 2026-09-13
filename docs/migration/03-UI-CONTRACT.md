# Grok terminal UI compatibility contract

## Purpose

The target UI is the product foundation. This contract freezes behavior and interaction while intelligence moves underneath it. A later brand/provider label change is allowed; layout, interaction model and perceived responsiveness require explicit evidence before any change is accepted.

## Preserved surface

| Area | Observed target implementation | Contract |
|---|---|---|
| Shell | React/OpenTUI dynamic bootstrap in `src/index.ts:59-106` and `src/ui/app.tsx` | Retain the OpenTUI renderer lifecycle, component structure and cleanup behavior. |
| Conversation | `App` state plus `agent.getChatEntries()`; Markdown/transcript rendering | Keep message ordering, streaming replacement, reasoning visibility and long-transcript behavior. |
| Composer | `PromptBox`, `src/ui/app.tsx:3822-4002` | Preserve focus, queueing during work, `@` file completion, Shift+Enter newline, Tab mode switching, Enter submit and Escape interrupt. |
| Tool activity | `MessageView` tool-specific branches at `src/ui/app.tsx:4232+` | Preserve plan, task, delegation, LSP, diff, Bash, process, read/search, media and generic tool views. |
| Commands | slash menu/handlers around `src/ui/app.tsx:2240+` | Keep command palette and modal interaction; replace only unsupported backend actions with honest capability states. |
| Modals | model, sandbox, wallet, API key, recap, MCP, agents and schedules | Retain modal focus/escape/approval behavior. Provider fields can become runtime/model fields later. |
| Headless | `src/index.ts:110-155` | Same application events must remain consumable without TUI rendering. |
| Resize/theme | `src/ui/theme.ts`, OpenTUI layout and responsive branches | Preserve theme architecture, terminal compatibility, resize behavior and visual hierarchy. |

## State dependency audit

`App` currently depends on target `Agent`, target message/tool types, Grok model registry and xAI-specific credential/copy. Provider-neutral seams should be introduced at the `Agent`/application boundary. The UI should receive a normalized model summary and presentation events; it must never receive an SDK model, xAI response object, provider-specific tool schema, or raw provider error.

Direct coupling observed in `src/ui/app.tsx` includes `grok/models` imports; API key presence and `xai-` validation; “Paste your xAI API key…” and “Message Grok…” strings; update/Telegram paths using Grok directories; and the Grok ASCII hero logo. These are recorded migration targets and intentionally unchanged in Phase 0.

## Required scenarios and terminal sizes

The baseline contract covers 80, 100, 120 and 160 columns. At each size, inspect startup, empty conversation, user message, assistant streaming, tool activity, plan, error, modal, slash menu, model selection, long transcript, resize, cancellation, approval and final task state. Record screenshots or PTY snapshots with terminal dimensions, selected model/runtime, and whether an API key was available.

The target baseline was not fully capturable in this environment during Phase 0: the target initially lacked installed dependencies, and all model actions require `GROK_API_KEY`; the interactive startup path therefore cannot produce an authenticated assistant/tool transcript. This is **UNPROVEN**, not a pass. The source Shelra checkout has golden OpenTUI tests at the same four widths (`tests/integration/tui-*`), which is a useful harness pattern but is not evidence of target UI equivalence.

## Event compatibility target

Keep the existing `StreamChunk` union in `src/types/index.ts:214-223` as the temporary presentation bridge. Map Shelra normalized events (`ShelraCode/src/providers/types.ts:32-60`) into it in the application seam. Preserve ordering: user entry -> assistant/reasoning deltas -> tool start/call -> tool result -> continuation -> done/error. Approval and cancellation must still reach the current modal and abort paths.

## Regression gates for later phases

Every implementation phase must run focused PTY/snapshot tests through the actual target application, compare all four widths and the major states above, and inspect the diff for unintended layout or keyboard changes. A provider/runtime label change is acceptable only when the equivalent model/runtime information remains visible through the existing hierarchy. No Shelra TUI component should be imported wholesale.


## Startup implementation update

The startup contract is now rendered by `src/ui/startup.tsx` using the existing
OpenTUI theme and terminal renderer. The interactive smoke at the target PTY
reached the loading view and the no-runtime onboarding state without showing an
API-key modal; GPU/VRAM, RAM, model count, and recovery controls were visible.
A live model transcript remains **UNPROVEN** until a local runtime is installed.
