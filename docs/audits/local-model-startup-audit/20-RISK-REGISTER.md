# 20 — Risk register

Every risk below is tied to specific code evidence. No generic risks.
**L** = likelihood, **I** = impact (both Low / Med / High).

---

## A. Correctness blockers (already firing)

### R-01 — Agent cannot create files in new directories
**Evidence:** `src/security/workspace-guard.ts:22-24`; `src/tools/file.ts:23-25,70`.
`realpathSync.native(dirname(candidate))` throws `ENOENT` before `mkdirSync`
runs. Reproduced: `newdir/file.ts` → `ENOENT: … realpath 'D:\PROYECTS\shelra\newdir'`.
**L:** High (any scaffolding task) · **I:** High
**Blast radius:** the agent's core capability. Silent to the user as a generic
tool error.
**Mitigation:** Phase 1.

### R-02 — Runtime install is a permanent failure loop
**Evidence:** `src/runtimes/bootstrap.ts:237` (throw without `unlink`),
`:124-127` (416 treated as complete), `:251-253` (no cleanup).
**Field state:** `~/.shelra/runtime/llama-cpp/llama-b10826-win-cpu-x64.zip.part`
(complete, hash **matches** `:69`) + empty `b10826.staging/` + no `b10826/`.
**L:** High (already occurred) · **I:** High
**Blast radius:** first-run onboarding dead-ends; `[r]`/`[Enter]` cannot recover;
only manual file deletion helps.
**Mitigation:** Phase 2.

### R-03 — `TypeError` on child death during model load
**Evidence:** `src/runtimes/managed-llama.ts:157-161` (exit handler nulls
`this.child`) vs `:169` (`this.child.kill()`).
**L:** Med-High (fires on OOM, corrupt GGUF, missing DLL, unsupported ISA) ·
**I:** High
**Blast radius:** a raw `TypeError` becomes the user-facing startup error, and
the OOM fallback at `src/startup/orchestrator.ts:154-190` is never reached
because the throw precedes the probe.
**Mitigation:** Phase 3.

### R-04 — The wrong model is served with ≥2 GGUFs installed
**Evidence:** `src/startup/orchestrator.ts:129` → `src/runtimes/managed-llama.ts:198`
→ `:128` (`installedModels[0]`) → `:130-133` (stop + respawn).
**L:** High **as soon as a user installs a second model** · **I:** High
**Blast radius:** UI, persisted settings and the agent all report model X while
the server runs model[0]; the readiness probe passes, so nothing detects it.
**Mitigation:** Phase 4.

---

## B. Resource & lifecycle

### R-05 — Orphaned `llama-server` processes
**Evidence:** `src/index.ts:373` (discovery replaced without dispose),
`:261-266` (up to 4 re-runs), `:56-70` (SIGTERM/fatal handlers exit without
dispose), `src/setup/onboarding.ts` (no `dispose` call at all).
**Observed:** a `llama-server` outlived a completed CLI run by **>13 s**;
subsequent runs cleaned up. Partially mitigated by the force-kill added to
`stopChild` (`src/runtimes/managed-llama.ts:256-288`) — but that only runs when
`dispose()` is reached, which is exactly what these paths skip.
**L:** Med-High · **I:** Med-High (each orphan holds a GGUF in RAM: 1.1 GB
today, 5 GB with the 7B)
**Mitigation:** Phase 5.

### R-06 — Discovery starts inference
**Evidence:** `src/runtimes/managed-llama.ts:190` and `:198` both call
`ensureServer`. **Measured:** `shelra models` = 2 817 / 3 475 / 5 380 ms with a
live `llama-server` PID captured during the run.
**L:** Certain · **I:** Med
**Blast radius:** every startup, every `shelra models`, and the 750 ms
`configureLocalProvider` discovery — **including on `--remote`, which never uses
it** (`src/index.ts:459-482`).
**Mitigation:** Phase 5.

### R-07 — Port bind race
**Evidence:** `src/runtimes/managed-llama.ts:19-33` closes the probe socket
before `:150` spawns the server.
**L:** Low · **I:** High (a foreign service answering `/health` 200 would be
treated as the model server)
**Mitigation:** retry-on-bind-failure, or have `llama-server` report its port.

### R-08 — Stack overflow on a directory-symlink cycle
**Evidence:** `src/context/compiler.ts:52-93` — `statSync` (follows symlinks) at
`:63,70,83`, no visited-set, no depth cap; the `MAX_FILES` guards at `:53,78`
count **files**, so a cycle through empty directories never terminates. Runs on
every `coding`/`repository` turn via `src/agent/agent.ts:1924`.
**L:** Low-Med (common in `node_modules`-adjacent or monorepo layouts) ·
**I:** High (`RangeError` → `uncaughtException` → `process.exit(1)`,
`src/index.ts:62-65`)
**Mitigation:** `lstatSync` + a visited real-path set + a depth cap.

