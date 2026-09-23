# Audit: the Shelra TUI against the Achilles visual line

Date: 2026-09-22. Deliverable 1 of the brief *Shelra CLI — adopt the Achilles visual line*. The approved
reference is the landing page in `frontend/` (tokens in `frontend/src/app/globals.css`, motifs in
`frontend/src/components/**`). This page describes every screen and state of the terminal app as it is
today and lists every deviation from the brief's tokens, glyphs, typography roles and motifs. Nothing
here changes the product; the fixes are deliverables 2 to 5.

## Method

- **Real app, scripted model.** Every capture is the production `<App>` on a real `Agent` with real
  tools (files, grep, `bun test`) against a throw-away fixture; only the model is scripted
  (`scripts/ui-demo`). Paths show as `~/projects/acme-api` because the fixture lives under a scratch
  home folder.
- **Real terminal protocol.** The app runs in a ConPTY and draws into xterm.js (truecolor, Geist Mono
  14px), which is captured as PNG and as text. For every cell the capture also records the character,
  its foreground and background colour, and bold/inverse.
- **Automated checks.** A script compares every cell colour with the brief's palette and every
  non-ASCII character with its glyph set. The numbers below come from it; `inventory.json` holds the
  per-screen results.
- **Three passes.** Pass 1 captured everything once. Pass 2 fixed two races in the capture script: a
  command typed and submitted within ~40 ms picked a stale match, and the sandbox picker swallowed
  keys. Pass 3 re-captured after the one real bug the audit found was fixed (below). The captures here
  are pass 3.
- **Limit.** xterm.js is not Windows Terminal or Warp. Colours and cell layout are exact; glyph shapes
  depend on the font. The component pass (deliverable 3) is captured again in both terminals.

Captures: [`80x24/`](80x24) and [`120x40/`](120x40), 39 states each, `NN-name.png` plus `NN-name.txt`.

## Found and fixed during the audit

**Plan questions never opened** (fixed in `65a89da`). OpenTUI's React reconciler updates `onSubmit`
only on `<input>`; a `<textarea>` keeps the handler it was created with. The composer's submit
handler, and everything it closes over, was frozen at the first render: after switching to plan mode
the app still read mode `agent`, so the questions panel (state 29) never appeared. `TextArea`
(`src/ui/components/text-area.tsx`) now gives every textarea a stable handler that calls the latest
one. Its test pins the library behaviour, so it will say when the wrapper is no longer needed.

## After the passes (2026-09-23)

The same 39 states, captured again the same way after the theme module, the component passes and the
code-review fixes (at `8d80830`): [`after/80x24/`](after/80x24) and [`after/120x40/`](after/120x40), with
the per-screen results in [`after/inventory.json`](after/inventory.json). The rest of this page describes
the screens before the passes.

- **Colours:** none outside the palette on any of the 78 captures (27 on the dark screens before, 39 with
  the light theme, which is gone).
- **Glyphs:** only `▀` and `▄`, the ends of OpenTUI's scrollbar thumb, the one documented exception: 20
  cells in all (32 characters outside the set before, rounded corners on 76 of 78 captures).
- **Not covered:** no state sends a message in Plan mode, so a magenta prompt there went unseen until the
  code review (`src/ui/app.test.tsx` now renders it). These are xterm.js captures; the brief's captures
  in Windows Terminal and Warp are not done yet.

## Screens and states

