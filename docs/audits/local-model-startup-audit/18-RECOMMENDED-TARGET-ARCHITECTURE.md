# 18 — Recommended target architecture

**Premise established by this audit:** roughly **70 %** of the intended
architecture already exists, and the boundaries are in the right places. The
recommendation is therefore **evolution and consolidation**, not replacement.

## 1. What is architecturally sound — preserve as-is

| Asset | Why it should survive |
| --- | --- |
| **`ProviderAdapter`** (`src/providers/types.ts:76-86`) | SDK-free, opaque messages/tools, normalised event union. Guarded by a real test (`src/providers/architecture.test.ts`). This is the seam that makes local-first possible. |
| **`LocalRuntimeAdapter`** (`src/runtimes/types.ts:35-61`) | `detect/health/listModels/prepareModel/installModel/dispose/provider` is the correct decomposition. A second runtime family (Ollama, MLX) can be added without touching the orchestrator. |
| **`StartupState` + `StartupProgress`** (`src/startup/types.ts:7-35`) | 14 states already cover the entire desired flow. The UI contract is a plain data object — testable, serialisable, transport-agnostic. |
| **`runStartup` as a single state machine** (`src/startup/orchestrator.ts:60-236`) | One place decides ready-vs-onboarding-vs-error. Injectable `discovery`/`hardware`/`healthCheck`/`persistSelection`. |
| **The readiness probe** (`:27-48`) | A real generation call gating chat is the right idea and is rare in this class of tool. |
| **`downloadHuggingFaceModel`** (`src/models/huggingface.ts:123-185`) | Resume + progress + hash + atomic finalize + cleanup-on-corruption. This is the reference implementation the runtime downloader should copy. |
| **The catalog-as-allowlist** (`:74-77` + `managed-llama.ts:224-225`) | A genuine supply-chain control. Keep the "only reviewed ids are installable" property. |
| **Pinned release + pinned SHA-256** (`src/runtimes/bootstrap.ts:50,69,80,90`) | Fail-closed on upstream drift. Keep. |
| **Host-side context compiler** (`src/context/compiler.ts`) | Doing retrieval on the host and asking a small model once is exactly the right strategy for weak local models. |
| **`maxOutputTokensForTurn`** (`src/agent/agent.ts:389-398`) | The one real small-model policy. Keep the idea; change the key (see §4). |
| **Single OpenTUI renderer, startup→chat as one root** (`src/index.ts:98-130`) | The chat experience is preserved; onboarding is not a separate app. |

## 2. What is duplicated — consolidate

