# Why Shelra felt frozen, and what changed (2026-10-06)

Evidence date 2026-10-06, Windows 11, Bun 1.4.1, OpenTUI 0.1.88, React 19.2. Everything below was measured with the
harness in `scripts/perf/`; where a number comes from one run, it says so. This is the account of one investigation
on one machine (other agent sessions were running on it, so single cells are noisy), not a benchmark of Shelra.

## How it was measured

- `scripts/perf/ui-stress.tsx` mounts the real `App` on a real `Agent` in OpenTUI's test renderer (the model is
  scripted, tools run for real on a git fixture) and drives it through the composer: a long history, a heavy turn
  (2,400 characters of reasoning, 3,600 of markdown, 16 reads and greps, a 4,000-line command, a 400-line file
  written and edited), typing and scrolling while it streams, resize, Esc, a new message after the cancel, and
  reading the whole history back to the top. It records event-loop gaps, React commits (Profiler), terminal frames,
  input-to-screen latency, CPU, memory, and (with `SHELRA_PERF_PROFILE=1`) a CPU profile.
- `scripts/perf/tool-stalls.ts`, `turn-setup.ts`, `markdown-cost.tsx` isolate one mechanism each.
- Probes (`src/utils/perf-probe.ts`) count hot paths; off unless `SHELRA_PERF_PROBE=1`.
- Not measured: the bytes a real Windows terminal receives and how fast it paints them. The test renderer does the
  layout, painting and diff but writes nothing to a console. Any claim about the user's terminal is inference.

## Root causes (each reproduced before it was changed)

| # | Mechanism | Evidence |
| --- | --- | --- |
| 1 | **Every mounted renderable costs layout on every frame**, and the log mounted the whole session. 34 renderables per turn; Yoga (WASM) layout was 41-55% of CPU. | Average frame during a heavy turn: 4.7 ms with no history, 11.8 ms after 60 turns, 21.3 ms after 150. Resize 35 / 91 / 186 ms. |
| 2 | `agent.getContextStats` ran **in `App`'s render body** and re-serialised the whole conversation on every commit. | 947 calls, 592 ms, one call 60 ms (60 turns). |
| 3 | `syncKernelState` polled every 100 ms: a database read and a fresh object, so a full-screen commit ten times a second even while waiting. | Frames while only waiting for the model: 19/s. |
| 4 | `scrollToBottom` ran every 50 ms of streaming without asking whether the reader had scrolled up: **the log could not be read while the agent worked.** | Reproduced by scrolling during a stream. |
| 5 | `MessageView` re-rendered ~13 times per message per turn (no memo, projection rebuilt every item). | 3,909 renders in one turn at 150 turns. |
| 6 | A streamed answer re-rendered all its finished blocks at 30 Hz. | Tick cost 29 ms at 32,000 characters. |
| 7 | **`write_file` of a big rewrite froze the UI in the line diff.** | 8,000 lines, half changed: 15.4 s with no way to cancel. |
| 8 | **`ripgrep` is WebAssembly on the main thread.** Each `grep` held the loop for the whole search. Parsing 180,000 matches added seconds. | 3,000 files: 0.33 s with one match, 1.0-1.4 s with 180,000; 3.8 s before the parse was bounded. |
| 9 | **Several `spawnSync("git")` at every turn start and end.** `captureWorkspaceState` read `git status` + `rev-parse` about 2.4 times per turn; the context compiler ran 4-5 git commands. | 76 ms per reading on a six-file project, ~250 ms per context compile and ~0.4 s per `git status` on this repository. |
| 10 | The `@` file index ran `execSync("git ls-files")` (5 s ceiling) on the UI thread. | Code reading; typing `@` in a big repository. |

Hypotheses tested and rejected: React's development build is not the freeze (frame cost identical in production mode;
it costs ~5% CPU and ~10% memory, so it is worth switching later); capping the renderer at 30 fps (typing latency
+6 ms, CPU -13%); a memory leak (heap follows the mounted window and plateaus: 40 heavy turns oscillate 113-132 MB,
~0.3 MB/turn of real data).

## What changed

- **Mounted window** (`src/ui/transcript-window.ts`, `hooks/use-transcript-window.ts`): the log mounts its last 150
  items; reaching the top mounts 100 more and keeps the reader's line in place; the whole history is still stored and
  reachable. A `▸ N earlier entries` line says so.
