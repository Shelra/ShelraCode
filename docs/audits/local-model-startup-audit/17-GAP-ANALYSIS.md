# 17 — Gap analysis: desired UX vs current implementation

Status vocabulary: **IMPLEMENTED** (end-to-end trace exists) / **PARTIAL** /
**DISCONNECTED** (code exists, not reachable from the flow) / **BROKEN** /
**PLACEHOLDER** / **NOT FOUND** / **UNKNOWN**.

*No row is marked IMPLEMENTED without an end-to-end trace in this audit.*

## 1. Desired-UX-vs-current matrix

| # | Requirement | Current implementation | Evidence (`path:line`) | Status | Gap |
| --- | --- | --- | --- | --- | --- |
| 1 | **Immediate startup UI** | `StartupScreen` painted before any model work; 14-state progress vocabulary; the whole model pipeline is fire-and-forget after the first frame | `src/index.ts:416,417`; `src/ui/startup.tsx:104-250`; `src/startup/types.ts:7-21` | **IMPLEMENTED** | The workspace-trust `readline` prompt and the SQLite/transcript load both run **before** the renderer exists (`src/index.ts:815,86` → `src/agent/agent.ts:637-646`); every progress frame unmounts/remounts the React tree (`src/index.ts:123-130`) |
| 2 | **Local model discovery** | `discoverLocalRuntimes` → `ManagedLlamaRuntime.listModels` → `discoverInstalledHuggingFaceModels` (GGUF scan of `~/.shelra/models`) | `src/runtimes/discovery.ts:87-113`; `src/runtimes/managed-llama.ts:208-211`; `src/models/huggingface.ts:193-237` | **IMPLEMENTED** (with defects) | Non-recursive; no GGUF integrity check; corrupt sidecar silently degrades the model (`:206-233` — **observed live**); discovery **spawns a server and loads weights** (`managed-llama.ts:190,198`) |
| 3 | **Automatic existing-model selection** | `selectLocalRoute` filters + ranks; `runStartup` prepares, health-checks, probes, persists, mounts chat | `src/router/local-first.ts:21-59`; `src/startup/orchestrator.ts:93-235`; `src/index.ts:376-380` | **IMPLEMENTED** for 1 model; **BROKEN** for ≥2 | With ≥2 GGUFs, `runStartup:129`'s `health()` re-enters `ensureServer` **without a model id** and reloads `installedModels[0]` (`managed-llama.ts:198,128,130-133`), so the served model ≠ the selected model, and the probe still passes |
| 4 | **GPU-aware selection** | GPU VRAM is the dominant scoring term (+38/−60 swing) and the sole bootstrap signal | `src/hardware/profile.ts:181-198`; `src/models/recommendation.ts:33-44` | **PARTIAL** | GPU is known only for **NVIDIA** (`profile.ts:107-110`); Apple Silicon and all AMD/Intel report **no VRAM** (`:75-83,85-103`) and are treated as CPU-only. Three of four `selectLocalRoute` call sites pass the GPU-blind `inspectHardware()` (`index.ts:464`; `onboarding.ts:105`; `profile.ts:171` default) |
| 5 | **Hardware scan** | `detectHardware()` — CPU, RAM total/free, storage, GPU via `nvidia-smi`/`system_profiler`/`rocm-smi` | `src/hardware/profile.ts:144-152,105-130` | **PARTIAL** | No AMD-on-Windows, no Intel, no Vulkan/OpenCL/DirectML; `accelerationBackends` written and never read (`:14` vs grep); `cpuCores`/`cpuModel` never used for a decision; storage measured on `cwd`, not the model volume (`:137`); **zero tests** for any detector |
| 6 | **Model recommendation** | `recommendBootstrapModel` over a 2-entry catalog | `src/models/recommendation.ts:17-70`; `src/models/huggingface.ts:43-70` | **PARTIAL** | 3 inputs → **2 possible outputs**; the RAM/CPU/storage branch at `:44` is **unreachable dead code**; `alternatives` computed and never rendered; no benchmark, licence, or quant dimension |
| 7 | **Guided onboarding** | `state:"onboarding"` → recommendation panel → `[Enter]` → engine install → model download → re-discover → prepare → probe → chat | `src/startup/orchestrator.ts:99-108`; `src/ui/startup.tsx:195-227`; `src/index.ts:217-355` | **IMPLEMENTED** but currently **BROKEN in the field** | The engine-install step dead-ends on a poisoned `.part` (`src/runtimes/bootstrap.ts:236-253`); no model choice; no cancel; up to 4 orphaned `llama-server` children per attempt (`src/index.ts:261-266,373`) |
| 8 | **Model download** | Range-resume, progress, SHA-256, atomic `rename`, sidecar; catalog allowlist | `src/models/huggingface.ts:123-185`; `src/runtimes/managed-llama.ts:224-231` | **IMPLEMENTED** | No already-installed check → full re-download (`:132`); disk gate uses the wrong volume and conflates memory with bytes (`src/models/manager.ts:42-45`; `src/index.ts:326`) |
| 9 | **Download progress** | Bytes / total / speed / ETA / percent, 250 ms UI throttle, 20-cell bar | `src/models/huggingface.ts:156-162`; `src/index.ts:287-327`; `src/ui/startup.tsx:83-102` | **IMPLEMENTED** | Runtime download and model download use two different throttles; **no progress at all during `loading-model`** |
| 10 | **Resume** | `Range: bytes=N-`, append-vs-truncate, 206 handling | `src/models/huggingface.ts:132-146`; `src/runtimes/bootstrap.ts:121-135` | **IMPLEMENTED** (model) / **BROKEN** (runtime) | The runtime resume resumes a *poisoned* partial forever (416 → treated as complete → same bad hash), because `:237` throws without `unlink` |
| 11 | **Runtime preparation** | Pinned llama.cpp release, SHA-256, extract, locate `llama-server`; spawn on a free loopback port; wait for `/health` | `src/runtimes/bootstrap.ts:50,214-254`; `src/runtimes/managed-llama.ts:19-33,124-184` | **PARTIAL** | No failure cleanup (R1/R2); two disagreeing "installed?" predicates (`:207-212` vs `:223`); macOS arm64 and x64 share one `sha256` (`:80`) — one of them must fail; **no GPU build** for win/linux (`:65,86`) |
| 12 | **Model load** | `prepareModel(id)` → `ensureServer(signal,id)` → real `llama-server` with `-m <path>` | `src/runtimes/managed-llama.ts:246-248,124-184` | **IMPLEMENTED** | 45 s ceiling with **no child-liveness check** (`:109-122`); `this.child.kill()` **TypeError** when the child dies mid-wait (`:169`); `stdio:"ignore"` discards every diagnostic (`:152`); `--ctx-size` always 32 768 regardless of memory (`:146`) |
| 13 | **Readiness check** | `probeLocalModel` — a real `generateText` ("READY", 15 s, non-empty required) gating `state:"ready"` | `src/startup/orchestrator.ts:27-48,147-235` | **IMPLEMENTED** | Certifies *text generation only*: not tools, not streaming, not the context setting, not that the **selected** model is loaded. Result is never cached (`lastLocalHealthCheck` is write-only) |
| 14 | **Chat gated by readiness** | `App` mounts only from the `ready` branch | `src/index.ts:376-380,192-215` | **PARTIAL** | Correct at mount; **never re-checked** afterwards. In-chat gating is `!!agent.provider` only (`src/ui/app.tsx:3424`; `src/agent/agent.ts:710-712`); the composer is never disabled; a dead local server can open the **API-key modal** (`src/ui/app.tsx:2161-2165`) |
| 15 | **Persistence** | `defaultModel`, `localRuntimeId`, `lastLocalHealthCheck` in `~/.shelra/user-settings.json` | `src/utils/settings.ts:176-194`; `src/startup/orchestrator.ts:219-225` | **PARTIAL / DISCONNECTED** | Two of three keys are **never read**; `defaultModel` is only a tiebreak that the fit-score sort can override (`src/router/local-first.ts:39-50`); no hardware cache, no probe cache, no onboarding flag, no schema version → second launch repeats **all** of first launch except downloads |
| 16 | **Missing-model recovery** | Re-discovery on every launch; `[r] Scan again` | `src/startup/orchestrator.ts:60-236`; `src/index.ts:157,411` | **PARTIAL** | Silently substitutes another model; the explanation exists in `route.reasons` (`src/router/local-first.ts:42`) and is **never displayed**. No corrupt-file detection, no repair action, no re-download offer |
| 17 | **OOM recovery** | Regex on the probe error → pick a smaller **already-installed** model → re-probe | `src/startup/orchestrator.ts:154-190` | **PLACEHOLDER** | No-op on a 1-model machine (the normal case); cannot reduce context, layers, or quant, and cannot download a smaller model; a real OOM kills the child during `waitForHealth` and hits the `TypeError` at `managed-llama.ts:169` **before** any probe |
| 18 | **CPU fallback** | CPU is the *only* mode on Windows and Linux | `src/runtimes/bootstrap.ts:65,86`; `src/runtimes/managed-llama.ts:138-148` | **IMPLEMENTED by default, UNTUNED** | No `--threads`, no ISA check, no throughput gate; `cpuCores` detected and unused; the only concession is `maxOutputTokensForTurn`'s 512/256/2048 clamp (`src/agent/agent.ts:389-398`) |
| 19 | **Multi-model selection** | Fit-score ranking; in-chat picker with real prepare+probe | `src/router/local-first.ts:45-50`; `src/index.ts:168-190`; `src/ui/app.tsx:2997-3005` | **BROKEN** | `runStartup:129` reloads `installedModels[0]` (row 3); the picker closes on failure and the error is rendered inside the closed modal (`src/ui/app.tsx:2997-3005,3720-3721`); startup never asks the user |

