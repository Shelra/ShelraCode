# 19 — Recommended implementation phases

**Audit-only document. Nothing here has been implemented.** Every phase is
derived from evidence in this audit and is scoped to be small and individually
verifiable. Phases 1–3 are correctness; 4–6 are consolidation; 7–9 are the
missing capability; 10 is hygiene.

---

## Phase 1 — Unblock the agent's own file tool

### Objective
Restore the agent's ability to create files in directories that do not exist yet.

### Current evidence
`resolveWorkspacePath` resolves `existsSync(candidate) ? candidate : dirname(candidate)`
and then calls `realpathSync.native` on it (`src/security/workspace-guard.ts:22-24`).
For `newdir/file.ts` the parent does not exist → `ENOENT`, thrown before
`writeFile`'s own `mkdirSync` (`src/tools/file.ts:70`) can run. Reproduced:
`newdir/file.ts` and `a/b/c.ts` both throw; `src/newfile.ts` succeeds.

### Existing code to reuse
`isInside` (`workspace-guard.ts:9-12`) — the containment logic is correct.

### Existing code to modify
`src/security/workspace-guard.ts:22-24` — walk **up** to the nearest existing
ancestor instead of one level, realpath that, and verify containment of the
remaining (not-yet-created) suffix.

### Existing code to retire later
None.

### Missing capability
Containment checking for paths whose ancestors do not exist yet.

### Dependencies
None.

### Tests required
* `resolveWorkspacePath("newdir/file.ts", root)` succeeds and returns a
  contained path.
* `resolveWorkspacePath("a/b/c/d.ts", root)` succeeds.
* A symlinked ancestor that escapes the workspace is still rejected (extend
  `src/security/workspace-guard.test.ts:16`).
* `writeFile` creates a multi-level directory (`src/tools/file.test.ts`).

### UX impact
The agent can write new files again. Currently it cannot.

### Risks
Weakening the symlink-escape guard. Mitigate by realpathing the **deepest
existing ancestor** and rejecting if that is outside the root.

### Acceptance criteria
All four tests pass; `src/security/workspace-guard.test.ts:16` still passes.

---

## Phase 2 — Make the runtime installer recoverable

### Objective
Remove the permanent failure loop that blocks first-run onboarding.

### Current evidence
`installManagedRuntime` throws on hash mismatch without deleting the `.part`
(`src/runtimes/bootstrap.ts:237`) and never removes the staging directory on any
failure (`:243-253`). `downloadArchive` treats a 416 on a full-size partial as
"complete" (`:124-127`), so retries rehash the same bytes forever. **Field
state:** `~/.shelra/runtime/llama-cpp/` holds a complete, hash-**matching**
`.part` and an **empty** `b10826.staging/`, with no `b10826/`.

### Existing code to reuse
`src/models/huggingface.ts:169-175` — the correct pattern
(`unlink(partial)` then throw).

### Existing code to modify
* `src/runtimes/bootstrap.ts:236-237` — `unlink(archivePath)` before throwing.
* `:251-253` — in `catch`, remove `extractionDirectory` and `archiveFinalPath`.
* `:223-224` — make the already-installed check use the same resolver as
  `findManagedLlamaServer` (see Phase 5), and record the release.
* `:80` — the macOS arm64 and x64 plans share one `sha256`; give each its own.
* `extractArchive` (`:170-186`) — surface the extractor's stderr in the thrown
  message so the empty-staging failure is diagnosable.

### Existing code to retire later
None.

### Missing capability
Failure cleanup; per-asset hashes; extractor diagnostics.

### Dependencies
None.

### Tests required
* Hash mismatch → `.part` is gone and a second call re-downloads.
* Extraction failure → staging directory removed; `success:false` with the
  extractor's message.
* Already-installed → returns early without any network call.
* `resolveRuntimeInstallPlan("darwin","arm64").sha256 !== resolveRuntimeInstallPlan("darwin","x64").sha256`.

### UX impact
`[Enter] Prepare engine` stops dead-ending. This is the single change that
unblocks scenario B.

### Risks
Deleting a partial the user could have resumed. Only delete on a *verification*
failure, never on an abort or a network error.

### Acceptance criteria
From the current poisoned state on this machine, one retry recovers or reports a
specific, actionable reason.

---

