# 13 — Persistence, second launch, stale state & recovery

## 1. What is persisted

### `~/.shelra/user-settings.json` — the only startup-relevant store

```ts
// src/utils/settings.ts:176-194 (excerpt)
export interface UserSettings {
  apiKey?: string;
  defaultModel?: string;
  /** Last validated local selection; the runtime is still rediscovered on boot. */
  localRuntimeId?: string;
  lastLocalHealthCheck?: string;
  recapsEnabled?: boolean;
  sandboxMode?: SandboxMode;
  sandbox?: SandboxSettings;
  ...
}
```

Writers:

| Writer | Keys | Line |
| --- | --- | --- |
| `runStartup` (on `ready`) | `defaultModel`, `localRuntimeId`, `lastLocalHealthCheck` | `src/startup/orchestrator.ts:219-225` |
| `prepareLocalModel` (picker) | same three | `src/index.ts:181-185` |
| `selectLocalModel` (picker, again) | `defaultModel` (+ project `model`) | `src/ui/app.tsx:830-831` |
| `runOnboarding` (`shelra setup`) | `defaultModel` | `src/setup/onboarding.ts:127` |
| `resolveConfig` (CLI flags) | `apiKey`, `defaultModel` | `src/index.ts:709-710` |

Readers:

| Key | Read where | Effect |
| --- | --- | --- |
| `defaultModel` | `getCurrentModel` `src/utils/settings.ts:349-365` → `Agent` ctor `src/agent/agent.ts:614` → `runStartup({requestedModel})` `src/index.ts:369` | **advisory preference** |
| `localRuntimeId` | **NOWHERE** | — |
| `lastLocalHealthCheck` | **NOWHERE** | — |
| `apiKey` | `getApiKey` `settings.ts:341-343` | remote path |

**FACT — two of the three local-startup keys are write-only.** Verified by grep
across `src/`: `localRuntimeId` appears at `settings.ts:180`,
`orchestrator.ts:222`, `index.ts:183`; `lastLocalHealthCheck` at
`settings.ts:181`, `orchestrator.ts:223`, `index.ts:184`. No read site exists.

### `./.shelra/settings.json` (project) — `ProjectSettings.model`

Written by the model picker (`src/ui/app.tsx:830`). Read by `getCurrentModel`
(`src/utils/settings.ts:349-365`) as part of the precedence chain.

### `~/.shelra/models/<file>.gguf.json` — the model sidecar

Written on successful download (`src/models/huggingface.ts:177-181`,
`mode: 0o600`), read by discovery (`:208-217`). **This is the only per-model
metadata persistence** and it is unversioned and unvalidated beyond three
`typeof === "string"` checks (`:211-215`).

### `~/.shelra/shelra.db` — SQLite

`applyMigrations` (`src/storage/migrations.ts:5-20`) uses
`PRAGMA user_version` with three steps (`< 1`, `< 2`, `< LATEST_DB_VERSION`).
Holds workspaces, sessions, transcripts, usage. **No model, runtime, hardware or
capability data.**

**FACT — legacy migration is read-only for the DB** (`src/storage/db.ts:26-33`
copies `~/.grok/grok.db` → `~/.shelra/shelra.db` once if the target is absent)
and for settings (`settings.ts:228` falls back to the legacy path).

### FACT — the legacy write mirror (unconditional, never read)

```ts
// src/agent/delegations.ts:234-243
async function ensureDelegationsDir(cwd) {
  const dir = path.join(getHomeDir(), CONFIG_DIR_NAME, "delegations", projectId);
  await fs.mkdir(dir, { recursive: true });
  const legacyDir = path.join(getHomeDir(), LEGACY_CONFIG_DIR_NAME, "delegations", projectId);
  await fs.mkdir(legacyDir, { recursive: true });      // ← unconditional
  return dir;
}
// :263-277
async function writeRecord(filePath, record) {
  await fs.writeFile(filePath, serialized, "utf8");
  ...
  if (filePath.startsWith(canonicalPrefix)) {
    const legacyPath = path.join(legacyRoot, filePath.slice(canonicalPrefix.length));
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(legacyPath, serialized, "utf8");   // ← mirror
  }
}
```

The comments (`:238-239`, `:267-268`) say the mirror "is deliberately never read
by the application". **Confirmed by grep** — nothing reads
`~/.grok/delegations`. So every delegation **recreates the legacy tree on a
clean machine** and doubles disk writes. **Field evidence:** `~/.grok/delegations`
on this machine contains 9 project directories, timestamped after the migration.

## 2. What is NOT persisted

