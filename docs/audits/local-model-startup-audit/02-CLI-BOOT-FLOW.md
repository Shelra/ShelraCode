# 02 — CLI boot flow

## 1. The real entrypoint

**FACT.** `package.json:12-14` maps `bin.shelra → dist/index.js`, compiled from
`src/index.ts` (`tsconfig.json` `rootDir: ./src`, `outDir: ./dist`).
`src/index.ts:1` is `#!/usr/bin/env bun`. Nothing else in `src/` is an
entrypoint; `src/index.ts` is the only file with a shebang and the only one that
calls `program.parse()` (`src/index.ts:1009`).

## 2. Module-load side effects (before *any* argv is inspected)

These run at import time, in order:

| Order | Effect | Line |
| --- | --- | --- |
| 1 | Static imports pull in `Agent`, `inspectHardware`, `runStartup`, `runOnboarding`, `discoverLocalRuntimes`, `installManagedRuntime`, settings, … | `src/index.ts:2-52` |
| 2 | `dotenv.config()` — reads `./.env` into `process.env` | `:54` |
| 3 | `process.on("SIGTERM", …)` → `process.exit(0)` | `:60` |
| 4 | `process.on("uncaughtException")` → prints `Fatal: <message>`, `exit(1)` | `:62-65` |
| 5 | `process.on("unhandledRejection")` → prints `Unhandled rejection: …`, `exit(1)` | `:67-70` |
| 6 | `program.…` command-tree construction | `:734-1007` |
| 7 | `program.parse()` | `:1009` |

**FACT — global error policy is fatal-by-default.** Any unhandled rejection
anywhere (including inside the TUI) kills the process with a single stderr line
and exit 1. This is the outermost error boundary and it is *not* TUI-aware: it
does not `renderer.destroy()`, so a crash can leave the terminal in raw/alt-screen
mode. **INFERENCE (medium):** terminal corruption on crash.

## 3. Sequence — interactive launch (`shelra`, no flags)

Every hop below is a real call site.

```
$ shelra
│
├─ src/index.ts:54     dotenv.config()
├─ src/index.ts:1009   program.parse()
└─ src/index.ts:757    .action(async (message, options) => …)
   │
   ├─ :758-763  --update? → runUpdate, exit                      [network, pre-UI]
   ├─ :765      changeDirectoryOrExit(options.directory)  ← process.chdir
   ├─ :767-770  --background-task-file? → runBackgroundDelegation
   ├─ :772      resolveConfig(options)                  → :688-713
   │            ├─ getApiKey()      src/utils/settings.ts:341  (env → user-settings.json)
   │            ├─ getBaseURL()     src/utils/settings.ts:345  (env only; "" default)
   │            ├─ normalizeModelId src/models/catalog.ts:7    (trim only)
   │            ├─ getCurrentSandboxMode()      settings.ts:606
   │            ├─ getCurrentSandboxSettings()  settings.ts:614
   │            └─ saveUserSettings({apiKey|defaultModel}) if flags given  :709-710
   ├─ :774-795  --verify? → runHeadless(buildVerifyPrompt(...))
   ├─ :797-812  --prompt? → runHeadless(...)
   ├─ :815      resolveWorkspaceTrustSandboxMode()      → :624-636
   │            └─ if untrusted cwd + TTY: readline prompt on stdin/stderr  :579-622
   │               ***BLOCKING SYNCHRONOUS-STYLE PROMPT BEFORE ANY UI EXISTS***
   └─ :816      startInteractive(...)                   → :72-418
      │
      ├─ :86    new Agent(undefined, undefined, model, …)   ← preferLocal ⇒ no key/URL
      │         src/agent/agent.ts:606-647
      │         ├─ :614 modelId = normalizeModelId(model || getCurrentModel("agent"))
      │         │        getCurrentModel reads ~/.shelra/user-settings.json  settings.ts:349-365
      │         ├─ :621 new BashTool(cwd, {sandboxMode, sandboxSettings})
      │         ├─ :625 new DelegationManager
      │         ├─ :627 new ScheduleManager
      │         ├─ :635 loadRecapsEnabled()            ← settings read
      │         └─ :637-646 new SessionStore(cwd)      ← **opens SQLite, runs migrations,
      │                     openSession(), loadTranscriptState()**   src/storage/db.ts:23-40
      ├─ :92-96 dynamic import @opentui/core, @opentui/react, react, ./ui/app, ./ui/startup
      ├─ :98    await createCliRenderer({exitOnCtrlC:false, useMouse:true, useKittyKeyboard})
      ├─ :121   root = createRoot(renderer)
      ├─ :133   startupHardware = inspectHardware()     ← SYNC, os.cpus()/totalmem, gpu:[]
      ├─ :403   const { resolveStartupKeyAction } = await import("./ui/startup-input")
      ├─ :414   renderer.keyInput.on("keypress", startupKeyHandler)
      ├─ :416   renderStartup({state:"booting", …})     ← ***FIRST FRAME PAINTED***
      └─ :417   void initializeLocal()                  ← fire-and-forget, NOT awaited
         │
         └─ :357-401 initializeLocal
            ├─ :358 guard: return if initializing || installing
            ├─ :360-365 if (!preferLocal) { setApiKey?; renderApp([]); return }
            ├─ :368 await runStartup({requestedModel, signal, onProgress})
            │       src/startup/orchestrator.ts:60-236   ← see §5
            ├─ :373-375 startupDiscovery/Hardware/Recommendation = result.*
            ├─ :376-380 if ready → agent.setProvider(provider, model.id); renderApp(models)
            └─ :381-390 else → renderStartup({state, message, detail})
```

