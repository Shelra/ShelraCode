# 06 — Model recommendation & GPU as a selection signal

## 1. There are two separate, unreconciled selection systems

| | System A — bootstrap recommender | System B — installed-candidate scorer |
| --- | --- | --- |
| Symbol | `recommendBootstrapModel` | `localModelFitScore` + `selectLocalRoute` |
| File | `src/models/recommendation.ts:17-70` | `src/hardware/profile.ts:171-201` + `src/router/local-first.ts:21-59` |
| Operates on | The 2-entry `HUGGING_FACE_MODELS` catalog | `LocalModelCandidate[]` from discovery |
| Used when | **No usable local model exists** (`src/startup/orchestrator.ts:100`) | **A local model exists** (`:93-97`) |
| Signals | GPU VRAM sum **only** | GPU VRAM, else RAM; + tools, capability class, context, loaded, tok/s |
| Style | if/else tiers, hard-coded thresholds | additive integer score |
| GPU headroom factor | `0.72` (`:44`) | `0.82` (`:183`) |
| Output | `ModelRecommendation` (+ unused `alternatives`) | ranked `LocalModelCandidate[]` |

**FACT — they share no code and produce inconsistent verdicts.** A machine that
System A judges "big enough for the 7B" can, once the 7B is installed, be
scored by System B as a **negative** fit (`score -= 60`, `:188`) if
`memory > usableGpu * 1.4`, because A uses `0.72 × VRAM` while B uses
`0.82 × VRAM` and then applies its own `0.65`/`1.0`/`1.4` bands.

## 2. System A — `recommendBootstrapModel` verbatim analysis

```ts
// src/models/recommendation.ts:17-70
export function recommendBootstrapModel(hardware, env = process.env): ModelRecommendation {
  const override = env.SHELRA_ONBOARDING_MODEL?.trim();                       // :21
  if (override) { ...return { id: override, estimatedMemoryGb: selected?.estimatedMemoryGb ?? 2.2, ... }; }

  const gpuMemory = (hardware.gpu ?? [])
    .reduce((sum, gpu) => sum + (gpu.vramAvailableGb ?? gpu.vramTotalGb ?? 0), 0);   // :33
  if (gpuMemory === 0) {                                                      // :34
    const cpuModel = HUGGING_FACE_MODELS[0];                                  // :35   → 1.5B
    return { ... reason: "A compact coding model selected for a responsive private session on this computer." };
  }
  const usableMemory = gpuMemory > 0 ? gpuMemory * 0.72
                                     : (hardware.memoryAvailableGb ?? hardware.memoryGb) * 0.45;  // :44
  if (usableMemory < 5)  return HUGGING_FACE_MODELS[0];   // 1.5B             // :45-53
  if (usableMemory < 10) return HUGGING_FACE_MODELS[1];   // 7B               // :54-62
  return HUGGING_FACE_MODELS[1];                          // 7B               // :63-69
}
```

### FACT — the RAM branch at `:44` is unreachable dead code

`gpuMemory === 0` already returned at `:34-43`. Therefore at `:44` `gpuMemory`
is always `> 0`, the ternary always takes the `gpuMemory * 0.72` arm, and
`(hardware.memoryAvailableGb ?? hardware.memoryGb) * 0.45` **can never
execute**. RAM, CPU, cores, storage, arch and platform are **not inputs to the
bootstrap recommendation at all**.