| State | Persisted? | Consequence |
| --- | --- | --- |
| Hardware profile | **No** | `nvidia-smi`/`system_profiler`/`rocm-smi` re-spawned every launch (up to 2.5 s each, `src/hardware/profile.ts:49`) |
| GPU capabilities / VRAM | **No** | same |
| Model capability probe result | **No** | the 15 s READY probe is re-run every launch |
| `onboardingCompleted` | **No** | recomputed from "is there a GGUF?" every launch |
| Download progress / partial state | **On disk only** (`.part` files) | no manifest; a `.part` for a model no longer in the catalog is invisible and never cleaned |
| Runtime install state / release version | **No** | inferred by scanning `~/.shelra/runtime/llama-cpp` |
| Server port / PID | **No** | orphans are undetectable and unrecoverable |
| Model path | **No** | `defaultModel` stores an **id**, not a path; the path is re-derived from the filesystem scan |
| Settings **schema version** | **No** | `UserSettings` has no `version` field |
| Health state | **Written but unread** (`lastLocalHealthCheck`) | |

## 3. Second-launch trace (actual behaviour)

Starting from the state on this machine
(`defaultModel: "local:qwen2.5-coder-1.5b-instruct-q4_k_m.gguf"`, one GGUF, a
manually-placed engine binary):

```
1. src/agent/agent.ts:614   modelId = getCurrentModel("agent")
                            → resolveCurrentModel(undefined, "local:qwen…gguf")  settings.ts:369-372
                            → "local:qwen2.5-coder-1.5b-instruct-q4_k_m.gguf"
2. src/index.ts:369         runStartup({ requestedModel: model || agent.getModel() })
3. orchestrator.ts:75       detectHardware()          ← full GPU re-scan, NOT cached
4. orchestrator.ts:73       discoverLocalRuntimes()   ← re-scan + SPAWN llama-server (loads models[0])
5. orchestrator.ts:93-97    selectLocalRoute(models, { preferredModel: "local:qwen…" , hardware })
                            router/local-first.ts:39-43 moves it to the front
                            router/local-first.ts:45-50 RE-SORTS by fit score  ← preference is only a tiebreak
6. orchestrator.ts:120      prepareModel(id)          ← respawn if the wrong model was loaded at step 4
7. orchestrator.ts:129      health()                  ← ⚠ can reload installedModels[0]
8. orchestrator.ts:153      probeLocalModel           ← 15 s budget, REAL generation, NOT cached
9. orchestrator.ts:219-225  saveUserSettings(...)     ← rewrites the same three keys
10. src/index.ts:377-378    setProvider + renderApp   ← chat
```

**FACT — second launch repeats essentially all of first launch except the
downloads.** Nothing is reused: not the hardware scan, not the probe, not the
runtime location. The only thing `defaultModel` buys is a tiebreak in step 5.

**FACT — steps 4, 6 and 7 can each start or restart the server.** In the worst
case (`installedModels[0] ≠ selected`), one launch spawns `llama-server`
**three times** with two full model loads.

## 4. Stale / invalid model handling

