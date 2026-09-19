# 15 — Test coverage

## 1. Suite shape

* Runner: **Vitest 4** via `bunx vitest run --pool=forks`.
* Config: `vitest.config.ts` — only an `exclude` list (`dist`, `node_modules`,
  `tmp`, `.claude`, `.cursor`). **No coverage provider, no thresholds, no
  setup files, no environment configuration.**
* The `test` script (`package.json:22`) additionally excludes `ShelraCode/**`
  and runs four environment-sensitive files serially with
  `--no-file-parallelism`.
* `src/storage/sessions.test.ts` is **excluded from both `test` and
  `test:watch`** — it never runs.

### Measured result (this audit)

```
run 1 (main):                62 files / 264 tests   passed
run 2 (sandbox.test.ts):      1 file  /   4 tests   passed
run 3 (delegations.test.ts):  1 file  /   2 tests   passed
run 4 (recap.test.ts):        1 file  /   2 tests   passed
run 5 (runtime-prep.test.ts): 1 file  /   1 test    passed
──────────────────────────────────────────────────────────
TOTAL                        66 files / 273 tests   EXIT 0
```

**Note:** `docs/architecture/10-IMPLEMENTATION-STATUS.md` records "66 test files /
268 tests". The file count matches; the test count has drifted by +5. Minor
doc/code drift.

## 2. Coverage of the audited subsystems

| Subsystem | Test file | Cases | Kind | Verdict |
| --- | --- | --- | --- | --- |
| **Startup orchestration** | `src/startup/orchestrator.test.ts` | 3 | Unit, **fully injected** (`hardware` + `discovery` handed in, `FakeProvider`) | **PARTIAL** — the state machine's ordering, onboarding branch and recommendation are covered; **no real discovery, no real runtime, no OOM fallback, no `health()` re-entry** |
| Hardware detection | `src/hardware/profile.test.ts` | 1 | Unit | **NOT COVERED** — the single test exercises `localModelFitScore`, not detection. `detectHardware`/`detectGpus`/parsers have **zero tests** despite an injectable `CommandRunner` |
| Runtime discovery | `src/runtimes/discovery.test.ts` | 3 | Unit, fake adapters | **PARTIAL** — asserts managed-by-default, no implicit vendor probing, installable-runtime visibility |
| Managed llama.cpp | `src/runtimes/managed-llama.test.ts` | 1 | Unit, `spawnImpl`/`fetchImpl` injected | **MINIMAL** — only the single-flight lock. **No test for:** child death during `waitForHealth`, the `this.child.kill()` `TypeError`, model swap, `dispose`, port allocation, `installModel` |
| Runtime bootstrap | `src/runtimes/bootstrap.test.ts` | 4 | Unit, pure | **PARTIAL** — plan resolution for win/mac/linux, unsupported-arch fail-closed, `SHELRA_DISABLE_RUNTIME_INSTALL`. **No test for:** download, resume, 416 handling, hash mismatch, **failure cleanup (the blocker bug)**, extraction |
| Model download (HF) | `src/models/huggingface.test.ts` | 2 | Unit, `fetchImpl` injected, real tmp FS | **GOOD** — resume + progress + verify + atomic finalize; corrupt artifact rejected without exposure. **No test for:** already-installed skip, disk-full, cancellation |
| Install manager | `src/models/manager.test.ts` | 2 | Unit | **PARTIAL** — runtime-owned install + progress forwarding; unsafe-id rejection. **No disk-gate test** |
| Recommendation | `src/models/recommendation.test.ts` | 1 | Unit, pure | **MINIMAL** — one assertion pair. **The unreachable RAM branch is not caught** |
| Routing | `src/router/local-first.test.ts` | 2 | Unit, pure | **PARTIAL** — no test that `preferredModel` loses to a higher fit score |
| Onboarding (`shelra setup`) | `src/setup/onboarding.test.ts` | 2 | Unit, `discovery`+`hardware` injected | **PARTIAL** — bypasses real discovery, so the **missing `dispose` leak is invisible** |
| Startup input | `src/ui/startup-input.test.ts` | 3 | Unit, pure | **GOOD** for what it covers |
| Context compiler | `src/context/compiler.test.ts` | 4 | Unit, real tmp FS | **GOOD** — classification, bounded evidence, host-evidence-only, `ShelraCode/` exclusion. **No symlink-cycle test** |
| Workspace guard | `src/security/workspace-guard.test.ts` | 2 | Unit, real FS | **PARTIAL** — containment + symlink escape. **No test for a path whose parent does not exist** — which is exactly the regression (B1) |
| Provider architecture | `src/providers/architecture.test.ts` | 2 | Source-text assertions | **GOOD** — genuinely enforces the SDK boundary |
| Local provider | `src/runtimes/local-provider.test.ts` | 1 | Unit | **MINIMAL** — metadata + `supportsBatch === false` |
| Model catalog stub | `src/models/catalog.test.ts` | 2 | Unit | Asserts the stub *is* a stub |
| Agent kernel | `src/agent/kernel.test.ts` | 2 | Unit, pure | Covers `evaluateCompletion`; **nothing asserts the agent drives it** |

## 3. Untested by area (the brief's checklist)