## 2. End-to-end scenario traces

### A. Existing model → detected → selected → loaded → chat ready

**Verdict: EXISTS TODAY (for exactly one installed model).**

```
src/index.ts:1009      program.parse()
src/index.ts:816       startInteractive(...)
src/index.ts:86        new Agent(undefined, undefined, "local:qwen…gguf", …)
                       └─ agent.ts:614 getCurrentModel() ← ~/.shelra/user-settings.json
src/index.ts:416       renderStartup({state:"booting"})                      [FIRST FRAME]
src/index.ts:417       initializeLocal()
src/index.ts:368       runStartup({requestedModel:"local:qwen…gguf"})
orchestrator.ts:73     discoverLocalRuntimes(…, 60 s)
  discovery.ts:78        new ManagedLlamaRuntime()
  discovery.ts:93-97     Promise.all([detect, health, listModels])
    managed-llama.ts:187   hasBinary() → findManagedLlamaServer → manual/llama-server.exe  ✔
    managed-llama.ts:190   ensureServer()  ← SPAWNS llama-server with installedModels[0]
    managed-llama.ts:209   listModels → discoverInstalledHuggingFaceModels
      huggingface.ts:208-220 sidecar JSON.parse FAILS (corrupt)  ← observed
      huggingface.ts:221-233 fallback id "local:qwen…gguf", parameters 0
orchestrator.ts:75     detectHardware() → nvidia-smi/rocm-smi
orchestrator.ts:93     selectLocalRoute([1 model], {preferredModel, requiresTools, hardware})
  local-first.ts:24-37   passes (tools:true asserted)
  local-first.ts:45-50   sort → the sole candidate
orchestrator.ts:120    prepareModel("local:qwen…gguf") → ensureServer(signal, id)  (already correct → waitForHealth)
orchestrator.ts:129    health() → ensureServer(signal)  ← 1 model ⇒ same file ⇒ no reload  ✔
orchestrator.ts:143    provider(model) → LocalProviderAdapter @ http://127.0.0.1:<port>/v1
orchestrator.ts:153    probeLocalModel → generateText "READY"                 [READINESS GATE]
orchestrator.ts:219    saveUserSettings({defaultModel, localRuntimeId, lastLocalHealthCheck})
orchestrator.ts:226    emit "ready"
src/index.ts:377       agent.setProvider(provider, model.id)
src/index.ts:378       renderApp(discovery.models) → App mounts               [CHAT]
```

