# 11 — Onboarding

## 1. There are two onboarding implementations

| | **Onboarding A — TUI (wired)** | **Onboarding B — `shelra setup` (diagnostic)** |
| --- | --- | --- |
| Trigger | `runStartup` returns `state: "onboarding"` (`src/startup/orchestrator.ts:99-108`) | Explicit `shelra setup` (`src/index.ts:830-840`) |
| UI | `StartupScreen` onboarding branch (`src/ui/startup.tsx:195-227`) | `console.log` text report (`src/setup/onboarding.ts:129`) |
| Hardware scan | `detectHardware()` via `runStartup:75` | `detectHardware()` (`:23`) |
| Recommendation | `recommendBootstrapModel` (`orchestrator.ts:100`) | **none** — it only ranks *installed* models (`:76-83`) |
| Can install a runtime | **Yes** (`src/index.ts:227-280`) | **No** |
| Can download a model | **Yes** (`src/index.ts:288-327`) | **No** |
| Can load / probe | **Yes** (via `initializeLocal:342`) | **No** |
| Persists | `defaultModel`, `localRuntimeId`, `lastLocalHealthCheck` (`orchestrator.ts:219-225`) | `defaultModel` only (`:127`) |
| Enters chat | **Yes** | **No** — prints and returns |
| Status | **IMPLEMENTED, wired end-to-end** | **PARTIAL / DUPLICATE** — a read-only doctor with an interactive prompt that cannot act |

## 2. Onboarding A — end-to-end trace

### 2a. Trigger

```ts
// src/startup/orchestrator.ts:99-108
const model = route.model;
if (!model) {
  const recommendation = recommendBootstrapModel(hardware);
  emit(options, "onboarding", "No ready local model found", {
    detail: discovery.runtimes.length > 0
      ? "A local runtime is available. ShelraCode needs a coding model before chat can start."
      : "Install or start a supported local runtime to continue.",
  });
  return { state: "onboarding", hardware, discovery, route, recommendation, healthChecked: false };
}
```

**FACT — the trigger is "`selectLocalRoute` found no eligible model"**, which
happens when: no GGUF exists; or every GGUF was filtered out by
`requiresTools`/`contextTokens` (`src/router/local-first.ts:24-37`) — but since
`tools` is hard-coded `true` for every managed candidate, in practice the
trigger is exactly **"no GGUF on disk"**.

**FACT — there is no persisted "onboarding completed" flag.** Onboarding state
is recomputed from the filesystem on every launch. Deleting the GGUF returns the
user to onboarding with no memory of having completed it before.

### 2b. What the user sees

`src/ui/startup.tsx:195-227`:
* Title override: *"One step to a private coding session"* (`:138`).
* `RECOMMENDED FOR YOU` panel: name, `reason`, `Approx. N GB memory`,
  *"Downloaded from Hugging Face"* (`:196-204`).
* Actions row (`:209-227`): a highlighted primary button whose label is chosen
  by a three-way predicate (`:214-218`) —
  `[Enter] Install recommended` / `[Enter] Prepare engine` / `[Enter] Try again` —
  plus `[r] Scan again` and `[esc] Exit`.
* `THIS COMPUTER` panel: GPU, VRAM, RAM, model count (`:180-194`).

**FACT — `recommendation.alternatives` is never rendered.** The user cannot
choose a different model; it is accept-or-quit.

### 2c. The install action