---

## C. Cross-platform & Windows-specific

### R-09 — Non-NVIDIA machines are invisible to the recommender
**Evidence:** `src/hardware/profile.ts:75-83` (ROCm: no VRAM), `:85-103`
(Apple: VRAM only if `system_profiler` prints it — Apple Silicon does not), no
Windows-AMD/Intel path at all.
**L:** High (every Apple Silicon and AMD/Intel machine) · **I:** Med
**Blast radius:** `recommendBootstrapModel:33-43` sees `gpuMemory === 0` and
always recommends the 1.5B — on a 128 GB M3 Max as readily as on a netbook.
**Mitigation:** Phase 8.

### R-10 — macOS arm64 and x64 share one SHA-256
**Evidence:** `src/runtimes/bootstrap.ts:72-82` — one `sha256:
"15c1b2f4…"` for two different asset URLs.
**L:** Certain for one of the two architectures · **I:** High (integrity check
fails → R-02's permanent loop)
**Mitigation:** Phase 2.

### R-11 — Windows extraction is a PowerShell shell-out with no diagnostics
**Evidence:** `src/runtimes/bootstrap.ts:172-183` — `Expand-Archive` via
`execFile("powershell.exe", …)`; on failure only `findExecutable` at `:244`
notices, throwing a generic *"The downloaded runtime did not contain
llama-server."*
**L:** Med (long paths, AV interference, ExecutionPolicy, PS unavailable) ·
**I:** High (this is the presumed cause of the empty `b10826.staging/` observed)
**Mitigation:** Phase 2 (surface stderr).

### R-12 — Storage is measured on the wrong volume
**Evidence:** `src/hardware/profile.ts:137` measures `process.cwd()`;
models are written to `~/.shelra/models` (`src/models/huggingface.ts:85-87`).
**On this machine the repo is on `D:` and the home directory on `C:`.**
**L:** High on Windows · **I:** Med (a false pass → `ENOSPC` mid-download;
a false fail → refusing a viable install)
**Mitigation:** measure the model directory.

### R-13 — Unsupported platforms silently have no engine
**Evidence:** `src/runtimes/bootstrap.ts:61,93` — win32-arm64, linux-arm64 and
every non-x64/arm64 target return `undefined`. The UI degrades the button label
to `[Enter] Try again` (`src/ui/startup.tsx:214-218`) rather than explaining.
**L:** Med (Windows on ARM is growing) · **I:** Med

---

## D. Model compatibility & memory

### R-14 — Memory estimation ignores the KV cache while forcing a 32 K context
**Evidence:** `src/hardware/profile.ts:154-168` (weights × 1.12 only) vs
`src/runtimes/managed-llama.ts:145-146` (`--ctx-size` always the full window).
**L:** High for the 7B entry · **I:** High (a model scored "fits" can fail to
load)
**Mitigation:** Phase 7.

### R-15 — Quantization strings outside `q4/q5/q6/q8` are treated as fp16
**Evidence:** `src/hardware/profile.ts:158-166` — `Q2_K`, `Q3_K_M`, `IQ4_XS`,
`"unknown"` all fall through to `16`.
**L:** Med (any hand-placed GGUF) · **I:** Med (4–8× over-estimate → a
perfectly usable model is scored `−45`/`−60`)
**Mitigation:** Phase 7.

### R-16 — A corrupt sidecar silently downgrades a catalogued model
**Evidence:** `src/models/huggingface.ts:206-233` — `JSON.parse` failure is
caught and ignored; the model becomes `local:<file>` with `parameters: 0`,
`quantization: "unknown"`.
**Field state:** the sidecar on this machine has a trailing literal `\n` and
fails `JSON.parse`; `~/.shelra/user-settings.json` holds
`"defaultModel": "local:qwen2.5-coder-1.5b-instruct-q4_k_m.gguf"`, and
`shelra models` prints that id.
**L:** Already firing · **I:** Med
**Mitigation:** validate, warn, and offer repair from the catalog.

### R-17 — Any `.gguf` file is accepted as a model
**Evidence:** `src/models/huggingface.ts:204` — extension filter only. No magic
bytes, no size check, no re-hash against the sidecar's `sha256` (which is
present at `:18`).
**L:** Med (interrupted copies, cloud-sync placeholders) · **I:** Med (a 45 s
load attempt with no diagnosis)

