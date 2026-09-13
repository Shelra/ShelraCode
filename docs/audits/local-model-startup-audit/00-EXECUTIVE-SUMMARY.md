# 00 — Executive summary

**Audit type:** forensic architecture & implementation audit (read-only).
**Repository:** `D:\PROYECTS\grok-cli`
**Branch:** `main` · **HEAD:** `fb97af83f06dca873281d60168430f06c8de6324`
**Working tree at audit time:** dirty (large in-progress migration) — preserved untouched.
**Scope exclusions honoured:** `ShelraCode/`, `node_modules/`, `dist/`, `tmp-runtime-smoke/`, `.git/`.

Every claim below is labelled **FACT** (traced to code, cited `path:line`) or
**INFERENCE** (reasoned, with confidence). Documentation (`README.md`,
`AGENTS.md`, `docs/migration/*`) was used only to direct investigation; where it
disagrees with code, the code wins and the disagreement is recorded.

---

## 1. Can ShelraCode currently execute the desired startup flow end-to-end?

### **PARTIALLY — with a strong caveat.**

The *shape* of the desired flow exists and is genuinely wired end-to-end for the
**single-model, already-installed, CPU-inference** case. A real launch on this
machine reaches a real local `llama-server`, a real health probe, and a real chat
shell. That is more than a skeleton — it is a working local-first startup.

But three of the flow's headline promises are **not** what the code does:

| Desired promise | Reality |
| --- | --- |
| "evaluate GPU/VRAM → determine optimal model" | GPU is read and scored, but the **managed engine is a CPU-only build and is never given a GPU-offload flag** — so GPU influences *which model is recommended* and never *how it runs* (FACT: `src/runtimes/bootstrap.ts:65,86`; `src/runtimes/managed-llama.ts:138-148`). |
| "evaluate RAM/CPU/storage" | The bootstrap recommender's RAM branch is **unreachable dead code** (FACT: `src/models/recommendation.ts:34-44`). CPU and storage are never inputs to the recommendation at all. |
| "select best existing local model" | With ≥2 installed models the orchestrator's own health re-check **silently reloads the first model on disk**, discarding the selection (FACT: `src/startup/orchestrator.ts:129` → `src/runtimes/managed-llama.ts:198` → `:128`). |

And the guided-onboarding branch is **blocked on this machine by a real,
reproducible failure**: the managed-runtime installer leaves a poisoned
`.part` archive and an empty staging directory that it never cleans
(FACT: `src/runtimes/bootstrap.ts:236-253`; field evidence in
`~/.shelra/runtime/llama-cpp/`). Local inference works here **only because a
`llama-server.exe` was copied in by hand** into
`~/.shelra/runtime/llama-cpp/manual/`, which the recursive binary search happens
to find (FACT: `src/runtimes/bootstrap.ts:188-212`).

So: **existing-model startup is real; no-model onboarding is real code that
currently fails at the runtime-install step; GPU-aware inference does not exist.**

---

## 2. Current architecture, one paragraph each (code-cited)

### CLI startup
`src/index.ts` is the real entrypoint (`#!/usr/bin/env bun`, `bin.shelra →
dist/index.js`). `commander` parses argv at `src/index.ts:734-828`; the default
action resolves config (`:688-713`), optionally prompts for workspace sandbox
trust on stdin **before any TUI exists** (`:624-636`, `:579-622`), then calls
`startInteractive` (`:72-418`). `startInteractive` constructs the `Agent` first
(`:86-91`), *then* dynamically imports OpenTUI/React (`:92-97`), creates the
renderer (`:98-106`), and immediately paints `StartupScreen` (`:416`) before
kicking off `initializeLocal()` (`:417`). So the UI does appear before any
network/model work — the first frame is a `booting` progress panel. **FACT.**
Everything model-related is async and driven by `runStartup`
(`src/startup/orchestrator.ts:60-236`). Chat (`App`) mounts only via `renderApp`
(`src/index.ts:192-215`), which is reached only from the `ready` branch
(`:376-380`) or the `--remote` branch (`:360-365`).

