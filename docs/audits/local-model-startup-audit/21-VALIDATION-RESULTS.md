# 21 — Validation results

## 0. Audit conditions

| | |
| --- | --- |
| Repository | `D:\PROYECTS\grok-cli` |
| Branch | `main` |
| HEAD | `fb97af83f06dca873281d60168430f06c8de6324` ("bump version") |
| Dirty before audit | **YES** — large migration in progress |
| Dirty after audit | **YES** — identical set of source changes, **preserved untouched** |
| Files created by this audit | `docs/audits/local-model-startup-audit/*.md` (21 files) — **nothing else** |
| Git write commands run | **NONE** (`git status`, `git diff --stat`, `git rev-parse`, `git log` only) |
| Subagents spawned | **NONE** |
| Platform | Windows 11 (26200), Bun 1.4.1, PowerShell + Git Bash |

---

## 1. Verification commands discovered and run

Commands were taken from `package.json` (`scripts`) and from
`.github/workflows/typecheck.yml`.

| Command | Result | Pre-existing or audit-induced? |
| --- | --- | --- |
| `bun run typecheck` (`tsc --noEmit`) | **PASS — exit 0**, no output | n/a |
| `bun run test` (5-stage chained vitest) | **PASS — exit 0** | n/a |
| `bun run lint` (`biome check src/`) | **FAIL — exit 1**, 160 errors / 12 warnings across 190 files | **PRE-EXISTING** |
| `bun run format` (`biome format src/`) | **FAIL — exit 1** | **PRE-EXISTING** |
| `bun run build` | **NOT RUN — deliberately.** See §4. | — |

**No failure is audit-induced.** This audit changed **zero** source files; the
only writes were the 21 markdown files under `docs/audits/`, which Biome does
not check (`biome.json` scope is `src/` via the `lint`/`format` scripts).

### 1a. `bun run typecheck`

```
$ tsc --noEmit
(no output)
exit 0
```

Run twice — at the start of the audit and again at the end, after the working
tree changed (§5). Both passed.

### 1b. `bun run test`

Run twice. Both runs exited **0**.

| Stage | Start of audit | End of audit |
| --- | --- | --- |
| main run (excludes 5 files) | 62 files / 264 tests | 63 files / 271 tests |
| `src/agent/sandbox.test.ts` | 1 / 4 | 1 / 4 |
| `src/agent/delegations.test.ts` | 1 / 2 | 1 / 2 |
| `src/agent/recap.test.ts` | 1 / 2 | 1 / 2 |
| `src/verify/runtime-prep.test.ts` | 1 / 1 | 1 / 1 |
| **Total** | **66 files / 273 tests** | **67 files / 280 tests** |

The increase between runs is caused by concurrent work by another agent in this
session (§5), not by the audit.

`docs/migration/10-IMPLEMENTATION-STATUS.md` records "66 test files / 268 tests";
the file count matched at audit start, the test count did not (**+5**). Recorded
as doc/code drift in `17-GAP-ANALYSIS.md` §3.

### 1c. `bun run lint` — **pre-existing RED**

```
Checked 190 files in 397ms. No fixes applied.
Found 160 errors.
Found 12 warnings.
error: script "lint" exited with code 1
```

Breakdown by rule (the remaining ~128 diagnostics are `format` errors, almost
entirely **CRLF line endings** — Biome wants LF):

| Rule | Count |
| --- | --- |
| `assist/source/organizeImports` | 12 |
| `lint/suspicious/noTemplateCurlyInString` | 6 |
| **`lint/correctness/noUnusedVariables`** | **6** |
| `lint/correctness/noUnusedImports` | 5 |
| `lint/correctness/useExhaustiveDependencies` | 2 |
| `lint/correctness/noUnusedFunctionParameters` | 1 |
| `format` (CRLF + spacing) | remainder |

Unused-variable/import locations (verbatim, end-of-audit line numbers):

```
src\agent\agent.ts:2706:10   noUnusedVariables        ← toToolCall
src\agent\agent.ts:2729:10   noUnusedVariables        ← getStepNumber
src\agent\agent.ts:2737:10   noUnusedVariables        ← getFinishReason
src\agent\agent.ts:2753:10   noUnusedVariables        ← getUsage
src\lsp\builtins.ts:6:3      noUnusedImports
src\lsp\client.ts:193:23     noUnusedVariables
src\lsp\npm-cache.test.ts:1:17 noUnusedImports
src\lsp\runtime.ts:33:34     noUnusedFunctionParameters
src\storage\db.ts:4:10       noUnusedImports
src\tools\computer.ts:3:10   noUnusedImports
src\utils\install-manager.ts:20:7 noUnusedVariables
src\utils\instructions.ts:2:13 noUnusedImports
```

