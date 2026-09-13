# Distribution build and global CLI installation

## Objective

Make `bun run build` produce a self-contained ShelraCode executable and install
the active version so a user can run `shelra` from any terminal and any
project directory.

## Evidence from the ShelraCode reference

The local reference repository uses `scripts/build.ts` to create a bundled
`dist/index.js`, compile a platform executable with `Bun.build({ compile })`,
and call `src/cli/installation.ts`. Its Windows install contract is
`%USERPROFILE%\\.shelra\\bin\\shelra.exe`, an `active.json` manifest, and a
persistent user PATH entry. The target now follows that contract while keeping
its Grok-derived React/OpenTUI entrypoint.

## Target implementation

- `scripts/build.ts` creates the JavaScript bundle, emits declarations, and
  compiles `dist/shelra.exe` on Windows (or `shelra` on Unix).
- `src/cli/installation.ts` performs an atomic staged copy, retains the prior
  executable as `.previous`, writes `active.json` atomically, and registers the
  user PATH on Windows through PowerShell's user environment scope.
- `SHELRA_BUILD_SKIP_INSTALL=1` builds artifacts without touching the user
  installation. `SHELRA_INSTALL_BIN` selects a custom installation directory.
- `build:binary` remains an alias for the complete build/install flow.

## Real verification

- `bun run typecheck` — PASS.
- `bun run test` — PASS: 67 test files, 281 tests.
- `SHELRA_BUILD_SKIP_INSTALL=1 bun run build` — PASS; `dist/index.js` and
  `dist/shelra.exe` were produced.
- `dist/shelra.exe --version` — PASS (`1.1.7`).
- `bun run build` — PASS; active executable installed at
  `C:\\Users\\Javie\\.shelra\\bin\\shelra.exe`, manifest version `1.1.7`,
  and user PATH registration reported success.
- A refreshed child shell resolved `shelra` from the persisted user PATH and
  returned `1.1.7` from a temporary directory.
- `shelra setup --non-interactive` completed with exit code 0, displayed the
  detected NVIDIA GPU and reviewed Hugging Face model, and released its
  temporary managed runtime before exiting.
- The installed binary starts the app-managed CUDA runtime automatically when
  `nvidia-smi` reports an NVIDIA device; see
  [`13-GPU-RUNTIME-VERIFICATION.md`](13-GPU-RUNTIME-VERIFICATION.md) for the
  real device and utilization evidence.
- A real global CLI smoke test from a temporary directory used the managed
  local model and returned `READY`, exit code `0`, in 16.3 seconds. A follow-up
  process check found no resident `shelra.exe` or `llama-server.exe` process.
- `shelra uninstall --dry-run` recognizes the active build manifest and shows
  the expected Shelra data paths.

## Limitations

The Windows x64 executable path is verified on the current host. Cross-builds
for macOS/Linux and Windows arm64 are represented by the target selection code
but require those host/toolchain environments for real verification.
