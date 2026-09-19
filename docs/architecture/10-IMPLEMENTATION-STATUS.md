# ShelraCode migration implementation status

This is the status after the controlled migration pass through phases 1-9 and
the cloud-first runtime implementation. The React/OpenTUI shell
remains the presentation boundary. The default intelligence path is now owned
by Shelra's OpenRouter adapter and dynamic model registry; the pinned,
app-managed llama.cpp server plus GGUF artifacts resolved from Hugging Face are
an explicit `--local` secondary path.

| Phase | State | Evidence |
| --- | --- | --- |
| 0 - forensic audit | IMPLEMENTED | `docs/architecture/00-CURRENT-STATE.md`, `02-SHELRACODE-ARCHITECTURE.md` through `06-FEATURE-MATRIX.md`, and `08-RISK-REGISTER.md` |
| 1 - provider seam | IMPLEMENTED | `src/providers/types.ts`, `src/providers/stream.ts`, `src/providers/architecture.test.ts`; provider protocol objects stop at adapters |
| 2 - local foundation | IMPLEMENTED; real local inference VERIFIED | `src/models/huggingface.ts`, `src/runtimes/bootstrap.ts`, `src/runtimes/managed-llama.ts`, `src/runtimes/discovery.ts`; the Qwen GGUF was downloaded and SHA-256 checked, llama.cpp returned a real `READY` completion, and the CUDA runtime was observed using the GTX 1650 |
| 3 - control plane/context | IMPLEMENTED | `src/context/compiler.ts`; ordinary chat stays lightweight and repository turns receive bounded evidence |
| 4 - kernel/safety | PARTIALLY VERIFIED, see correction below | `src/agent/kernel.ts`, `src/security/workspace-guard.ts`; host review, containment and verification are present, while a full autonomous coding task on the small local model remains UNPROVEN |
| 5 - model routing | IMPLEMENTED | `src/models/routing.ts`, `src/models/openrouter.ts`; cloud capability/cost policy selects Free by default while `src/router/local-first.ts` remains the explicit local-mode router |
| 6 - remove xAI execution | IMPLEMENTED | default startup never creates an xAI client; the xAI-only adapter, its static model catalog and the xAI media tools have been removed |
| 7 - feature reconciliation | IMPLEMENTED, capability dependent | Shell commands, MCP, LSP, headless, schedules and approvals remain; unsupported provider-only capabilities surface as unavailable |
| 8 - branding/config | IMPLEMENTED | state and settings use `.shelra` and `SHELRA_*` only; legacy-path reads and legacy environment names were removed |
| 9 - debt deletion | PARTIALLY IMPLEMENTED | the xAI-only adapter, media tools and legacy paths were removed; the batch and remote-STT modules remain as isolated compatibility code |

## Correction to Phase 4 (2026-09-12)

The Phase 4 row above understates the current state and predates a second, independent state machine.
`src/agent/kernel.ts`'s completion gate is real and correct, but has zero observers anywhere in
`src/` — it computes a phase/verification veto that nothing ever reads. Separately, `src/autonomy/*`
(not listed above) implements a considerably more complete objective/task/acceptance ledger, but only
for `--autonomous` runs. See `docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md` for the full
evidence trail, root-cause analysis, and the target architecture that reconciles the two.

## Local runtime and model path

`src/runtimes/bootstrap.ts` installs a pinned official llama.cpp release asset
into `~/.shelra/runtime/llama-cpp/<release>-<backend>`, verifies its SHA-256,
extracts it atomically, and locates `llama-server`. On Windows x64 with an
NVIDIA device it selects the CUDA build and installs its pinned CUDA runtime
DLL package beside the server. It does not invoke WinGet, Homebrew,
Ollama, LM Studio, or another user-managed runtime. `src/runtimes/managed-llama.ts`
starts the server on loopback, waits for `/health`, and exposes it through the
provider-neutral OpenAI-compatible adapter.

`src/models/huggingface.ts` resolves reviewed GGUF artifacts from Hugging Face,
resumes `.part` downloads with HTTP Range, reports byte progress/speed/ETA,
checks SHA-256, writes a sidecar, and atomically finalizes the model. The
current reviewed seed catalog is a fallback for first-run recommendation; it is
not a static model registry. A future catalog refresh can add more HF entries
without changing the runtime contract.

## Verification evidence

- `C:\Users\Javie\.shelra\models\qwen2.5-coder-1.5b-instruct-q4_k_m.gguf` exists at **1,117,320,768 bytes**. The downloader verified SHA-256 `cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046` before finalization.
- `llama-server` build `b10826` (llama.cpp `0.4.0-dev`) was started against that file. `/health` returned HTTP 200 and `/v1/models` exposed the local model.
- A direct local chat-completions request returned HTTP 200 with the assistant content `READY`. The provider adapter and the compiled headless CLI both completed the same deterministic local turn (`bun dist/index.js --prompt ... --max-tool-rounds 1`) with exit code 0. This proves local runtime, normalized adapter, and a real conversation turn; it does **not** prove a complete autonomous coding task.
- A compiled CLI PTY run rendered the startup/onboarding surface, showed real download byte progress, entered chat after model readiness, and accepted cancellation. A final second-launch PTY run entered the chat shell without onboarding/API-key prompts and exited cleanly; `shelra models` also terminates without leaving a runtime child.
- A disposable-workspace OpenRouter Free smoke test selected `openrouter/free`, created `index.html`, `style.css`, and `script.js` for a digital clock, read the generated files, recovered from an invalid shell command, and completed local verification without paid escalation.

## Automated verification

The canonical target checks are `bun run typecheck`, `bun run lint`,
`bun run format`, `bun run build`, and the target Vitest suite. The latest suite
passed **69 primary test files / 321 tests**, then the four intentionally
isolated suites (**4 + 4 + 2 + 1 tests**), for **73 files / 332 tests** total.
OpenRouter catalog, routing and web-research tests are network-free in Vitest.
Separate live validation completed `GET /models`, a compiled installed
free-router streaming response, a zero-budget paid-request block, and a real
installed-binary digital-clock coding task; those checks are not part of
automated CI.

## Licensing

The target MIT notice remains. No Shelra source directory was copied wholesale.
If Apache-2.0 Shelra files are copied in a later phase, their headers and
NOTICE obligations must remain with those files and in release notices.