### Local-model discovery
One authoritative path: `discoverLocalRuntimes`
(`src/runtimes/discovery.ts:87-113`) fans out over adapters built by
`createLocalRuntimeAdapters` (`:74-85`) — always `ManagedLlamaRuntime`, plus an
`explicitEndpointRuntime` only when `SHELRA_LOCAL_ENDPOINT`/`OPENAI_BASE_URL` is
set (`:82-83`). Actual model enumeration is a **filesystem scan for `*.gguf` in
`~/.shelra/models`** plus a per-file `<name>.gguf.json` sidecar
(`src/models/huggingface.ts:193-237`). There is **no Ollama, LM Studio, MLX,
vLLM, HF-cache or remote-catalog probing anywhere in `src/`** — a deliberate
design choice documented at `src/runtimes/discovery.ts:79-81`. **FACT.**

### Hardware detection
`src/hardware/profile.ts` has two functions: `inspectHardware()` (`:34-44`,
synchronous, `os` only, **always returns `gpu: []`**) and `detectHardware()`
(`:144-152`, async, shells out). GPU detection (`:105-130`) tries `nvidia-smi`
→ (darwin) `system_profiler SPDisplaysDataType` → `rocm-smi`. Windows AMD/Intel
GPUs are **not detected at all** (no WMI/DXGI path). `parseRocm` (`:75-83`)
returns **no VRAM figure ever**. `parseMacDisplays` (`:85-103`) only records VRAM
if the profiler prints a `VRAM:` line, which Apple Silicon does not — so an
M-series Mac reports `vramTotalGb: undefined`. Storage uses `fs.statfsSync`
(`:132-141`). **FACT.**

### Recommendation
Two *separate* mechanisms, both real, both hard-coded:
`recommendBootstrapModel` (`src/models/recommendation.ts:17-70`) picks from a
**2-entry** array for the *not-yet-installed* case; `localModelFitScore`
(`src/hardware/profile.ts:171-201`) scores *already-installed* candidates for
`selectLocalRoute` (`src/router/local-first.ts:21-59`). The bootstrap
recommender sums GPU VRAM (`:33`), returns the 1.5B when that sum is `0`
(`:34-43`), and the `usableMemory` RAM fallback at `:44` is **unreachable**
because the `gpuMemory === 0` case already returned. Net effect: exactly three
outcomes — 1.5B (no GPU), 1.5B (<5 GB usable VRAM), 7B (otherwise). **FACT.**

### Onboarding
Two independent implementations. The **wired** one is the TUI branch:
`runStartup` returns `state: "onboarding"` with a `recommendation`
(`src/startup/orchestrator.ts:99-108`), `StartupScreen` renders a
"RECOMMENDED FOR YOU" panel and an `[Enter] Install recommended` action
(`src/ui/startup.tsx:195-227`), and `installRecommended`
(`src/index.ts:217-355`) installs the engine then the GGUF. The **second**,
`shelra setup` → `runOnboarding` (`src/setup/onboarding.ts:122-132`), is a
read-only diagnostic printer with a `readline` model chooser that **cannot
download anything** and duplicates the ranking logic (`:76-83`, `:105`). **FACT.**

### Runtime
ShelraCode fully owns runtime lifecycle. `ManagedLlamaRuntime`
(`src/runtimes/managed-llama.ts:73-284`) allocates a free loopback port
(`:19-33`), spawns `llama-server` with `-m/--host/--port/--ctx-size/--jinja`
(`:138-148`), polls `GET /health` for up to 45 s (`:109-122`), and kills the
child on `dispose()` (`:250-270`). The binary is installed by
`installManagedRuntime` (`src/runtimes/bootstrap.ts:214-254`) from a **pinned**
llama.cpp release `b10826` with a pinned SHA-256 (`:50`, `:56-94`). **FACT.**

### Model loading
"Selected" genuinely means "loaded": `prepareModel(id)`
(`src/runtimes/managed-llama.ts:246-248`) → `ensureServer(signal, id)`
(`:124-184`) stops any wrong-model child (`:133`), spawns a new one with the
GGUF path, and returns only after `/health` is green. **FACT.** The failure
mode is the 45 s ceiling (`:17`) with no early exit when the child dies.

### Readiness
There is a **formal readiness gate**: `probeLocalModel`
(`src/startup/orchestrator.ts:27-48`) issues a real `generateText` call
("Reply with the single word READY") with a 15 s timeout and requires non-empty
text. `state: "ready"` is returned only past that probe (`:226-235`). **FACT.**
It does **not** verify tool-calling, streaming, or context configuration.

