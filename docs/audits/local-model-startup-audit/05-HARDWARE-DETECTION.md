# 05 — Hardware detection

Everything hardware-related lives in **one file**: `src/hardware/profile.ts`
(205 lines). There is no second implementation anywhere in `src/` (verified by
grep for `nvidia-smi`, `system_profiler`, `rocm-smi`, `totalmem`, `os.cpus`,
`statfs`, `wmic`, `Get-CimInstance`, `lspci`, `vulkaninfo`, `clinfo`).

## 1. The two entry points

| Function | Line | Sync? | GPU? | Storage? | Cost |
| --- | --- | --- | --- | --- | --- |
| `inspectHardware()` | `:34-44` | **sync** | **never** — hard-codes `gpu: []` (`:42`) | no | `os.cpus()` ×2, `os.totalmem()`, `os.freemem()` |
| `detectHardware(run?)` | `:144-152` | async | yes (`detectGpus`) | yes (`statfsSync`) | spawns up to 2 child processes |

```ts
// src/hardware/profile.ts:34-44   — note gpu: []
export function inspectHardware(): HardwareProfile {
  return {
    platform: process.platform, arch: process.arch,
    cpuModel: os.cpus()[0]?.model?.trim() || "Unknown CPU",
    cpuCores: os.cpus().length,
    memoryGb: round(os.totalmem() / 1024 ** 3),
    memoryAvailableGb: round(os.freemem() / 1024 ** 3),
    gpu: [],
  };
}
```

**FACT — `inspectHardware()` is not a "fast profile", it is a *GPU-blind*
profile**, and it is used in three consequential places:

| Call site | Consequence |
| --- | --- |
| `src/index.ts:133` `startupHardware = inspectHardware()` | The first startup frame always renders "CPU mode / no dedicated VRAM" or the "Scanning…" placeholder (`src/ui/startup.tsx:119-122`) |
| `src/index.ts:464` `hardware: inspectHardware()` inside `configureLocalProvider` | The **non-`runStartup`** local wiring path ranks models as if the machine had no GPU |
| `src/startup/orchestrator.ts:63` `hardware = options.hardware ?? inspectHardware()` | The value used if discovery throws before `Promise.all` resolves (`:80-90`) |
| `src/hardware/profile.ts:171` default parameter of `localModelFitScore` | Any caller that omits hardware silently scores GPU-blind — e.g. `src/setup/onboarding.ts:105` |

## 2. GPU detection

```ts
// src/hardware/profile.ts:105-130
async function detectGpus(platform, run) {
  try { parsed = parseNvidia(await run("nvidia-smi",
          ["--query-gpu=name,memory.total,memory.free","--format=csv,noheader,nounits"]));
        if (parsed.length) return parsed; } catch {}
  if (platform === "darwin") {
    try { return parseMacDisplays(await run("system_profiler", ["SPDisplaysDataType"])); }
    catch { return []; } }
  try { return parseRocm(await run("rocm-smi", ["--showproductname"])); } catch { return []; }
}
```

Runner: `execFile` with `timeout: 2_500`, `windowsHide: true`, `maxBuffer: 1 MB`
(`:48-51`).

| Vendor / stack | Detected? | VRAM total? | VRAM **available**? | Evidence |
| --- | --- | --- | --- | --- |
| NVIDIA (any OS, `nvidia-smi` on PATH) | **Yes** | **Yes** (`memory.total`, MiB→GiB `/1024`) | **Yes** (`memory.free`) | `:53-73`, `:107-110` |
| Apple Silicon / Intel Mac GPU | **Yes** (name) | **Only if `system_profiler` prints a `VRAM:` line** | **No** | `:85-103` |
| AMD via ROCm (Linux) | Name only | **No — `parseRocm` never sets `vramTotalGb`** | No | `:75-83` |
| **AMD on Windows** | **No** | — | — | no code path |
| **Intel Arc / iGPU (any OS)** | **No** | — | — | no code path |
| **Vulkan / OpenCL / DirectML / SYCL** | **No** | — | — | no code path |
| CUDA/ROCm/Metal *version* | **No** — only a label string | — | — | `accelerationBackends: ["cuda"|"rocm"|"metal"]` `:69,82,92` |