## Phase 3 — Make model loading fail honestly

### Objective
Stop the `TypeError`, stop the 45 s hang, and start reporting *why* a load
failed.

### Current evidence
* `this.child.kill()` at `src/runtimes/managed-llama.ts:169` runs after the
  `exit` handler at `:157-161` may have set `this.child = undefined`.
* `waitForHealth` (`:109-122`) never checks child liveness and always burns
  `SERVER_START_TIMEOUT_MS = 45_000` (`:17`).
* `stdio: "ignore"` (`:152`) discards every llama.cpp diagnostic, which is why
  the OOM regex at `src/startup/orchestrator.ts:155` almost never matches.

### Existing code to reuse
The `exit` handler already tracks liveness; `LocalRuntimeHealth.reason`
(`src/runtimes/types.ts:8`) already exists as a carrier.

### Existing code to modify
* `:150-175` — hold the spawned child in a local `const`, use it for `kill()`,
  and track an `exited` flag.
* `:109-122` — accept the child and return early when it exits.
* `:152` — capture stderr into a bounded ring buffer; attach its tail to the
  health reason and to `prepareModel`'s failure.

### Existing code to retire later
The OOM regex at `src/startup/orchestrator.ts:155` becomes a fallback once real
diagnostics exist.

### Missing capability
Child-death detection and diagnostic capture.

### Dependencies
None.

### Tests required
* Injected `spawnImpl` whose child emits `exit` during `waitForHealth` →
  `ensureServer` returns `false` **within ~1 s**, no throw.
* The captured stderr tail appears in `health().reason`.
* Existing single-flight test still passes.

### UX impact
"The local model could not be loaded" gains a real cause; failures take seconds
instead of 45.

### Risks
Unbounded stderr buffering — cap it (e.g. last 8 KB).

### Acceptance criteria
No `TypeError` path remains; a killed child is detected in under 2 s.

---

## Phase 4 — One model, one server: fix multi-model selection

### Objective
Guarantee that the model reported as ready is the model actually loaded.

### Current evidence
`runStartup:129` calls `runtime.health(signal)` after `prepareModel(model.id)`;
`ManagedLlamaRuntime.health` calls `ensureServer(signal)` with **no model id**
(`src/runtimes/managed-llama.ts:198`), which selects `installedModels[0]`
(`:128`) and restarts the server (`:130-133`). The probe still passes because
`llama-server` serves whatever is loaded.

### Existing code to reuse
`prepareModel` (`:246-248`) already threads the id correctly; `activeModelPath`
(`:83`) already records what is loaded.

### Existing code to modify
* `src/runtimes/managed-llama.ts:194-206` — `health(signal, modelId?)` that
  defaults to the **active** model, never to `installedModels[0]`.
* `src/runtimes/types.ts:40` — widen the `health` signature.
* `src/startup/orchestrator.ts:129` — either pass `model.id` or drop the call
  entirely (`prepareModel` already proved `/health`).
* `src/startup/orchestrator.ts:200-209` — do not return a stale `provider` on
  the error path.

### Existing code to retire later
The redundant health round-trip at `:129`.

### Missing capability
Model-aware health.

### Dependencies
Phase 3 (so a failed health has a real reason).

### Tests required
* Fixture with **two** installed models: select the second; assert the spawned
  args contain the second model's path and that no second spawn occurs.
* `health()` with no argument on a runtime with an active model does not restart
  it.
* `runStartup` returns `model.id === <selected>` and a provider whose baseURL
  matches the live port.

### UX impact
Model switching and multi-model machines become trustworthy.

### Risks
Changing an interface method's signature — it is optional and has two
implementations, both in-repo.

### Acceptance criteria
Scenario F in `17-GAP-ANALYSIS.md` §2 produces the selected model.

---

## Phase 5 — Cheap discovery + no orphans

### Objective
Make "what is installed?" free, and stop leaking `llama-server` processes.

### Current evidence
* `detect` (`:186-192`) and `health` (`:194-206`) both call `ensureServer`.
  Measured: `shelra models` takes **2.8–5.4 s** and spawns a real server
  (PID observed).
* `src/index.ts:373` overwrites `startupDiscovery` without disposing the
  previous discovery; `installRecommended:261-266` runs `initializeLocal()` up
  to 4 times.
