# Shelra Bench — UI Design Specification

## 1. Purpose & Scope

This document defines the visual system, information architecture, and interaction patterns for **Shelra Bench**, a benchmark feature embedded in the existing OpenTUI terminal application. It is the UI design and implementation reference; the main implementation currently lives in `src/ui/bench-modal.tsx` and its integration in `src/ui/app.tsx`.

The benchmark evaluates Shelra's agent harness across fixed dimensions and produces immutable runs. The UI must make it easy to:

- Compare Shelra harness versions and configurations at a glance, with the model treated as a controlled variable (leaderboard).
- Browse and filter historical runs (run history).
- Spot trends over time (historical chart).
- Compare two or more runs side-by-side (run comparison).
- Inspect a single run in depth (run detail).
- Drill into individual tasks and acceptance criteria (task explorer).
- Monitor an in-flight benchmark when a real runner is active (live run progress).

The default scope is Shelra. Other agents are calibration data only when a real
run has been persisted; production UI code must never invent leaderboard rows.

## Implementation status

This specification is now backed by the implemented Shelra Bench modal in
src/ui/bench-modal.tsx and the persisted benchmark store in
src/storage/benchmarks.ts. The UI reads real SQLite history, including empty,
invalid, failed, interrupted, diagnostic, and leaderboard-eligible states.
Fixtures are used only by tests and development validation.

The current entry point is the TUI slash command /bench. It is a modal surface
inside ShelraCode, not a separate web route. Long-running benchmark execution
currently starts from the CLI; persisted progress and later inspection are the
stable integration boundary.

## 2. Design Principles

- **Terminal-native density**: Optimize for 80+ column terminals. Prefer compact tables, single-line rows, and text glyphs over heavy borders or box art.
- **Read-first, act-second**: The leaderboard and history are read-heavy surfaces; keep them scannable before adding actions.
- **Harness-first analysis**: Agent identity is the subject; model/provider/version remain visible so a model change cannot be mistaken for a harness improvement.
- **Color carries meaning, structure carries hierarchy**: Use color only for semantic emphasis. Layout, indentation, and alignment do the structural work.
- **Aurora is a highlight, not a wallpaper**: The emerald→cyan→violet gradient is reserved for active/live states and top-ranked accents. Static surfaces use solid theme roles.
- **Same app, same rules**: Reuse the existing modal system, keyboard grammar, and theme contract from `src/ui/theme.ts` and `src/ui/app.tsx`.

## 3. Layout Approach

### 3.1 Modal-First Architecture

Shelra Bench surfaces are implemented as **full-screen modals** layered over the chat workspace, consistent with the existing picker/browser modals (`ModelPickerModal`, `McpBrowserModal`, `ScheduleBrowserModal`).

- A semi-transparent `t.overlay` backdrop covers the workspace.
- A single modal panel is centered or bottom-aligned using `bottomAlignedModalTop()`.
- The panel uses `t.backgroundPanel` or `t.surface` as its background.
- No persistent sidebar or top navigation is added to the main app chrome; entry is via slash command (`/bench`) and the slash menu.

### 3.2 Internal Pane Layout

Inside a Bench modal, content is divided into **panes** using simple vertical/horizontal flex boxes with `t.border` rules (1-character lines or empty split chars). Avoid nested boxes with heavy borders.

Common pane patterns:

- **List + Preview**: A scrollable list on the left (40–50% width) and a detail/preview pane on the right.
- **Table + Footer**: A full-width table with a one-line status footer.
- **Split Comparison**: Two or three equal columns for run comparison, separated by a single vertical rule.
- **Stacked Sections**: For run detail, sections stack vertically with compact headers.

### 3.3 Tables

Tables are the primary data structure. Use these conventions:

- Header row: `t.textSecondary` or `t.textMuted`, no background, underlined with `t.border` if space permits.
- Row height: 1–2 lines. Most rows are single-line; expanded rows may show a second metadata line.
- Selected row: `t.selectedBg` background with `t.selected` foreground.
- Current/highlighted row: same as selected, or `t.brandSoft` if it denotes the user's current baseline.
- Column alignment: numbers right-aligned, text left-aligned, status glyphs centered.
- Truncation: use `…` at column boundary; never wrap mid-word inside a cell.