**FACT — Apple Silicon reports no VRAM.** `parseMacDisplays` only assigns
`vramTotalGb` when the output matches `/^(?:VRAM|Total.*VRAM):\s*([\d.]+)\s*(GB|MB)/i`
(`:96-100`). Apple Silicon uses unified memory and `system_profiler
SPDisplaysDataType` does not emit a VRAM line for it. **Consequence (FACT,
traced):** on an M-series Mac, `gpu[0].vramTotalGb` is `undefined` →
`recommendBootstrapModel`'s `gpuMemory` sum is `0`
(`src/models/recommendation.ts:33`) → the machine is treated exactly like a
CPU-only box and always gets the 1.5B model, even on a 128 GB M3 Max.

**FACT — `accelerationBackends` is dead data.** Grep across `src/`: the field is
written at `:69,82,92` and read **nowhere**. No backend selection, no runtime
build choice, no `-ngl` decision consumes it.

**FACT — the "first-match-wins" order can misreport.** `nvidia-smi` is tried
first on *every* platform (`:107`), so on a Mac with an eGPU or on a Linux box
with both NVIDIA and AMD, only the first family is reported and the ROCm branch
is unreachable once NVIDIA parses.

**FACT — multi-GPU is parsed but only partially consumed.** `parseNvidia`
returns one entry per line (`:58-72`), and the scorers sum across all entries
(`src/hardware/profile.ts:181-182`, `src/models/recommendation.ts:33`). Summing
VRAM across physically separate GPUs is **not a valid fit signal** for llama.cpp
without tensor-splitting configuration, which the runtime never requests.
**INFERENCE (high):** a 2× 8 GB machine is scored as if it had 16 GB usable.

## 3. RAM

**FACT.** `memoryGb = os.totalmem()`, `memoryAvailableGb = os.freemem()`
(`:40-41`). Both are captured once per `inspectHardware()` call and never
refreshed.

`os.freemem()` on Windows returns the OS "available physical memory" — a
volatile number. **INFERENCE (medium):** using it as the availability signal in
`localModelFitScore:190` (`(memoryAvailableGb ?? memoryGb) * 0.65`) makes model
ranking depend on whatever else the user has open at launch, with no smoothing
or floor.

## 4. CPU