```
resolveStartupKeyAction → "install"          src/ui/startup-input.ts:31
└─ installRecommended()                      src/index.ts:217-355
   ├─ :218      guard (installing || !recommendation)
   ├─ :222-226  managedRuntime = discovery.runtimes.find(id === "shelra-llama")
   │            runtimeBinaryReady = !hasRuntimeBinary || await hasRuntimeBinary()
   │            needsManagedRuntime = Boolean(resolveRuntimeInstallPlan()) && !runtimeBinaryReady
   ├─ ── engine branch (:227-280) ──
   │    ├─ :228-232 renderStartup "preparing-runtime"
   │    ├─ :233-247 installManagedRuntime({signal, onProgress})       ← see 08 §2
   │    ├─ :250-257 !success → "recoverable-error", return
   │    ├─ :261-266 up to 4× { await initializeLocal(); break if an installer runtime appeared; sleep 1s }
   │    ├─ :267-275 still not ready → "recoverable-error" ("Press r to retry")
   │    └─ :276-279 recursive: await installRecommended()   ← second pass installs the MODEL
   ├─ ── model branch (:281-342) ──
   │    ├─ :281-286 renderStartup "downloading-model", percent 0
   │    ├─ :287-327 installLocalModel(...) with a 250 ms render throttle (:294)
   │    ├─ :328-337 !success → "recoverable-error", return
   │    └─ :340-342 installing=false; await initializeLocal()   ← full re-discovery → ready → chat
   └─ :343-354 catch/finally → "recoverable-error"; installAbort=null; installing=false
```

**FACT — this is a genuinely complete onboarding action.** It installs the
engine, re-scans, installs the model, re-scans, prepares, probes, persists, and
mounts chat. The intended product flow is implemented here.

### 2d. Defects in Onboarding A

| # | Defect | Evidence |
| --- | --- | --- |
| O1 | **Blocked in practice by the runtime-install failure loop.** A poisoned `.part` makes every retry re-hash the same bytes. | `src/runtimes/bootstrap.ts:236-253`; field state in `~/.shelra/runtime/llama-cpp/` |
| O2 | **Orphan leak.** `:261-266` calls `initializeLocal()` up to 4 times; each replaces `startupDiscovery` (`:373`) without disposing the previous adapter. | `src/index.ts:261-266,373,115` |
| O3 | **Re-entrancy.** `installRecommended` calls itself at `:277` while `installing` was set `false` at `:249`; the guard at `:218` therefore does not prevent the recursive call. Depth is bounded at 2 by the `needsManagedRuntime` predicate, so it terminates — but the control flow is fragile. | `src/index.ts:218,249,276-279` |
| O4 | **No cancellation UX.** `installAbort` exists but no key maps to cancel; `downloading-model`/`preparing-runtime` are not `actionable` states. | `src/ui/startup-input.ts:28`; `src/index.ts:220,110` |
| O5 | **No choice.** `alternatives` computed and discarded. | `src/models/recommendation.ts:41,51,60,68` vs `src/ui/startup.tsx` (no reference) |
| O6 | **Disk gate uses the wrong volume and the wrong unit.** | `src/models/manager.ts:42-45`; `src/hardware/profile.ts:137`; `src/index.ts:326` |
| O7 | **The `canInstall` prop means two different things** on the two sides of the boundary (a runtime exposes `installModel` vs a recommendation exists). | `src/index.ts:161` vs `:409` |
| O8 | **Post-install verification is a full cold re-discovery**, re-paying the model-load cost, instead of registering the new artifact. | `src/index.ts:342` |

## 3. Onboarding B — `shelra setup`

```ts
// src/setup/onboarding.ts:122-132
export async function runOnboarding(options = {}): Promise<OnboardingState> {
  const state = await collectOnboardingState(options);              // :123
  let selected = state.route.model;                                 // :124
  if (options.interactive && !options.requestedModel)
    selected = (await chooseModel(state.discovery.models)) ?? selected;   // :125-126
  if (selected) saveUserSettings({ defaultModel: selected.id });    // :127
  console.log(renderOnboarding(finalState));                        // :129
  if (selected) console.log(`\nSaved default local model: ${selected.id}`);
  return finalState;
}
```

**FACT — what it does:** `detectHardware()` + `discoverLocalRuntimes()` +
`selectLocalRoute()` (`:22-31`), then prints a formatted report (`:43-101`)
covering hardware, GPU, storage, runtimes with health flags, ranked models,
routing decision and reasons, plus "Next steps".

