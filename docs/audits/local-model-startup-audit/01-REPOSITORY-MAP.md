# 01 — Repository map

All statements are **FACT** unless marked INFERENCE.

## 1. Workspace shape

**Single package, not a monorepo.** `package.json` has no `workspaces` key; there
is exactly one `package.json` inside the audited scope (`ShelraCode/` excluded).

| Property | Value | Source |
| --- | --- | --- |
| name | `shelra` | `package.json:2` |
| version | `1.1.7` | `package.json:3` |
| description | "A local-first AI coding agent built with Bun and OpenTUI." | `package.json:4` |
| module system | `"type": "module"` | `package.json:5` |
| bin | `shelra` → `dist/index.js` | `package.json:12-14` |
| engines | `node >= 18` | `package.json:2915`-region (`"engines"` block) |
| package manager | **Bun** (`bun.lock`, 611 KB, present; no `package-lock.json`/`pnpm-lock.yaml`) | repo root |

**Note (FACT):** `bin` points at `dist/index.js`, but `tsconfig.json` has
`"declaration": true` and `rootDir: ./src` / `outDir: ./dist`, and `build` is
plain `tsc`. The published entry is therefore the compiled `src/index.ts`.
`src/index.ts` carries `#!/usr/bin/env bun` (`src/index.ts:1`) and has the
executable bit set.

## 2. Runtime, framework, build, test, lint

| Concern | Tooling | Source |
| --- | --- | --- |
| Runtime | Bun (dev), Node ≥18 (published) | `package.json` scripts, `src/index.ts:1` |
| TUI | `@opentui/core` + `@opentui/react` + React 19, `jsx: react-jsx`, `jsxImportSource: @opentui/react` | `tsconfig.json`, `package.json` deps |
| CLI parsing | `commander` v12 | `src/index.ts:3,734-828` |
| AI SDK | `ai` v6 + `@ai-sdk/openai-compatible` (+ `@ai-sdk/xai`, legacy) | `src/runtimes/local-provider.ts:1-2`, `src/toolset/client.ts:1` |
| Storage | `bun:sqlite` | `src/storage/db.ts:1` |
| Schemas | `zod` v4 | deps |
| MCP | `@modelcontextprotocol/sdk`, `@ai-sdk/mcp` | `src/mcp/*` |
| Telegram | `grammy` | `src/telegram/*` |
| Payments/wallet | `@coinbase/agentkit`, `viem` (transitive) | `src/payments/*`, `src/wallet/*` |
| Build | **Changed during this audit** by concurrent work: `build` and `build:binary` are now both `bun run scripts/build.ts` (a `Bun.build` bundler that externalises the `@opentui/core-*` native packages). At audit start `build` was `tsc`. `scripts/build.ts` and its dependency `src/cli/installation.ts` were added after the audit scope was fixed and are **not audited**. | `package.json:18-19`; `scripts/build.ts:1-40`; see `21-VALIDATION-RESULTS.md` §5 |
| Typecheck | `tsc --noEmit` | `package.json:21` |
| Tests | **Vitest 4** via `bunx vitest run --pool=forks` | `package.json:22` |
| Lint/format | **Biome 2.4.8** (`biome check src/` / `biome format src/`) | `package.json:24-25`, `biome.json` |
| Hooks | Husky + lint-staged (`biome check --write` on staged) | `package.json:28-30`, `.husky/` |

### The `test` script verbatim (`package.json:22`)

```
bunx vitest run --pool=forks --exclude="ShelraCode/**" --exclude="ShelraCode/node_modules/**"
  --exclude="src/storage/sessions.test.ts" --exclude="src/agent/sandbox.test.ts"
  --exclude="src/agent/delegations.test.ts" --exclude="src/agent/recap.test.ts"
  --exclude="src/verify/runtime-prep.test.ts"
&& bunx vitest run --pool=forks --no-file-parallelism src/agent/sandbox.test.ts
&& bunx vitest run --pool=forks --no-file-parallelism src/agent/delegations.test.ts
&& bunx vitest run --pool=forks --no-file-parallelism src/agent/recap.test.ts
&& bunx vitest run --pool=forks --no-file-parallelism src/verify/runtime-prep.test.ts
```

`src/storage/sessions.test.ts` is **permanently excluded** — it is never run by
`bun run test` or `bun run test:watch`. **FACT.**

## 3. Git state

```
branch: main
```