| Duplication | Target |
| --- | --- |
| Two scorers (`recommendBootstrapModel` vs `localModelFitScore`) | **One `scoreModelFit(spec, hardware)`** over a common shape. `recommendBootstrapModel` becomes "score the catalog"; `selectLocalRoute` stays "score the installed set". Same constants, one place. |
| Two onboarding paths | **One.** `shelra setup` becomes a printer over `runStartup({healthCheck:false, persistSelection:false})` — it gains correctness and loses its `dispose` leak for free. |
| Three "runtime installed?" predicates (`hasBinary`, `hasInstalledBinary`, `hasRuntimeBinary`, plus `installManagedRuntime`'s `existing`) | **One `resolveInstalledRuntime(): {path, release} \| undefined`** that is version-aware, so a release bump actually adopts the new binary. |
| Four writers of `defaultModel` + duplicate `setModel` calls | **One `commitModelSelection(model, runtime)`** used by startup, the picker, and setup. |
| Two hardware profiles used interchangeably | **One `HardwareProfile`**, resolved once per process and passed down. `inspectHardware()` becomes a private fallback, not a public API used at decision points. |

## 3. What is coupled incorrectly

| Coupling | Evidence | Fix direction |
| --- | --- | --- |
| **The agent hard-codes a runtime id** | `src/agent/agent.ts:394` `runtimeKind !== "managed-llama"` | Replace with a capability on `ModelInfo` (e.g. `throughputClass: "slow" \| "fast"`) supplied by the adapter. The agent should never name a runtime. |
| **The UI hard-codes a runtime id** | `src/index.ts:222` `runtime.id === "shelra-llama"` | Ask the discovery result for "the runtime that can install", which the code already computes elsewhere (`src/models/manager.ts:20-22`). |
| **`src/models/catalog.ts` stubs are load-bearing** in four subsystems | `07` §1 | Either give it a real implementation backed by the active provider, or delete it and let `provider.resolveModelRuntime` be the only source of `ModelInfo`. Today it silently disables `applyModelConstraints` and the reasoning-effort UI. |
| **The chat UI cannot observe runtime health** | `src/index.ts:192-215` passes data + one callback; adapters stay in a closure | Do **not** pass the adapter to the UI. Add a small **readiness port** to `startupConfig`: `{ getRuntimeStatus(): Promise<RuntimeStatus>, onRuntimeStatusChange(cb) }`. The isolation is correct; the contract is incomplete. |
| **`llama-server` diagnostics are discarded** | `src/runtimes/managed-llama.ts:152` `stdio:"ignore"` | Capture stderr into a bounded ring buffer and attach the tail to `LocalRuntimeHealth.reason`. This single change makes OOM detection, corrupt-GGUF detection and ISA failures diagnosable instead of guessable. |
| **The UI imports byte formatters from a domain module** | `src/ui/startup.tsx:5` | Move `formatDownloadSize/Speed` to a UI/format utility. |
| **Compaction constants are model-agnostic** | `src/agent/compaction.ts:30-32`; `src/agent/agent.ts:1584-1589` | Derive `reserveTokens` and `keepRecentTokens` from `contextWindow` (e.g. `reserve = min(maxTokens, ctx*0.25)`, `keepRecent = ctx*0.4`) so a 32 K model is representable. |

## 4. What is genuinely missing

1. **A hardware→execution path.** Detected GPU influences model *choice* and
   nothing else. The missing pieces are (a) GPU-flavoured assets in
   `resolveRuntimeInstallPlan` (`src/runtimes/bootstrap.ts:56-94`), and (b) an
   `-ngl`/`--threads`/`--ctx-size` policy derived from the profile and threaded
   into `ensureServer`'s `args` (`src/runtimes/managed-llama.ts:138-148`).
2. **A real memory model.** `estimateModelMemoryGb`
   (`src/hardware/profile.ts:154-168`) is weights-only. A usable model needs
   `weights(params, bpw) + kvCache(ctx, layers, heads, kvType) + compute +
   reserve`, and it must be able to answer *"what context fits?"*, not only
   *"does it fit?"*.
3. **A degradation ladder.** Today the only recovery is "pick another installed
   model". The ladder should be: reduce `ctx` → reduce `-ngl` → smaller quant →
   smaller model → CPU → onboarding.
4. **Failure cleanup + idempotency in the runtime installer.** Copy the model
   downloader's discipline (`unlink` on hash mismatch, remove staging on any
   failure, skip when already installed).
5. **A capability cache.** `HardwareProfile` + probe result + runtime location,
   keyed by a cheap invalidation signal, so second launch is fast.
6. **Diagnostic surfacing.** `route.reasons`, `StartupProgress.model/.runtime`
   and `recommendation.alternatives` are all computed and thrown away.

## 5. Proposed ownership — who should be authoritative for what