* `src/setup/onboarding.ts` never calls `disposeLocalRuntimes` at all.
* Three "installed?" predicates disagree (`16` §D-3).

### Existing code to reuse
`disposeLocalRuntimes` (`src/runtimes/discovery.ts:116-119`); the
force-kill logic recently added to `stopChild`
(`src/runtimes/managed-llama.ts:256-288`).

### Existing code to modify
* `src/runtimes/managed-llama.ts:186-192` — `detect` returns `hasBinary() &&
  models.length >= 0` **without** spawning.
* `:194-206` — `health` may spawn, but only when asked.
* `src/runtimes/discovery.ts:93-97` — call `detect` + `listModels` eagerly;
  make `health` lazy (or explicitly requested).
* `src/index.ts:373` — dispose the previous `startupDiscovery` before replacing
  it.
* `src/index.ts:56-70` — dispose on `SIGTERM` and on the fatal handlers.
* `src/setup/onboarding.ts:122-132` — dispose in a `finally`.
* `src/runtimes/bootstrap.ts` — one `resolveInstalledRuntime()` returning
  `{path, release}`; `ManagedLlamaRuntime.hasBinary/hasInstalledBinary/hasRuntimeBinary`
  collapse onto it.

### Existing code to retire later
`hasInstalledBinary` (`:272-279`) — a duplicate of `hasBinary`.

### Missing capability
A spawn-free discovery mode; version-aware runtime resolution.

### Dependencies
Phase 3 (liveness), Phase 4 (model-aware health).

### Tests required
* `discoverLocalRuntimes` with a real `ManagedLlamaRuntime` and an injected
  `spawnImpl` → **zero** spawn calls.
* `shelra models` completes without a spawn (integration).
* Two sequential `initializeLocal()` calls → the first discovery is disposed.
* `runOnboarding` disposes.

### UX impact
Startup reaches `detecting-models` in milliseconds instead of seconds; no
resident `llama-server` after a listing command.

### Risks
`discovery.health` becomes lazy — `src/startup/orchestrator.ts:129,172` and
`src/setup/onboarding.ts:68` read it. Update those three call sites.

### Acceptance criteria
`shelra models` < 1 s with no `llama-server` process at any point.

---

## Phase 6 — One scorer, one onboarding, one selection commit

### Objective
Remove the three duplications that make behaviour inconsistent.

### Current evidence
`16-DUPLICATION-AND-DEAD-CODE.md` §D-1, §D-2, §D-4. The RAM branch at
`src/models/recommendation.ts:44` is unreachable; `0.72` vs `0.82` disagree;
`shelra setup` ranks twice with two different hardware profiles
(`src/setup/onboarding.ts:77` vs `:105`).

### Existing code to reuse
`localModelFitScore` (`src/hardware/profile.ts:171-201`) as the single scorer.

### Existing code to modify
* `src/hardware/profile.ts` — export `scoreModelFit(spec, hardware)` over a
  shape both `HuggingFaceModelSpec` and `LocalModelCandidate` can satisfy.
* `src/models/recommendation.ts:17-70` — score the catalog with it; delete the
  unreachable `else` at `:44`; return real `alternatives`.
* `src/setup/onboarding.ts:122-132` — reduce to a printer over
  `runStartup({healthCheck:false, persistSelection:false})`.
* New `commitModelSelection(model, runtime)` used by
  `src/startup/orchestrator.ts:219-225`, `src/index.ts:181-185`,
  `src/ui/app.tsx:828-831`.

### Existing code to retire later
`recommendBootstrapModel`'s tier ladder; `collectOnboardingState`;
`chooseModel`.

### Missing capability
A shared model shape for scoring.

### Dependencies
Phase 5 (so `shelra setup` inherits cheap discovery).

### Tests required
* A CPU-only profile and a 12 GB-VRAM profile produce the documented catalog
  picks **through the shared scorer**.
* `shelra setup` and `shelra` rank the same installed set identically.
* `commitModelSelection` writes user settings, project settings and the session
  row exactly once each.

### UX impact
`shelra setup` stops contradicting `shelra`; a recommendation carries real
alternatives.

### Risks
Ranking changes for existing users. Gate with the tests above; the current
thresholds are documented verbatim in `06-MODEL-RECOMMENDATION.md` §4.