The four `agent.ts` entries confirm the dead post-refactor helpers documented in
`14-PROVIDER-AND-AGENT-INTEGRATION.md` §2 and `16-DUPLICATION-AND-DEAD-CODE.md` §2.

**Drift note:** at the start of the audit the same command reported
**158 errors / 12 warnings across 188 files**; the +2 files / +2 errors come from
`src/cli/installation.ts` added concurrently (§5).
`docs/migration/10-IMPLEMENTATION-STATUS.md` records "157 errors and 12
warnings" — a third value, consistent with the file having been written before
further changes.

### 1d. `bun run format` — **pre-existing RED**

```
× Some errors were emitted while running checks.
error: script "format" exited with code 1
```

`biome format src/` without `--write` reports and exits non-zero.

### 1e. CI implication

`.github/workflows/typecheck.yml` runs, in order:
`bun install --frozen-lockfile` → **`bun run format`** → **`bun run lint`** →
`bun run typecheck` → `bun run build:binary`.

**FACT — this workflow currently fails at step 2 (`format`) and would also fail
at step 3 (`lint`).** Steps 4 and 5 are never reached. See `20-RISK-REGISTER.md`
R-37.

---

## 2. Behavioural measurements (read-only)

### 2a. `shelra models` — latency and side effects

`bun run src/index.ts models`, repeated:

| Run | Wall time |
| --- | --- |
| 1 | 4 216 ms |
| 2 | 5 380 ms |
| 3 | 3 475 ms |
| 4 | 2 817 ms |
| 5 | 2 900 ms |

**Output (verbatim):**
```
ShelraCode local model catalog:

  Local runtimes:
  local:qwen2.5-coder-1.5b-instruct-q4_k_m.gguf — qwen2.5-coder-1.5b-instruct-q4_k_m
    (managed-llama, 32.768K context, free)
```

Two findings are visible in this one line:
1. The model id is `local:…`, **not** the catalog id `hf:Qwen/…` — the corrupt
   sidecar degradation (`04-LOCAL-MODEL-DISCOVERY.md` §5).
2. `32.768K context` — `formatContext` (`src/index.ts:1011-1014`) divides by
   1 000 without rounding. Cosmetic.

**Side-effect confirmed:** a background PowerShell sampler polling
`Get-Process llama-server` every 200 ms during one run captured **PID 16488**.
A listing command spawns a real inference server and loads a 1.1 GB GGUF.
(`09-RUNTIME-ARCHITECTURE.md` §7)

**Orphan observation (lower confidence):** in one earlier sequence a
`llama-server` with a `StartTime` matching a completed run remained alive for
**>13 s** after the CLI exited; three later runs left `residual_llama=0`. Not
reliably reproducible from `models`; the code-level leak at `src/index.ts:373`
is unambiguous and is documented separately (`20-RISK-REGISTER.md` R-05).

### 2b. `resolveWorkspacePath` — reproduced regression

A throwaway script in the scratchpad (outside the repository) imported the real
module and called the pure function:

```
src/index.ts    => OK  src/index.ts
newdir/file.ts  => ERR ENOENT: no such file or directory, realpath 'D:\PROYECTS\grok-cli\newdir'
a/b/c.ts        => ERR ENOENT: no such file or directory, realpath 'D:\PROYECTS\grok-cli\a\b'
src/newfile.ts  => OK  src/newfile.ts
```

**Confirms R-01 / B1** (`src/security/workspace-guard.ts:22-24`). Even a
**single-level** new directory fails. Nothing was written to the repository.

### 2c. On-disk state inspected (read-only)

```
~/.shelra/
  user-settings.json   {"defaultModel":"local:qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
                        "localRuntimeId":"shelra-llama",
                        "lastLocalHealthCheck":"2026-09-06T21:59:23.532Z"}
  models/
    qwen2.5-coder-1.5b-instruct-q4_k_m.gguf        1,117,320,768 bytes
    qwen2.5-coder-1.5b-instruct-q4_k_m.gguf.json   594 bytes  ← INVALID JSON
  runtime/llama-cpp/
    b10826.staging/                                 EMPTY
    llama-b10826-win-cpu-x64.zip.part               18,412,429 bytes
    manual.zip                                      18,412,429 bytes
    manual/                                         contains llama-server.exe
    (no b10826/)
~/.grok/
  delegations/  ← 9 project directories, recreated post-migration
```

