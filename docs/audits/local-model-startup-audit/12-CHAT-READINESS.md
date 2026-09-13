# 12 — Chat readiness

## 1. The claim under test

> "When chat becomes active, the selected local model is actually ready."

### Verdict: **TRUE at mount time in the local-first path; NOT MAINTAINED afterwards; FALSE in two edge paths.**

## 2. Every path that mounts `App`

`App` (`src/ui/app.tsx:596`) is mounted **only** by `renderApp`
(`src/index.ts:192-215`). `renderApp` has exactly two call sites:

| Call site | Guard | Model ready? |
| --- | --- | --- |
| `src/index.ts:378` | `if (result.state === "ready" && result.provider && result.model)` — and `agent.setProvider(...)` on the line before (`:377`) | **YES** — past `prepareModel` + `health` + real generation probe |
| `src/index.ts:362` | `if (!preferLocal)` — the `--remote` branch, preceded by `if (apiKey && baseURL) agent.setApiKey(...)` (`:361`) | **NO** — no local model involved; and if `baseURL === ""` **no provider at all** |

**FACT — in the normal (`preferLocal`) path, chat cannot open before readiness.**
There is no third mount point, no "open chat while loading" affordance, and no
timeout that gives up and mounts chat anyway.

## 3. What "ready" certifies at that instant

From `src/startup/orchestrator.ts` (see `10-MODEL-LIFECYCLE.md` §4):

1. `prepareModel(model.id)` → `llama-server` spawned with `-m <path>` and
   `/health` answered `200` within 45 s (`:120`).
2. `runtime.health()` → `{healthy: true}` (`:129`).
3. `probeLocalModel` → a real `generateText` returned non-empty text within
   15 s (`:153`).
4. `agent.setProvider(result.provider, result.model.id)` (`src/index.ts:377`).

**FACT — with two or more installed GGUFs, step 2 can have swapped the loaded
model** (see `09` §9 / `10` §7). In that case chat opens against a *ready but
different* model. The claim then holds for "a model is ready" but **fails for
"the selected model"**.

## 4. Send-time gating inside chat

```ts
// src/ui/app.tsx:3398-3437  handleSubmit
if (!raw.trim() && pasteBlocks.length === 0) { /* interrupt-or-noop */ return; }   // :3400-3409
...
if (!message.trim()) return;                                                        // :3423
if (!hasApiKeyRef.current) { openApiKeyModal(); return; }                           // :3424-3427
if (handleCommand(message)) return;                                                 // :3428
...
if (isProcessingRef.current) { queue it; return; }                                  // :3430-3435
processMessage(enhancedMessage, displayText);                                       // :3436
```

**FACT — the only readiness-adjacent guard is `hasApiKeyRef.current`**, which
tracks `hasApiKey` state (`:1827-1829`), seeded from
`agent.hasApiKey()` (`:599`) = `!!this.provider`
(`src/agent/agent.ts:710-712`).

**FACT — that is a *provider-object-exists* check, not a readiness check.** It
does not consult:
* whether the `llama-server` child is alive,
* `runtime.health()`,
* `lastLocalHealthCheck`,
* `model.loaded`,
* `capabilityConfidence`.

**FACT — the composer is never disabled.** Grep of `src/ui/app.tsx` for
`disabled` on the input: the only hit is a settings display string (`:478-479`).
The user can always type. `switchingModel` guards the *picker* (`:817`,
`:2999`) but not the composer, so a message can be submitted **while a model
switch is mid-flight**.

## 5. What happens if the runtime dies after chat opens

**FACT — nothing detects it.**

* No health polling after mount — grep for `health(` in `src/ui/app.tsx`: none.
* No process supervision — `ManagedLlamaRuntime` has no restart logic
  (`src/runtimes/managed-llama.ts:157-161` merely clears state on `exit`).
* No reconnect — `LocalProviderAdapter` sets `maxRetries: 0`
  (`src/runtimes/local-provider.ts:88`).