## 4. What initializes before vs after the UI

| Phase | Work | Blocking? |
| --- | --- | --- |
| **Before UI** | dotenv, argv parse, `chdir`, settings reads, **workspace-trust stdin prompt**, `new Agent(...)` incl. **SQLite open + migrations + session load** | Yes — all synchronous or awaited |
| **UI construction** | dynamic import of OpenTUI/React/App/StartupScreen, `createCliRenderer` | Yes (awaited, `src/index.ts:92-106`) |
| **First frame** | `StartupScreen` in state `booting` | — (`:416`) |
| **After UI** | hardware scan, runtime discovery, model discovery, ranking, server spawn, health probe, model install | No — all inside the fire-and-forget `initializeLocal()` at `:417` |

**FACT — the UI does appear before any model/network work.** The first paint is
`renderStartup(startupProgress)` at `src/index.ts:416`, with
`startupProgress = { state: "booting", message: "Preparing your local coding
environment" }` (`:131`).

**FACT — but two things can still delay or precede the first frame:**

1. **The workspace-trust prompt** (`src/index.ts:815` → `:624-636` → `:579-622`)
   writes a multi-line question to stderr and blocks on `readline` **before**
   `startInteractive` is even called. On a first run in a new directory the user
   sees a plain-text prompt, not the ShelraCode startup screen.
2. **`new Agent(...)` opens SQLite and replays the transcript** before the
   renderer exists (`src/index.ts:86` → `src/agent/agent.ts:637-646`). A large
   session transcript is deserialized on the main thread pre-UI.
   **INFERENCE (medium):** measurable on long sessions; not measured here.

## 5. `runStartup` internals (`src/startup/orchestrator.ts:60-236`)

