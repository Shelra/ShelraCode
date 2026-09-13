# 10 — Model lifecycle: loading, readiness, memory, OOM, quantization

## 1. Does "selected" mean "loaded"?

### FACT — YES, in both selection paths.

**Path A — startup** (`src/startup/orchestrator.ts`):
```
:93   route = selectLocalRoute(...)          → picks a candidate
:120  await runtime.prepareModel(model.id)   → ensureServer(signal, id) — REAL server start with -m <path>
:129  await runtime.health(signal)           → confirms /health 200   (⚠ see §7)
:143  activeProvider = runtime.provider(model)
:153  probe = await probeLocalModel(...)     → REAL generateText round-trip
:226  emit "ready"
```

**Path B — in-chat model picker** (`src/index.ts:168-190`):
```
:174  if (runtime.prepareModel && !(await runtime.prepareModel(candidate.id))) → error
:177  const provider = runtime.provider(candidate)
:178  const probe = await probeLocalModel(provider, candidate)
:179  if (!probe.ok) → { success:false, error: probe.reason }
:180  agent.setProvider(provider, candidate.id)
:181-185 saveUserSettings({defaultModel, localRuntimeId, lastLocalHealthCheck})
```

Both genuinely load the weights and both genuinely generate before declaring
success. This is materially better than "config points at a model".

## 2. The load operation

```ts
// src/runtimes/managed-llama.ts:138-148
const args = [
  "-m", installed.path,
  "--host", "127.0.0.1",
  "--port", String(this.port),
  "--ctx-size", String(installed.spec.contextWindow || DEFAULT_CONTEXT),   // 32_768
  "--jinja",
];
this.child = this.spawnImpl(executable, args, {
  windowsHide: true, stdio: "ignore",
  env: Object.fromEntries(Object.entries(process.env).filter(([,v]) => v !== undefined)),
});
```

**FACT — the complete argument list is five flags.** Absent: `--n-gpu-layers`,
`--threads`, `--threads-batch`, `--batch-size`, `--ubatch-size`, `--flash-attn`,
`--cache-type-k/v`, `--split-mode`, `--main-gpu`, `--tensor-split`, `--mlock`,
`--no-mmap`, `--parallel`, `--cont-batching`, `--alias`, `--api-key`.

**FACT — `stdio: "ignore"` discards all `llama-server` output.** When a load
fails (bad GGUF, missing DLL, unsupported ISA, OOM), llama.cpp's diagnostic goes
to a closed pipe. The only signal ShelraCode has is "the health endpoint never
answered." Every load failure is therefore reported with the same generic text:
*"The local runtime could not prepare {name}."*
(`src/startup/orchestrator.ts:121`) or *"The managed llama.cpp runtime could not
start."* (`src/runtimes/managed-llama.ts:202`).

**FACT — the full `process.env` is forwarded to the child** (`:153-155`),
including any API keys present in the parent environment.

**FACT — `--ctx-size` is unconditionally the model's declared context window.**
No reduction based on available RAM/VRAM, no relationship to
`estimateModelMemoryGb`, no fallback if the allocation fails.

## 3. Waiting, timeout, and readiness detection

```ts
// src/runtimes/managed-llama.ts:109-122
const deadline = Date.now() + SERVER_START_TIMEOUT_MS;   // 45_000  (:17)
while (Date.now() < deadline) {
  if (signal?.aborted) return false;
  try { if ((await this.fetchImpl(`${this.serverURL}/health`, {signal})).ok) return true; } catch {}
  await new Promise(r => setTimeout(r, 250));
}
return false;
```

| Property | Value |
| --- | --- |
| Poll interval | 250 ms |
| Budget | 45 s (`:17`) |
| Abort respected | Yes (`:112`) |
| **Child liveness checked** | **No** — see `09` §8 |
| Load progress reported | **No** — the UI shows a static `loading-model` message with no percent |

**FACT — a dead child costs the full 45 s** (when the `TypeError` at `:169`
does not fire first). During that window the startup screen shows
`loading-model` with no progress bar (`ProgressBar` returns `null` when neither
`percent` nor `completed` is set, `src/ui/startup.tsx:84`).

## 4. Readiness gate — what "ready" actually certifies