Working tree at audit start and end (verified unchanged): **45 modified**,
**2 deleted** (`src/toolset/models.ts`, `src/toolset/models.test.ts`), **16 untracked**
entries. Untracked new source trees: `src/context/`, `src/hardware/`,
`src/models/`, `src/product/`, `src/providers/`, `src/router/`, `src/runtimes/`,
`src/security/`, `src/setup/`, `src/startup/`, plus `src/agent/kernel.ts(.test)`,
`src/ui/startup.tsx`, `src/ui/startup-input.ts(.test)`, and `docs/`.

**INFERENCE (high confidence):** every subsystem central to this audit
(startup, hardware, models, runtimes, router, providers, product identity,
security guard, context compiler) is **untracked new work**; the tracked
baseline is the earlier runtime. That is why doc/code drift is so
pronounced.

## 4. Source tree (`src/`) — role and audit relevance

| Directory | Role | Relevant to this audit |
| --- | --- | --- |
| `agent/` | `Agent` façade (2 937 lines), compaction, delegations, reasoning, vision, `kernel.ts` | **Yes** — provider install, context, readiness consumption |
| `audio/stt/` | Remote STT for Telegram voice | No |
| `context/` | Host-side turn classifier + repo evidence compiler | **Yes** — runs on every turn |
| `daemon/` | Schedule daemon | No |
| `toolset/` | Tools registry and batch; the xAI-only adapter and media tools it once held have been removed | Partly (`tools.ts`, `batch.ts` live) |
| `hardware/` | Hardware profile + fit score | **Yes** |
| `headless/` | `--prompt` output rendering | **Yes** (error UX) |
| `hooks/` | Lifecycle hook config/executor | No |
| `lsp/` | LSP manager/clients | No |
| `mcp/` | MCP runtime/catalog/validate | No |
| `models/` | HF catalog+download, install manager, recommendation, `catalog.ts` stub | **Yes** |
| `payments/`, `wallet/` | x402 wallet | No |
| `product/` | Product identity constants + dirs | **Yes** (paths) |
| `providers/` | `ProviderAdapter` contract, stream normalizer, fake, auxiliary | **Yes** |
| `router/` | `selectLocalRoute` | **Yes** |
| `runtimes/` | Managed llama.cpp, bootstrap installer, discovery, local provider | **Yes** |
| `security/` | `resolveWorkspacePath` guard | **Yes** (regression) |
| `setup/` | `shelra setup` onboarding printer | **Yes** (duplicate) |
| `startup/` | Startup orchestrator + types | **Yes** (core) |
| `storage/` | SQLite sessions/transcripts/usage/migrations | **Yes** (persistence) |
| `telegram/` | Remote-control bridge | No |
| `tools/` | bash, file, grep, computer, schedule | **Yes** (`file.ts` regression) |
| `types/` | Shared `ModelInfo`, `ToolCall`, … | **Yes** |
| `ui/` | `app.tsx` (5 902 lines), `startup.tsx`, modals, theme | **Yes** |
| `utils/` | settings, install-manager, workspace-trust, skills, update-checker | **Yes** |
| `verify/` | `--verify` flow, checkpoints, recipes | No (adjacent) |

### File sizes of the audit-critical files

```
src/ui/app.tsx              5902 lines
src/agent/agent.ts          2937
src/utils/settings.ts        707
src/toolset/client.ts           351   (dead in runtime graph)
src/ui/startup.tsx           250
src/startup/orchestrator.ts  236
src/runtimes/managed-llama.ts 284
src/runtimes/bootstrap.ts    254
src/models/huggingface.ts    249
src/hardware/profile.ts      205
src/context/compiler.ts      181
src/runtimes/local-provider.ts 152
src/setup/onboarding.ts      132
src/agent/kernel.ts          114
src/runtimes/discovery.ts    119
src/models/recommendation.ts  70
src/router/local-first.ts     59
src/models/manager.ts         53
src/security/workspace-guard.ts 35
src/models/catalog.ts         32   (all stubs)
```

## 5. CLI surface (`src/index.ts:734-1007`)

| Command | Handler | Line |
| --- | --- | --- |
| *(default)* `shelra [message...]` | `startInteractive` / `runHeadless` / `runBackgroundDelegation` | `:757-828` |
| `shelra setup` | `runOnboarding` | `:830-840` |
| `shelra telegram-bridge` | `runTelegramHeadlessBridge` | `:842-873` |
| `shelra models` | `discoverLocalRuntimes` + print | `:875-896` |
| `shelra update` | `runUpdate` | `:898-906` |
| `shelra uninstall` | `runScriptManagedUninstall` | `:908-924` |
| `shelra wallet init\|balance\|history` | `WalletManager` / `PaymentHistory` | `:926-986` |
| `shelra daemon` | `SchedulerDaemon` | `:988-1007` |