### Persistence
Only three keys survive a restart: `defaultModel`, `localRuntimeId`,
`lastLocalHealthCheck` in `~/.shelra/user-settings.json`
(`src/utils/settings.ts:176-194`, written at
`src/startup/orchestrator.ts:219-225`). **No hardware profile, no capability
cache, no onboarding-completed flag, no download state, no schema version.**
`localRuntimeId` and `lastLocalHealthCheck` are written but **never read
anywhere** (verified by grep). **FACT.**

### Chat gating
`App` is only mounted after `ready` (`src/index.ts:376-380`), so in the
local-first path chat genuinely opens behind the readiness gate. Inside `App`
the only send-time guard is `hasApiKeyRef.current`
(`src/ui/app.tsx:3424-3427`), which is `agent.hasApiKey()` → `!!this.provider`
(`src/agent/agent.ts:710-712`) — i.e. "a provider object exists", **not** "the
model is loaded". **FACT.**

---

## 3. Most complete existing subsystems (top 3)

1. **Hugging Face artifact download** — `src/models/huggingface.ts:123-185`.
   Range-resume, byte/speed/ETA progress, SHA-256 verify, corrupt-partial
   `unlink`, atomic `rename`, sidecar write. Genuinely production-shaped, and
   the only downloader in the repo that cleans up after itself.
2. **Managed llama.cpp lifecycle** — `src/runtimes/managed-llama.ts:73-284`.
   Free-port allocation, single-flight start lock (`:125`, `:178-183`), real
   `/health` polling, model-swap detection (`:130-133`), explicit `dispose`.
3. **Startup state machine + its UI contract** — `src/startup/types.ts:7-21`
   (14 named states) driving `src/ui/startup.tsx:104-250`. The state vocabulary
   already covers booting/detecting/validating/onboarding/downloading/loading/
   ready/error, and the screen renders a stage checklist, progress bar,
   hardware panel, recommendation panel and recovery actions.

## 4. Most important disconnected subsystems (top 3)

1. **`shelra setup` / `src/setup/onboarding.ts`** — a complete second onboarding
   implementation that is reachable (`src/index.ts:830-840`) but **cannot install
   a model**; it only prints diagnostics and writes `defaultModel`
   (`:122-132`). It duplicates ranking (`:76-83`) and its own model chooser
   ranks with `localModelFitScore(model)` using **no hardware argument** at
   all (`:105`), so it silently scores against `gpu: []`.
2. **`src/grok/client.ts`** — a full 351-line `GrokProviderAdapter` +
   `createProvider` that **no runtime code imports**. Only `src/grok/media.ts:5`
   takes a `type`-only import and `client.test.ts` exercises it. Backend-only,
   zero callers.
3. **Persisted local selection** — `localRuntimeId` and `lastLocalHealthCheck`
   are written (`src/startup/orchestrator.ts:221-223`, `src/index.ts:181-185`)
   and never read; `defaultModel` is read but only as a *soft* preference that
   the fit-score sort can override (`src/router/local-first.ts:39-50`).

## 5. Most important missing capabilities (top 3)

1. **GPU-accelerated inference.** No `--n-gpu-layers`, no `--threads`, no
   backend selection anywhere (`src/runtimes/managed-llama.ts:138-148`), and the
   pinned Windows/Linux assets are explicitly CPU builds
   (`src/runtimes/bootstrap.ts:65`, `:86`). The whole GPU-detection stack feeds
   only model *choice*.
2. **Memory-fit modelling beyond weights.** `estimateModelMemoryGb`
   (`src/hardware/profile.ts:154-168`) is `params × bits/8 × 1.12`. No KV
   cache, no context term, no OS/display reserve, no partial-offload term —
   yet `--ctx-size` is always the full 32 768 (`src/runtimes/managed-llama.ts:146`).
3. **Real OOM/stale-state recovery.** The only fallback is "try another
   *already-installed* model" (`src/startup/orchestrator.ts:154-190`). Nothing
   reduces context, reduces layers, picks a smaller quant, or downloads a
   smaller model. With one installed model — the normal case — the fallback is
   a no-op.

## 6. Most serious architectural duplication (top 3)

1. **Two model-selection systems**: `recommendBootstrapModel`
   (`src/models/recommendation.ts:17-70`, catalog-based, GPU-only) vs
   `localModelFitScore` + `selectLocalRoute`
   (`src/hardware/profile.ts:171-201` + `src/router/local-first.ts:21-59`,
   candidate-based, GPU-or-RAM). They use different formulas, different
   thresholds (`0.72` vs `0.82`/`0.65`), and neither knows about the other.