### R-18 — GPU influences selection but never execution
**Evidence:** `src/runtimes/bootstrap.ts:65,86` (CPU assets) +
`src/runtimes/managed-llama.ts:138-148` (no `-ngl`).
**L:** Certain on Windows/Linux · **I:** High (a 7B recommended to a GPU
machine runs on CPU)
**Mitigation:** Phase 8.

---

## E. Download & state integrity

### R-19 — Re-downloading an already-installed model
**Evidence:** `src/models/huggingface.ts:132` inspects only `.part`; no caller
checks `destination`.
**L:** Low-Med (reachable via `SHELRA_ONBOARDING_MODEL` and the
`installRecommended` retry loop) · **I:** Med (1.1–5 GB of redundant traffic)

### R-20 — Downloads cannot be cancelled from the UI
**Evidence:** `installAbort` exists (`src/index.ts:220`) but
`resolveStartupKeyAction` has no `cancel` and `downloading-model` is not
actionable (`src/ui/startup-input.ts:28`). Only `esc` responds — and it quits.
**L:** High · **I:** Med (a user on a metered link must kill the process)

### R-21 — A runtime-release bump keeps using the old engine
**Evidence:** `findManagedLlamaServer` recurses the whole tree
(`src/runtimes/bootstrap.ts:207-212`) while `installManagedRuntime` checks only
`<newRelease>/` (`:223`). No release is recorded anywhere.
**L:** Certain on the next pin bump · **I:** High (the new engine is downloaded,
verified, extracted — and never used)
**Mitigation:** Phase 5.

### R-22 — No settings schema version
**Evidence:** `src/utils/settings.ts:176-194` — no `version` field; only SQLite
is versioned (`src/storage/migrations.ts:5-20`).
**L:** Med (any future shape change) · **I:** Med

---

## F. UI & UX regressions

### R-23 — Model-switch failures are invisible
**Evidence:** `src/ui/app.tsx:2997-3005` closes the picker in an unconditional
`.then()`; the error renders only inside the closed modal (`:3720-3721`).
**L:** High whenever a switch fails · **I:** Med-High (the header shows the old
model; the server may have been restarted by the failed attempt)

### R-24 — A dead local server can open the API-key modal
**Evidence:** `src/ui/app.tsx:2161-2165` on `turnHadAuthError`; the modal's
submit calls `agent.setApiKey`, which **throws** without a base URL
(`src/agent/agent.ts:724-726` → caught at `src/ui/app.tsx:1812-1815`).
**L:** Med · **I:** Med (the user is sent down an unresolvable path)

### R-25 — The startup checklist can claim "Local engine ✓" with no engine
**Evidence:** `src/ui/startup.tsx:130` `runtimeReady = discovery.runtimes.length > 0`,
combined with `src/runtimes/discovery.ts:105-107`, which deliberately keeps an
installable-but-absent runtime in the list.
**L:** Certain on a fresh machine · **I:** Low-Med (misleading, contradicts the
"Prepare engine" button beside it)