This directly contradicts `docs/architecture/11-STARTUP-ONBOARDING.md:16-19`
("scores the reviewed Hugging Face GGUF seed catalog using GPU/VRAM first,
**then RAM/CPU/storage and context headroom**"). **Docs vs code: code wins;
the doc claim is false.**

### FACT — the tiers at `:54-62` and `:63-69` are behaviourally identical

Both return `HUGGING_FACE_MODELS[1]` with the same `id`, `name`,
`estimatedMemoryGb` and `alternatives`. Only the human-readable `reason` string
differs. There is no third tier and no model above 7B in the catalog, so a
24 GB or 80 GB GPU receives exactly the same recommendation as a 10 GB one.

### FACT — the complete decision table

| Detected VRAM (sum of `vramAvailableGb ?? vramTotalGb`) | `usableMemory` | Recommendation |
| --- | --- | --- |
| `0` (no GPU, AMD-on-Windows, Intel, **Apple Silicon**, ROCm) | *(n/a, early return)* | **Qwen2.5-Coder-1.5B Q4_K_M** |
| `> 0` and `< 6.94` (e.g. 4 GB, 6 GB) | `< 5` | **Qwen2.5-Coder-1.5B Q4_K_M** |
| `≥ 6.94` (e.g. 8, 12, 16, 24, 48, 80 GB) | `≥ 5` | **Qwen2.5-Coder-7B Q4_K_M** |

**Three inputs collapse to two outputs.** That is the entire recommendation
system for a machine with no installed model.

### FACT — the `SHELRA_ONBOARDING_MODEL` override is unvalidated

`:21-31` returns `{ id: override, name: override, estimatedMemoryGb: selected?.estimatedMemoryGb ?? 2.2 }`
**even when `HUGGING_FACE_MODELS.find(...)` returns `undefined`**. The
recommendation then flows to `installLocalModel` →
`ManagedLlamaRuntime.installModel` → `getHuggingFaceModelSpec(id)` which returns
`undefined` → `{success:false, reason:"That Hugging Face model is not in
Shelra's reviewed local catalog."}` (`src/runtimes/managed-llama.ts:224-225`).
Recoverable, but the UI will have already displayed a fabricated
recommendation panel with a 2.2 GB estimate for a model that does not exist.

### FACT — `alternatives` is populated on every path and never rendered

`:41`, `:51`, `:60`, `:68` all build an `alternatives` array with a `"faster"`
or `"quality"` label. Grep of `src/ui/startup.tsx`: no reference. Grep of
`src/index.ts`: `startupRecommendation.alternatives` is never read. **Dead
output — the user is never offered a choice.**

## 3. System B — `localModelFitScore` verbatim analysis

```ts
// src/hardware/profile.ts:171-201
export function localModelFitScore(model, hardware = inspectHardware()): number {
  let score = model.loaded ? 25 : 0;                                        // :172
  if (model.tools) score += 20;                                             // :173
  if (model.capabilityClass === "agent")   score += 15;                     // :174
  else if (model.capabilityClass === "coding") score += 10;                 // :175
  else if (model.structuredOutput)         score += 5;                      // :176
  if (model.contextWindow >= 32_000)       score += 8;                      // :177

  const memory = estimateModelMemoryGb(model);                              // :179
  const gpus = hardware.gpu ?? [];
  const availableGpu = Σ (gpu.vramAvailableGb ?? gpu.vramTotalGb ?? 0);     // :181
  const totalGpu     = Σ (gpu.vramTotalGb ?? 0);                            // :182
  const usableGpu    = Math.max(0, (availableGpu || totalGpu) * 0.82);      // :183

  if (memory !== undefined && usableGpu > 0) {                              // :184
    if      (memory <= usableGpu * 0.65) score += 38;                       // :185
    else if (memory <= usableGpu)        score += 20;                       // :186
    else if (memory <= usableGpu * 1.4 && hardware.memoryGb >= memory * 1.5) score += 4;   // :187
    else                                 score -= 60;                       // :188
  } else if (memory !== undefined) {                                        // :189
    const usableRam = (hardware.memoryAvailableGb ?? hardware.memoryGb) * 0.65;            // :190
    if      (memory <= usableRam)              score += 30;                 // :191
    else if (memory <= hardware.memoryGb * 0.9) score += 10;                // :192
    else                                        score -= 45;                // :193
  }

  if (memory !== undefined && usableGpu > 0 && memory <= usableGpu)
    score += Math.max(0, Math.round((1 - memory / usableGpu) * 12));        // :196-198
  if (model.estimatedTokensPerSecond) score += Math.min(10, round(tok/s / 5));  // :199
  return score;
}
```

### Exact input inventory

| Signal | Used? | Max weight | Source |
| --- | --- | --- | --- |
| Already loaded | Yes | 25 | `model.loaded` — set only by `runStartup:215` on the *returned* copy, so almost always `false` during ranking |
| Tool support | Yes | 20 | `model.tools` — **hard-coded `true`** for every managed GGUF (`src/runtimes/managed-llama.ts:47`) ⇒ **constant** |
| Capability class | Yes | 15 | `capabilityClass` — **hard-coded `"agent"`** (`:56`) ⇒ **constant** |
| Context ≥ 32 K | Yes | 8 | `contextWindow` — **hard-coded 32 768** (`:45`) ⇒ **constant** |
| GPU VRAM fit | Yes | **+38 / −60** | dominant term |
| GPU headroom bonus | Yes | +12 | `:196-198` |
| RAM fit (GPU-less) | Yes | +30 / −45 | `:190-193` |
| Tokens/sec | Yes | +10 | `estimatedTokensPerSecond` — **never set by any producer** (grep: declared `src/runtimes/types.ts:30`, written nowhere) ⇒ **dead** |
| Quantization | **Indirectly** | — | only via `estimateModelMemoryGb`'s bit-width guess |
| Parameter count | **Indirectly** | — | same |
| CPU cores / model | **No** | — | — |
| Storage | **No** | — | — |
| Coding benchmark | **No** | — | — |
| Download size | **No** | — | — |
| Measured latency | **No** | — | — |
| Licensing | **No** | — | — |

**FACT — for the managed-llama runtime, five of the nine terms are constants.**
`tools` (+20), `capabilityClass` (+15), `contextWindow ≥32k` (+8) are identical
for every discovered GGUF; `estimatedTokensPerSecond` is never populated; and
`loaded` is `false` during ranking. The score therefore reduces to
**`43 + memory-fit term (+38…−60) + headroom bonus (0…+12)`** — i.e. it is,
in practice, **a pure memory-fit function**.

### FACT — GPU is the strongest signal *by weight*, and it is decisive

Range of the GPU branch is 98 points (`+38` to `−60`); the entire rest of the
score spans 68. So yes — *when a GPU with a known VRAM figure is present*, GPU
memory dominates ranking. That satisfies the letter of "GPU as strongest
signal".

### FACT — but the GPU branch is skipped far more often than it fires

`usableGpu > 0` requires `gpu[].vramTotalGb` or `vramAvailableGb` to be a
number. Per `05-HARDWARE-DETECTION.md`, that holds **only for NVIDIA** (and
some Intel-Mac discrete GPUs). Apple Silicon, all AMD, all Intel, and every
call site that passes `inspectHardware()` (`src/index.ts:464`,
`src/setup/onboarding.ts:105`, the default parameter at `:171`) fall into the
RAM branch instead.

## 4. `estimateModelMemoryGb` — the shared foundation

```ts
// src/hardware/profile.ts:154-168
function estimateModelMemoryGb(model) {
  if (model.memoryRequiredGb > 0) return model.memoryRequiredGb;          // :155
  if (!model.parameters) return undefined;                                // :156
  const quant = model.quantization?.toLowerCase() ?? "";
  const bits = quant.includes("q8") ? 8 : quant.includes("q6") ? 6
             : quant.includes("q5") ? 5 : quant.includes("q4") ? 4 : 16;  // :158-166
  return (model.parameters / 1e9) * (bits / 8) * 1.12;                    // :167
}
```

**FACT — verbatim constants:** bit-widths `{q8:8, q6:6, q5:5, q4:4, else:16}`;
overhead multiplier `1.12`.

**FACT — what the formula omits:** KV cache, context length, batch size,
runtime/allocator overhead, OS/display reserve, partial-offload split, and
quantization *variants* (`Q4_K_M` vs `Q4_K_S` vs `Q4_0` all map to 4 bits).
`Q2`/`Q3`/`IQ*`/`bpw` strings fall through to **16 bits**, over-estimating a
Q2 model by 4×.

**FACT — this omission is material because `--ctx-size` is always the full
window.** `src/runtimes/managed-llama.ts:146` passes
`String(installed.spec.contextWindow || DEFAULT_CONTEXT)` = 32 768 with no
consideration of fit. For a 7B model at 32 K context the KV cache alone is on
the order of 1–2 GB, entirely unaccounted for.

**FACT — the `memoryRequiredGb` shortcut at `:155` usually wins.**
`modelCandidate` sets `memoryRequiredGb: installed.spec.estimatedMemoryGb`
(`src/runtimes/managed-llama.ts:55`), which for catalog models is the
hand-written `2.2` / `5.3` (`src/models/huggingface.ts:53,66`) and for
sidecar-less files is `max(1, fileSizeGiB × 1.12)` (`:231`). So in the normal
path the parameter/quantization formula at `:156-167` **is not even executed**.

## 5. Does GPU influence how the model *runs*?

### FACT — no. Not at all.

`ensureServer` builds the argument list at `src/runtimes/managed-llama.ts:138-148`:

```ts
const args = ["-m", installed.path, "--host", "127.0.0.1", "--port", String(this.port),
              "--ctx-size", String(installed.spec.contextWindow || DEFAULT_CONTEXT), "--jinja"];
```

There is **no `--n-gpu-layers`/`-ngl`, no `--threads`, no `--split-mode`, no
`--main-gpu`, no `--flash-attn`, no `--tensor-split`, no `--mlock`, no
`--no-mmap`** — and no conditional argument construction of any kind.

And the *binary itself* is a CPU build on two of three platforms
(`src/runtimes/bootstrap.ts`):

| Platform | Pinned asset | Line |
| --- | --- | --- |
| win32 x64 | `llama-b10826-bin-**win-cpu-x64**.zip` | `:65` |
| darwin arm64/x64 | `llama-b10826-bin-macos-arm64/x64.tar.gz` | `:76` |
| linux x64 | `llama-b10826-bin-**ubuntu-x64**.tar.gz` (the CPU asset; CUDA is a separate `-cu12` asset upstream) | `:86` |

**Conclusion (FACT for Windows, INFERENCE-high for Linux):** ShelraCode's
managed engine performs **CPU inference**, regardless of the GPU it detected and
scored against. The entire GPU pipeline — `nvidia-smi` parsing, VRAM summation,
`usableGpu * 0.82`, the `+38/−60` band — exists to choose *which* model to run,
and has **zero influence on execution**. On macOS arm64 the official asset does
ship Metal support, but with no `-ngl` argument the offload behaviour is left to
the binary's default rather than being chosen from the detected hardware.

This is the single largest gap between the desired product flow
("evaluate GPU/VRAM → … → prepare runtime → load model") and the implementation.

## 6. Tests

| Test | File | What it actually asserts |
| --- | --- | --- |
| "prioritizes GPU headroom while keeping CPU-only machines supported" | `src/models/recommendation.test.ts:5` (1 test) | System A tiers |
| "scores a tool-capable model that fits available memory" | `src/hardware/profile.test.ts:5` (1 test) | System B, one case |
| "selects a loaded tool-capable local model" / "fails closed when local-only policy has no eligible model" | `src/router/local-first.test.ts:33,40` | routing filter/sort |
| "exposes a hardware-ranked recommendation when a runtime can install" | `src/startup/orchestrator.test.ts:71` | asserts the 12 GB fixture yields the 7B id |

**FACT — no test covers:** the unreachable RAM branch, Apple-Silicon/AMD
zero-VRAM behaviour, multi-GPU summation, the `SHELRA_ONBOARDING_MODEL` invalid
override, quantization strings other than `Q4_K_M`, or the disagreement between
System A and System B.

## 7. Verdict

| Question from the brief | Answer |
| --- | --- |
| Is there a scoring system? | **Yes — two of them**, unreconciled |
| Is selection static rules? | System A: **yes, 3 hard-coded tiers over a 2-entry catalog**. System B: additive score |
| Does it ignore GPU? | **No** — GPU is the dominant *scoring* term when VRAM is known |
| Does it only check total RAM? | System B falls back to RAM whenever VRAM is unknown — which is most non-NVIDIA machines |
| Exactly how much does GPU matter today? | **For model choice: decisive (98-point swing). For model execution: zero.** |
| Benchmark-aware? | **No** |
| Dynamic / remote-catalog? | **No** — 2 hard-coded entries |
| Runtime-based capability probing? | Only the binary READY probe (`src/startup/orchestrator.ts:27-48`); nothing feeds back into scores |
</content>
</invoke>