2. **Two onboarding surfaces**: the TUI branch in `src/index.ts:217-355` +
   `src/ui/startup.tsx` vs `src/setup/onboarding.ts:122-132`. Only the first can
   install.
3. **Two "is the managed runtime installed?" predicates**:
   `findManagedLlamaServer` recursively scans the whole
   `~/.shelra/runtime/llama-cpp` tree (`src/runtimes/bootstrap.ts:188-212`)
   while `installManagedRuntime` only checks `<root>/<release>/`
   (`:223-224`). On this machine they **disagree** — the first finds
   `manual/llama-server.exe`, the second sees nothing and would re-download.

## 7. Highest-risk current bugs / blockers

| # | Severity | Evidence |
| --- | --- | --- |
| B1 | **Blocker** | Agent cannot create a file in any non-existent directory. `resolveWorkspacePath` calls `realpathSync.native(dirname(candidate))` on a path that does not exist yet → `ENOENT`, before `writeFile`'s own `mkdirSync` can run. `src/security/workspace-guard.ts:22-24`; `src/tools/file.ts:23-25,70`. **Empirically reproduced** (see `21-VALIDATION-RESULTS.md`). |
| B2 | **Blocker** | Managed-runtime install is a permanent failure loop: SHA/extract failure throws without deleting the `.part` archive or the staging dir, so every retry resumes the same bytes. `src/runtimes/bootstrap.ts:236-253`. **Field evidence:** a complete, hash-*correct* `.part` and an empty `b10826.staging/` sit in `~/.shelra/runtime/llama-cpp/`. |
| B3 | **High** | `TypeError` + 45 s hang when `llama-server` exits during startup. The `exit` handler sets `this.child = undefined` (`src/runtimes/managed-llama.ts:157-161`); `:169` then calls `this.child.kill()`. `waitForHealth` (`:109-122`) never checks liveness, so it burns the full `SERVER_START_TIMEOUT_MS` (`:17`). |
| B4 | **High** | Multi-model selection is silently overridden. `runStartup` calls `runtime.health()` *after* `prepareModel(model.id)` (`src/startup/orchestrator.ts:120,129`); `health()` calls `ensureServer(signal)` with **no model id** (`src/runtimes/managed-llama.ts:198`), which selects `installedModels[0]` (`:128`) and restarts the server on the wrong model. |
| B5 | **High** | Orphaned `llama-server` children. `initializeLocal` overwrites `startupDiscovery = result.discovery` (`src/index.ts:373`) without disposing the previous discovery; only the last one is disposed at exit (`:115`). `installRecommended` re-runs it up to 4× (`:261-266`). |
| B6 | **High** | Compaction can never satisfy a 32 K local window: trigger is `used > 32768 − reserve(16384)` = 16 384 tokens, but `keepRecentTokens` is 20 000. `src/agent/compaction.ts:30-32,247-253`; `src/agent/agent.ts:1584-1589`. |
| B5b | **High** | Windows `child.kill()` can return without killing the native `llama-server`. **Being addressed concurrently** — `stopChild` now force-kills via `taskkill /T /F` (win32) or `SIGKILL` (unix) after a 2 s grace period (`src/runtimes/managed-llama.ts:256-288`, added during this audit). This mitigates the *dispose* path only; the three orphan paths in B5 (crash, SIGTERM, re-discovery overwrite) are unaffected because `dispose()` is never reached in them. |
| B7 | **Medium** | Discovery/`shelra models` spawns a real `llama-server` and loads the GGUF into RAM just to list names — `detect()` (`src/runtimes/managed-llama.ts:186-192`) and `health()` (`:194-206`) both call `ensureServer`. **Measured:** 2.8–5.4 s per `shelra models` run, with a live `llama-server` PID observed during the run. |
| B8 | **Medium** | A corrupt `<model>.gguf.json` sidecar silently downgrades a catalogued model to `local:<filename>` with `parameters: 0`, `quantization: "unknown"` (`src/models/huggingface.ts:206-233`) — **currently happening on this machine**; `~/.shelra/user-settings.json` holds `"defaultModel": "local:qwen2.5-coder-1.5b-instruct-q4_k_m.gguf"`. |
| B9 | **Medium** | `--remote` without `SHELRA_BASE_URL` wires no provider at all (`getBaseURL()` returns `""`, `src/utils/settings.ts:345-347`) and still runs a 750 ms local discovery it never uses (`src/index.ts:459-482`), ending in a misleading `"No model runtime configured"` (`src/agent/agent.ts:2341-2349`) or an unsatisfiable API-key modal (`src/ui/app.tsx:1805-1825`). |
| B10 | **Medium** | Model-picker errors are invisible: the `Enter` handler closes the modal in `.then()` regardless of `{success:false}` (`src/ui/app.tsx:2997-3005`), and the error is only rendered *inside* the now-closed modal (`:3720-3721`). |
| B11 | **Medium** | `compileContextPacket` runs a synchronous recursive `readdirSync`/`statSync` walk (up to 256 files) plus up to 3 `readFileSync` on the render thread for every non-conversation turn (`src/agent/agent.ts:1924`; `src/context/compiler.ts:52-93,113-164`). `walk()` follows symlinks with no visited-set or depth cap → stack overflow on a directory-symlink cycle. |
| B12 | **Low (CI)** | `bun run lint` **and** `bun run format` both exit 1, so the CI job in `.github/workflows/typecheck.yml` fails at its second step. 158 errors / 12 warnings; 146 are CRLF formatting, 4 are the genuinely dead `toToolCall`/`getStepNumber`/`getFinishReason`/`getUsage` in `src/agent/agent.ts:2706,2729,2737,2753`. |