| # | State | Reached by | Deviations |
| --- | --- | --- | --- |
| 01 | Home: logo, `[ PROJECT ]`, `[ KNOWS ]`, composer | start | G2 (≥100 cols), G1, M1, M11, M12, M16, P2, P7 |
| 02 | Command list | `/` | P1, P5/D2, M3 |
| 03 | Keyboard and commands | `?` | P1, M3, M4 |
| 04 | Model picker | `/models` | P1, P5/D2, M3, G9 |
| 05 | Reasoning effort | `/effort` | P1, P5/D2, M3 |
| 06 | Theme | `/theme` | P1, P5/D2, M3, P11 |
| 07 | Sandbox | `/sandbox` | P1, P5/D2, M3, M9 |
| 08 | Session recaps | `/recaps` | P1, M9 |
| 09 | Wallet and payments (the only settings list) | `/wallet` | P1, P5/D2, M3, M9, M18 |
| 10 | What Shelra knows: memory | `/memory` | P1, P5/D2, P8, G8, M3 |
| 11 | What Shelra knows: skills | `/skills` | P1, G8, G11, M3 |
| 12 | Sub-agents | `/agents` | P1, G1, M3 |
| 13 | MCP servers | `/mcp` | P1, G1, G11, M3 |
| 14 | Schedules | `/schedule` | P1, G1, M3 |
| 15 | Remote control (Telegram) | `/remote-control` | P1, G8, M3 |
| 16 | "Nothing yet" notice | `/plan` before a plan exists | M19 |
| 17 | Composer with a typed request | typing | M11, M12, M16 |
| 18 | Run: thinking, loading a skill | right after Enter | G3, G4, T1, T2, M15, M21 |
| 19 | Run: tool lines and the live plan | a few seconds in | G3, G4, M14, M15, M17, M21, P7 |
| 20 | Run done: code, answer, turn summary, memory line | end of turn | P9, M14, M16, P10 (diffstat) |
| 21 | Details mode | `ctrl+o` | M20, G6 |
| 22 | Plan view | `alt+2` | M1, M17 |
| 23 | Changes view | `alt+3` | M1, P10 |
| 24 | Checks view | `alt+4` | M1, G5 |
| 25 | Context view | `alt+5` | M1, M6 |
| 26 | Session inspector | `/status` | P1, D1, G7, M3, M8, M18, L2 |
| 27 | Errors: failed edit, failing test, rate-limit retry | errors scenario | G5, M19, P6 |
| 28 | Markdown answer: headings, lists, quote, rule, table, code | rich scenario | G1, G10, P9 |
| 29 | Plan questions | plan mode | G1, G8, P5/D2, P8, M12 |
| 30 | Sub-agent running, with the agents strip | subagent scenario | P7, G11, G3 |
| 31 | Sub-agent done | subagent scenario | M14 |
| 32 | Payment approval | payment scenario | G1, G8, P6, P7, P8 |
| 33 | API key prompt (first run without a key) | no provider | P1, M3, M10 |
| 34 | Startup: cloud booting, cloud error, local onboarding, local download | `scripts/ui-demo/startup.tsx` | G1, M5, M6, M7, M8, M10 |
| 35 | Light theme: home | `appearance: light` | P11 |
| 36 | Light theme: finished turn | `appearance: light` | P11 |

Reviewed in code only, not reproducible in the demo: Telegram bridge entries in the log (source label
`Telegram ShelraCode • user 123`, G7), the update dialog, and the Telegram token and pairing dialogs.

## Already in line with the brief

- The page is `#080808`, surfaces are `#111111`, text is `#F0F0F0` and `#888888`, the accent is
  `#00FF88`. No cell anywhere uses the terminal's own theme colours.
- No gradients, shadows or emoji (removed on 2026-09-19).
- Bracket badges, `·` separators and the `✓ ● · ▸` glyphs are already the vocabulary.
- The 80-column logo uses only `█` and `░`.
- Most strings are English sentence case.

## Deviations

### Palette

27 colours outside the palette appear on the dark screens (39 with the light theme). The brief allows
exactly the palette plus two status colours, used for text and glyphs only.

| ID | Today | Where | Cells | Brief |
| --- | --- | --- | --- | --- |
| P1 | Modal backdrop `#000000CC` blended over the screen: `#010101` `#050505` `#060606` `#2C2C2C` `#191919` `#002E19` `#11212E` and more | every modal (`t.overlay`: `app.tsx:5315`, `5985`, `6065`, `agents-modal.tsx:68`, `176`) | about 88,000 on 32 screens | Terminals have no alpha; depth only from surface colour and hairlines. |
| P2 | Borders `#222222`, `#444444`; focus border `#00FF88` | `theme.ts` `border`, `borderStrong`, `borderActive`, `composerFocusBorder` | 6,300 on 33 screens | Hairlines `#1A1A1A`; a focused panel's border is accent-40 `#056B3B`. |
| P3 | Extra greys `#B8B8B8`, `#5E5E5E`, `#6B6B6B` | `textSecondary`, `textDim`, `disabled` | 3,150 on 50 screens | Text is default `#F0F0F0` or subtle `#888888`; disabled is subtle. |
| P4 | Surfaces `#1A1A1A` (composer fill, inputs), `#141414` (code, diff context), `#0C0C0C` | `surfaceRaised`, `backgroundElement`, `mdCodeBlockBg`, `surfaceMuted` | 2,100 on 6 screens, plus the composer | Surface `#111111`; white-8 `#1C1C1C` for hover; `#1A1A1A` is the border colour. |
| P5 | Selected row `#07301C` | `selectedBg`, `brandSoft` | 2,600 on 24 screens | accent-16 is `#073020`, and the brief also says selection is accent + on-light: decision D2. |
| P6 | Error `#FF5C6C`, warning `#FFB84D`; `#00CF6E` used as "success" | `danger`, `warning`, `success` | 1,070 on 14 screens | Error `#FF5C5C`, warning `#FFB454`; success is the accent; `#00CF6E` is only the pressed state. |
| P7 | Blues `#5CB8FF`, `#8AC7FF`, `#A6D8FF` | `info` (mode label "Agent", the `>` before your message, links, plan file paths, security score), `subagentAccent`, `mdLinkText` | 520 on 32 screens | No blue in the palette. |
| P8 | Amber for the Plan mode label and the details notice | `modePlan` | part of P6 | Warning is for warnings only. |
| P9 | Markdown: bold `#FFFFFF`, inline code `#8CFFC4`, code text `#E0E0E0`, syntax colours (keywords blue, types amber) | `mdBold`, `mdCode`, `mdCodeBlockFg`, code highlighter | 1,050 on 10 screens | Palette only: decision D5. |
| P10 | Diff backgrounds `#0B2E1D` and `#33161B`, text `#8CFFC4` / `#FF9AA4`, line numbers `#00A85A` / `#B04A57`; diffstat `-2` in red | diff tokens, turn summary | on the changes view and summaries | No tinted surfaces; a status colour is never a surface. The site writes `+87` in accent and `−23` in subtle. |
| P11 | A whole light palette (`#F0F0F0` page, `#007A40` brand, `#0B62C4` info …) | `theme.ts` `light` | 2 screens | The approved site is dark only: decision D4. |