```ts
// src/startup/orchestrator.ts:27-48
export async function probeLocalModel(provider, model, signal?) {
  const probeSignal = signal ?? AbortSignal.timeout(15_000);
  const result = await provider.generateText({
    modelId: model.id, system: "Reply with the single word READY.",
    prompt: "READY", maxOutputTokens: 8, temperature: 0, signal: probeSignal,
  });
  return result.text.trim().length > 0 ? {ok:true} : {ok:false, reason:"The model returned an empty response."};
}
```

**The exact condition that permits declaring "ready" (FACT):**

1. A model candidate survived `selectLocalRoute`'s filter (`tools === true`).
2. `prepareModel` returned `true` (server answered `/health` within 45 s).
3. `runtime.health()` returned `{healthy: true}`.
4. `generateText` returned **any non-empty string** within 15 s.

| Verified | Not verified |
| --- | --- |
| Process alive (transitively) | Tool/function calling actually works |
| HTTP server responds | Streaming works |
| A model is loaded | **That the *selected* model is the one loaded** (see §7) |
| Generation produces tokens | Context settings are correct |
| | Output is coherent or correct |
| | Chat template is compatible |
| | Throughput is usable |

**FACT — the probe does not check the response content.** "Reply with the single
word READY" is a prompt, not an assertion; any non-empty text passes. A model
that replies with `"?"` is certified ready.

**FACT — `capabilityConfidence` is upgraded to `"probed"` on success**
(`src/startup/orchestrator.ts:217`), which overstates what was probed: only text
generation was tested, while `tools: true` (`src/runtimes/managed-llama.ts:47`)
remains an unverified assertion.

**FACT — the probe cost is paid on every launch.** No result is cached;
`lastLocalHealthCheck` is written (`:223`) and never read.

**FACT — `healthCheck: false` bypasses the gate entirely**
(`src/startup/types.ts:55-56`, `orchestrator.ts:147`). No production caller uses
it; it exists for diagnostics/tests. Correctly plumbed.

## 5. Memory estimation — formulas and constants verbatim

```ts
// src/hardware/profile.ts:154-168
function estimateModelMemoryGb(model: LocalModelCandidate): number | undefined {
  if (model.memoryRequiredGb && model.memoryRequiredGb > 0) return model.memoryRequiredGb;
  if (!model.parameters) return undefined;
  const quant = model.quantization?.toLowerCase() ?? "";
  const bits = quant.includes("q8") ? 8
             : quant.includes("q6") ? 6
             : quant.includes("q5") ? 5
             : quant.includes("q4") ? 4
             : 16;
  return (model.parameters / 1_000_000_000) * (bits / 8) * 1.12;
}
```

Other memory constants in the codebase:

| Constant | Value | Location | Meaning |
| --- | --- | --- | --- |
| overhead multiplier | `1.12` | `profile.ts:167` | weights → footprint |
| GPU usable fraction (scorer) | `0.82` | `profile.ts:183` | |
| GPU comfort band | `0.65` | `profile.ts:185` | +38 points |
| GPU stretch band | `1.4` | `profile.ts:187` | +4 points, requires `RAM ≥ mem × 1.5` |
| RAM usable fraction | `0.65` | `profile.ts:190` | +30 points |
| RAM ceiling | `0.9` | `profile.ts:192` | +10 points |
| GPU usable fraction (recommender) | `0.72` | `recommendation.ts:44` | **different from 0.82** |
| RAM fraction (recommender) | `0.45` | `recommendation.ts:44` | **unreachable** |
| Recommender tier thresholds | `5`, `10` GB | `recommendation.ts:45,54` | |
| Sidecar-less footprint | `max(1, sizeGiB × 1.12)` | `huggingface.ts:231` | |
| Catalog footprints | `2.2`, `5.3` GB | `huggingface.ts:53,66` | hand-written |
| Disk gate | `max(4, estMemGb × 1.25)` | `manager.ts:42` | |

### FACT — what the memory model omits

| Term | Included? |
| --- | --- |
| Model weights | **Yes** (or a hand-written figure) |
| Flat overhead | **Yes** — a single 12 % multiplier |
| **KV cache** | **No** |
| **Context length** | **No** — despite `--ctx-size 32768` always being passed |
| Batch/ubatch buffers | **No** |
| Compute buffers / scratch | **No** |
| Partial GPU offload split | **No** — the model is either "on GPU" or "on RAM" in the score |
| OS / display reserve | **No** — only the flat `0.82`/`0.65` fractions |
| Runtime process overhead | **No** |
| Quantization variant (`_K_M` vs `_K_S` vs `_0`) | **No** — all map to the same bit count |
| `Q2`, `Q3`, `IQ*`, `bpw` strings | **No** — fall through to **16 bits**, a 4–8× over-estimate |