**FACT.** `cpuModel` (first core's model string) and `cpuCores`
(`os.cpus().length` — **logical** cores, not physical) at `:38-39`.

**FACT — CPU data is never used for any decision.** Grep for `cpuCores` /
`cpuModel` across `src/`: read only for display —
`src/ui/startup.tsx` does not render them at all; `src/setup/onboarding.ts:49`
prints them in the `shelra setup` text report. **No thread count is derived, no
`--threads` flag is passed to `llama-server`
(`src/runtimes/managed-llama.ts:138-148`), no AVX/ISA capability is probed.**

## 5. Storage

```ts
// src/hardware/profile.ts:132-141
const statfs = (fs as ...).statfsSync;
if (!statfs) return undefined;
return round((statfs(process.cwd()).bavail * bsize) / 1024 ** 3);
```

**FACT — measured against `process.cwd()`, not the model directory.** Models
are written to `~/.shelra/models` (`src/models/huggingface.ts:85-87`). On a
machine where the repo is on `D:` and the home directory on `C:` — **exactly
this machine** — the free-space check governs the wrong volume.

Consumer: `installLocalModel` (`src/models/manager.ts:42-45`):

```ts
const requiredStorage = Math.max(4, (expectedSizeGb ?? 0) * 1.25);
if (hardware.storageAvailableGb !== undefined && hardware.storageAvailableGb < requiredStorage)
  return { success: false, reason: "There is not enough free storage to install a local coding model." };
```

**FACT — a unit confusion.** The caller passes
`startupRecommendation.estimatedMemoryGb` (`src/index.ts:326`), which is a
*memory* footprint (`src/models/huggingface.ts:53,66`), not a *download* size.
For the 7B entry: `estimatedMemoryGb = 5.3` but `sizeBytes = 5_025_000_000`
(≈4.68 GiB). The check demands 6.6 GiB for a 4.68 GiB file — conservative here,
but the two quantities are unrelated by construction and `sizeBytes` — the
correct field — is available and ignored.

## 6. Where hardware data is actually consumed

| Consumer | What it reads | Effect |
| --- | --- | --- |
| `localModelFitScore` `src/hardware/profile.ts:171-201` | `gpu[].vramAvailableGb/vramTotalGb`, `memoryAvailableGb`, `memoryGb` | ranks **installed** candidates |
| `recommendBootstrapModel` `src/models/recommendation.ts:33-69` | `gpu[].vramAvailableGb/vramTotalGb` **only** (RAM branch unreachable — see `06`) | picks a **catalog** entry to download |
| `installLocalModel` `src/models/manager.ts:43` | `storageAvailableGb` | pre-download disk gate |
| `StartupScreen` `src/ui/startup.tsx:117-127,188-193` | `gpu[0].vendor/model/vramTotalGb`, `memoryGb` | display |
| `renderOnboarding` `src/setup/onboarding.ts:49-58` | cpuModel, cpuCores, memoryGb, gpu[], storageAvailableGb | display |

**FACT — `cpuCores`, `cpuModel`, `arch`, `platform`, `accelerationBackends` and
`vramAvailableGb`-vs-`vramTotalGb` distinction never influence how a model is
*run*.** They influence only which model is *chosen* and what is *printed*.

**This is the audit brief's exact test case:** *"A scanner whose output nobody
uses is not an implemented recommendation system."* Here the scanner's output
**is** used — but only for selection, never for execution. See `06` and `09`.

## 7. Testing

**FACT.** `src/hardware/profile.test.ts` contains **one** test:
`"scores a tool-capable model that fits available memory"` — it exercises
`localModelFitScore`, not detection. There is **no test at all** for
`detectHardware`, `detectGpus`, `parseNvidia`, `parseRocm`, `parseMacDisplays`,
or `detectStorageAvailableGb`, despite `detectHardware` accepting an injectable
`CommandRunner` (`:144`) that makes them trivially testable.

## 8. Verdict

| Capability | Status |
| --- | --- |
| CPU model / core count | **IMPLEMENTED** (detected, never used for decisions) |
| Total RAM | **IMPLEMENTED** |
| Available RAM | **IMPLEMENTED** (volatile, unsmoothed) |
| Platform / arch | **IMPLEMENTED** |
| Storage free | **PARTIAL** — measures `cwd`, not the model volume |
| NVIDIA GPU + VRAM total + free | **IMPLEMENTED** |
| Apple GPU name | **PARTIAL** — no VRAM ⇒ treated as CPU-only |
| AMD GPU (Linux/ROCm) | **PARTIAL** — name only, no VRAM |
| AMD GPU (Windows) | **NOT FOUND** |
| Intel GPU (any) | **NOT FOUND** |
| Vulkan / OpenCL / DirectML | **NOT FOUND** |
| CUDA/ROCm/Metal version or presence check | **NOT FOUND** (label string only) |
| Multi-GPU correctness | **BROKEN** (naive VRAM summation) |
| Backend selection from hardware | **NOT FOUND** — `accelerationBackends` is written and never read |
| Hardware persistence / caching | **NOT FOUND** — re-scanned every launch |
| Tests for detection | **NOT FOUND** |
</content>
</invoke>
