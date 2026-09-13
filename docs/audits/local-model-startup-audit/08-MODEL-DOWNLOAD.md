# 08 — Model & runtime download

Two independent downloaders exist. **They are near-identical in structure and
differ in exactly the way that matters: failure cleanup.**

| | Model downloader | Runtime downloader |
| --- | --- | --- |
| Symbol | `downloadHuggingFaceModel` | `installManagedRuntime` / `downloadArchive` |
| File | `src/models/huggingface.ts:123-185` | `src/runtimes/bootstrap.ts:214-254` / `:114-164` |
| Fetches | GGUF from `huggingface.co` | llama.cpp release zip/tar from `github.com` |
| Resume | Yes (`Range`) | Yes (`Range`) |
| Progress | Yes (bytes/speed/ETA) | Yes (bytes/speed/ETA/percent/elapsed) |
| SHA-256 verify | Yes | Yes |
| **Deletes the bad partial on hash failure** | **YES** (`:172`) | **NO** (`:237`) |
| Atomic finalize | Yes (`rename`, `:176`) | Partial (`rename` twice, no staging cleanup) |
| Sidecar / metadata | Yes (`:177-181`) | No |

## 1. Model download — full trace

```
[UI]  StartupScreen "[Enter] Install recommended"        src/ui/startup.tsx:212-223
  └─ resolveStartupKeyAction → "install"                 src/ui/startup-input.ts:31
     └─ installRecommended()                             src/index.ts:217-355
        ├─ :218  guard: return if installing || !startupRecommendation
        ├─ :220  installAbort = new AbortController()
        ├─ :222-226 runtimeBinaryReady? (managedRuntime.hasRuntimeBinary())
        ├─ :227-280 if engine missing → installManagedRuntime(...)   ← §2
        ├─ :281-286 renderStartup({state:"downloading-model", percent:0})
        ├─ :288-327 installLocalModel(discovery, id, hardware, onProgress, signal, estMemGb)
        │            src/models/manager.ts:28-53
        │            ├─ :36  runtime = discovery.runtimes.find(r => typeof r.installModel === "function")
        │            ├─ :42-45 disk gate: max(4, estMemGb*1.25) vs hardware.storageAvailableGb
        │            └─ :47-51 runtime.installModel({modelId, signal, onProgress})
        │                      src/runtimes/managed-llama.ts:213-236
        │                      ├─ :224 spec = getHuggingFaceModelSpec(modelId)   ← ALLOWLIST
        │                      ├─ :225 reject if not in catalog
        │                      └─ :227 downloadHuggingFaceModel(spec, {...})     ← §1b
        ├─ :328-337 !success → renderStartup({state:"recoverable-error"})
        └─ :340-342 success → installing=false; await initializeLocal()   ← full re-discovery
```

### 1b. `downloadHuggingFaceModel` (`src/models/huggingface.ts:123-185`)

| Step | Line | Behaviour |
| --- | --- | --- |
| mkdir target dir | `:129` | `recursive: true` |
| compute `.part` path | `:130-131` | `<dest>.part` |
| read existing partial size | `:132` (`existingSize:100-106`) | `stat().size`, `0` on error |
| build `Range: bytes=N-` | `:133-134` | only when offset > 0 |
| emit `connecting` | `:135` | |
| abort check | `:136` | `DOMException("Download cancelled","AbortError")` (`:114-116`) |
| fetch | `:137` | `signal` forwarded |
| accept 2xx or 206 | `:138-140` | else throw `HTTP <status>` |
| require body | `:141` | |
| decide append vs truncate | `:143-146` | `resumed = offset>0 && status===206`; `open(partial, resumed ? "a" : "w")` |
| total size | `:145` | `content-range` → else `content-length + start` → else `spec.sizeBytes` (`:93-98`) |
| stream + per-chunk progress | `:150-163` | abort-checked each chunk; speed & ETA computed |
| close handle | `:164-166` | in `finally` |
| emit `verifying` | `:168` | |
| **SHA-256 verify** | `:169-175` | streaming hash (`:108-112`) |
| **on mismatch: `unlink(partial)` then throw** | **`:172-173`** | *"the partial artifact was removed"* |
| atomic finalize | `:176` | `rename(partial, destination)` |
| write sidecar | `:177-181` | `{...spec, path, installedAt}`, `mode: 0o600` |
| emit `complete` | `:183` | |