Empirically corroborated: `shelra models` completes the discovery+spawn half of
this trace in **2.8–5.4 s** on this machine, printing the real (degraded) model
id.

### B. No local model → onboarding → hardware → recommendation → download → load → chat

**Verdict: PARTIAL — the code path is complete; it currently fails at the
engine-install step on this machine.**

```
orchestrator.ts:93     selectLocalRoute([]) → {kind:"unavailable"}
orchestrator.ts:100    recommendBootstrapModel(hardware)
  recommendation.ts:33   gpuMemory = Σ VRAM
  recommendation.ts:34   if 0 → 1.5B     |  :45 <5 → 1.5B  |  :54/:63 → 7B
orchestrator.ts:101    emit "onboarding"
src/index.ts:381-390   renderStartup(onboarding, discovery, recommendation)
ui/startup.tsx:195-227 RECOMMENDED FOR YOU + [Enter] Install recommended
startup-input.ts:31    "install"
src/index.ts:217       installRecommended()
src/index.ts:222-226   hasRuntimeBinary()? → false on a clean machine
src/index.ts:233       installManagedRuntime({onProgress})
  bootstrap.ts:219       resolveRuntimeInstallPlan()  ← undefined on win-arm64 / linux-arm64
  bootstrap.ts:234       downloadArchive → .part with Range resume
  bootstrap.ts:236-237   sha256 check
  bootstrap.ts:242-246   rename → extract → findExecutable → rename to <release>/
                         ✘ FAILS HERE ON THIS MACHINE: b10826.staging/ is EMPTY,
                           .part survives with a MATCHING hash, no b10826/ exists
  bootstrap.ts:251-253   catch → {success:false}   ← NO CLEANUP  ⇒ every retry repeats
src/index.ts:250-257   renderStartup("recoverable-error")            [DEAD END]
   … (had it succeeded) …
src/index.ts:261-266   up to 4 × initializeLocal()                   ← orphan leak
src/index.ts:276-278   recursive installRecommended() → model branch
src/index.ts:288       installLocalModel(...)
  manager.ts:42-45       disk gate (wrong volume, wrong unit)
  managed-llama.ts:224   getHuggingFaceModelSpec  ← allowlist
  huggingface.ts:123-185 download + verify + finalize + sidecar
src/index.ts:342       initializeLocal() → scenario A → chat
```

