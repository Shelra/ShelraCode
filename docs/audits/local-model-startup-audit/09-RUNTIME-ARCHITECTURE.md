# 09 — Runtime architecture & lifecycle

## 1. The runtime abstraction

```ts
// src/runtimes/types.ts:35-61
export interface LocalRuntimeAdapter {
  readonly id: string;
  readonly kind: LocalRuntimeKind;              // "managed-llama" | "openai-compatible"
  readonly baseURL: string;
  detect(signal?): Promise<boolean>;
  health(signal?): Promise<LocalRuntimeHealth>;
  listModels(signal?): Promise<LocalModelCandidate[]>;
  prepareModel?(modelId, signal?): Promise<boolean>;      // optional
  dispose?(): Promise<void> | void;                        // optional
  hasRuntimeBinary?(): Promise<boolean>;                   // optional
  installModel?(request): Promise<{success, reason?}>;     // optional
  provider(model): ProviderAdapter;
}
```

**FACT — this is a sound, minimal contract**, and it is the correct seam for the
desired architecture. `LocalRuntimeKind` is a closed union of exactly two
members (`:3`).

## 2. Runtime capability matrix

Only **two** adapters exist in the entire codebase
(`createLocalRuntimeAdapters`, `src/runtimes/discovery.ts:74-85`).

| Capability | `ManagedLlamaRuntime` (`shelra-llama`) | `explicitEndpointRuntime` (`local-openai`) |
| --- | --- | --- |
| **Defined at** | `src/runtimes/managed-llama.ts:73-284` | `src/runtimes/discovery.ts:7-72` |
| **Enabled** | **always** (`:78`) | only when `SHELRA_LOCAL_ENDPOINT` or `OPENAI_BASE_URL` is set (`:82-83`) |
| Discovery | binary present + GGUFs on disk; **starts the server** (`:186-192`) | `GET {base}/models` returns ok (`:13-19`) |
| Startup (own process) | **Yes** — spawns `llama-server` (`:150-156`) | **No** — assumes an already-running server |
| Shutdown | **Yes** — `dispose()`/`stopChild()` (`:250-270`) | **No** `dispose` at all |
| Health check | `GET /health`, 45 s budget (`:109-122,194-206`) | `GET /models` (`:20-36`), latency + reason |
| Model listing | filesystem GGUF scan (`:208-211`) | `/models` JSON `data[].id` (`:37-67`) |
| Model **load** | **Yes** — `prepareModel` → `ensureServer(id)` (`:246-248`) | **No `prepareModel`** — cannot select a model |
| Model unload | Implicit — stopping the child (`:133`) | n/a |
| Streaming | via `LocalProviderAdapter.stream` (`src/runtimes/local-provider.ts:81-108`) | same class (`discovery.ts:69`) |
| Tool support | **asserted** `tools: true` (`:47`) | **asserted** `tools: true` (`discovery.ts:54`) |
| Context discovery | from sidecar/`DEFAULT_CONTEXT` 32 768 (`:45`) | **hard-coded 32 768** (`discovery.ts:53`) |
| GPU backend support | **None** — no flag, CPU asset on win/linux | inherited from whatever the user runs |
| Model install | **Yes** — HF catalog (`:213-236`) | **No** |
| `hasRuntimeBinary` | **Yes** (`:281-283`) | **No** |
| Error handling | try/catch → `false`/`{healthy:false}` | try/catch → `false`/`[]` |
| Tests | 1 (`managed-llama.test.ts`) | 2 (`discovery.test.ts:9,23`) |

**FACT — runtimes NOT supported (verified by exhaustive grep):** Ollama,
LM Studio, llamafile, koboldcpp, text-generation-webui, GPT4All, Jan, MLX,
vLLM, TGI, TensorRT-LLM, any embedded/in-process inference. This is an explicit
design decision (`src/runtimes/discovery.ts:79-81`).

## 3. Who owns the lifecycle — ShelraCode does

**FACT.** For `shelra-llama`, ShelraCode owns every step:

| Phase | Code |
| --- | --- |
| Binary install | `installManagedRuntime` `src/runtimes/bootstrap.ts:214-254` |
| Binary discovery | `findManagedLlamaServer` `:207-212` (recursive) |
| Port allocation | `freeLoopbackPort` `src/runtimes/managed-llama.ts:19-33` — binds `:0` on `127.0.0.1`, reads the assigned port, closes |
| Spawn | `:150-156` — `spawn(exe, args, {windowsHide, stdio:"ignore", env: filtered process.env})` |
| Readiness | `waitForHealth` `:109-122` — `GET /health` every 250 ms up to 45 s (`:17`) |
| Model swap | `:130-133` — if `activeModelPath !== selected.path`, `stopChild()` then respawn |
| Shutdown | `stopChild` `:256-270` — `child.kill()`, resolve on `exit` or after 2 s |
| Exit tracking | `:157-161` — `once("exit")` clears `port`, `child`, `activeModelPath` |

**FACT — the user is never asked to install or start a runtime application.**
That matches the product intent and is a real strength.