```
runStartup(options)
├─ :61  emit "booting"
├─ :63  hardware = options.hardware ?? inspectHardware()          (sync, gpu:[])
├─ :66  emit "detecting-runtime"
├─ :67-73  discoveryPromise = discoverLocalRuntimes(undefined, AbortSignal.timeout(60_000))
├─ :74  emit "detecting-hardware"
├─ :75  hardwarePromise = detectHardware()          ← spawns nvidia-smi/rocm-smi/system_profiler
├─ :76  [discovery, hardware] = await Promise.all([...])     ← CONCURRENT ✔
├─ :77-79 emit "detecting-models" with count
├─ :80-90 catch → state "recoverable-error"
├─ :92  emit "recommending-model"
├─ :93-97 route = selectLocalRoute(discovery.models, {preferredModel, requiresTools:true, hardware})
├─ :99-108 if no model → recommendBootstrapModel(hardware); return state "onboarding"
├─ :110-118 runtime = findRuntime(...); if missing → "recoverable-error"
├─ :120-128 await runtime.prepareModel(model.id, signal)   ← SPAWNS/RELOADS llama-server
├─ :129     runtimeHealth = runtime.prepareModel ? await runtime.health(signal) : discovery.health[id]
│           ⚠ health() re-enters ensureServer WITHOUT a model id  → see 10-MODEL-LIFECYCLE §B4
├─ :130-138 if unhealthy → "recoverable-error"
├─ :140-145 emit "validating-model" → "preparing-runtime" → "loading-model"
│           (these three are cosmetic: no work happens between them)
├─ :147-212 if healthCheck !== false:
│           ├─ :149 emit "health-check"
│           ├─ :153 probe = await probeLocalModel(provider, model, signal)   ← REAL generation
│           ├─ :154-190 if !ok and reason matches /out.?of.?memory|oom|memory|load|resource/i:
│           │           pick a smaller ALREADY-INSTALLED candidate, prepare, re-probe
│           └─ :193-210 still !ok → "recoverable-error" (returns the *stale* provider)
├─ :214-218 activeModel = {...activeModel, loaded:true, capabilityConfidence: "probed"}
├─ :219-225 saveUserSettings({defaultModel, localRuntimeId, lastLocalHealthCheck})
└─ :226-235 emit "ready"; return {state:"ready", model, provider, healthChecked}
```

**FACT — the three emits at `:140-145` (`validating-model`,
`preparing-runtime`, `loading-model`) are emitted back-to-back with no awaited
work between them.** They are decorative: the actual load already happened at
`:120`. The user sees them flash by.

## 6. Sequence — headless (`shelra -p "…"`)

```
src/index.ts:797 → runHeadless(...)  :485-543
├─ :498  new Agent(undefined, undefined, model, …)          (preferLocal ⇒ no remote wiring)
├─ :506  configureLocalProvider(agent, model, preferLocal, requireReady=true)   :442-483
│        └─ preferLocal ⇒ activate && requireReady branch  :448-458
│           ├─ await runStartup({requestedModel})     ← FULL startup incl. health probe
│           ├─ throw if state !== "ready"
│           └─ agent.setProvider(startup.provider, startup.model.id)
├─ :507-514 catch → stderr "ShelraCode could not start a local model: …", exitCode 1
├─ :515-517 renderHeadlessPrelude
├─ :520     processAtMentions
├─ :522-539 for await (chunk of agent.processMessage(...)) → stdout
└─ :541     finally: agent.cleanup() + localSetup.dispose()
```

**FACT — headless is fully gated on readiness** (`:506` uses
`requireReady=true`, and `runStartup` runs the real probe). Headless is the
*strictest* readiness path in the codebase.

## 7. Sequence — `--remote`

`config.preferLocal = options.remote !== true` (`src/index.ts:712`).

```
--remote + -p:
  runHeadless(:498) → new Agent(apiKey, baseURL, …)
     src/agent/agent.ts:618  if (apiKey && baseURL) this.setApiKey(apiKey, baseURL)
     ⚠ getBaseURL() returns "" unless SHELRA_BASE_URL is set
       (src/utils/settings.ts:345-347) ⇒ "" is falsy ⇒ NO provider created
  configureLocalProvider(agent, model, activate=false, requireReady=true)  :506
     └─ activate is false ⇒ skips the requireReady branch entirely (:448)
        └─ falls to :459-482: discoverLocalRuntimes(…, timeout 750ms)
           ⚠ spins up LOCAL discovery (which can spawn llama-server) that --remote never uses
        └─ activate false ⇒ no provider wired; returns {models, dispose}
  → first agent.processMessage → requireProvider() throws
     "No model runtime configured. Start a local runtime or set SHELRA_API_KEY together with SHELRA_BASE_URL."
     src/agent/agent.ts:2341-2349
```