### C. Configured model missing

**Verdict: PARTIAL — recovers silently, never explains.**

```
agent.ts:614            modelId = "hf:Qwen/…7B…"   (from settings)
orchestrator.ts:73      discovery → the file is gone ⇒ not in discovery.models
orchestrator.ts:93      selectLocalRoute({preferredModel:"hf:…7B…"})
  local-first.ts:39-42    no match ⇒ reasons.push("hf:…7B…: preferred local model is unavailable")
  local-first.ts:45-50    ranks whatever remains
  → if another model exists: it is chosen SILENTLY (reasons[] never rendered)
  → if none:                 orchestrator.ts:99-108 → "onboarding"
```
No message, no "your model is missing", no offer to re-download the exact model.
The **only** surface that would print `route.reasons` is `shelra setup`
(`src/setup/onboarding.ts:91`).

### D. Model does not fit GPU memory

**Verdict: NOT FOUND (as posed) — the scenario cannot occur.**

There is **no GPU offload**: no `--n-gpu-layers` is ever passed
(`src/runtimes/managed-llama.ts:138-148`) and the pinned Windows/Linux assets
are CPU builds (`src/runtimes/bootstrap.ts:65,86`). Weights are therefore never
allocated in VRAM, so a GPU OOM cannot happen.

What *can* happen is host-RAM exhaustion:

```
localModelFitScore:188  score -= 60 (memory > usableGpu*1.4) — but a lone candidate still wins
                        (local-first.ts:51 takes eligible[0] regardless of score)
managed-llama.ts:150    spawn llama-server
managed-llama.ts:167    waitForHealth — child dies loading weights
managed-llama.ts:159    exit handler sets this.child = undefined
managed-llama.ts:169    this.child.kill()  →  TypeError            [CRASH, not a fallback]
   → rejects ensureServer → prepareModel → orchestrator.ts:120-128 → "recoverable-error"
   → the OOM fallback at orchestrator.ts:154-190 IS NEVER REACHED (it is downstream of the probe)
```

### E. CPU-only system

**Verdict: EXISTS TODAY — and is the default on Windows/Linux.**

```
profile.ts:107          nvidia-smi throws (absent)
profile.ts:117-129      darwin? system_profiler : rocm-smi → [] on a plain CPU box
recommendation.ts:33    gpuMemory = 0
recommendation.ts:34-43 → HUGGING_FACE_MODELS[0]  (1.5B Q4_K_M)
profile.ts:189-193      RAM branch of the fit score
bootstrap.ts:65/86      CPU-only llama.cpp asset
managed-llama.ts:138-148 no --threads, no -ngl
agent.ts:389-398        maxOutputTokensForTurn clamps managed-llama turns to 512/256/2048
```
Untested, untuned, and un-benchmarked, but functional.

### F. Multiple installed models

**Verdict: BROKEN.**

```
huggingface.ts:204      readdir → ["a-model.gguf", "b-model.gguf"]  (readdir order)
managed-llama.ts:190    detect → ensureServer()  ⇒ loads installedModels[0] = a-model
orchestrator.ts:93      selectLocalRoute ranks → b-model wins on fit score
orchestrator.ts:120     prepareModel("b-model") ⇒ stopChild + respawn with b-model    ✔
orchestrator.ts:129     health() → ensureServer(signal)          ← NO MODEL ID
managed-llama.ts:128      selected = find(id === undefined) ?? installedModels[0] = a-model
managed-llama.ts:130-133  activeModelPath (b) !== selected.path (a) ⇒ stopChild + respawn with A  ✘
orchestrator.ts:143     provider(b-model) → new port, but the server is serving A
orchestrator.ts:153     probe passes (llama-server serves the loaded model regardless of the id)
orchestrator.ts:226     "ready", model = b-model                  ← THE UI, SETTINGS AND AGENT ALL LIE
```

The in-chat picker path (`src/index.ts:168-190`) is correct — it skips
`health()` — but its failure reporting is broken (`src/ui/app.tsx:2997-3005`).

## 3. Docs vs code — recorded disagreements