### Acceptance criteria
Grep finds exactly one scoring function and one onboarding discovery path.

---

## Phase 7 — Real memory modelling

### Objective
Replace a weights-only estimate with something that can answer "what fits, and
at what context?".

### Current evidence
`estimateModelMemoryGb` (`src/hardware/profile.ts:154-168`) is
`params × bits/8 × 1.12`; its quant ladder maps `Q2/Q3/IQ*` to **16 bits**; and
in production the function is bypassed entirely because `memoryRequiredGb` is
always set (`src/runtimes/managed-llama.ts:55`). Meanwhile `--ctx-size` is
always 32 768 (`:146`) with no KV-cache accounting.

### Existing code to reuse
The constants table in `10-MODEL-LIFECYCLE.md` §5; `HardwareProfile`.

### Existing code to modify
`src/hardware/profile.ts:154-201` — add `estimateFootprint({params, bpw,
contextTokens, layers?, kvBits?})` returning `{weightsGb, kvGb, overheadGb,
totalGb}`; make `scoreModelFit` consume it; expose
`maxContextForBudget(spec, budgetGb)`.

### Existing code to retire later
The `q8/q6/q5/q4/else-16` ladder.

### Missing capability
KV-cache and context terms; per-quant bits-per-weight; OS reserve.

### Dependencies
Phase 6.

### Tests required
* Known-good reference points (1.5B Q4_K_M @ 32 K; 7B Q4_K_M @ 32 K and @ 8 K).
* `Q2_K` is not treated as 16-bit.
* `maxContextForBudget` is monotonic in the budget.

### UX impact
Recommendations stop ignoring the 32 K KV cost; a machine can be offered a
model at a reduced context instead of being refused.

### Risks
Over-fitting to one architecture. Keep the model conservative and documented.

### Acceptance criteria
Estimates are within a stated tolerance of measured RSS for the two catalog
models on this machine.

---

## Phase 8 — Hardware actually drives execution

### Objective
Make the detected GPU change how the model runs, not only which model is picked.

### Current evidence
`resolveRuntimeInstallPlan` pins CPU assets for win32/linux
(`src/runtimes/bootstrap.ts:65,86`); `ensureServer`'s args contain no `-ngl`,
no `--threads` (`src/runtimes/managed-llama.ts:138-148`);
`GpuProfile.accelerationBackends` is written and never read
(`src/hardware/profile.ts:14,69,82,92`).

### Existing code to reuse
`accelerationBackends`; `HardwareProfile.cpuCores`; the pinned-asset +
SHA-256 discipline.

### Existing code to modify
* `src/runtimes/bootstrap.ts:56-94` — add GPU variants (CUDA on win/linux)
  selected from the hardware profile, each with its own pinned hash.
* `src/runtimes/managed-llama.ts:124-148` — accept a `RuntimeLaunchPolicy`
  (`{ctxSize, gpuLayers, threads}`) computed from the profile and the Phase 7
  footprint model.
* `src/hardware/profile.ts:105-130` — add Windows AMD/Intel detection and
  Apple unified-memory accounting so non-NVIDIA machines stop reading as
  CPU-only.

### Existing code to retire later
The unconditional `--ctx-size <full window>` at `:145-146`.

### Missing capability
Backend selection and launch-parameter policy.

### Dependencies
Phases 2, 3, 5, 7.

### Tests required
* An NVIDIA profile yields a CUDA plan and `-ngl > 0`; a CPU profile yields the
  CPU plan and no `-ngl`.
* Apple Silicon yields a non-zero memory budget.
* Launch args are a pure function of `(spec, hardware)` — snapshot them.

### UX impact
The largest single performance change available. Today a GPU machine runs at CPU
speed.

### Risks
Highest-risk phase: GPU builds fail in ways CPU builds do not (driver, CUDA
runtime, VRAM). Mitigate with Phase 9's ladder and by keeping the CPU asset as
the fallback.

### Acceptance criteria
On an NVIDIA machine, a launch with `-ngl` succeeds and is measurably faster;
on failure, the CPU plan is used automatically.

---

## Phase 9 — A real degradation ladder

### Objective
Turn "the model failed to load" into an automatic, ordered recovery.

### Current evidence
The only recovery is "another installed model with `parameters ≤`"
(`src/startup/orchestrator.ts:154-190`), which is a no-op on a one-model
machine and is triggered by a regex over an error string that is usually empty
because diagnostics are discarded.