| Scenario | Actual behaviour | Evidence |
| --- | --- | --- |
| Saved model **deleted** | Discovery does not return it → `selectLocalRoute` logs `"<id>: preferred local model is unavailable"` into `reasons[]` (`router:42`) → **another model is silently chosen**, or `onboarding` if none remain. **The reason string is never displayed** (nothing reads `route.reasons` except `src/setup/onboarding.ts:91`). | `src/router/local-first.ts:39-43`; `src/startup/orchestrator.ts:99-108` |
| Saved model **moved** to a subdirectory | Invisible — the scan is non-recursive (`src/models/huggingface.ts:199`). Treated as deleted. | |
| Model file **corrupt / truncated** | **Still listed as installed** — only the `.gguf` extension is checked (`:204`), no magic bytes, no size check, no re-hash. `prepareModel` then fails at `/health`, producing *"The local runtime could not prepare …"* with no diagnosis (llama.cpp's message is discarded by `stdio:"ignore"`). | `src/models/huggingface.ts:204`; `src/runtimes/managed-llama.ts:152` |
| Sidecar **corrupt** | Silent downgrade to `local:<filename>`, `parameters: 0`, `quantization: "unknown"`. **Happening on this machine.** | `src/models/huggingface.ts:206-233` |
| Model **no longer fits memory** | Nothing re-validates fit at load time. `localModelFitScore` may return a negative score, but a lone candidate still wins (it is the only element after sorting). Failure appears as a load/probe failure. | `src/router/local-first.ts:45-51` |
| **Runtime binary disappears** | `hasBinary()` false → `detect()` false, but the adapter is still listed (it has `installModel`, `src/runtimes/discovery.ts:105-107`) → `listModels` still returns the GGUFs → `selectLocalRoute` picks one → `prepareModel` → `ensureServer` → `findManagedLlamaServer` returns `undefined` → `:136` returns `false` → `"The local runtime could not prepare …"`. **Recoverable-error, not re-onboarding**, so the user is *not* offered the engine install that would fix it. | `src/runtimes/managed-llama.ts:134-136`; `src/startup/orchestrator.ts:120-128` |
| **Runtime version changes** (`MANAGED_LLAMA_RELEASE` bumped) | `findManagedLlamaServer` recurses the whole `runtime/llama-cpp` tree and will happily return the **old release's** binary (`src/runtimes/bootstrap.ts:207-212`), while `installManagedRuntime` looks only at `<newRelease>/` (`:223`). **The old engine keeps being used and the new one is downloaded but never adopted** unless the old directory is removed. No version is recorded anywhere. | |
| **Backend unavailable** (e.g. missing CUDA DLL) | Child exits during `waitForHealth` → `TypeError` at `src/runtimes/managed-llama.ts:169` (see `09` §8). | |
| **Stale `.part` files** | Model `.part`: resumed correctly, or deleted on hash mismatch (`huggingface.ts:172`). Engine `.part`: **never cleaned → permanent failure loop**. | `src/runtimes/bootstrap.ts:237` |
| **Orphaned `llama-server` from a previous crash** | Not detected, not killed, not reused. A new server is started on a new port. | no code |

**FACT — there is no explicit "your saved model is gone" message anywhere.**
`route.reasons` records it; the TUI never renders it. The user experiences a
silent switch.

**FACT — recovery is uniformly "re-run the whole discovery".** `[r] Scan again`
→ `initializeLocal()` → `runStartup()` (`src/index.ts:157`, `:411`). There is no
targeted repair (delete corrupt artifact, re-download, reinstall engine) and no
"repair" action in the UI.

## 5. Migration & versioning

| Store | Versioned? | Migration | Validation |
| --- | --- | --- | --- |
| `user-settings.json` | **No** | legacy path fallback read only (`settings.ts:228`) + a "canonical vs legacy" write dance (`:233-234`) | Per-field normalizers exist for sandbox/reasoning (`:240-243`) but **none for `defaultModel`** beyond `trim()` |
| Project `settings.json` | **No** | — | — |
| Sidecar JSON | **No** | — | 3 `typeof` checks (`huggingface.ts:211-215`) |
| SQLite | **Yes** — `PRAGMA user_version` | `applyMigrations` `migrations.ts:5-20` | — |
| Runtime install | **No** | — | SHA-256 at install only |

**FACT — SQLite is the only versioned store, and it holds none of the startup
state.**

## 6. Multiple local models

| Question | Answer |
| --- | --- |
| Select first found? | Only as a **side effect** of `ensureServer`'s `installedModels[0]` default (`src/runtimes/managed-llama.ts:128`) — which, via `health()`, can *override* the real selection. |
| Restore last used? | **Advisory only** — `preferredModel` is re-sorted away (`src/router/local-first.ts:39-50`). |
| Rank? | **Yes** — `localModelFitScore` (`src/hardware/profile.ts:171-201`). |
| Ask the user? | **At startup: no.** In `shelra setup`: yes, but the choice cannot be acted on. In chat: yes, via the model picker (`src/ui/app.tsx:2997-3005`) — whose errors are invisible. |
| Choose by hardware? | Yes (the fit score). |
| Choose by task? | **No** — `contextTokens` in `RouteRequest` (`src/router/local-first.ts:9`) is never passed by any caller. |
| Configured default? | Yes, as a tiebreak. |
| Model switching | **Implemented** (`src/index.ts:168-190`) and correct; the **UI wrapper is broken** (`12-CHAT-READINESS.md` §6). |

**FACT — multi-model is the least-exercised configuration**: the machine has one
GGUF, no test fixture has two *installed* models on one managed runtime, and the
`health()` swap bug (`09` §9) only manifests with ≥2.

## 7. Verdict

| Aspect | Status |
| --- | --- |
| Selected model persisted | **PARTIAL** — stored as an id, treated as advisory |
| Runtime id persisted | **DISCONNECTED** — written, never read |
| Health state persisted | **DISCONNECTED** — written, never read |
| Model path persisted | **NOT FOUND** — re-derived by scanning |
| Hardware profile cached | **NOT FOUND** |
| Capability/probe cached | **NOT FOUND** |
| Onboarding-completed flag | **NOT FOUND** |
| Download state manifest | **NOT FOUND** (`.part` files only) |
| Settings schema version / migration | **NOT FOUND** (SQLite excepted) |
| Second launch skips work | **NOT FOUND** — repeats hardware scan, discovery, spawn and probe |
| Missing-model recovery | **PARTIAL** — silently substitutes, never explains |
| Corrupt-model detection | **NOT FOUND** |
| Corrupt-sidecar detection | **NOT FOUND** — silent degradation, observed live |
| Runtime-version change handling | **BROKEN** — old binary wins, new one is downloaded and ignored |
| Orphan recovery | **NOT FOUND** |
| Legacy `.grok` write mirror | **LEGACY, unconditional, never read** (`src/agent/delegations.ts:238-241,267-276`) |
</content>
</invoke>