## 4. Leaderboard

### 4.1 Primary/Secondary Column Split

The leaderboard table uses a **primary column group** and a **secondary column group**.

**Primary columns (left, fixed order):**

| Column | Width | Notes |
| --- | --- | --- |
| Rank | 4–5 chars | `#1`, `#2`, etc. |
| Agent / model | 24–30 chars | Shelra identity plus the controlled model, truncated |
| Version | 8–10 chars | Version tag or commit short hash |
| Overall | 6–8 chars | Bold, color-coded score |

**Secondary columns (right, scrollable if terminal is narrow):**

| Column | Width | Notes |
| --- | --- | --- |
| Coding | 6 chars | Dimension score |
| Agentic | 6 chars | Dimension score |
| Intent | 6 chars | Dimension score |
| Verify | 6 chars | Dimension score |
| Research | 6 chars | Dimension score |
| Memory | 6 chars | Dimension score |
| Efficiency | 6 chars | Dimension score |
| Runs | 5 chars | Count of runs aggregated |
| Trend | 7–9 chars | Sparkline or delta glyph |

On narrow terminals, secondary columns collapse behind a horizontal scroll or a detail pane. The primary columns remain visible so the user never loses context.

### 4.2 Row States

- **Baseline row**: the currently selected agent/version; marked with `*` or `▸` and `t.brandSoft` background.
- **Top rank**: rank `#1` uses `t.warning` (gold accent) to avoid overusing brand green.
- **Selected row for action**: `t.selectedBg` / `t.selected`.
- **Hovered/focused row**: same as selected in keyboard-driven UI.

The default query is `agent_name = Shelra`. A model filter is available for
within-agent analysis; it is not a replacement for the harness leaderboard.

### 4.3 Sorting

Default sort: **Overall desc**. Cycling sort with `s` cycles through Overall, Coding, Agentic, Intent, Verify, Research, Memory, Efficiency, and Date. The active sort column is indicated with `▲`/`▼` next to the header.

## 5. Color Semantics

All colors are drawn from `src/ui/theme.ts`. No new palette tokens are introduced.

### 5.1 Scores

| Score range | Color token | Usage |
| --- | --- | --- |
| 90–100 | `t.success` | Excellent; strong pass |
| 70–89 | `t.brand` / `t.accent` | Good; on track |
| 50–69 | `t.warning` | Needs attention |
| 0–49 | `t.danger` | Poor; failed |
| Missing / N/A | `t.textDim` | `--` or `n/a` |

Score text is rendered in the token color. Backgrounds are **not** colored except for the selected/baseline row background.

### 5.2 Regressions & Improvements

| Meaning | Glyph | Color token | Example |
| --- | --- | --- | --- |
| Improvement vs baseline | `▲` | `t.success` | `▲ +4.2` |
| Regression vs baseline | `▼` | `t.danger` | `▼ -2.1` |
| No change | `=` | `t.textDim` | `= 0.0` |
| New / first run | `·` | `t.textMuted` | `· new` |

In comparison views, deltas are shown per dimension and overall. Keep deltas to one decimal place.

### 5.3 Status

| Status | Glyph | Color token | Usage |
| --- | --- | --- | --- |
| Queued | `◌` | `t.textDim` | Waiting to start |
| Running | `◐` / spinner | `t.subagentAccent` | Live run in progress |
| Passed | `✓` | `t.success` | All acceptance criteria met |
| Failed | `×` | `t.danger` | One or more criteria failed |
| Partial | `◐` | `t.warning` | Some criteria passed |
| Cancelled | `⊘` | `t.textMuted` | User or system abort |
| Error | `!` | `t.danger` | Infrastructure/error |

Use the existing `Spinner` component for running states; respect `reducedMotion` by falling back to a static `●`.

### 5.4 Aurora Accent Usage

The Aurora gradient (`t.aurora.green` → `t.aurora.cyan` → `t.aurora.violet`) is used **sparingly**:

- **Live progress bar**: a thin horizontal bar that animates through the gradient while a run is active.
- **Top-ranked highlight**: only when the terminal is wide enough, a subtle 1-cell gradient underline under the `#1` row.
- **Sparkline trend**: optional gradient stroke for the current-baseline sparkline in the leaderboard.