**FACT — this is a well-built downloader.** Resume, progress, integrity, atomic
finalize, and correct cleanup on corruption are all present and unit-tested
(`src/models/huggingface.test.ts:30` "resumes a partial artifact, reports
progress, verifies it, and finalizes atomically"; `:51` "rejects a corrupt
artifact without exposing it as installed").

### FACT — defect M1: no already-installed check

`:132` inspects **only** `${destination}.part`. It never checks whether
`destination` itself already exists. Neither does `installModel`
(`src/runtimes/managed-llama.ts:213-236`) nor `installLocalModel`
(`src/models/manager.ts:28-53`).

Consequence: invoking the install path for a model that is already installed
re-downloads the entire GGUF (1.1 GB / 5 GB) from scratch and overwrites the
finalized artifact. In the normal TUI flow this is masked, because the
recommendation only appears in the `onboarding` state (i.e. when no usable model
was found) — but it is reachable via `SHELRA_ONBOARDING_MODEL` pointing at an
installed model, and via the `installRecommended` retry loop at
`src/index.ts:261-266`+`:276-278` (a recursive re-entry after the engine is
installed).

### FACT — defect M2: no free-space re-check and a unit mismatch in the gate

`src/models/manager.ts:42-45` compares `hardware.storageAvailableGb` (measured
on `process.cwd()`'s volume — `src/hardware/profile.ts:137`) against
`max(4, estimatedMemoryGb * 1.25)`. The model is written to
`~/.shelra/models` (`src/models/huggingface.ts:85-87`), which may be a
different volume (**it is on this machine: repo on `D:`, home on `C:`**).
`spec.sizeBytes` — the correct quantity — exists in the catalog and is ignored.
There is no mid-download disk check; `ENOSPC` surfaces as a raw write error.

### FACT — cancellation works, but is unreachable from the UI

`installAbort.signal` is threaded through `installLocalModel` →
`installModel` → `downloadHuggingFaceModel` and checked per chunk (`:151`).
`onExit` aborts it (`src/index.ts:110`). But during
`state: "downloading-model"` the key handler treats the state as
non-actionable (`src/ui/startup-input.ts:28`), so only `esc` responds — and
`esc` quits the application. **There is no "cancel this download and keep
running" affordance.**

### FACT — registration after install is a full re-discovery

`installRecommended` ends with `await initializeLocal()` (`src/index.ts:342`),
which re-runs `runStartup` → `discoverLocalRuntimes` → new
`ManagedLlamaRuntime` → filesystem rescan. There is no incremental
registration. This is *correct* but expensive, and it is the source of the
orphan leak (see §4).

## 2. Runtime download — full trace and the blocking defect

```
installManagedRuntime(options)                     src/runtimes/bootstrap.ts:214-254
├─ :216-218 SHELRA_DISABLE_RUNTIME_INSTALL === "1" → refuse
├─ :219-220 plan = resolveRuntimeInstallPlan(platform, arch)   (:56-94) — else refuse
├─ :222     versionDirectory = <root>/<release>
├─ :223-224 existing = findExecutable(versionDirectory, exeName) → early success
├─ :226     archivePath      = <root>/<archiveName>.part
├─ :227     archiveFinalPath = <root>/<archiveName>
├─ :228     extractionDirectory = <root>/<release>.staging
├─ :234     bytes = await downloadArchive(plan, archivePath, options, startedAt)   (:114-164)
├─ :236     actualHash = await sha256(archivePath)
├─ :237     if (actualHash !== plan.sha256) throw  ←←← NO unlink(archivePath)
├─ :242     await rename(archivePath, archiveFinalPath)
├─ :243     await extractArchive(plan, archiveFinalPath, extractionDirectory)  (:170-186)
├─ :244-245 executable = findExecutable(extractionDirectory, exeName); throw if missing
├─ :246     await rename(extractionDirectory, versionDirectory)
├─ :247-248 installed = findExecutable(versionDirectory, exeName); throw if missing
└─ :251-253 catch → { success:false, reason: message }   ←←← NO cleanup of ANY artifact
```

### FACT — defect R1 (BLOCKER): poisoned `.part` is never removed

`:237` throws without `unlink(archivePath)`. `src/models/huggingface.ts:172`
does exactly the opposite in the analogous position. On the next attempt:

1. `downloadArchive:121` reads `fileSize(archivePath)` → the full byte count.
2. `:122` sends `Range: bytes=<full>-`.
3. GitHub replies **416 Range Not Satisfiable**; `:124-127` treats a 416 whose
   `content-range` total equals the offset as **complete** and returns `offset`.
4. `:236` rehashes the same bytes → the same mismatch → the same throw.

**Permanent failure loop.** Neither `[r] Scan again` nor `[Enter]` can escape
it; only manually deleting `~/.shelra/runtime/llama-cpp/*.part` can.

### FACT — defect R2: staging and final-archive directories are never cleaned

`extractionDirectory` (`<root>/<release>.staging`) is created by
`extractArchive:171` and is only removed by the *success* path's `rename` at
`:246`. Any failure at `:243`, `:244-245`, or `:246` leaves it behind
permanently. `archiveFinalPath` is likewise never deleted, on success or
failure.

### Field evidence from this machine — R1/R2 have already fired

```
~/.shelra/runtime/llama-cpp/
  b10826.staging/                              ← EMPTY directory (extraction produced nothing)
  llama-b10826-win-cpu-x64.zip.part            ← 18,412,429 bytes
  manual.zip                                   ← 18,412,429 bytes (identical size)
  manual/                                      ← hand-extracted; CONTAINS llama-server.exe
  (no b10826/ directory — the install never completed)

$ sha256sum llama-b10826-win-cpu-x64.zip.part
  5828cccc7261b14607d23de3144f35fac4249d9fd207e13bff5e31dd8ae39d56
$ grep sha256 src/runtimes/bootstrap.ts:69
  sha256: "5828cccc7261b14607d23de3144f35fac4249d9fd207e13bff5e31dd8ae39d56"
```

**FACT — the downloaded archive is complete and its hash MATCHES the pin.** So
the download and verification steps both succeeded; the failure occurred later,
at `rename`/`extractArchive`/`findExecutable`.

**INFERENCE (medium-high) — the failure point is `extractArchive`.**
`b10826.staging` exists (created by `mkdir` at `:171`) and is empty, which is
exactly the state produced when `Expand-Archive` runs (or fails) and
`findExecutable` at `:244` then returns `undefined`, throwing *"The downloaded
runtime did not contain llama-server."* A plausible contributing cause is the
Windows `MAX_PATH`/long-path limit or `Expand-Archive`'s behaviour on a
`.part`-renamed archive; the code anticipates the extension problem
(`:239-242` comment) but not the failure aftermath.

**FACT — the user worked around it by hand**, producing `manual.zip` and
`manual/`. And this workaround *functions*, because:

### FACT — defect R3: two disagreeing "is the runtime installed?" predicates

| Predicate | Search root | Result on this machine |
| --- | --- | --- |
| `findManagedLlamaServer(runtimeDirectory)` `src/runtimes/bootstrap.ts:207-212` → `findExecutable` `:188-205` **recurses the entire tree** | `~/.shelra/runtime/llama-cpp` | **finds `manual/llama-server.exe`** |
| `installManagedRuntime`'s `existing` check `:223` | `~/.shelra/runtime/llama-cpp/**b10826**` | **finds nothing** |

So `ManagedLlamaRuntime.hasBinary()` (`src/runtimes/managed-llama.ts:100-103`)
reports the engine as installed and starts it, while `installManagedRuntime`
would download and fail all over again. Local inference works on this machine
**only** because of the accidental interaction between a manual copy and a
recursive search.

`findExecutable` also searches `<release>.staging`, so a *partially* extracted
staging directory could expose a half-installed binary as "installed".

## 3. `resolveRuntimeInstallPlan` — platform coverage

```ts
// src/runtimes/bootstrap.ts:56-94
if (arch !== "x64" && arch !== "arm64") return undefined;                    // :61
win32 + x64   → llama-b10826-bin-win-cpu-x64.zip        sha 5828cccc…       // :62-71
darwin        → llama-b10826-bin-macos-{arm64|x64}.tar.gz  sha 15c1b2f4…   // :72-82
linux + x64   → llama-b10826-bin-ubuntu-x64.tar.gz      sha c708a8d8…      // :83-92
otherwise     → undefined                                                   // :93
```

**FACT — not covered:** Windows arm64, Linux arm64, any BSD, and — critically —
**any GPU-accelerated build on Windows or Linux**. The two `.tar.gz` entries
share a single `sha256` per platform, so macOS arm64 and x64 both map to
`15c1b2f4…` at `:80` — **a bug**: the same hash cannot be correct for two
different asset URLs. One of the two macOS platforms will always fail
verification.

**FACT — `MANAGED_LLAMA_RELEASE = "b10826"` (`:50`)** with the comment
*"Updating this pin is deliberate so a startup cannot silently execute an
unreviewed binary after a tag changes."* Good supply-chain hygiene.

**FACT — extraction uses the host shell.** `.zip` → `powershell.exe
Expand-Archive` with `-NoProfile -NonInteractive -ExecutionPolicy Bypass` and
single-quote escaping (`:166-168,175-182`); `.tar.gz` → `tar -xzf` (`:185`).
No archive-content validation (no zip-slip guard) beyond the post-extraction
`findExecutable` check.

## 4. FACT — defect D1: orphaned `llama-server` children from re-discovery

`installRecommended` and `initializeLocal` both assign
`startupDiscovery = result.discovery` (`src/index.ts:373`, and via
`renderStartup:148`) **without disposing the previous discovery**. Each
`runStartup` builds a fresh adapter list
(`createLocalRuntimeAdapters` → `new ManagedLlamaRuntime(...)`,
`src/runtimes/discovery.ts:78`), and each `ManagedLlamaRuntime` owns its own
`child` (`src/runtimes/managed-llama.ts:81`). Only the **final**
`startupDiscovery` is disposed, at `onExit` (`src/index.ts:115`).

Amplification: `installRecommended:261-266` loops `await initializeLocal()` up
to **4 times** after a runtime install, and `:276-278` recurses into
`installRecommended` again. Each iteration can leave one live `llama-server`
holding a GGUF in RAM.

**Empirical support (medium confidence):** during audit measurement a
`llama-server` process was observed with a `StartTime` matching a completed
`shelra models` run and persisted for **>13 s** after that CLI exited; three
subsequent runs left no residue. Not reliably reproducible from the `models`
command, but the code-level leak at `src/index.ts:373` is unambiguous.

## 5. What exists vs what the brief asked for

| Capability | Model download | Runtime download |
| --- | --- | --- |
| Progress (bytes/%) | **IMPLEMENTED** `:156-162` | **IMPLEMENTED** `:148-157` |
| Speed / ETA | **IMPLEMENTED** | **IMPLEMENTED** (+ elapsed) |
| Resume | **IMPLEMENTED** `:132-146` | **IMPLEMENTED** `:121-135` |
| Retries | **NOT FOUND** — one attempt, error surfaces to UI | **NOT FOUND** |
| Cancellation (code) | **IMPLEMENTED** `:151` | **IMPLEMENTED** `:140` |
| Cancellation (UX) | **NOT FOUND** — no key/button | **NOT FOUND** |
| Integrity / checksum | **IMPLEMENTED** `:169-175` | **IMPLEMENTED** `:236-237` |
| Partial-file handling | **IMPLEMENTED** | **BROKEN** — poisoned partial persists (R1) |
| Atomic completion | **IMPLEMENTED** `:176` | **PARTIAL** — two renames, no cleanup |
| Failure cleanup | **IMPLEMENTED** `:172` | **BROKEN** (R1 + R2) |
| Disk validation | **PARTIAL** — wrong volume, wrong unit (M2) | **NOT FOUND** |
| Already-installed check | **NOT FOUND** (M1) | **PARTIAL** — checks only `<release>/` (R3) |
| Registration after install | **IMPLEMENTED** — full re-discovery `:342` | **IMPLEMENTED** — rescan loop `:261-266` |
| Mirror / alternate source | **NOT FOUND** | **NOT FOUND** |
| Tests | 2 (`src/models/huggingface.test.ts`) | 4, none covering failure cleanup (`src/runtimes/bootstrap.test.ts`) |
</content>
</invoke>