## 4. Concurrency control

```ts
// src/runtimes/managed-llama.ts:124-184 (abridged)
private async ensureServer(signal?, requestedModelId?): Promise<boolean> {
  if (this.starting) return this.starting;                      // :125  single-flight
  const task = (async () => { ... })();
  this.starting = task;                                          // :178
  try { return await task; } finally { if (this.starting === task) this.starting = undefined; }  // :179-183
}
```

**FACT — the single-flight lock works within one adapter instance**, and is the
subject of the only `managed-llama` test (`"serializes concurrent discovery
health checks into one server"`). It is what keeps `detect` + `health` running
concurrently in `discoverLocalRuntimes` (`src/runtimes/discovery.ts:93-97`) from
spawning two servers.

**FACT — it does NOT protect across adapter instances.** Every
`discoverLocalRuntimes()` call constructs a **new** `ManagedLlamaRuntime`
(`:78`), with a fresh `starting`/`child`/`port`. Two overlapping or sequential
discovery passes therefore have independent locks. This is the mechanism behind
the orphan leak at `src/index.ts:373`.

## 5. Ports

**FACT.** Ephemeral, OS-assigned, loopback-only: `server.listen(0, "127.0.0.1")`
then read `address().port` and close (`:19-33`).

**FACT — this is a classic bind-race.** The port is released before
`llama-server` binds it (`:30` closes, `:137` stores, `:150` spawns). Another
process can take it in the interval. `waitForHealth` would then poll a foreign
service; if that service happens to answer `200` on `/health`, the adapter would
declare a wrong process healthy. **INFERENCE (low probability, high impact).**

**FACT — no port persistence, no conflict handling, no reuse.** Each spawn gets
a new port; nothing is written to disk; nothing detects an already-running
Shelra `llama-server` from a previous crashed session.

## 6. State transitions — what actually happens

| Situation | Behaviour | Evidence |
| --- | --- | --- |
| Runtime binary missing | `detect()` returns `false` (`:187`) but the adapter is **still listed** because it exposes `installModel` (`src/runtimes/discovery.ts:105-107`) | intentional — enables first-run install |
| Runtime present, no models | `detect()` returns `true` without starting a server (`:190`); `health()` returns `{healthy:false, reason:"The managed runtime has no installed model."}` (`:197`) | |
| Runtime present + models | `detect()` **starts the server** (`:190`) | see §7 |
| Server stopped | Next `ensureServer` respawns (`:130` fails the liveness test) | |
| Wrong model loaded | `stopChild()` + respawn (`:133`) | |
| Server crashes mid-session | `exit` handler clears state (`:157-161`); **nothing notices until the next request fails** — no supervisor, no restart, no UI signal | |
| CLI exits normally | `onExit` → `disposeLocalRuntimes(startupDiscovery)` (`src/index.ts:115`) → `dispose()` → `stopChild()` | |
| CLI crashes | `uncaughtException`/`unhandledRejection` → `process.exit(1)` (`src/index.ts:62-70`) **without** disposing runtimes → **orphan** | |
| SIGTERM | `process.exit(0)` (`:56-60`) **without** disposing → **orphan** | |
| Second discovery pass | previous adapter never disposed → **orphan** | `src/index.ts:373` |

**FACT — three distinct orphan paths exist** (crash, SIGTERM, re-discovery), and
none of them is covered by a test.

## 7. FACT — discovery starts inference (the central performance defect)

```ts
// src/runtimes/managed-llama.ts:186-192
async detect(signal?) {
  if (!(await this.hasBinary())) return false;
  if ((await this.installedModels()).length > 0) await this.ensureServer(signal);   // ← SPAWN
  return true;
}
// :194-206
async health(signal?) {
  const models = await this.installedModels();
  if (models.length === 0) return {healthy:false, ...};
  if (!(await this.ensureServer(signal))) return {healthy:false, ...};              // ← SPAWN
  return {healthy:true, latencyMs};
}
```

Consequences, all **FACT**:

* `shelra models` — a pure listing command — spawns `llama-server` and loads a
  GGUF into RAM. **Measured: 2 817 / 3 475 / 5 380 ms**, and a live
  `llama-server` PID was captured by a concurrent sampler during a run.
* `configureLocalProvider`'s 750 ms discovery (`src/index.ts:460`) starts a
  server it will abandon — **including on the `--remote` path**, which never
  uses it.
* Startup pays the model-load cost during `detecting-runtime`, before the user
  has agreed to anything.
* Because `ensureServer` is called with **no model id** from `detect`/`health`,
  it loads `installedModels[0]` (`:128`) — an arbitrary choice that then has to
  be undone by `prepareModel(realId)` (a full stop/respawn) once selection
  completes.

## 8. FACT — defect: `this.child.kill()` on a possibly-`undefined` child

```ts
// src/runtimes/managed-llama.ts:150-175
this.child = this.spawnImpl(executable, args, {...});
this.child.once("exit", () => { this.port = undefined; this.child = undefined; this.activeModelPath = undefined; });  // :157-161
...
const healthy = await this.waitForHealth(signal);          // :167
if (!healthy) {
  this.child.kill();                                       // :169  ← TypeError if exit already fired
  this.child = undefined; this.port = undefined; this.activeModelPath = undefined;
}
```

