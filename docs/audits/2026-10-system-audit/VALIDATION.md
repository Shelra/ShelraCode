# Baseline and final validation

The root validation was run on Windows with Bun 1.4.1. The audit did not install dependencies, overwrite the user's publishing-script edit or install its compiled binary into the user's executable directory.

## Baseline

Before product changes, root format, lint, typecheck and the complete root test chain passed. Main Vitest coverage was 173 files / 1468 tests, followed by the isolated Vitest and Bun suites in `package.json`. Frontend typecheck passed separately. The locally present, Git-ignored account backend passed its own typecheck and 32 tests using fake/PGlite resources. Root checks do not cover those independent applications.

Baseline green tests did not cover the new hung-stream cancellation, unclosed shell child, memory concurrency, compaction objective, wrong check-role, tool-protocol or Bun runner reproductions. Fail-before regressions were run before each corresponding repair.

## Failed intermediate repairs are evidence

Early sandbox execution rejected subprocess/temporary-state operations. Those failures are retained in `validation-sandbox.json` and its log; they were not called product regressions.

The next full unsandboxed run was a product regression: `src/memory/concurrency.test.ts` retained 99/100 indexed entries despite all five children reporting successful exit. `validation-unrestricted-initial.json` records 178 passed / 1 failed files and 1499 passed / 1 failed tests. The subsequent owner-change regression reproduces the unsafe dead-lock reaping condition deterministically.

After the owner-identity correction, another full-suite run rejected two memory writers at the existing one-second admission bound. `validation-before-fairness.json` and `validation-test-before-fairness.txt` retain that failure. Unique writer tickets prevent whole-batch reacquisition ahead of waiters; neither the wait bound nor full-suite parallelism was relaxed. The test still requires all 100 indexed/readable entries and now also rejects whole-batch monopolization.

## Final required checks

| Command | Exit | Duration | Evidence |
| --- | --- | --- | --- |
| `bun run format` | 0 | 0.597 s | `validation-format.txt` |
| `bun run lint` | 0 | 1.236 s | `validation-lint.txt` |
| `bun run typecheck` | 0 | 19.635 s | `validation-typecheck.txt` |
| `bun run test` | 0 | 109.324 s | `validation-test.txt` |
| `SHELRA_BUILD_SKIP_INSTALL=1 bun run build` | 0 | 23.253 s | `validation-build.txt` |

The final root test chain passes 1511 main Vitest tests in 179 files, 9 separately run Vitest tests, and 116 Bun tests: **1636 tests in this chain**, after the MCP/model/persistence, Windows PID, monotonic-clock and image-persistence follow-ups. Existing React `act` warnings remain in the output and were not suppressed to obtain the result. Build emits the bundle and standalone executable with per-user installation disabled. Both `bun run dist/index.js --help` and `dist/shelra.exe --help` exit zero with recognized help output (`cli-smoke.json`); this is startup coverage, not a model query. The frontend/backend were unchanged after their baseline checks.

Additional regressions prove that a frozen wall clock cannot extend the one-second memory wait indefinitely, MCP failures remain failures in model output and reloaded transcripts, successful MCP image conversion remains intact, and an exited Windows PID is released before its inherited pipes close. Their fail-before cases were run before those follow-ups; no timeout or assertion was relaxed.

The final attachment follow-up adds two local/remote cases using the installed SDK schema: fresh binary messages pass, JSON-replayed messages fail before repair, and new base64 messages pass with identical decoded bytes. All ten vision regressions pass. Existing binary-object rows were not migrated.

The complete command output and exact exit codes are in `bench/history/system-audit/validation.json` and the text files above. They are retained as `.txt` so root log-ignore rules do not remove the evidence from a review. Home/scratch paths and recognized credential patterns are redacted in audit artifacts; byte counts describe original output before redaction.

## Reproduce

`bun scripts/system-audit-validate.ts` runs format, lint, typecheck, the complete root test chain and build serially, sets `SHELRA_BUILD_SKIP_INSTALL=1`, records output and stops on any failure. Its ten-minute caller bound is an audit safety limit, not a change to product deadlines.

Run runtime benchmarks serially after these checks. `bun scripts/system-audit.ts final` repeats the original bounded fault probes; `bun scripts/system-audit.ts fairness-stress --repetitions=10` repeats writer stress. `bun scripts/system-audit-report.ts` generates benchmark comparisons and redacts retained logs. Passing these checks demonstrates the covered boundaries, not months-long autonomy.