**FACT — in the normal path the formula never runs.** `memoryRequiredGb` is set
for every managed candidate (`src/runtimes/managed-llama.ts:55`), so `:155`
short-circuits. The quantization/parameter arithmetic at `:156-167` is only
reachable for candidates lacking `memoryRequiredGb` — i.e. the
`explicitEndpointRuntime` models, which also lack `parameters`, so they return
`undefined` at `:156`. **INFERENCE (high): lines `:157-167` are effectively
unreachable in production.**

## 6. Quantization handling

| Question from the brief | Answer |
| --- | --- |
| How is quantization represented? | A free-text string on `LocalModelCandidate.quantization` (`src/runtimes/types.ts:23`) and `HuggingFaceModelSpec.quantization` (`src/models/huggingface.ts:15`). Values in use: `"Q4_K_M"` (catalog) or `"unknown"` (sidecar-less, `:229`). |
| Does Shelra **discover** it? | Only from the sidecar. **No GGUF header parsing anywhere** — verified by grep for `GGUF`/magic-byte reads. A sidecar-less GGUF is `"unknown"` forever. |
| Does Shelra **recommend** a quant? | **No.** The catalog has exactly one quant level (`Q4_K_M`) for both entries (`:49,62`), so there is no quant decision to make. |
| Does it understand memory impact? | Partially — the `q8/q6/q5/q4/else-16` ladder at `profile.ts:158-166`, which (a) ignores `_K_M`/`_K_S`/`_0` variants and (b) is effectively unreachable (§5). |
| Are variants treated independently? | **Yes structurally** — each `{repo, quant}` is a separate catalog id (`hf:<repo>:<quant>`) — but there is only one variant per repo today. |
| Manual quant choice? | **No UI.** Only `SHELRA_ONBOARDING_MODEL` (`recommendation.ts:21`), which selects a catalog id, and the catalog has no alternatives. |
| Effectively ignored? | **In practice, yes.** |

**FACT — `"unknown"` quantization is silently sorted as 16-bit** if the
formula ever runs, since `"unknown".includes("q4")` is false.

## 7. FACT — the selected model can be silently replaced (BLOCKER for multi-model)

Repeated here because it is a *lifecycle* defect, not just a runtime one:

```
orchestrator.ts:120   prepareModel("MODEL-X")   → ensureServer(signal, "MODEL-X")   loads X
orchestrator.ts:129   runtime.health(signal)
                        → managed-llama.ts:198  this.ensureServer(signal)        ← no id!
                        → managed-llama.ts:128  selected = installedModels.find(m => m.spec.id === undefined)
                                                           ?? installedModels[0]
                        → managed-llama.ts:130-133  activeModelPath !== selected.path ⇒ stopChild() + respawn
orchestrator.ts:143   provider(model)  → new port, serving installedModels[0]
orchestrator.ts:153   probe passes (llama-server serves the loaded model regardless of the requested id)
orchestrator.ts:226   "ready" with model = MODEL-X                                ← WRONG
```

The in-chat picker path (`src/index.ts:168-190`) does **not** call `health()`
and is therefore correct. Two paths, two behaviours, one of them wrong.

## 8. OOM & load-failure recovery

```ts
// src/startup/orchestrator.ts:154-190 (abridged)
if (!probe.ok) {
  const fallback = /out.?of.?memory|oom|memory|load|resource/i.test(probe.reason || "")
    ? selectLocalRoute(
        discovery.models.filter(c => c.id !== model.id &&
          (model.parameters === undefined || c.parameters === undefined || c.parameters <= model.parameters)),
        { requiresTools: true, hardware }).model
    : undefined;
  if (fallback) { /* prepare, re-probe; on success adopt it */ }
  if (!probe.ok) return { state: "recoverable-error", model: activeModel, provider: activeProvider, ... };
}
```

**FACT — what this recovery can do:** switch to a *different already-installed*
model whose `parameters` is `≤` the failed model's.

**FACT — what it cannot do:**

| Recovery action | Present? |
| --- | --- |
| Reduce `--ctx-size` and retry | **No** |
| Reduce GPU layers (`-ngl`) | **No** — the flag is never passed at all |
| Choose a smaller quantization | **No** — one quant in the catalog |
| Download a smaller model | **No** — the fallback only searches installed models |
| Fall back to CPU | **No-op** — inference is already CPU on win/linux |
| Re-enter onboarding/recommendation | **No** — returns `recoverable-error` |
| Retry the same model | **No** — one attempt |