| Concern | Authoritative module (existing where possible) | Change required |
| --- | --- | --- |
| **Startup orchestration** | `src/startup/orchestrator.ts` | Keep. Remove the redundant `health()` call at `:129` (it is what breaks multi-model); move the OOM ladder here. |
| **Hardware** | `src/hardware/profile.ts` | Add a `resolveHardware()` that caches per-process **and** to disk; make `inspectHardware()` private. Add Windows-AMD/Intel and Apple-unified-memory paths. |
| **Model catalog** | `src/models/huggingface.ts` (`HUGGING_FACE_MODELS`) | Keep as the allowlist. Add quantization variants so there is something to choose. Keep it compile-time until a signed remote catalog exists. |
| **Model discovery** | `src/models/huggingface.ts` (`discoverInstalledHuggingFaceModels`) | Add GGUF header validation and sidecar repair/warning. Make it recursive or explicitly document flat-only. |
| **Recommendation** | **new**: one `scoreModelFit` in `src/hardware/profile.ts`, consumed by both `recommendation.ts` and `router/local-first.ts` | Collapse the two scorers; delete the unreachable branch. |
| **Download** | `src/models/huggingface.ts` for models, `src/runtimes/bootstrap.ts` for the engine | Make bootstrap match huggingface's cleanup discipline. |
| **Runtime lifecycle** | `src/runtimes/managed-llama.ts` | Split `detect`/`listModels` (must be **cheap**, no spawn) from `prepareModel`/`health` (may spawn). Capture stderr. Fix `this.child.kill()`. Add liveness to `waitForHealth`. |
| **Model lifecycle** | `ManagedLlamaRuntime.prepareModel` | Make `health(signal, modelId?)` respect the active model instead of defaulting to `installedModels[0]`. |
| **Readiness** | `src/startup/orchestrator.ts` `probeLocalModel` | Extend to a tiny tool-call probe when `tools` is claimed, so `capabilityConfidence: "probed"` is honest. Cache the result. |
| **Persistence** | `src/utils/settings.ts` | Add a versioned `local` block: `{schemaVersion, modelId, modelPath, runtimeId, runtimeRelease, hardwareFingerprint, probedAt, onboardingCompletedAt}`. Read what you write. |
| **UI state** | `src/startup/types.ts` `StartupProgress` | Already correct. Render `model`/`runtime`/`alternatives`; produce `fatal-error` or delete it. |

## 6. Integrating the desired flow into the **current** UI (no separate app)

The desired startup/onboarding UX needs **no new visual framework**. Concretely:

1. **Keep the two-phase root** (`StartupScreen` → `App` via `renderRoot`,
   `src/index.ts:123-130`). It already delivers "launch → loading → chat".
2. **Replace the unmount/remount render with a state prop.** Mount
   `StartupScreen` once and drive it with a `progress` prop through a tiny
   store; this removes the per-frame reconciler churn and makes richer
   onboarding affordances (a selection list, a cancel button) practical.
3. **Add three things to the existing `StartupScreen`**, all from data the
   orchestrator already emits:
   * render `progress.model` / `progress.runtime` in the status column;
   * render `recommendation.alternatives` as a selectable list (the
     `StartupAction` primitive at `src/ui/startup.tsx:44-70` is sufficient);
   * add a `cancel` action to `resolveStartupKeyAction`
     (`src/ui/startup-input.ts:21-34`) that is actionable during
     `downloading-model`/`preparing-runtime` and calls the existing
     `installAbort`.
4. **Give `App` a readiness port** (§3) so the chat header can show engine
   status and the composer can be disabled during a model switch — without the
   UI ever seeing a `LocalRuntimeAdapter`.
5. **Later, if desired**, the same `StartupProgress` stream can be rendered as
   an in-chat overlay instead of a pre-mount screen; because the contract is
   plain data, that is a rendering choice, not a re-architecture.

## 7. What this architecture explicitly should **not** do

* Do not introduce a second startup path, a second scorer, or a second
  onboarding surface. The audit's clearest finding is that duplication — not
  absence — is the main source of incorrect behaviour.
* Do not pass runtime adapters into React. The current isolation is correct.
* Do not replace `runStartup`. Its structure is right; three localised defects
  (`:129`, `:154-190`, the stale `provider` on the error return) account for
  nearly all of its incorrect behaviour.
* Do not add remote-provider fallbacks into the local path. `--remote` is
  correctly opt-in; the only fix needed there is to stop running local discovery
  when `preferLocal` is false (`src/index.ts:459-482`).
</content>
</invoke>