### Glyphs

32 characters outside the allowed set `─ │ ┌ ┐ └ ┘ ├ ┤ ● ○ ▸ ▪ ✓ ✗ › · → █ ░`.

| ID | Today | Where | Brief |
| --- | --- | --- | --- |
| G1 | Rounded corners `╭ ╮ ╰ ╯` | 14 places: composer, modal cards, plan questions, payment dialog, startup panels, markdown tables (76 of 78 captures) | `┌ ┐ └ ┘`, no rounded corners |
| G2 | Double lines `═ ║ ╔ ╗ ╚ ╝` (about 3,400 cells) | the wide logo, at 100 columns and more | decision D3 |
| G3 | Braille spinner `⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏` | `transcript.tsx:66` | a 4-frame spinner in accent, from the allowed set |
| G4 | `■■⬝` busy mark in the composer | `app.tsx:5265` | the accent spinner, or `●` |
| G5 | `×` for failed | `GLYPH.failed`, `transcript.tsx:27` | `✗` |
| G6 | `▾` for expanded | `GLYPH.expanded` | only `▸` exists; an open fold needs another allowed mark |
| G7 | `•` bullets | session inspector, Telegram source label (`telegram-turn-ui.ts`) | `·` |
| G8 | Arrows `↑ ↓ ← ↔ ⇆` in key hints | memory, remote control, payment, plan questions | words (`up/down`), or `→` |
| G9 | Half blocks `▀ ▄` | scrollbar thumb ends | `█` on a `│` track |
| G10 | Table junctions `┬ ┼ ┴` | markdown tables | `├ ┤` only, or no vertical rules |
| G11 | `◆` (skills), `□ ■` (MCP on/off), `↳` (sub-agent line) | knowledge, MCP, live turn | `▪`, `●`/`○`, `›` |

Text punctuation (`…`, `—`, `–`, in prose and truncation) is typography, not a UI glyph; the site
itself writes `Planning...` and `−23`.

### Motifs and typography