**FACT — confirmed finding #5, refined.** The failure only occurs when no base
URL is configured; with `SHELRA_BASE_URL` set, the `Agent` constructor wires the
provider and `--remote` works. The wasted 750 ms local discovery happens
*regardless*.

Interactive `--remote` is different but also broken-ish: `initializeLocal`
`:360-365` does `if (apiKey && baseURL) agent.setApiKey(...)` then
`renderApp([])`. With `baseURL === ""` no provider is wired, `agent.hasApiKey()`
is false, and `App` opens the API-key modal (`src/ui/app.tsx:645`). Submitting a
key calls `agent.setApiKey(apiKey)` (`:1811`), which **throws**
`"Remote provider base URL required. Set SHELRA_BASE_URL or pass --base-url."`
(`src/agent/agent.ts:724-726`) — caught at `src/ui/app.tsx:1812-1815` and shown
as a modal error the user cannot resolve from inside the modal. **FACT.**

## 8. Can chat be used before model readiness?

**No, in the local-first path — FACT.** `App` is only ever mounted by
`renderApp` (`src/index.ts:192-215`), called from exactly two places:
`initializeLocal:362` (the `--remote` branch) and `initializeLocal:378`
(guarded by `result.state === "ready"`).

**Caveat (FACT):** once `App` *is* mounted, its own send-guard
(`src/ui/app.tsx:3424`) only checks `hasApiKeyRef.current` →
`agent.hasApiKey()` → `!!this.provider` (`src/agent/agent.ts:710-712`). It does
**not** re-check liveness. If the `llama-server` child dies after chat opens,
nothing detects it until a request fails. See `12-CHAT-READINESS.md`.

## 9. Expensive / blocking work in the boot path

| Work | Where | Cost | When |
| --- | --- | --- | --- |
| SQLite open + migrations + transcript replay | `src/agent/agent.ts:637-646` | I/O, sync-ish | **Pre-UI, every launch** |
| `os.cpus()` ×2 | `src/hardware/profile.ts:38,39` | trivial | every `inspectHardware()` call |
| `nvidia-smi` / `rocm-smi` / `system_profiler` | `src/hardware/profile.ts:105-130`, 2.5 s timeout each (`:49`) | up to ~7.5 s worst case (serial fallbacks) | every launch (`detectHardware`) |
| `readdir` of `~/.shelra/models` + `stat`/`readFile` per GGUF | `src/models/huggingface.ts:193-237` | small | **called 3× per discovery** (`detect`, `health`, `listModels`) plus twice inside `ensureServer` (`:127,135`) |
| **`llama-server` spawn + full GGUF load into RAM** | `src/runtimes/managed-llama.ts:124-184` | **seconds to tens of seconds, GB of RAM** | on *discovery*, not just on use — see `27` perf notes in `09-RUNTIME-ARCHITECTURE.md` |
| Real generation probe | `src/startup/orchestrator.ts:27-48`, 15 s timeout | 1 inference | every launch |
| GitHub releases fetch | `src/utils/update-checker.ts:16-29` via `src/ui/app.tsx:1863-1873` | network | on chat mount |

**Measured (this machine, `shelra models` — a strict subset of startup):
2 817 / 3 475 / 5 380 ms**, with a live `llama-server` PID observed during the
run. See `21-VALIDATION-RESULTS.md`.

## 10. Failures possible before vs after the UI exists

**Before the UI (bare stderr + `process.exit`):**
`changeDirectoryOrExit` (`src/index.ts:545-557`), `parseHeadlessOutputFormat`
(`:726-732`), `requireApiKey` (`:715-724`), any throw inside `new Agent(...)`
(e.g. SQLite failure) → caught only by the global `uncaughtException` handler
(`:62-65`) → `Fatal: <message>`, exit 1.

**After the UI:** `initializeLocal` wraps `runStartup` in try/catch
(`:391-396`) and renders `recoverable-error`; `installRecommended` does the same
(`:343-350`). So post-UI model failures are non-fatal and retryable via
`[r]`/`[Enter]` (`src/ui/startup-input.ts:21-34`). **This is a genuine
strength.**
</content>
</invoke>