> **Line-number note — read before acting on any citation.** The working tree
> was edited by another agent *during* this audit, including a substantial
> in-progress CUDA/GPU implementation in `src/runtimes/bootstrap.ts` and
> `src/runtimes/managed-llama.ts`. **Every finding above was re-verified as
> still present at audit close**, but the line numbers in
> `src/runtimes/bootstrap.ts`, `src/runtimes/managed-llama.ts` and
> `src/startup/orchestrator.ts` have moved. Documents `00`–`20` cite the
> audit-baseline numbering; **`21-VALIDATION-RESULTS.md` §5b carries a complete
> baseline→current mapping table plus the recorded file hashes.** All other
> audited files are unchanged.

## 8. Can the existing architecture be evolved without a rewrite?

### **YES.**

The seams that matter are already correct and already in the right places:

* a provider-neutral `ProviderAdapter` contract (`src/providers/types.ts:76-86`)
  that the UI and agent consume without touching any SDK — enforced by a real
  test (`src/providers/architecture.test.ts`);
* a runtime-neutral `LocalRuntimeAdapter` contract
  (`src/runtimes/types.ts:35-61`) with `detect/health/listModels/prepareModel/
  installModel/dispose/provider`;
* a single startup state machine with a typed progress event
  (`src/startup/types.ts`) and one UI that renders it;
* a real readiness probe that gates chat mounting.

Roughly **70 % of the intended architecture exists**. The defects are
*implementation* defects inside correct boundaries (cleanup on failure, an
unreachable `else`, a missing `-ngl` argument, a wrong argument to `health()`),
plus **two duplicate systems that should be collapsed into the existing seams**
(the second onboarding surface and the second scoring function). Nothing here
argues for replacing the boundaries.

The one subsystem that is *conceptually* under-built rather than buggy is
**memory estimation** (`src/hardware/profile.ts:154-168`) — it needs a real
model, not a patch.

## 9. Recommended implementation strategy (short)

1. **Stop the bleeding first** (no new architecture): fix B1, B2, B3, B4, B5 —
   five small, individually testable changes inside existing files.
2. **Make discovery cheap**: split "is a runtime present / what models exist"
   from "start a server" so `detect`/`listModels`/`shelra models` never spawn
   `llama-server` (B7). This is a prerequisite for a fast startup screen.
3. **Collapse the duplicates**: make `localModelFitScore` the single scorer and
   have `recommendBootstrapModel` score *catalog* entries with the same
   function; reduce `src/setup/onboarding.ts` to a non-interactive
   `--doctor`-style printer over `runStartup({healthCheck:false})`.
4. **Then, and only then, add the missing capability**: a real memory model
   (weights + KV + context + reserve), GPU-build selection in
   `resolveRuntimeInstallPlan`, and an `-ngl`/`--threads` policy derived from it.
5. **Persist what was learned** (hardware profile, capability probe result,
   schema version) so second launch can skip work instead of redoing it.

Phase-by-phase detail is in `19-IMPLEMENTATION-PHASES.md`.
</content>
</invoke>
