# Grok CLI architecture audit

## Boot and modes

`src/index.ts:1-108` is the bootstrap. It resolves settings/model/API key, constructs `Agent`, and either dynamically imports OpenTUI React and renders `src/ui/app.tsx` (`startInteractive`) or runs the same `Agent` through a headless observer (`runHeadless`, `src/index.ts:110-155`). Exit cleanup calls `agent.cleanup()` then `renderer.destroy()` (`src/index.ts:76-89`). Commander wiring, API-key enforcement, model flags, verification, Telegram, update, and batch flags are in `src/index.ts:302-518`.

The current product contract is therefore one application object serving two presentations:

```text
Commander/settings
        -> Agent (session + model loop + tools + verification)
             -> React/OpenTUI App       (interactive)
             -> headless observer       (non-interactive)
```

## Provider and model path

`src/grok/client.ts:1-117` creates an `@ai-sdk/xai` provider with `GROK_BASE_URL` or `https://api.x.ai/v1`, resolves static Grok model IDs, attaches `providerOptions.xai.reasoningEffort`, and calls `generateText` for title/recap. `src/grok/models.ts:3-111` is a static registry for grok-4.3, grok-4.20 variants, and grok-3-mini with xAI context/pricing/reasoning metadata.

`src/agent/agent.ts:535-710` owns the provider, API key, base URL, model ID, message history, session store, abort controller, context meter, mode, usage, delegations and schedules. Its live turn begins at `processMessage` (`src/agent/agent.ts:1824`), compacts messages for the xAI context limit, creates tools, invokes `streamText` (`src/agent/agent.ts:1911-1980`), translates AI SDK full-stream parts to target `StreamChunk` events, persists model messages, and retries one context-limit failure if no assistant text was produced. Batch mode is a second xAI-specific request path (`src/agent/agent.ts:956-1150`, `1575-1770`).

## Message and UI event types

Target domain types in `src/types/index.ts:167-242` define `ToolResult`, `ToolCall`, `ChatEntry`, `StreamChunk`, and `ModelInfo`. The `StreamChunk` union is already close to a presentation-neutral bridge: content, reasoning, tool calls, tool results, approval requests, done and errors. The `Agent` observer interfaces in `src/agent/agent.ts:114-158` add step/tool/usage notifications consumed by both UI and headless paths.

## Tool registry and execution

`src/grok/tools.ts:51-588` builds an AI SDK `ToolSet` from the Bash tool, file tools, process control, MCP, LSP, delegation, schedules, computer, Telegram, plans and payments. It also embeds xAI response-search tools (`web_search`/`x_search`, lines 59-84), media generation, and provider-specific response tool schemas. The model directly receives this registry; the UI receives normalized target tool calls/results afterward.

File operations (`src/tools/file.ts:1-127`) resolve relative paths and write/edit content, but do not enforce workspace containment or stale hashes. Bash (`src/tools/bash.ts:33-161`, `389-430`) can execute on the host, with an optional Shuru sandbox on supported macOS hardware. The target has useful diff/LSP reporting but lacks Shelra's general execution-broker boundary.

## State and persistence

`Agent.messages` is the model transcript. `SessionStore` loads/persists session history; `App` derives `ChatEntry[]` through `agent.getChatEntries()` and owns transient stream text, reasoning, active tools, modal state, focus, scroll, queued messages, and layout state. Storage paths are Grok-branded (`src/storage/db.ts`, `src/utils/settings.ts`), principally `~/.grok/grok.db` and `~/.grok/user-settings.json`.

Verification is invoked by `Agent.verify()` through `src/verify/orchestrator` (`src/agent/agent.ts:2238-2262`) and uses Grok-era `.grok/environment.json`/artifact conventions. It is valuable as a UI flow but is not yet a provider-independent completion authority.

## UI architecture and coupling

`src/ui/app.tsx` is a 5,862-line React/OpenTUI application. Its state includes API-key presence, transcript entries, streaming content/reasoning, processing/abort, selected model, sandbox/mode, model/sandbox/wallet/API-key/recap/slash/MCP/agent/schedule modals, active plan/subagent, queued messages, Telegram and update state. It imports target `Agent`, target types and `src/grok/models`.

The main path (`src/ui/app.tsx:2046-2160`) adds a user entry, calls `agent.processMessage`, maps stream chunks to transcript/tool activity, handles approval and auth errors, and finalizes the turn. `PromptBox` (`src/ui/app.tsx:3822-4002`) owns focus, textarea behavior, `@` file completion, Shift+Enter, Tab mode changes, queueing, Enter submit and Escape interrupt. `MessageView` (`src/ui/app.tsx:4232+`) renders Markdown, tool calls/results, plans, tasks, delegation, LSP diagnostics, media, diffs, Bash and process output.

Slash commands and modal flows (`src/ui/app.tsx:2240+`) include model/sandbox/wallet/recap/API key, MCP, agents, schedules, review, verify, commit/push/PR, remote control and update. Direct xAI coupling is visible at the API-key modal (`xai-` validation and wording around lines 1601, 4154-4161, 1792), the composer placeholder “Message Grok…” (line 3929), update/Telegram wording, and `HeroLogo`’s Grok ASCII. These are migration targets, not Phase 0 edits.

## Architectural assessment

The smallest clean seam is a provider-independent `Agent` execution port between `App`/headless observers and the current `streamText`/batch/provider code. Preserve the target UI event vocabulary initially; implement an adapter that maps normalized provider events to `StreamChunk` and observer notifications. Later phases should move task/context/verification ownership behind that façade. The target loop should not be mechanically retained as the final intelligence layer because it lacks Shelra's deterministic context, durable ledger, execution broker and host completion gate.