Default-command flags relevant here: `--remote` (`:742`), `-m/--model` (`:741`),
`-k/--api-key` (`:739`), `-u/--base-url` (`:740`), `-p/--prompt` (`:744`),
`--verify` (`:745`), `--format` (`:746`), `--sandbox/--no-sandbox` (`:747-748`),
`-s/--session` (`:752`), `--background-task-file` (`:753`).

## 6. Configuration system

### On disk

| Path | Written by | Read by |
| --- | --- | --- |
| `~/.shelra/user-settings.json` | `saveUserSettings` (`src/utils/settings.ts:231`) | `loadUserSettings` (`:227-229`) |
| `~/.shelra/models/*.gguf` + `*.gguf.json` | `downloadHuggingFaceModel` (`src/models/huggingface.ts:176-181`) | `discoverInstalledHuggingFaceModels` (`:193-237`) |
| `~/.shelra/runtime/llama-cpp/<release>/` | `installManagedRuntime` (`src/runtimes/bootstrap.ts:246`) | `findManagedLlamaServer` (`:207-212`) |
| `~/.shelra/shelra.db` (+ `-wal`, `-shm`) | `src/storage/db.ts:23-34` | sessions/transcripts/usage |
| `~/.shelra/delegations/<projectId>/` | `src/agent/delegations.ts:234-243` | same |
| `./.shelra/settings.json` (project) | `saveProjectSettings` (`src/utils/settings.ts:322`) | `loadProjectSettings` (`:316`) |
| `~/.shelra/workspace-trust.json` | `src/utils/workspace-trust.ts` | `getWorkspaceTrustDecision` (`src/index.ts:629`) |

### Environment variables (`src/product/identity.ts:9-14`)

`SHELRA_API_KEY`, `SHELRA_BASE_URL`, `SHELRA_MODEL`, `SHELRA_MAX_TOKENS`,
`SHELRA_BACKGROUND_CHILD`, `SHELRA_HOOK_EVENT`.
Additional startup-relevant vars: `SHELRA_LOCAL_ENDPOINT` / `OPENAI_BASE_URL`
(`src/runtimes/discovery.ts:82`), `SHELRA_ONBOARDING_MODEL`
(`src/models/recommendation.ts:21`), `SHELRA_DISABLE_RUNTIME_INSTALL`
(`src/runtimes/bootstrap.ts:216`), `SHELRA_TRUST_WORKSPACE`
(`src/index.ts:626`). `dotenv.config()` runs at module load
(`src/index.ts:54`).

## 7. Repository instructions

| File | State |
| --- | --- |
| `AGENTS.md` | **STALE — do not trust.** Documents a "broken ESLint config" (the repo uses Biome) and references `src/utils/model-config.ts` and `settings-manager.ts` (**neither exists**). Verified by grep: no `.eslintrc*`, no `model-config.ts`, no `settings-manager.ts` under `src/`. |
| `README.md` | 21 KB, largely accurate about *intent*; several concrete claims contradict code — see `17-GAP-ANALYSIS.md` §"Docs vs code". |
| `CLAUDE.md` | **Not present.** |
| `.claude/` | **Not present.** |
| `.cursor/` | Present (not audited — no startup/model impact found by grep). |
| `.agents/skills/` | `agent-browser`, `agent-desktop`, `find-skills`. All three are host-tooling instructions for browser/desktop automation and skill discovery. **None touch startup, hardware, model discovery, runtime, or provider code.** Out of scope, verified by reading all three `SKILL.md` files. |
| `docs/architecture/` | 11 docs, untracked, self-aware and mostly honest. Divergences are recorded per-area in the relevant audit files and summarised in `17-GAP-ANALYSIS.md`. |

## 8. CI

`.github/workflows/typecheck.yml` (job name `ci`, on push/PR to `main`/`develop`):
`bun install --frozen-lockfile` → **`bun run format`** → **`bun run lint`** →
`bun run typecheck` → `bun run build:binary`.

**FACT:** both `bun run format` and `bun run lint` currently exit `1`
(measured — see `21-VALIDATION-RESULTS.md`), so this workflow fails at step 2.
Other workflows present: `release.yml`, `security.yml` (not audited).
</content>
</invoke>