Static tables, headers, borders, and text bodies use solid theme roles. Never fill a table row with an Aurora gradient background.

## 6. Dark/Light Parity

The feature uses the existing `resolveTheme()` helper. Both themes must be visually equivalent in meaning:

- **Dark** (`#090B0A` background): scores pop against dark surfaces; `t.success` is `#3ABF81`, `t.danger` is `#F07178`.
- **Light** (`#F7F9F8` background): same semantic mapping; `t.success` becomes `#167C5B`, `t.danger` becomes `#C1333D`.

Requirements:

1. All score/status colors must be readable against `t.backgroundPanel` in both themes (contrast ratio ≥ 4.5:1).
2. Selected row background (`t.selectedBg`) must remain distinguishable from panel background in both themes.
3. `t.textDim` and `t.textMuted` must not be used as the sole indicator of state; pair with a glyph or number.
4. Aurora colors shift with the theme (`#28E59A`→`#087D4C` green, `#00CFE8`→`#087E8F` cyan, `#7967FF`→`#5E4EDB` violet) but the usage rules stay the same.

## 7. Screens & Information Architecture

### 7.1 Bench Home / Leaderboard

Entry modal after `/bench`. Shows the leaderboard with primary/secondary columns, sort controls, and a footer with key hints.

Footer hints:

```
↑↓ navigate  enter detail  c compare  b baseline  s metric  / filter  r refresh  esc close
```

### 7.2 Run History

A scrollable table of all immutable runs. Columns:

- Run ID (short hash)
- Agent / Model
- Version / Commit
- Started
- Duration
- Cost
- Tokens
- Overall
- Status

Filter by typing `/` then a query string that matches agent, model, version, commit, or run ID.

### 7.3 Historical Chart / Trend

A modal pane showing a sparkline or ASCII line chart for one selected metric over time.

- X-axis: time (run date).
- Y-axis: score 0–100.
- One selected metric is shown at a time; its label and numeric point list remain visible:
  - Overall: `━` solid, `t.brand`
  - Coding: `─` light, `t.success`
  - Agentic: `┄` dotted, `t.info`
  - Intent: `┈` sparser, `t.warning`
  - Verify: `╌` double dash, `t.subagentAccent`
  - Research: `┉` dense, `t.textSecondary`
  - Memory: `╍` double dense, `t.modePlan`
  - Efficiency: `┅` medium, `t.accent`
- The point list includes run number, benchmark version, model, commit, and value.
- On narrow terminals, the selected metric remains readable instead of becoming an unreadable multi-line chart.

### 7.4 Run Comparison

A split-pane modal for comparing 2–4 runs side by side.

- Each column is a run card: agent, model, version, commit, status, cost, tokens, time.
- Below: a dimension table with one row per dimension and one column per run, plus a delta column against the first selected run.
- Acceptance criteria summary per run: passed / failed / partial counts.

### 7.5 Run Detail

A full-modal view for one run, organized in stacked sections:

1. **Header**: run ID, agent, model, version, commit, status, timestamp.
2. **Summary bar**: cost, tokens, duration, overall score.
3. **Dimension scores**: a compact table or bar chart.
4. **Task results**: expandable list of tasks with status and per-dimension contribution.
5. **Acceptance criteria**: per-task criteria with pass/fail/partial and any notes.
6. **Raw metadata**: collapsible JSON-ish summary (kept collapsed by default), with benchmark/model/commit/environment provenance.

### 7.6 Task Explorer

A two-pane modal:

- Left: filterable list of tasks (name, category, average score across runs).
- Right: selected task details — description, dimensions measured, historical best/worst, and a list of run results.

### 7.7 Live Run Progress

A modal that opens when a benchmark is running. It is non-blocking to the rest of the app but provides a dedicated view.

- Header: run ID, agent/model, start time, elapsed.
- Progress bar: thin Aurora-gradient bar showing completed/total tasks.
- Current task: task name + spinner + elapsed.
- Live log: tail of task events (tool calls, verification steps, errors) using the same grammar as `RuntimeActivityTree`.
- Footer: `esc` backgrounds the modal without cancelling the run; `ctrl+c` cancels.