| Area | Unit | Integration | Mocked | **Never tested** |
| --- | --- | --- | --- | --- |
| CLI boot flow (`startInteractive`, `initializeLocal`, `installRecommended`) | — | — | — | **✗ NEVER** |
| `configureLocalProvider` / `runHeadless` / `--remote` | — | — | — | **✗ NEVER** |
| Startup state machine | ✓ (3) | — | fully injected | real-runtime path never |
| Hardware discovery | — | — | — | **✗ NEVER** |
| Runtime discovery | ✓ (3) | — | fake adapters | real `ManagedLlamaRuntime` never |
| Model discovery (GGUF scan) | — | — | — | **✗ NEVER** (`discoverInstalledHuggingFaceModels` has no direct test; corrupt-sidecar path untested) |
| Recommendation | ✓ (1) | — | pure | thresholds/branches mostly untested |
| Onboarding (TUI branch) | — | — | — | **✗ NEVER** |
| Onboarding (`shelra setup`) | ✓ (2) | — | injected | dispose leak untested |
| Downloading (model) | ✓ (2) | ✓ tmp FS | fetch mocked | already-installed, cancel, disk-full |
| Downloading (runtime) | ✓ (4, plan only) | — | — | **✗ download/extract/cleanup NEVER** |
| Model loading | — | — | — | **✗ NEVER** (no `prepareModel` test) |
| Health / readiness | ✓ indirectly via `orchestrator.test.ts` with `FakeProvider` | — | — | real probe never |
| Persistence | — | — | — | **✗ NEVER** (no test writes/reads `defaultModel` round-trip through startup) |
| Recovery (stale/missing/corrupt) | — | — | — | **✗ NEVER** |
| Chat readiness / gating | — | — | — | **✗ NEVER** |
| Model switching | — | — | — | **✗ NEVER** |
| Startup UI rendering | — | — | — | **✗ NEVER** — no component test; `src/ui/startup.tsx` has **zero** tests |
| `src/ui/app.tsx` (5 902 lines) | partial via `slash-menu.test.ts`, `telegram-turn-ui.test.ts` | — | — | the component itself never rendered in a test |

**FACT — there is no snapshot testing, no component testing, and no
integration test that runs the real startup path end-to-end.** Every
startup-related test injects its dependencies, which is why every defect in this
audit passes the suite.

## 4. Why the suite is green while the blockers exist

Direct mapping from `00-EXECUTIVE-SUMMARY.md` §7:

| Bug | Why the tests miss it |
| --- | --- |
| B1 `resolveWorkspacePath` ENOENT on a new directory | `workspace-guard.test.ts` only tests paths whose parent exists |
| B2 poisoned runtime `.part` | `bootstrap.test.ts` never calls `installManagedRuntime`'s download path |
| B3 `this.child.kill()` TypeError | `managed-llama.test.ts` injects a `spawnImpl` whose child never exits mid-health-check |
| B4 `health()` reloads `installedModels[0]` | No fixture has **two** installed models on one managed runtime |
| B5 orphaned children | Nothing exercises `initializeLocal` twice |
| B6 compaction arithmetic | `compaction.test.ts` (present) does not assert against a 32 K window with the production constants |
| B7 discovery spawns a server | `discovery.test.ts` uses fake adapters, not `ManagedLlamaRuntime` |
| B8 corrupt sidecar | `huggingface.test.ts` never writes an invalid sidecar |
| B9 `--remote` without base URL | No CLI-level test at all |
| B10 model-picker error swallowed | `app.tsx` is never rendered |
| B11 symlink-cycle stack overflow | `compiler.test.ts` builds a flat tmp tree |
| Onboarding `dispose` leak | `onboarding.test.ts` injects `discovery` |

## 5. Test-infrastructure observations

**Positive (FACT):**
* Dependency injection is designed in: `fetchImpl`/`spawnImpl`
  (`src/runtimes/managed-llama.ts:60-66`), `CommandRunner`
  (`src/hardware/profile.ts:46,144`), `adapters` parameter
  (`src/runtimes/discovery.ts:88`), `discovery`/`hardware` options
  (`src/startup/types.ts:52-53`), `healthCheck`/`persistSelection` switches
  (`:55-57`), `FakeProvider`. **The seams for real integration tests already
  exist and are simply unused.**
* `src/providers/architecture.test.ts` is an unusual and valuable test: it
  asserts on *source text* to keep SDK types out of the agent.

**Negative (FACT):**
* Four test files need `--no-file-parallelism` (`package.json:22`), indicating
  shared global state (real `$HOME`, real cwd, real child processes).
* `src/storage/sessions.test.ts` is silently excluded — dead test coverage.
* No coverage reporting means regressions in untested areas are invisible.
* `src/verify/runtime-prep.test.ts` tests `prepareVerifySandbox` from
  `./entrypoint` — the filename does not match the module under test, which
  makes the exclusion list in `package.json:22` hard to reason about.

## 6. Verdict

| Question | Answer |
| --- | --- |
| Does the suite pass? | **Yes — 66 files / 273 tests, exit 0** |
| Does passing mean the startup flow works? | **No.** Every startup test injects its dependencies; none exercises a real runtime, a real download, or a real UI. |
| Unit-tested | Startup state machine, routing, recommendation, HF download, install plans, discovery aggregation, startup keys, context compiler, workspace guard, provider architecture, kernel |
| Integration-tested | **Effectively nothing.** `huggingface.test.ts` and `compiler.test.ts` touch a real tmp filesystem; that is the closest the suite gets. |
| Mocked | `fetch`, `spawn`, adapters, providers, hardware, discovery |
| Never tested | CLI boot, `--remote`, TUI rendering, onboarding install action, model load, model switch, persistence round-trip, all recovery paths, runtime download/extract |
| Snapshot-only | None |
</content>
</invoke>