### R-26 — `fatal-error` is unreachable
**Evidence:** consumed at `src/ui/startup.tsx:128,230`; produced by nothing.
Every failure is `recoverable-error`, including ones that are not recoverable
(unsupported platform, R-02's loop).
**L:** Certain · **I:** Low-Med (the user retries forever)

### R-27 — Pre-UI stdin prompt breaks the "immediate startup" promise
**Evidence:** `src/index.ts:815` → `:624-636` → `:579-622` — a `readline`
question on stderr before `startInteractive`.
**L:** Certain on a first run in a new directory · **I:** Low-Med

---

## G. Performance & startup latency

### R-28 — Nothing is cached between launches
**Evidence:** `localRuntimeId`/`lastLocalHealthCheck` written and never read
(`src/utils/settings.ts:180-181`); `detectHardware()` re-shells every launch
(2.5 s timeout each, `src/hardware/profile.ts:49`); the 15 s probe re-runs every
launch (`src/startup/orchestrator.ts:153`).
**L:** Certain · **I:** Med

### R-29 — Synchronous repo walk on the render thread
**Evidence:** `src/agent/agent.ts:1924` → `src/context/compiler.ts:113-164`;
the sort comparator issues two `statSync` per comparison (`:60-76`).
**L:** Certain on coding/repository turns · **I:** Med (blocks OpenTUI's event
loop before the first token)

### R-30 — Up to three server spawns per launch
**Evidence:** `detect` (`:190`) → `prepareModel` (`orchestrator.ts:120`) →
`health` (`:129`), each able to `stopChild()`+respawn.
**L:** High with ≥2 models · **I:** Med-High (two full model loads at startup)

---

## H. Agent state & provider coupling

### R-31 — Compaction cannot satisfy a 32 K window
**Evidence:** `src/agent/agent.ts:1584-1589` (`reserve = max(16 384, 16 384)`)
+ `src/agent/compaction.ts:30-32` (`keepRecent = 20 000`) +
`:247-253`. Trigger = 16 384; kept ≈ 20 000.
**L:** Certain once a local session exceeds ~16 K tokens · **I:** High
(compaction runs every turn and never converges)

### R-32 — `applyModelConstraints` is dead
**Evidence:** `src/agent/agent.ts:565-579` depends on
`getModelInfo` (`src/models/catalog.ts:11-13`), which always returns
`undefined`, so the constraint block is unreachable.
**L:** Certain · **I:** Med (a model without tool support would still be told to
use tools)

### R-33 — The agent names a specific runtime
**Evidence:** `src/agent/agent.ts:394` `runtimeKind !== "managed-llama"`.
**L:** Certain · **I:** Low-Med (adding a second local runtime silently loses
the small-model output clamp)

### R-34 — `setMode` can desynchronise model and provider
**Evidence:** `src/agent/agent.ts:687-699` replaces `this.modelId` without
touching `this.provider`. Dormant only because `modeModels` is unset by default.
**L:** Low · **I:** Med

### R-35 — `AgentKernel` records a turn's start and nothing else
**Evidence:** constructed and transitioned at `src/agent/agent.ts:1925-1929`;
`recordMutation`/`recordObservation`/`evaluateCompletion` are never called from
the agent (only from `kernel.test.ts`); `getKernelState()` is never called by the
UI.
**L:** Certain · **I:** Low today, **High if trusted** — `getKernelState()`
returns a snapshot that looks authoritative and is not.

---

## I. Testing & process

### R-36 — Every blocker in this register passes the test suite
**Evidence:** `15-TEST-COVERAGE.md` §4 maps each bug to the reason its tests
miss it. 66 files / 273 tests, exit 0.
**L:** Certain · **I:** High (green CI is not evidence of a working startup)

### R-37 — CI is red on `main`
**Evidence:** `.github/workflows/typecheck.yml` runs `bun run format` then
`bun run lint`; **both exit 1** (measured). 158 errors / 12 warnings; 146 are
CRLF formatting, 4 are the dead helpers at
`src/agent/agent.ts:2706,2729,2737,2753`.
**L:** Certain · **I:** Med (the team cannot use CI as a gate, so regressions
land silently)

### R-38 — `src/storage/sessions.test.ts` never runs
**Evidence:** excluded from both `test` and `test:watch` (`package.json:22-23`).
**L:** Certain · **I:** Low-Med (dead coverage for the session store, which the
`Agent` constructor depends on pre-UI)

### R-39 — Repository instructions are actively misleading
**Evidence:** `AGENTS.md` describes a broken ESLint
config and two files that do not exist (`src/utils/model-config.ts`,
`settings-manager.ts`).
**L:** Certain · **I:** Med (any agent or contributor following it will be wrong
about lint and the module layout)

---

## J. Security & privacy (detail in the security section of `17`)

### R-40 — The full parent environment is passed to `llama-server`
**Evidence:** `src/runtimes/managed-llama.ts:153-155` forwards every defined
`process.env` entry, including `SHELRA_API_KEY` if set.
**L:** Certain · **I:** Low-Med (a local third-party binary receives credentials
it has no use for)

### R-41 — The update check contacts GitHub on every chat mount
**Evidence:** `src/ui/app.tsx:1863-1873` → `checkForUpdate`
(`src/utils/update-checker.ts:16-29`) → `https://api.github.com/repos/yosoyjavieruiz/ShelraCode/releases/latest`
(`src/utils/install-manager.ts:14`).
**L:** Certain · **I:** Low (no user data sent; but it is an unannounced network
call in a "local-first, private by default" product whose startup screen reads
*"No account, API key, or remote provider is required"*, `src/ui/startup.tsx:245`)

### R-42 — No zip-slip guard on runtime extraction
**Evidence:** `src/runtimes/bootstrap.ts:170-186` extracts into a staging
directory with no path validation; only a post-hoc `findExecutable` check
follows. Mitigated in practice by the pinned SHA-256 (`:237`), which must match
before extraction.
**L:** Low · **I:** High if the hash gate is ever relaxed
</content>
</invoke>