| ID | Today | Brief |
| --- | --- | --- |
| M1 | `[ LABEL ]` badges draw the brackets in dim grey and the label bold, hand-built in six places (`app.tsx:281`, `295`, `5460`, `plan.tsx:140`, `session-inspector.tsx:603`, `transcript.tsx:261`) | one badge: brackets and label in accent, uppercase, one space inside, like the site's `SectionBadge` |
| M2 | `[ SHELRA ]` before every answer is entirely grey | badges are accent |
| M3 | Modal title rows: a bold title left, `esc` right (`Commands`, `Select model`, `Wallet & Payments` …) | title row = badge left, metadata right |
| M4 | Help section headings (`Compose`, `While Shelra works`, `Review`) in bold grey | badges |
| M5 | Startup labels `STARTUP CHECKLIST`, `CLOUD FIRST`, `PRIVATE BY DEFAULT` in grey caps | badges and metadata lines |
| M6 | Progress: `############--------` (startup download), `░░░░` with no fill (context) | `████████░░` accent on border, with `step 4 of 6 · 80%` |
| M7 | Checklist marks `[ok]` `[..]` `[  ]` | `✓` done, `●` running, `○` queued |
| M8 | `|` separators (startup lines, inspector title and footer) | ` · ` |
| M9 | Toggles `< disabled >`, `< off >` | `○──` / `──●` in accent |
| M10 | `[ esc ] Exit` as a white rounded outline; primary actions drawn like secondary ones | primary: accent fill, on-light bold; secondary: accent text in a hairline; disabled: subtle |
| M11 | Composer: an accent frame around a `#1A1A1A` fill (a card inside a card) | one hairline panel, 1-cell padding, focus in accent-40 |
| M12 | Mode label colours: `Agent` blue, `Plan` amber, `Ask` green | one palette-only mode label |
| M13 | Your message starts with a blue `>` | the prompt-line motif (`$ shelra run`), in palette colours |
| M14 | Tool lines: bold verb in a status colour, the path in secondary grey | tool line in default, path in accent |
| M15 | Live line: spinner and bold verb; the thought is one italic sentence under it | `> Planning…` thinking line in subtle |
| M16 | `Qwen3 Coder  99% context left` | `model · cost · tokens · elapsed`, joined by ` · ` |
| M17 | Plan steps marked `●` and `·`; no numbered chips anywhere | `01` `02` `03` on an accent chip; `○` for queued steps |
| M18 | `Wallet & Payments`, `Session control surface`, `State: Blocked \| Completion blocked` | sentence case, plain words |
| M19 | Notices as plain bracketed text: `[Model connection interrupted (…); retrying in 2s.]`, `[Not verified — …]`, `[Paused — …]` | a status line: glyph, status colour, metadata |
| M20 | The details on/off notice in amber in the hint row | warning is for warnings |
| M21 | `esc` drawn in red in `esc stop` while running | status colours only for status |

### Layout

| ID | Finding |
| --- | --- |
| L1 | At 80×24 the home logo takes 8 of 24 rows; in a session, header, composer and path take 8, leaving about 12 rows of log. |
| L2 | At 120×40 the inspector's label column is too narrow: `Runtime objectiveFix the failing…`. |
| L3 | Notices truncate at 80 columns: `Details on: every step with its evide…`. |

### Motion

| ID | Finding |
| --- | --- |
| T1 | The spinner is 10 braille frames every 90 ms (G3). |
| T2 | **The thinking line cannot be read with a fast model** (reported by the user on 2026-09-22). It shows only the latest reasoning sentence (`reasoningPreview`, `activity.ts:303`) and is recomputed on every reasoning delta (`app.tsx:4536`), so it changes several times a second; when the answer starts it disappears. |
| T3 | **The streaming answer has no pace.** Deltas are painted as they arrive, so a fast model paints whole paragraphs in one frame. |
| T4 | The composer's busy mark `■■⬝` is static text. |
| T5 | No progress-bar fill animation; the cursor is the terminal's. |

## Other findings

- **N1** Command-list race: typing `/recaps` and Enter within about 40 ms picked the stale `/review`
  match and sent its 18-line prompt. People rarely type that fast; a pasted command would.
- **N2** The demo's payment scenario runs the product's real URL safety check, which sends the
  (fictional) host name to the Brin API.

## Decisions before the theme module

| ID | Question | Default if not decided |
| --- | --- | --- |
| D1 | The brief asks for a one-row tab bar; on 2026-09-19 the persistent tab row was removed and views open on demand (`alt+2..5`, `/plan` `/diff` `/checks` `/context`). | none: needs an answer |
| D2 | Selected rows: accent-16 fill (tokens table) or accent fill with on-light text (motif "Selection = accent background + on-light text … for selected rows and the active tab"). | none: needs an answer |
| D3 | The wide logo's shadow uses `═ ║ ╔ ╗ ╚ ╝`, outside the glyph set; the 80-column logo already uses only `█ ░`. | none: needs an answer |
| D4 | The light theme has no counterpart on the approved site. | none: needs an answer |
| D5 | Code and diffs from the palette only. | keywords accent, strings default, comments subtle; diff `+` lines accent, `−` lines error text, context subtle, no tinted backgrounds; diffstat `+87` accent, `−23` subtle, as on the site |
| D6 | One commit per deliverable. | commits on `main`, pushed when each deliverable is done |

## Reproduce

```text
# the demo (real app, scripted model); scenarios: fix-auth, errors, markdown, rich, plan-questions, subagent, payment
SHELRA_DEMO_SCENARIO=fix-auth bun run scripts/ui-demo/main.tsx
SHELRA_DEMO_NO_KEY=1 bun run scripts/ui-demo/main.tsx          # first run without an API key
SHELRA_DEMO_STARTUP=local-downloading bun run scripts/ui-demo/startup.tsx
```

Point `USERPROFILE`/`HOME` at a scratch folder so settings and memory stay out of your profile.