## 8. Component Inventory

All components are new and live alongside existing modal components in `src/ui/`. They do not modify the chat workspace.

| Component | Location | Fits existing modal system? | Purpose |
| --- | --- | --- | --- |
| `BenchModal` | `src/ui/bench-modal.tsx` | Yes — full-screen modal with overlay | Root entry; switches sub-views |
| `BenchLeaderboard` | `src/ui/bench-modal.tsx` or `src/ui/bench/` | Yes — rendered inside `BenchModal` | Leaderboard table |
| `BenchRunHistory` | `src/ui/bench-modal.tsx` or `src/ui/bench/` | Yes — rendered inside `BenchModal` | Historical run list |
| `BenchTrendChart` | `src/ui/bench-modal.tsx` or `src/ui/bench/` | Yes — rendered inside `BenchModal` | ASCII/sparkline trend |
| `BenchRunComparison` | `src/ui/bench-modal.tsx` or `src/ui/bench/` | Yes — rendered inside `BenchModal` | Side-by-side run comparison |
| `BenchRunDetail` | `src/ui/bench-modal.tsx` or `src/ui/bench/` | Yes — rendered inside `BenchModal` | Single-run deep dive |
| `BenchTaskExplorer` | `src/ui/bench-modal.tsx` or `src/ui/bench/` | Yes — rendered inside `BenchModal` | Task-centric drill-down |
| `BenchLiveProgress` | `src/ui/bench-modal.tsx` or `src/ui/bench/` | Yes — rendered inside `BenchModal` | In-flight monitoring |
| `BenchScoreCell` | `src/ui/bench/` | Yes — table cell helper | Renders a score with color |
| `BenchDeltaCell` | `src/ui/bench/` | Yes — table cell helper | Renders ▲/▼/= delta |
| `BenchStatusBadge` | `src/ui/bench/` | Yes — inline helper | Renders status glyph + label |
| `BenchSparkline` | `src/ui/bench/` | Yes — chart helper | ASCII sparkline for trends |
| `BenchProgressBar` | `src/ui/bench/` | Yes — progress helper | Aurora-gradient progress bar |
| `BenchRunRow` | `src/ui/bench/` | Yes — row helper | Reusable run summary row |
| `BenchDimensionRow` | `src/ui/bench/` | Yes — row helper | Reusable dimension score row |

### Implemented integration points in src/ui/app.tsx

1. `showBenchModal` and `benchView` state are owned by the app.
2. `/bench`, `/benchmark`, and `/benchmarks` open the modal through the command
   path and the slash menu exposes the `bench` entry.
3. The render tree mounts `BenchModal` alongside the existing inspector and
   passes persisted leaderboard, history, details, comparison, baseline, and
   live snapshot data.
4. `handleKey` implements modal navigation, filtering, selection, comparison,
   baseline selection, trend metric changes, refresh, and close behavior.
5. The app polls the persisted run snapshot while the modal is open and
   recovers abandoned active runs before reading history.

## 9. Keyboard Navigation Patterns

Reuse the existing keyboard grammar from `src/ui/app.tsx`.

### Global within Bench modal

| Key | Action |
| --- | --- |
| `esc` | Close Bench modal (or go back one level) |
| `tab` | Cycle primary views: Leaderboard → History → Trend → Comparison → Tasks → Live |
| `1`–`6` | Jump directly to views 1–6 |
| `/` | Focus filter/search field |
| `?` | Show help overlay with key bindings |

### Leaderboard / History tables

| Key | Action |
| --- | --- |
| `↑` / `↓` or `k` / `j` | Move selection |
| `enter` | Open detail for selected run/row |
| `c` | Add/remove selected run from comparison set |
| `s` | Cycle sort column |
| `r` | Refresh the persisted benchmark snapshot |
| `backspace` | Clear filter when filtering |

### Comparison view

| Key | Action |
| --- | --- |
| `←` / `→` or `h` / `l` | Move focus between run columns |
| `d` | Change baseline/delta reference column |
| `esc` | Return to leaderboard |

### Detail / Task Explorer