The first symptom is a failed request. It surfaces via the stream's `error`
event (`src/providers/stream.ts:60-62`) into the turn's error handling
(`src/ui/app.tsx:2140-2165`), which appends *"An unexpected error occurred."*
(`:2151`) unless the failure was classified as an auth error, in which case it
opens the **API-key modal** (`:2161-2165`) — a completely wrong remedy for a
dead local server.

**FACT — the startup runtime is not reachable from `App` at all.** `renderApp`
passes only `agent`, `startupConfig` (a plain data object built at
`src/index.ts:199-210`), `initialMessage` and `onExit`. The `LocalRuntimeAdapter`
instances live in the `startupDiscovery` closure in `startInteractive` and are
never handed to the UI. The only bridge is the `onSelectLocalModel` callback
(`:205` → `prepareLocalModel`, `:168-190`). **So the chat UI structurally
*cannot* check runtime health even if it wanted to.**

## 6. Model switching from chat

```ts
// src/ui/app.tsx:815-837
const selectLocalModel = useCallback(async (modelId) => {
  if (switchingModel) return;
  setModelSwitchError(null); setSwitchingModel(true);
  try {
    const result = startupConfig.onSelectLocalModel ? await startupConfig.onSelectLocalModel(modelId) : {success:true};
    if (!result.success) { setModelSwitchError(result.error || "The local model could not be prepared."); return; }
    agent.setModel(modelId); setModel(modelId);
    saveProjectSettings({model: modelId}); saveUserSettings({defaultModel: modelId});
  } finally { setSwitchingModel(false); }
}, [agent, startupConfig.onSelectLocalModel, switchingModel]);
```

The backing implementation `prepareLocalModel` (`src/index.ts:168-190`) is
**correct and complete**: it finds the candidate, finds the runtime, calls
`prepareModel`, builds a fresh provider *after* the reload, probes it, installs
it on the agent, and persists. It does **not** call `health()`, so it is free of
the model-swap bug described in `09` §9.

### FACT — but the UI throws the result away

```ts
// src/ui/app.tsx:2997-3005
if (key.name === "return") {
  const sel = filteredModelIds[modelPickerIndex];
  if (sel && !switchingModel) {
    void selectLocalModel(sel).then(() => {
      setShowModelPicker(false);      // ← unconditional
      setModelSearchQuery("");
    });
  }
  return;
}
```

`selectLocalModel` never rejects (it swallows failure into
`setModelSwitchError`), so `.then()` **always** runs and the picker **always**
closes. And `modelSwitchError` is rendered only *inside* the picker
(`:3720-3721`, `error={modelSwitchError}`), which is now closed.

**Net effect (FACT):** if `prepareModel` or the probe fails, the modal closes,
no error is shown, `agent.setModel` was never called — so the header still
displays the **old** model while the runtime may have been stopped/restarted by
the failed `prepareModel` attempt. The user has no indication anything went
wrong.

**FACT — a second inconsistency:** on success the code calls
`agent.setModel(modelId)` (`:828`) even though `prepareLocalModel` already did
`agent.setProvider(provider, candidate.id)` (`src/index.ts:180`), which itself
calls `setModel` (`src/agent/agent.ts:718`). Harmless duplication, but it shows
the two layers each believe they own model state.

## 7. Streaming and the first-token path

```
handleSubmit :3436 → processMessage (src/ui/app.tsx ~:2040-2185)
  → agent.processMessage(message, observer)      src/agent/agent.ts:~1880+
     ├─ :1913  provider = this.requireProvider()        ← throws if null
     ├─ :1914  runtime = provider.resolveModelRuntime(this.modelId)
     ├─ :1918  buildVisionUserMessages (unless supportsVision === false)
     ├─ :1924  compileContextPacket(cwd, userMessage)   ← SYNC repo walk, see §8
     ├─ :2020-2029 compactForContext(provider, system, modelInfo.contextWindow, …)
     ├─ :2031-2059 createTools(...) (+ MCP for mutate turns)
     └─ :2072  provider.stream({... maxOutputTokens: maxOutputTokensForTurn(runtime, kind, this.maxTokens) })
                 → LocalProviderAdapter.stream  src/runtimes/local-provider.ts:81-108
                 → streamText({ maxRetries: 0 })
                 → normalizeProviderEvents      src/providers/stream.ts:30-67
```

