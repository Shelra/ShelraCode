# 16 — Duplicated systems, dead code & legacy

Findings below come from call-graph tracing (grep for every importer, then every
call site), **not** from filenames or folder names.

## 1. Duplicated systems

### D-1 — Model selection: two scorers (**most serious**)

| | System A | System B |
| --- | --- | --- |
| Symbol | `recommendBootstrapModel` | `localModelFitScore` (+ `selectLocalRoute`) |
| File | `src/models/recommendation.ts:17-70` | `src/hardware/profile.ts:171-201`, `src/router/local-first.ts:21-59` |
| Domain | catalog entries (not installed) | discovered candidates (installed) |
| GPU headroom | `× 0.72` (`:44`) | `× 0.82` (`:183`) |
| RAM fallback | `× 0.45` — **unreachable** (`:34-44`) | `× 0.65` / `× 0.9` (`:190-192`) |
| Shape | 3 if/else tiers | additive score, 9 terms |

**Authoritative:** neither. They are invoked on **mutually exclusive** branches
of `runStartup` (`:93` vs `:100`), so they never contradict each other *within
one run* — but they encode two different opinions of the same physics, and a
model recommended by A can be scored negative by B on the next launch.

**Recommendation:** one scorer over a common `ModelSpec` shape; the bootstrap
path should score catalog entries with the same function.

### D-2 — Onboarding: two implementations

| | A (TUI) | B (`shelra setup`) |
| --- | --- | --- |
| Entry | `runStartup → "onboarding"` + `installRecommended` (`src/index.ts:217-355`) | `runOnboarding` (`src/setup/onboarding.ts:122-132`) |
| Can install | **Yes** | **No** |
| Ranking | `selectLocalRoute` (once) | `localModelFitScore` **twice, with different hardware** (`:77` GPU-aware, `:105` GPU-blind) |
| Disposes runtimes | Yes (`src/index.ts:115`) | **No — leaks a `llama-server`** |

**Authoritative:** A. B duplicates ranking and adds a leak.

**Recommendation:** reduce B to a printer over `runStartup({healthCheck:false,
persistSelection:false})` so there is exactly one discovery/ranking path.

### D-3 — "Is the managed runtime installed?": two predicates

| Predicate | Search scope | File |
| --- | --- | --- |
| `findManagedLlamaServer` → `findExecutable` **recursive over the whole tree** | `~/.shelra/runtime/llama-cpp/**` | `src/runtimes/bootstrap.ts:188-212` |
| `installManagedRuntime`'s `existing` check | `~/.shelra/runtime/llama-cpp/<release>/` only | `:223-224` |

**FACT — they disagree on this machine** (see `08` §2). One finds a
hand-placed `manual/llama-server.exe`; the other sees nothing. Also
`ManagedLlamaRuntime` exposes **two names for one thing**:
`hasInstalledBinary()` (`:272-279`) and `hasRuntimeBinary()` (`:281-283`, a
straight delegate), plus a private `hasBinary()` (`:100-103`) that does the same
check a third way.

**Authoritative:** should be a single, version-aware resolver.

### D-4 — Model-id persistence: four writers, three stores

`defaultModel` is written by `runStartup` (`orchestrator.ts:221`),
`prepareLocalModel` (`index.ts:182`), `selectLocalModel` (`app.tsx:831`),
`runOnboarding` (`onboarding.ts:127`), and `resolveConfig` (`index.ts:710`) —
into `~/.shelra/user-settings.json`, plus `./.shelra/settings.json`
(`app.tsx:830`) and the SQLite session row (`agent.ts:645,662,696`).

**FACT — the model picker writes it twice in one action:** `prepareLocalModel`
writes it (`index.ts:182`) and then `selectLocalModel` writes it again
(`app.tsx:831`). And `agent.setModel` is called twice (`agent.ts:718` via
`setProvider`, then `app.tsx:828`).

### D-5 — Provider factories: three entry points, one class

`createLocalProvider` (`local-provider.ts:127-129`),
`createOpenAICompatibleProvider` (`:133-152`), and the dead
`createProvider` and the xAI-only adapter (`toolset/client.ts:120,234`; since removed). The first two
both construct `LocalProviderAdapter`; the difference is a synthetic candidate
and an api key.

### D-6 — Title/recap generation: two implementations

`src/providers/auxiliary.ts:36-71` (`generateTitle`, `generateRecap`, provider-
neutral) vs `src/toolset/client.ts:267,304` (same names, xAI-flavoured).
**Only the `providers/` pair is imported by runtime code**; the `toolset/client.ts`
pair is dead with the rest of that file.

### D-7 — Stream-event helpers: two sets

`src/providers/stream.ts:11-27` (`toToolCall`) + `src/runtimes/local-provider.ts:16-38`
(`usage`, `stepNumber`, `finishReason`) vs the four orphans in
`src/agent/agent.ts:2706,2729,2737,2753`. See §2.

### D-8 — Hardware profile: two shapes of the same call

`inspectHardware()` (GPU-blind) and `detectHardware()` (GPU-aware) are used
interchangeably at four `selectLocalRoute` call sites, producing three different
effective profiles in one process (see `04` §4). Not two *implementations*, but
a duplication of intent that behaves like one.

## 2. Dead code (present, compiles, no runtime caller)