| Claim | Source | Reality |
| --- | --- | --- |
| "scores the catalog using GPU/VRAM first, **then RAM/CPU/storage and context headroom**" | `docs/migration/11-STARTUP-ONBOARDING.md:16-19` | **False.** The RAM branch is unreachable (`recommendation.ts:34-44`); CPU and storage are never inputs |
| "a startup lock that prevents parallel discovery calls from spawning duplicate servers" | `docs/migration/11:28-30` | **True per adapter instance only.** Each `discoverLocalRuntimes` builds a new instance (`discovery.ts:78`), so re-discovery still leaks (`src/index.ts:373`) |
| "A missing, moved, corrupt or incompatible saved artifact triggers rediscovery **and recovery**" | `docs/migration/11:42-43` | **Half true.** Rediscovery yes; "recovery" is a silent substitution with no message and no repair |
| "A memory/load failure can move to a smaller ranked candidate" | `docs/migration/11:43-44` | **Only if a smaller model is already installed**, and a real OOM crashes before the fallback is reached |
| "`--remote` … is not contacted by normal local-first startup" | `docs/migration/11:45-46` | True — but the converse fails: `--remote` **does** run local discovery it never uses (`src/index.ts:459-482`) |
| "Discovers local models, scores them against your hardware, and keeps inference on the machine by default" | `README.md:190` | True, except "scores against your hardware" excludes the GPU on non-NVIDIA machines and never affects execution |
| lint "reports 157 errors and 12 warnings" | `docs/migration/10:...` | **158 errors / 12 warnings** measured; `bun run format` also fails (not mentioned) |
| "66 test files / 268 tests" | `docs/migration/10:...` | **66 files / 273 tests** measured |
| "Grok CLI … `GROK_API_KEY` … broken ESLint config … `src/utils/model-config.ts`" | `AGENTS.md` | **Entirely stale** — Biome, `SHELRA_API_KEY`, and neither named file exists |

## 4. Security & privacy — what actually leaves the machine

"Local-first" is not "offline". This section reports **real behaviour** with
citations, not the product's claims.

### 4a. Outbound network calls in the startup / onboarding / discovery path

| Destination | Trigger | Payload sent | Evidence |
| --- | --- | --- | --- |
| `https://huggingface.co/<repo>/resolve/<rev>/<file>?download=true` | Only when the user presses `[Enter] Install recommended` and a model download begins | A plain `GET`, plus `Range: bytes=N-` when resuming. **No auth header, no telemetry, no query parameters beyond `?download=true`.** | `src/models/huggingface.ts:79-83,133-137` |
| `https://github.com/ggml-org/llama.cpp/releases/download/b10826/<asset>` | Only when the engine is being installed | A plain `GET` (+ `Range` on resume) | `src/runtimes/bootstrap.ts:65,76,86,123` |
| `https://api.github.com/repos/superagent-ai/grok-cli/releases/latest` | **On every chat mount**, automatically | A plain `GET` with a 5 s timeout | `src/utils/install-manager.ts:11-14,168-171`; `src/utils/update-checker.ts:16-29`; invoked from `src/ui/app.tsx:1863-1873` |
| `http://127.0.0.1:<ephemeral>/health` and `/v1/*` | Continuously during startup and chat | Prompts and model output | `src/runtimes/managed-llama.ts:114`; `src/runtimes/local-provider.ts:52-58` — **loopback only** |
| `{SHELRA_LOCAL_ENDPOINT}` / `{OPENAI_BASE_URL}` `/models` | Only when that env var is set | A plain `GET` | `src/runtimes/discovery.ts:15,23,39,82-83` |

### 4b. Findings

**FACT — no telemetry, no analytics, no machine identifier, no hardware upload.**
Exhaustive grep across `src/` for `telemetry`, `analytics`, `posthog`,
`segment`, `sentry`, `amplitude`, `mixpanel`, `machineId`, `deviceId`,
`installId`: the **only** hits anywhere in `src/` are four lines in
`src/mcp/catalog.ts:58-61` describing a *Sentry MCP server* the user may
optionally add — a directory entry, not instrumentation. **Zero hits in the
startup, discovery, hardware, model or runtime code.** The
hardware profile (`src/hardware/profile.ts`) is never serialised to a network
call — it is only used in-process and rendered.

**FACT — no credentials leave the machine during local-first startup.**
`startInteractive` deliberately constructs the `Agent` with
`preferLocal ? undefined : apiKey` (`src/index.ts:86`), with the comment
*"Local-first is also a privacy boundary: do not even initialize a remote
adapter in the normal startup path when credentials happen to exist."* This is
a real, enforced boundary.

**FACT — no vendor-app probing.** ShelraCode never scans for Ollama, LM Studio
or any other local service; the only non-managed endpoint is opt-in via
`SHELRA_LOCAL_ENDPOINT`/`OPENAI_BASE_URL` (`src/runtimes/discovery.ts:82-83`).