**FACT — what it does not do:** no recommendation (`recommendBootstrapModel` is
not imported), no runtime install, no model download, no `prepareModel`, no
probe, no transition to chat. Its own "Next steps" text tells the user to go
back to `shelra` (`:96-98`).

**FACT — defects:**

| # | Defect | Evidence |
| --- | --- | --- |
| S1 | **Ranking duplication with a different hardware profile.** `renderOnboarding` ranks with `localModelFitScore(model, state.hardware)` (`:77` — GPU-aware) while `chooseModel` ranks with `localModelFitScore(a)` (`:105` — **no hardware argument**, so `inspectHardware()` with `gpu: []`). **The printed order and the chooser's order can disagree within one command.** |
| S2 | **Interactive fallback picks index 0 on any invalid input** (`:116`), so typing "x" silently selects the top-ranked model rather than re-prompting. |
| S3 | **Persists a selection that was never validated.** `saveUserSettings({defaultModel})` at `:127` with no `prepareModel`/probe. The next `shelra` launch will treat it as a preference and may still override it via fit score (`src/router/local-first.ts:45-50`). |
| S4 | **Discovery side effect.** `collectOnboardingState:24` calls `discoverLocalRuntimes(..., timeout 60s)`, which **spawns `llama-server`** — and `runOnboarding` **never calls `disposeLocalRuntimes`**. Grep of `src/setup/onboarding.ts`: no `dispose`. **`shelra setup` leaks a `llama-server` child on every invocation.** (Compare `src/index.ts:893`, where the `models` command *does* dispose.) |
| S5 | **Misleading flag semantics.** `--non-interactive` maps to `interactive: options.nonInteractive !== true` (`src/index.ts:839`), so the default (`shelra setup` with no flags) **is** interactive and prompts on stdin — which is fine, but the option's presence in a "diagnostics" command is confusing given it cannot act on the choice. |

**S4 is a concrete, unambiguous resource leak with a one-line fix** and is not
covered by either of the two `onboarding.test.ts` cases (which inject
`discovery` and `hardware`, bypassing the real discovery path entirely).

## 4. Is onboarding real, partial, visual-only, backend-only, or abandoned?

| Implementation | Classification |
| --- | --- |
| Onboarding A (TUI) | **REAL AND WIRED END-TO-END** — hardware → recommendation → engine install → model download → prepare → probe → persist → chat. Currently **blocked** by the runtime-install cleanup bug on this machine. |
| Onboarding B (`shelra setup`) | **BACKEND-ONLY DIAGNOSTIC + DUPLICATE RANKING.** Reachable, functional as a report, incapable of completing onboarding, and leaks a child process. |

## 5. What is missing from onboarding relative to the desired flow

| Desired step | Present? |
| --- | --- |
| Guided, staged UI | **Yes** — stage checklist + progress (`src/ui/startup.tsx:166-178`) |
| Scan hardware | **Yes** (`orchestrator.ts:75`) |
| Evaluate GPU/VRAM | **Yes for selection** (`recommendation.ts:33`), **no for execution** |
| Evaluate RAM/CPU/storage | **RAM branch unreachable; CPU never used; storage only as a disk gate** |
| Determine optimal model | **Partial** — 2-entry catalog, 2 possible outcomes |
| Recommend | **Yes** (`src/ui/startup.tsx:195-205`) |
| **User accepts / selects** | **Accept only.** No selection UI; `alternatives` discarded |
| Download / install | **Yes** (engine + model), with progress and integrity |
| Prepare runtime | **Yes** |
| Load model | **Yes** |
| Verify readiness | **Yes** (real generation probe) |
| Enter chat | **Yes** |
| Remember that onboarding happened | **No** — no persisted flag |
| Resume an interrupted onboarding | **Partial** — the `.part` resume works for the model; **broken** for the engine |
| Cancel gracefully | **No** |
</content>
</invoke>