**Sidecar validity check:**
```
$ tail -c 20 …gguf.json | od -c
  \n   }   \   n              ← a literal backslash + 'n' after the closing brace
$ node -e "JSON.parse(readFileSync(...))"
  PARSE FAIL: Unexpected non-whitespace character after JSON at position 591
```

**Runtime archive hash check:**
```
$ sha256sum llama-b10826-win-cpu-x64.zip.part
  5828cccc7261b14607d23de3144f35fac4249d9fd207e13bff5e31dd8ae39d56
src/runtimes/bootstrap.ts:69
  sha256: "5828cccc7261b14607d23de3144f35fac4249d9fd207e13bff5e31dd8ae39d56"
```

**The archive is complete and its hash matches the pin.** Therefore the install
failed *after* verification — at `rename`, `extractArchive`, or `findExecutable`
(`src/runtimes/bootstrap.ts:242-248`) — and left both the `.part` and the empty
staging directory behind, exactly as predicted by `:251-253`.
(`08-MODEL-DOWNLOAD.md` §2)

---

## 3. What was deliberately NOT executed

| Command | Why |
| --- | --- |
| `bun run build` / `bun run build:binary` | Writes into `dist/`. The audit brief forbids modifying any file outside `docs/audits/`. `bun run typecheck` (`tsc --noEmit`) performs the identical compilation without emitting and **passed**. Note the `build` script was changed **during** the audit (§5) from `tsc` to `bun run scripts/build.ts`, so a build would also have exercised newly-added, unaudited code. |
| `shelra setup` | `runOnboarding` writes `defaultModel` to `~/.shelra/user-settings.json` (`src/setup/onboarding.ts:127`) and leaks a `llama-server` (no `dispose` call). Both are user-file/state mutations. The leak is documented from the call graph instead (`11-ONBOARDING.md` §3, S4). |
| `shelra` (interactive TUI) | Would spawn a server, run a probe, and write settings. |
| `shelra -p "…"` | Same, plus a real inference turn. |
| `installManagedRuntime` / any download | Network + filesystem writes outside the repo. |
| `biome check --fix` / `--write` | Would modify `src/`. |
| Any `git add/commit/reset/clean/stash/checkout/restore` | Explicitly forbidden; the working tree is a migration in progress. |

---

## 4. Working-tree integrity

`git status --porcelain` was captured at the start and end of the audit.

**Unchanged by this audit:** the 45 modified files, the 2 deleted files, and the
14 untracked entries present at audit start.

**Added by concurrent activity (not by this audit):** `?? scripts/`,
`?? src/cli/`, and modifications to `package.json`,
`src/utils/install-manager.test.ts`, `src/runtimes/managed-llama.ts`,
`src/agent/agent.ts`. See §5.

**Added by this audit:** `docs/audits/local-model-startup-audit/` — 21 markdown
files. (`docs/` was already untracked before the audit, so `git status` shows no
new entry.)

---

## 5. Concurrent-modification log (important for citation accuracy)

Other agents (`main`, `code-review`) were active in this session and modified the
working tree **while the audit was running**. This is recorded here so the
citations can be trusted.