**FACT — `requireProvider()` is the last line of defence** and its message is
remote-flavoured: *"No model runtime configured. Start a local runtime or set
SHELRA_API_KEY together with SHELRA_BASE_URL."*
(`src/agent/agent.ts:2343-2345`). In a local-first product that reads as a
misconfiguration hint pointing at the wrong remedy.

## 8. FACT — a synchronous repository walk blocks the first token

`compileContextPacket` (`src/agent/agent.ts:1924`) runs on the main thread for
every turn classified `coding` or `repository`
(`src/context/compiler.ts:113-118`):

* `walk(root, root, allFiles)` — recursive `readdirSync` + **two `statSync`
  calls per entry inside the sort comparator** (`src/context/compiler.ts:60-76`)
  plus one more per entry in the loop (`:83`). For an N-entry directory the
  comparator alone issues O(N log N) `statSync` calls.
* Capped at `MAX_FILES = 256` (`:5`) **files**, but directory recursion is not
  capped.
* Then up to 3 `readFileSync` of manifests (`:153-156`).

**FACT — `walk` follows symlinks and has no visited-set and no depth limit.**
`statSync` (not `lstatSync`) is used at `:63`, `:70` and `:83`; a directory
symlink pointing at an ancestor recurses forever. The `paths.length >= MAX_FILES`
guards at `:53` and `:78` only stop recursion once 256 **files** have been
collected — a cycle through directories containing no regular files never
increments that counter. **Result: unbounded recursion → stack overflow → the
global `uncaughtException` handler kills the process** (`src/index.ts:62-65`).

**INFERENCE (high) — this is also the dominant per-turn latency contributor on a
large repository**, and it runs *before* the model is contacted, so it delays
the first token with the UI showing nothing.

## 9. Answers to the brief's specific questions

| Question | Answer |
| --- | --- |
| Can the user type/send while the model is not loaded? | **In the local path: no** (chat is not mounted). **After mount: yes** — nothing re-checks. |
| …while the runtime is unavailable? | **Yes** — a dead server is undetectable until a request fails. |
| …while discovery is incomplete? | **No** — `renderApp` is only reached after `runStartup` resolves. |
| …with an invalid provider? | **Yes, in `--remote` without a base URL** — `hasApiKey` is false, so the API-key modal opens, and submitting a key throws inside the modal (`src/agent/agent.ts:724-726` → `src/ui/app.tsx:1812-1815`). Unresolvable from the UI. |
| Where are send actions gated? | `src/ui/app.tsx:3424` (`handleSubmit`), `:3370-3374` (paste), `:3194-3197` (any keypress opens the modal when no provider). |
| Composer enabled state | **Always enabled.** |
| Model readiness state in the UI | **Not represented.** No `ready`/`loading` flag reaches `App`; `startupConfig` (`src/index.ts:199-210`) carries no readiness field. |
| Provider readiness | `agent.hasApiKey()` only. |
| Stream initialisation | `LocalProviderAdapter.stream` with `maxRetries: 0`. |
| First-token path | Blocked by a synchronous repo walk + optional compaction + optional MCP connection. |

## 10. Verdict

| Aspect | Status |
| --- | --- |
| Chat mounts only after a real readiness probe (local path) | **IMPLEMENTED** |
| Readiness maintained after mount | **NOT FOUND** |
| Composer disabled while unready / switching | **NOT FOUND** |
| Runtime health visible in chat | **NOT FOUND** |
| Runtime reachable from the UI layer | **NOT FOUND** (architectural — only a callback is passed) |
| Model-switch failure surfaced | **BROKEN** (`src/ui/app.tsx:2997-3005`) |
| Correct model actually served | **BROKEN** for ≥2 models (`src/startup/orchestrator.ts:129`) |
| Error remedy correctness | **BROKEN** — a dead local server can open the API-key modal (`src/ui/app.tsx:2161-2165`) |
| First-token latency | **PARTIAL** — a synchronous repo walk precedes every non-conversation turn |
</content>
</invoke>