| Item | Location | Evidence of deadness |
| --- | --- | --- |
| `toToolCall` | `src/agent/agent.ts:2706` | grep: 1 occurrence (its own definition); Biome `noUnusedVariables` |
| `getStepNumber` | `:2729` | same |
| `getFinishReason` | `:2737` | same |
| `getUsage` | `:2753` | same |
| **xAI-only provider adapter** (114 lines) | `src/toolset/client.ts:120-233` | no importer of `src/toolset/client` outside `media.ts` (type-only) and `client.test.ts` |
| `createProvider` | `src/toolset/client.ts:234-266` | same |
| `resolveModelRuntime` (module-level) | `src/toolset/client.ts:79` | same |
| `generateTitle`/`generateRecap` (xAI) | `src/toolset/client.ts:267,304` | superseded by `src/providers/auxiliary.ts` |
| `ResolvedModelRuntime`, `XaiProvider` types | `src/toolset/client.ts:26,57` | `XaiProvider` has exactly one type-only consumer (`src/toolset/media.ts:5`) |
| `StartupState = "fatal-error"` | `src/startup/types.ts:21` | consumed at `src/ui/startup.tsx:128,230`; **never produced** by any emitter |
| `ModelRecommendation.alternatives` | `src/models/recommendation.ts:9` | populated 4×, rendered 0× |
| `LocalModelCandidate.estimatedTokensPerSecond` | `src/runtimes/types.ts:30` | read at `src/hardware/profile.ts:199`; **never written** |
| `GpuProfile.accelerationBackends` | `src/hardware/profile.ts:14` | written 3×, read 0× |
| `UserSettings.localRuntimeId` | `src/utils/settings.ts:180` | written 2×, read 0× |
| `UserSettings.lastLocalHealthCheck` | `:181` | written 2×, read 0× |
| `RouteRequest.contextTokens` | `src/router/local-first.ts:9` | consumed at `:32`; **never passed** by any caller |
| `RouteRequest.policy` / `PrivacyPolicy` | `:4,7` | only affects a `reasons[]` string (`:57`); no caller passes it |
| `applyModelConstraints`' constraint block | `src/agent/agent.ts:571-578` | unreachable — depends on `getModelInfo`, which is a stub returning `undefined` |
| `estimateModelMemoryGb` lines `:157-167` | `src/hardware/profile.ts` | unreachable in production — `memoryRequiredGb` always set for managed candidates (`managed-llama.ts:55`), and endpoint candidates have no `parameters` |
| `recommendBootstrapModel` RAM fallback | `src/models/recommendation.ts:44` (else-arm) | unreachable — `gpuMemory === 0` returned at `:34` |
| `MODELS`, `getModelIds`, `isKnownModelId`, `getSupportedReasoningEfforts`, `getEffectiveReasoningEffort` | `src/models/catalog.ts:4,15,19,23,27` | constant stubs; imported but answer-free |
| `src/toolset/lsp-tools.ts` | — | **no importers** (only its own test) |
| `src/storage/sessions.test.ts` | — | excluded from both test scripts (`package.json:22-23`) |

**Deleted during the migration** (git status): `src/toolset/models.ts`,
`src/toolset/models.test.ts`.

## 3. Legacy (functional, intentionally retained, scheduled for removal)

| Item | Location | Note |
| --- | --- | --- |
| `AGENTS.md` | root | **Stale to the point of being misleading** — see `01` §7 |

## 4. Partially wired

| Item | State |
| --- | --- |
| `AgentKernel` | Constructed per turn, scoped, 3 transitions; **never fed mutations/observations/verification**; `getKernelState()` never called by the UI (`src/agent/agent.ts:1925-1929,2374`; `src/agent/kernel.ts`) |
| `capabilityConfidence` / `capabilityClass` | Populated with constants, displayed, **never gate behaviour** |
| `StartupProgress.model` / `.runtime` | Emitted by the orchestrator, **never rendered** (`src/ui/startup.tsx` has no reference) |
| `installAbort` | Wired through the whole download stack, **no UI action maps to it** |
| `healthCheck` / `persistSelection` options | Correctly plumbed, **no production caller uses them** |

## 5. Call-graph summary for `src/toolset/`

```
src/agent/agent.ts ──imports──> src/toolset/tools.ts        (createTools)           LIVE
                   ──imports──> src/toolset/tool-schemas.ts (toolSetToBatchTools)   LIVE
                   ──imports──> src/toolset/batch.ts                                LIVE
src/toolset/tools.ts  ──imports──> src/toolset/media.ts        (generateImage/Video)   LIVE
src/toolset/media.ts  ──type-only-> src/toolset/client.ts      (XaiProvider)           TYPE ONLY
src/toolset/client.ts ──> (nothing imports it for values)                           DEAD
src/toolset/lsp-tools.ts ──> (no importers at all)                                  DEAD
```

**FACT — `src/toolset/client.ts` survives only because `media.ts` needs one type
name from it.** Extracting `XaiProvider` would make the file removable.

## 6. Priority order for consolidation (no deletions recommended yet)

1. **D-1** — one scorer. Highest architectural leverage; both systems are small.
2. **D-2** — one onboarding path (also fixes the `dispose` leak).
3. **D-3** — one version-aware runtime resolver (also fixes B2's aftermath).
4. **Dead lint blockers** — the four orphan helpers in `agent.ts` are the only
   *lint-failing* dead code; removing them is a prerequisite for a green CI.
5. **D-4** — a single "commit model selection" function.
6. **Legacy delegation mirror** — since removed.
7. **`src/toolset/client.ts`** — extract the one type, then delete.

**No deletion is recommended in this audit**; each item above needs its own
verified change with a test.
</content>
</invoke>