| Time | Change observed | Effect on this audit |
| --- | --- | --- |
| mid-audit | `package.json` `build` changed from `tsc` to `bun run scripts/build.ts`; `build:binary` likewise | `01-REPOSITORY-MAP.md` §2 describes `build` as `tsc`; **the current value is `bun run scripts/build.ts`**. `typecheck` is unchanged. |
| mid-audit | `scripts/build.ts` (new) — a `Bun.build` bundler that externalises `@opentui/core-*` natives | Not audited (added after the audit's scope was fixed). |
| mid-audit | `src/cli/installation.ts` (new, 375 lines) | Not audited. Accounts for the +2 files / +2 lint errors between the two lint runs. |
| mid-audit | `src/agent/agent.ts` grew 2 937 → 2 967 lines; ~30 lines inserted between `:1925` and `:1987` (a new `maxOutputTokensForTurn(runtime, "repository", …)` call at `:1966`) | **All `src/agent/agent.ts` citations above `:1925` were re-verified and updated to the final numbering.** Citations at or below `:1925` are unaffected. |
| mid-audit | `src/runtimes/managed-llama.ts` grew 284 → 304 lines; `stopChild` (`:256-288`) gained a force-kill: `taskkill /PID <pid> /T /F` on win32, `SIGKILL` elsewhere, after a 2 s grace, guarded by a `settled` flag | **Directly relevant.** Its own comment states *"Windows `child_process.kill()` can report success while a native llama-server process is still alive"* — independently corroborating the orphan behaviour observed in §2a. It mitigates the **dispose** path only; the three orphan paths in R-05 (crash, SIGTERM, re-discovery overwrite at `src/index.ts:373`) bypass `dispose()` entirely and are unaffected. All cited line numbers in `managed-llama.ts` **≤ 253** were re-verified and are unchanged. |
| mid-audit | `docs/migration/11-STARTUP-ONBOARDING.md` gained a paragraph about a compiled Spanish-language repository-review run | Noted; does not change any finding. |

### File hashes at the end of the audit

```
d86765408269019a15b8c0049b90effa  src/agent/agent.ts
1582015608c33b5375ec6b2e58690700  src/index.ts
12810c96b3f7063890b0cd1bbd2851d6  src/ui/app.tsx
0aa56d1b3fc9cffc9cc3e4429b986ae2  src/startup/orchestrator.ts
03dc1bce73d8ba31626ea0769eb8ea1a  src/runtimes/managed-llama.ts
fc8d17948d07e30b03ecbd18a2baaaf0  src/runtimes/bootstrap.ts
1076eb622a66d81c7f9681b133295e17  src/models/huggingface.ts
23988c7aba2656f38cf85df81f03152b  src/hardware/profile.ts
cf005005a6333343e21fa3c902a0b5f6  src/models/recommendation.ts
c39b67256dfddc62163ef081380a7d5b  src/context/compiler.ts
e441e35b29fd2b0776b954b9f20d2356  src/security/workspace-guard.ts
```

**All `path:line` citations in this audit were verified against these
revisions.** If any of these hashes has changed when the audit is read,
re-verify the affected file's line numbers before acting on a citation.

---

## 5b. Second wave of concurrent changes — and a re-confirmation sweep

After the hashes in §5 were recorded, the concurrent agent made a **second,
larger** set of changes to three of the audited files. Notably, it began
implementing **CUDA GPU support** — which is independently the same direction as
this audit's Phase 8 recommendation:

| File | Before → after | What was added |
| --- | --- | --- |
| `src/runtimes/bootstrap.ts` | 254 → **425** lines | `RuntimeInstallPlan.dependencies`, `installRuntimeDependencies` (downloads + verifies a separate cudart archive), `hasCudaDevice(exe)` (probes `llama-server --list-devices` for `/CUDA\d+/`), `flattenRuntimeLibraries`, `findExecutables` (plural) |
| `src/runtimes/managed-llama.ts` | 284 → **336** lines | The `stopChild` force-kill (`taskkill /T /F` / `SIGKILL`) described in §5, plus supporting changes |
| `src/startup/orchestrator.ts` | 236 → **240** lines | Minor |
| `src/index.ts` | 1 014 → **1 015** lines | Minor |

### Re-confirmation sweep (run against the tree as it stands at audit close)

Each headline defect was re-checked against the **current** file contents. **All
of them still hold.** Only the line numbers moved.

| # | Finding | Audit-baseline citation | **Current citation** | Still present? |
| --- | --- | --- | --- | --- |
| B1 | `realpathSync.native(dirname(candidate))` → `ENOENT` for a new directory | `src/security/workspace-guard.ts:22-24` | **unchanged** (`:22,24`; file hash `e441e35…` unchanged) | **YES** |
| B2 | Hash mismatch throws without deleting the `.part`; `catch` cleans nothing | `src/runtimes/bootstrap.ts:237,251-253` | **`src/runtimes/bootstrap.ts:407,422`** | **YES** — the new CUDA-dependency path at `:312` *does* `unlink` its archive, but the primary engine path still does not |
| B3 | `this.child.kill()` after the `exit` handler nulled `this.child` | `src/runtimes/managed-llama.ts:157-161,167,169` | **`src/runtimes/managed-llama.ts:187,197,199`** | **YES** |
| B4 | `health()` re-enters `ensureServer` with **no** model id → reloads `installedModels[0]` | `orchestrator.ts:129` + `managed-llama.ts:198,128` | **`orchestrator.ts:133`** + **`managed-llama.ts:228,143`** | **YES** |
| B5 | `startupDiscovery` replaced without disposing the previous discovery | `src/index.ts:373` | **unchanged** (`:373`) | **YES** |
| B7 | `detect()` and `health()` both spawn `llama-server` | `managed-llama.ts:186-192,194-206` | **`managed-llama.ts:216-222,224-232`** | **YES** |
| B8 | Corrupt sidecar silently degrades a model | `src/models/huggingface.ts:206-233` | **unchanged** (hash `1076eb6…`) | **YES** |
| B10 | Model picker closes on failure; error rendered in the closed modal | `src/ui/app.tsx:2997-3005,3720-3721` | **unchanged** (hash `12810c9…`) | **YES** |
| B11 | `walk()` follows symlinks, no visited-set/depth cap | `src/context/compiler.ts:52-93` | **unchanged** (hash `c39b672…`) | **YES** |
| B12 | 4 dead helpers fail `noUnusedVariables` | `src/agent/agent.ts:2706,2729,2737,2753` | **unchanged** (hash `d867654…`); re-confirmed by the final lint run | **YES** |
| — | GPU never reaches execution (no `-ngl`, CPU-only assets) | `bootstrap.ts:65,86`; `managed-llama.ts:138-148` | **Being actively changed.** A CUDA install path now exists (`bootstrap.ts:280-324,362-425`), but `ensureServer`'s argument list at **`managed-llama.ts:153`** still contains **no `-ngl` and no `--threads`** | **PARTIALLY IN PROGRESS** |

### Other current-tree line mappings for frequently cited symbols

| Symbol | Baseline | Current |
| --- | --- | --- |
| `probeLocalModel` | `orchestrator.ts:27-48` | `:27` (unchanged) |
| `runStartup` | `:60` | **`:64`** |
| `discoverLocalRuntimes(…, 60 s)` | `:73` | **`:77`** |
| `detectHardware()` | `:75` | **`:79`** |
| `selectLocalRoute(...)` | `:93` | **`:97`** |
| `recommendBootstrapModel(hardware)` | `:100` | **`:104`** |
| `emit("onboarding")` | `:101` | **`:105`** |
| `prepareModel(model.id)` | `:120` | **`:124`** |
| `probe = await probeLocalModel` | `:153` | **`:157`** |
| OOM regex | `:155` | **`:159`** |
| `saveUserSettings({...})` | `:219` | **`:224`** |
| `state: "ready"` return | `:227` | **`:232`** |
| `SERVER_START_TIMEOUT_MS = 45_000` | `managed-llama.ts:17` | **`:23`** |
| `waitForHealth` | `:109` | **`:123`** |
| `ensureServer` | `:124` | **`:138`** |
| `installedModels[0]` selection | `:128` | **`:143`** |
| spawn `args` | `:138` | **`:153`** |
| `stdio: "ignore"` | `:152` | **`:182`** |
| full `process.env` forwarded | `:153-155` | **`:184`** |
| `listModels` | `:208` | **`:238`** |
| `installModel` | `:213` | **`:244`** |
| `provider(model)` | `:238` | **`:269`** |
| `prepareModel` | `:246` | **`:277`** |
| `MANAGED_LLAMA_RELEASE` | `bootstrap.ts:50` | **`:62`** |
| `resolveRuntimeInstallPlan` | `:56` | **`:94`** |
| 416-as-complete | `:124-127` | **`:186`** |
| `extractArchive` | `:170` | **`:232`** |
| `findManagedLlamaServer` | `:207` | **`:349`** |
| `installManagedRuntime` | `:214` | **`:362`** |
| `SHELRA_DISABLE_RUNTIME_INSTALL` | `:216` | **`:364`** |
| `existing` check (version dir only) | `:223` | **`:374`** |

**How to read this audit.** All narrative documents (`00`–`20`) cite the
**audit-baseline** line numbers, which correspond to the hashes recorded in §5.
For `src/runtimes/bootstrap.ts`, `src/runtimes/managed-llama.ts` and
`src/startup/orchestrator.ts`, use the mapping tables above to locate the same
code in the current tree. Every other audited file is unchanged.

**Every finding in this audit was re-verified as still present at audit close.**

## 6. Summary

| Check | Result | Attribution |
| --- | --- | --- |
| `bun run typecheck` | **PASS** (exit 0) | — |
| `bun run test` | **PASS** (exit 0) — 67 files / 280 tests at audit end | — |
| `bun run lint` | **FAIL** (exit 1) — 160 errors / 12 warnings | **pre-existing** |
| `bun run format` | **FAIL** (exit 1) | **pre-existing** |
| `bun run build` | not run | deliberate (writes to `dist/`) |
| CI (`typecheck.yml`) | **would FAIL at step 2** | **pre-existing** |
| Source files modified by this audit | **0** | — |
| Implementation performed | **NONE** | — |
</content>
</invoke>