**FACT.** If `llama-server` exits during `waitForHealth` — the *normal* outcome
for an OOM, a corrupt GGUF, a missing DLL, or an unsupported CPU ISA — the
`exit` handler at `:159` sets `this.child = undefined`, and `:169` then throws
`TypeError: Cannot read properties of undefined (reading 'kill')`. TypeScript
does not catch this because property narrowing survives the `await` (a known
unsoundness).

The throw escapes `ensureServer`'s IIFE, rejecting `this.starting`, which
propagates through `detect`/`health`/`prepareModel` into `discoverLocalRuntimes`'
`Promise.all` (`src/runtimes/discovery.ts:91`) → `runStartup`'s catch
(`src/startup/orchestrator.ts:80-90`) → `state: "recoverable-error"` with a raw
`TypeError` message shown to the user. **The OOM fallback at
`src/startup/orchestrator.ts:154-190` never runs**, because the throw happens
before any probe.

**FACT — compounding defect:** `waitForHealth` (`:109-122`) polls purely on time
and never inspects `this.child`. A child that dies in the first second still
burns the full `SERVER_START_TIMEOUT_MS = 45_000` (`:17`) before the loop ends —
except that here the `TypeError` fires first, so the user gets an obscure crash
instead of a 45 s wait. Either outcome is wrong.

## 9. FACT — defect: `health()` reloads the wrong model

`runStartup` sequence (`src/startup/orchestrator.ts`):

```
:120   await runtime.prepareModel(model.id, signal)   → ensureServer(signal, "MODEL-X")  ✔ loads X
:129   runtimeHealth = runtime.prepareModel ? await runtime.health(signal) : ...
         └─ ManagedLlamaRuntime.health:198 → this.ensureServer(signal)      ← NO MODEL ID
              └─ :128  selected = installedModels.find(m => m.spec.id === undefined) ?? installedModels[0]
              └─ :130  activeModelPath ("…X.gguf") !== selected.path ("…[0].gguf")
              └─ :133  await this.stopChild()   → kills the X server
              └─ :137-156 new port, respawn with installedModels[0]         ✘ WRONG MODEL
:143   activeProvider = runtime.provider(model)   → baseURL = the NEW port, serving models[0]
:153   probe succeeds (llama-server serves whatever is loaded, ignoring the requested model name)
:226   emits ready with model = MODEL-X
```

**FACT — with two or more installed GGUFs, the model the user selected is
silently replaced by the alphabetically-first file on disk, and the readiness
probe still passes.** The UI, the persisted `defaultModel`, and the agent's
`modelId` all say MODEL-X while the server serves models[0].

This is invisible today only because the audited machine has exactly one GGUF.
It is the highest-severity *correctness* bug in the runtime layer.

## 10. Provider construction

```ts
// src/runtimes/managed-llama.ts:238-240
provider(model) {
  return createLocalProvider({ ...model, baseURL: this.baseURL, runtimeId: this.id, runtimeKind: this.kind });
}
```

**FACT — correct: `this.baseURL` is read at call time**, so the provider gets
the live port (unlike `discovery.models[].baseURL`, which is a stale snapshot —
see `04` §3). Both `runStartup:143` and `src/index.ts:177` call `provider()`
**after** `prepareModel`, so ordering is right in both paths.

`LocalProviderAdapter` (`src/runtimes/local-provider.ts:40-129`) wraps
`createOpenAICompatible` with `maxRetries: 0` (`:88`) — a deliberate choice so a
dead local server fails fast rather than retrying.

## 11. Verdict

| Aspect | Status |
| --- | --- |
| Runtime abstraction / contract | **IMPLEMENTED** — sound seam |
| Managed llama.cpp lifecycle ownership | **IMPLEMENTED** |
| Ephemeral loopback port allocation | **IMPLEMENTED** (with a bind-race) |
| Single-flight start lock | **IMPLEMENTED** (per instance only) |
| Real `/health` readiness wait | **IMPLEMENTED** |
| Model swap on selection change | **IMPLEMENTED** — but defeated by `health()` (§9) |
| Graceful dispose on normal exit | **IMPLEMENTED** |
| Dispose on crash / SIGTERM / re-discovery | **BROKEN** — three orphan paths |
| Crash supervision / auto-restart | **NOT FOUND** |
| Runtime state persistence / stale recovery | **NOT FOUND** |
| Port conflict handling | **NOT FOUND** |
| GPU backend selection / offload flags | **NOT FOUND** |
| Thread count / CPU tuning | **NOT FOUND** |
| Cheap discovery (no inference) | **BROKEN** — `detect`/`health` both spawn |
| Child-death detection during startup | **BROKEN** — `TypeError` + no liveness check |
| Second runtime family (Ollama/LM Studio/…) | **NOT FOUND** — deliberate |
</content>
</invoke>