| Key | Action |
| --- | --- |
| `↑` / `↓` | Navigate sections/tasks |
| `e` | Expand/collapse selected task or criteria block |
| `esc` | Return to previous list |

### Live Run Progress

| Key | Action |
| --- | --- |
| `esc` | Background the live modal (run continues) |
| `ctrl+c` | Cancel the run |
| `t` | Toggle tail log follow |

All list navigation clamps to bounds and scrolls the selected item into view using `scrollChildIntoView`, matching `ModelPickerModal` and `McpBrowserModal`.

## 10. Data-Density Guidance

- **Target row density**: 1 line for leaderboard/history rows; 2 lines only when showing a subtitle (model name under agent name).
- **Padding**: use `paddingLeft={2}` / `paddingRight={2}` for modal content; `paddingTop={1}` / `paddingBottom={1}` between sections. Avoid double blank lines.
- **Borders**: use `border={["top"]}` or `border={["left"]}` for section separators, not full boxes. Reuse the `SPLIT` border chars pattern from `app.tsx`.
- **Glyphs over labels**: prefer `✓`/`×`/`◐` over the words "passed"/"failed"/"partial" in dense tables.
- **Numbers**: right-align, fixed-width formatting. Scores show one decimal (`87.3`). Costs show `$0.0042`. Tokens use `formatTokenCount` (`1.2K`, `3M`). Time uses `formatActivityElapsed` (`1:23`, `45s`).
- **Truncation**: hard truncate at column width with `…`. Never wrap a cell onto a third line.
- **Empty states**: one line in `t.textMuted`, e.g. `No runs yet. Press r to start a benchmark.`

## 11. Accessibility Notes

### 11.1 Color Independence

- Every state communicated with color is also communicated with a glyph or number:
  - Scores always show the numeric value, not just color.
  - Status always shows a glyph (`✓`/`×`/`◐`) plus a short label.
  - Trends always show `▲`/`▼`/`=` plus the numeric delta.
- Do not use color alone for row selection; selected rows have `t.selectedBg` background and, where supported, an `▸` indicator.
- Chart lines use distinct **patterns** (solid, dotted, dashed) in addition to color; the legend repeats both.

### 11.2 Keyboard

- All Bench surfaces are fully operable without a pointer.
- Focus is always visible via `t.selectedBg` / `t.selected`.
- Lists scroll selected items into view automatically.
- Modal traps focus; `esc` returns focus to the chat composer when closed.
- Provide a `?` help overlay listing all bindings.

### 11.3 Reduced Motion

- Respect the existing `reducedMotion` flag from `theme.ts`.
- Replace the live progress bar animation with a static filled bar when reduced motion is enabled.
- Replace `Spinner` with a static `●` in running states.
- Disable any score/count-up animations; render final values immediately.
- Aurora gradient accents remain static (no shimmer/scroll animation).

### 11.4 Screen Reader / Terminal Assistive Tech

- Keep text labels plain and positional: `Rank 1, Agent general, Overall 94.2` rather than relying on visual layout alone.
- Use concise, structured rows so that terminal screen readers can read line-by-line meaningfully.
- Avoid ASCII art or decorative borders that would be read as noise.

## 12. Entry Points

- Slash command: `/bench` opens the Shelra-first leaderboard.
- Slash menu: add a `bench` item under tools/status.
- Optional future hook: a status line in the workspace sidebar could show the last benchmark overall score when a run completes.

## 13. Implementation boundaries and extension points

These are not blockers for the design but should be resolved during implementation:

1. **Data source — resolved**: Reuse the existing SQLite database for the indexed history; keep bulky evidence in the existing objective journal/artifact paths.
2. **Live streaming — MVP**: Poll the persisted active run; a dedicated observer/broker can replace polling when in-app execution is added.
3. **Benchmark runner — resolved**: Keep the runner and executor contract in `src/bench/`; adapters can be added without changing storage or UI.
4. **Multi-select comparison — resolved**: Support up to four runs and withhold deltas when benchmark scope is incompatible.

## 14. References

- `src/ui/theme.ts` — color tokens and theme contract.
- `src/ui/app.tsx` — modal system, keyboard handling, and existing UI patterns.
- `src/ui/session-inspector.tsx` — example of a tabbed, keyboard-navigable inspector surface.