- Follow-vs-jump scrolling; per-message token estimate cache; `sameSnapshot` bail-outs on polled state; usage read
  at 1 Hz instead of 10; reasoning refreshed at 4 Hz (the thinking line holds a sentence 1.6 s); `React.memo` on log
  views with stable projected items; block-level memo in `Markdown`.
- `src/tools/bounded-diff.ts`: the diff has a 150 ms budget; past it the change is reported by size in the same patch format.
- `grep` runs ripgrep on a worker thread (`grep-worker.ts`, `ripgrep-client.ts`), falls back to the main thread if no
  worker starts, and trims output to the 5,000 first matches before copying it. `scripts/build.ts` ships the worker
  in the bundle and the executable (verified in source, bundle and compiled `.exe`).
- Async `captureWorkspaceStateAsync` (HEAD read from `.git` without a process), async `compileContextPacket` (independent
  git commands in parallel), async `FileIndex`.

## Results (stress turn, 120x40, same harness; baseline = the code before these changes)

| History | Frame avg (ms) | Resize (ms) | Typing worst (ms) | Scroll worst (ms) | Stalls > 50 ms in turn | CPU % |
| --- | --- | --- | --- | --- | --- | --- |
| 0 turns, before / after | 4.7 / 3.6 | 35 / 24-39 | 28 / 19 | 16 / 17 | 0 / 1 | 51 / 44 |
| 60 turns, before / after | 11.8 / 5.3 | 91 / 24-67 | 72 / 22 | 73 / 25 | 20 / 1 | 82 / 44 |
| 150 turns, before / after | 21.3 / 5.5 | 186 / 56-152 | 167 / 24 | 158 / 16 | 31 / 1.5 | 89 / 50 |

Frame cost no longer grows with history (mounted renderables: 1,661 after 150 turns, about 6,800 if all were mounted).
Reading 1,000 history items back to the top: 9 pages of ~170 ms, each anchored (3 runs of 3, 27/27).

| Single mechanism | Before | After |
| --- | --- | --- |
| `write_file`, 8,000 lines half changed | 15,407 ms blocked | 158 ms |
| `grep`, 180,000 matches (loop gap) | 3,827 ms | 54 ms |
| `grep`, one match in 3,000 files | 429 ms | 6 ms |
| Git work in 20 turns on a six-file repo (`stalledMs`) | 4,278 | 526 |
| Streaming tick at 32,000 characters (update + frame) | 41 ms | 9 ms |
| Frames per second while waiting for the model | 19 | 11 |

Memory: heap oscillates between 113 and 132 MB over 40 heavy turns (window sawtooth); RSS drift about 1 MB per turn.

## Verification run

`bun run format`, `bun run lint`, `bun run typecheck` pass; `SHELRA_BUILD_SKIP_INSTALL=1 bun run build` passes (bundle and
executable, `dist/tools/grep-worker.js` emitted); the 21 Bun-only suites pass. In `bun run test`'s Vitest part, 9-14
tests in eight agent/bench files time out at the 5 s limit when the whole suite runs in parallel, a different subset each
time; the same eight files pass serially (196/196), and 9 still time out with the synchronous workspace reading put back,
so the timeouts are load, not this change. Treat that as unproven until the suite is run on an idle machine.

## Not done, and what is still worth doing

- The terminal's own cost on Windows (bytes per frame, ConPTY) is unmeasured; run `SHELRA_TRACE=verbose` sessions with
  the probes on.
- Turn setup still reads memory and skills synchronously (about 140 ms per turn with a 200-entry store); SQLite
  contention still blocks for up to 5 s (audit F30); `read_file` still reads whole files (about 35 ms for 32 MiB);
  `captureWorkspaceState` is still synchronous in the memory-digest callback; a handful of `spawnSync("git")` remain
  (`memory/evidence.ts`, `agent.ts` `git show`).
- `projectTranscript` is O(n) per message change (2.4 ms at 150 turns): make it incremental if sessions grow far past that.
- Ship React in production mode (`NODE_ENV` in `scripts/build.ts`): -10% heap, -5% CPU, no frame change.
- `agent.ts` (315 KB) and `src/index.ts` (106 KB) were not split: no measurement pointed at their structure, and a
  split of this size without a behavioural reason is risk without evidence. The responsibility map and coupling points
  that did matter (workspace reading, context compile, tool I/O) were extracted or made async instead.
- The Next.js `frontend/` was not audited (the owner's rule in memory: another agent owns it).