**FACT — on a single-model machine (the normal case after onboarding) the
fallback is a guaranteed no-op**: the filter at `:158` excludes the only model
by id, so `selectLocalRoute` gets `[]` and returns `{kind:"unavailable"}`.

**FACT — the trigger is a regex on an error *string*.** `/out.?of.?memory|oom|
memory|load|resource/i` against `probe.reason`. Because `stdio: "ignore"`
discards llama.cpp's diagnostics (§2), a real OOM usually surfaces as a generic
fetch/timeout error that **does not match** the regex — so the fallback does not
even fire. And the word `load` matches broadly enough to trigger the fallback on
unrelated failures.

**FACT — an actual CUDA/ROCm/Metal OOM cannot reach this code at all.** There is
no GPU offload, so there is no GPU allocation to fail. The only realistic
failure is host-RAM exhaustion during weight loading — which kills the child
during `waitForHealth` and hits the `TypeError` at
`src/runtimes/managed-llama.ts:169` **before** any probe runs (see `09` §8).

**FACT — the error return leaks a stale provider.** `:200-209` returns
`provider: activeProvider` pointing at the *pre-fallback* port, which
`stopChild()` has already killed if a fallback was attempted. `src/index.ts`
ignores `provider` on non-`ready` states (`:376`), so no live bug today — but
`StartupResult.provider` is a public field (`src/startup/types.ts:43`) that
would mislead any other consumer.

## 9. CPU-only machines

| Question | Answer |
| --- | --- |
| Does CPU-only operation exist? | **Yes — it is the *only* mode on Windows and Linux.** The pinned assets are `bin-win-cpu-x64` (`bootstrap.ts:65`) and `bin-ubuntu-x64` (`:86`), and no offload flag is ever passed (`managed-llama.ts:138-148`). |
| Recommendation for CPU-only? | `gpuMemory === 0` → the 1.5B Q4_K_M (`recommendation.ts:34-43`). |
| Scoring for CPU-only? | RAM branch of `localModelFitScore` (`profile.ts:189-193`). |
| Thread tuning? | **None** — no `--threads`; `cpuCores` is detected and unused. |
| ISA/AVX check? | **None.** The Windows asset ships per-ISA DLLs (`ggml-cpu-haswell.dll`, `ggml-cpu-icelake.dll`, … — observed in `~/.shelra/runtime/llama-cpp/manual/`); selection is llama.cpp's own runtime dispatch, not Shelra's. |
| Tested? | `src/models/recommendation.test.ts:5` asserts the CPU-only tier. **No test spawns or loads on a CPU-only path**, and there is no throughput/usability check. |

**INFERENCE (high) — CPU-only is the *default and unavoidable* configuration
on the two most common desktop platforms, and it is the least-instrumented one.**
A 7B Q4 on CPU will be recommended to any machine with ≥7 GB detected VRAM and
then run *without* that VRAM, at CPU speed. The `maxOutputTokensForTurn` clamp
(`src/agent/agent.ts:389-398`, capping managed-llama turns at 512/256/2048
tokens) is the only acknowledgement anywhere in the codebase that local
generation is slow.

## 10. Verdict

| Aspect | Status |
| --- | --- |
| Load = real server start with weights | **IMPLEMENTED** |
| Readiness = real generation | **IMPLEMENTED** |
| Load timeout | **IMPLEMENTED** (45 s) — but no child-death detection |
| Load progress reporting | **NOT FOUND** |
| Load-failure diagnostics | **BROKEN** — `stdio:"ignore"` discards them |
| Selected model actually served | **BROKEN** for ≥2 models (§7) |
| Memory estimation | **PARTIAL/PLACEHOLDER** — weights only; formula effectively unreachable |
| Context sized to hardware | **NOT FOUND** — always 32 768 |
| GPU offload | **NOT FOUND** |
| Quantization discovery | **PARTIAL** — sidecar only, no GGUF parsing |
| Quantization recommendation | **NOT FOUND** — one quant in catalog |
| OOM recovery | **PARTIAL/PLACEHOLDER** — string-matched, installed-models-only, no-op on 1 model, unreachable for real OOM |
| Context/layer/quant degradation | **NOT FOUND** |
| CPU-only support | **IMPLEMENTED by default**, **untested and untuned** |
</content>
</invoke>
