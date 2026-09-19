# ShelraCode startup and local model onboarding

This document describes the explicit `--local` path. It is no longer the
normal startup path: the default CLI is cloud-first OpenRouter Free, and the
local runtime is secondary/private/offline.

## Objective

Keep the existing OpenTUI shell while making every explicit `shelra --local`
launch resolve and health-check a private local model before chat becomes
interactive. Normal `shelra` launches resolve OpenRouter cloud models instead.

## Current implementation

- `src/startup/orchestrator.ts` runs config validation, hardware inspection,
  managed-runtime discovery, model discovery, ranking, runtime preparation and
  provider health in one normalized startup state machine.
- `src/ui/startup.tsx` renders loading, recommendation, installation progress,
  recovery and ready states using the existing OpenTUI theme/component system.
  Chat mounts only after readiness; the old Shelra TUI is not imported.
- `src/models/recommendation.ts` scores the reviewed Hugging Face GGUF seed
  catalog using GPU/VRAM first, then RAM/CPU/storage and context headroom. A
  4 GB GTX 1650 selects the 1.5B Q4_K_M fallback instead of overfitting a 7B
  model to the machine.
- `src/models/huggingface.ts` owns resumable download, speed/ETA reporting,
  SHA-256 validation, sidecars, corrupt-partial removal and atomic finalization.
- `src/runtimes/bootstrap.ts` downloads and verifies the pinned llama.cpp release
  asset, extracts it under `.shelra`, and never calls a package manager or asks
  the user to install a separate runtime application.
- `src/runtimes/discovery.ts` keeps the managed installer visible before the
  engine binary exists, so a fresh machine receives an active install action;
  the action installs the engine first and the model second.
- `src/runtimes/managed-llama.ts` owns server lifecycle on loopback and waits
  for the real `/health` response before reporting readiness, with a startup
  lock that prevents parallel discovery calls from spawning duplicate servers.
- `src/ui/startup-input.ts` normalizes Enter/Return/CR/LF, retry and exit
  actions. Mouse and keyboard controls use the same startup surface.

## Normal paths

1. Existing model: validate the saved selection, scan managed runtime/model
   artifacts, rank candidates, start the private server, health-check generation,
   and mount chat without onboarding.
2. First run: scan the computer, present one understandable recommendation,
   install the selected GGUF from Hugging Face with byte progress, verify it,
   prepare llama.cpp, health-check it, persist the selection, and enter chat.
3. A missing, moved, corrupt or incompatible saved artifact triggers rediscovery
   and recovery. A memory/load failure can move to a smaller ranked candidate;
   it does not expose a raw stack trace as the primary UI.
4. The default cloud path does not initialize local runtimes. `--local` enters
   this state machine explicitly; `--remote` remains a compatibility alias for
   cloud mode.

## Production evidence and limits

The 1.5B Q4_K_M Qwen artifact was downloaded into `.shelra/models` from its
Hugging Face resolve URL, resumed/verified by the app, and served by the managed
llama.cpp binary. Direct `/health` and `/v1/chat/completions` checks succeeded.
The provider adapter and compiled headless CLI now complete a deterministic
conversation turn against the local model. The full small-model coding loop is
still **UNPROVEN**: an earlier unrestricted planning turn was cancelled after
it exceeded the practical timeout, and a disposable file-edit/test task still
needs a separate measured run.

The local Shelra reference checkout did not contain a production HF catalog,
download manager or embedded runtime lifecycle, so this target adds one
consolidated implementation rather than duplicating the reference TUI. The
reviewed seed catalog is deliberately small and auditable; dynamic HF catalog
search is a follow-up capability, not a claim made by this phase.

## Repository request behavior

Spanish and English repository intents are classified before inference. A broad
request such as `revisa el proyecto` receives a host-compiled set of root
manifests and bounded evidence, then one direct local generation. Explicit file
requests retain the read-only `read_file`/`grep`/`lsp` tool path. The target's
nested `ShelraCode/` reference checkout is excluded from workspace walking so it
cannot crowd out the target's `package.json` or `src/` paths.

A real compiled CLI run of the broad Spanish request completed with exit code 0
and produced a project summary. The 1.5B model's native tool-call behavior is
still not certified for arbitrary explicit tool turns; those turns remain a
separate capability measurement rather than a false green claim.

## Tests and acceptance

Focused tests cover startup actions, recommendation, HF resume/hash/atomic
finalization, runtime install plans, runtime discovery, provider normalization,
and managed-model routing. The compiled CLI was exercised on a second launch
with the installed model and reached the chat shell without onboarding; a direct
adapter probe also completed `detect -> prepare -> health -> generate READY ->
dispose`. A green unit suite alone is not evidence that a local model is ready.