### Existing code to reuse
The fallback scaffolding at `:154-190`; the emit/progress machinery; Phase 3's
diagnostics; Phase 7's footprint model.

### Existing code to modify
`src/startup/orchestrator.ts:147-212` — replace the single fallback with an
ordered ladder: **reduce ctx → reduce `-ngl` → smaller quant → smaller installed
model → CPU plan → onboarding**, emitting a distinct `StartupProgress` message
per rung.

### Existing code to retire later
The OOM regex at `:155`.

### Missing capability
Every rung except "smaller installed model".

### Dependencies
Phases 3, 7, 8.

### Tests required
* A load failure with a memory diagnostic retries at a reduced context and
  succeeds.
* Exhausting the ladder produces `recoverable-error` with the ladder recorded in
  `detail`.
* A one-model machine still gets at least the ctx and `-ngl` rungs.

### UX impact
Directly satisfies "Shelra prepares the best local model **available for this
computer**".

### Risks
Long retry chains at startup. Cap total attempts and total time; surface each
rung in the UI.

### Acceptance criteria
Scenario D in `17-GAP-ANALYSIS.md` §2 recovers instead of crashing.

---

## Phase 10 — Persistence, diagnostics, and a green CI

### Objective
Make second launch fast, make failures explainable, make `bun run lint` pass.

### Current evidence
`localRuntimeId` and `lastLocalHealthCheck` are written and never read
(`src/utils/settings.ts:180-181`); no hardware/probe cache; no schema version;
`route.reasons`, `StartupProgress.model/.runtime` and
`recommendation.alternatives` are all computed and discarded; `bun run lint`
and `bun run format` both exit 1, failing CI at
`.github/workflows/typecheck.yml`; 4 dead helpers at
`src/agent/agent.ts:2706,2729,2737,2753`; compaction constants
(`20 000 > 16 384`) cannot satisfy a 32 K window.

### Existing code to reuse
`saveUserSettings`/`loadUserSettings`; `applyMigrations`
(`src/storage/migrations.ts:5-20`) as the versioning pattern.

### Existing code to modify
* `src/utils/settings.ts:176-194` — add a versioned `local` block and **read**
  it on startup to skip the hardware scan and the probe when the fingerprint is
  unchanged.
* `src/ui/startup.tsx` — render `progress.model`, `progress.runtime`, and
  `recommendation.alternatives`; produce `fatal-error` or delete the state.
* `src/ui/app.tsx:2997-3005` — only close the picker on `{success:true}`.
* `src/agent/agent.ts:1584-1589` + `src/agent/compaction.ts:30-32` — derive the
  compaction budget from `contextWindow`.
* Delete the 4 dead helpers; run `biome check --fix` for the CRLF formatting.

### Existing code to retire later
The legacy delegation write mirror (`src/agent/delegations.ts:238-241,267-276`; since removed).

### Missing capability
A capability cache; a settings schema version; error surfacing.

### Dependencies
Phases 1–9 for the content of the cache.

### Tests required
* Second launch with an unchanged fingerprint performs **no** `nvidia-smi` and
  **no** probe.
* A changed fingerprint invalidates the cache.
* A failed model switch keeps the picker open and shows the error.
* `shouldCompactContext` + `keepRecentTokens` converge for a 32 K window.
* `bun run lint` exits 0.

### UX impact
Fast second launch; explainable failures; CI green.

### Risks
A stale cache masking a real hardware change — key it on a cheap fingerprint
(GPU names + total RAM + platform + runtime release) and always allow
`[r] Scan again` to bypass it.

### Acceptance criteria
`bun run format && bun run lint && bun run typecheck && bun run test` all exit 0.

---

## Suggested ordering

```
1 ─┐
2 ─┼─ correctness, independent, ship individually
3 ─┘
4 ← needs 3
5 ← needs 3,4
6 ← needs 5
7 ← needs 6
8 ← needs 2,3,5,7
9 ← needs 3,7,8
10 ← rolls up
```

**Phase 1 and Phase 2 are the highest value per unit of risk** and are
independent of everything else: Phase 1 restores the agent's ability to do its
job; Phase 2 unblocks first-run onboarding.
</content>
</invoke>