**FACT — three things nevertheless deserve attention:**

1. **An unannounced GitHub call on every chat mount.** `checkForUpdate` runs
   automatically in a `useEffect` (`src/ui/app.tsx:1863-1873`) with no opt-out
   setting anywhere in `UserSettings` (`src/utils/settings.ts:176-194`). The
   startup screen the user just passed through reads *"No account, API key, or
   remote provider is required"* and *"PRIVATE BY DEFAULT"*
   (`src/ui/startup.tsx:158,245`). GitHub sees the client's IP and User-Agent on
   every launch. No user data is sent, but the call is undisclosed.
2. **The update check still points at the old repository** —
   `superagent-ai/grok-cli` (`src/utils/install-manager.ts:11`), with
   `SHELRA_RELEASE_REPO` defined as an alias for it (`:13`).
3. **The full parent environment is handed to `llama-server`.**
   `src/runtimes/managed-llama.ts:153-155` forwards every defined `process.env`
   entry to the child, including `SHELRA_API_KEY`/`GROK_API_KEY` and any other
   secrets in the shell. A local third-party binary receives credentials it has
   no use for. Low severity (the binary is hash-pinned) but unnecessary.

**FACT — supply-chain controls are genuinely good:**
* The engine is a **pinned** upstream release with a **pinned SHA-256**
  (`src/runtimes/bootstrap.ts:50,69,80,90`), with an explicit comment that
  bumping it must be deliberate.
* Models are restricted to a reviewed allowlist; anything else is refused
  (`src/runtimes/managed-llama.ts:224-225`).
* Model artifacts are SHA-256 verified and the partial is deleted on mismatch
  (`src/models/huggingface.ts:169-175`).
* An escape hatch exists to disable runtime installation entirely:
  `SHELRA_DISABLE_RUNTIME_INSTALL=1` (`src/runtimes/bootstrap.ts:216-218`).

**FACT — one gap:** extraction has **no zip-slip / path-traversal guard**
(`src/runtimes/bootstrap.ts:170-186` shells out to `Expand-Archive` or `tar`
and only checks afterwards that `llama-server` exists). Today this is fully
mitigated by the mandatory hash check at `:237`, which runs *before*
extraction — but the two protections are coupled, and relaxing the hash pin
would silently remove the traversal protection too.

### 4c. Verdict

| Question | Answer |
| --- | --- |
| Does startup send anything externally? | **No** — until the user opts into a download. Discovery, hardware scan, ranking, load and the readiness probe are entirely local/loopback. |
| Does onboarding? | **Yes, by design and with consent** — Hugging Face (model) and GitHub Releases (engine), both hash-verified. |
| Does chat? | **Yes, once, undisclosed** — a GitHub Releases API call on mount. |
| Telemetry / analytics / machine ids? | **None found.** |
| Hardware data uploaded? | **No.** |
| API keys transmitted? | **Not by the local path.** They are, however, passed into the `llama-server` child's environment. |

## 5. Summary scoreboard

| Status | Rows |
| --- | --- |
| **IMPLEMENTED** | 1 (startup UI), 2 (discovery), 8 (model download), 9 (progress), 13 (readiness check), 18 (CPU by default) — **6** |
| **PARTIAL** | 4 (GPU-aware), 5 (hardware), 6 (recommendation), 11 (runtime prep), 12 (model load), 14 (chat gating), 15 (persistence), 16 (missing-model recovery) — **8** |
| **BROKEN** | 3 (auto-selection, ≥2 models), 7 (onboarding, in the field), 10 (runtime resume), 19 (multi-model) — **4** |
| **PLACEHOLDER** | 17 (OOM recovery) — **1** |
| **NOT FOUND** | — (row 4's GPU-for-execution and row 17's degradation ladder are the substantive absences, captured as PARTIAL/PLACEHOLDER above) |
</content>
</invoke>
