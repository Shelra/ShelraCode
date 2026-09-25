# Shelra terminal design system

The approved reference is the landing page in `frontend/` (tokens in `frontend/src/app/globals.css`,
motifs in `frontend/src/components/**`). The tokens live in `src/ui/theme.ts`; this page is the
translation to terminal cells. The audit that led to it is `docs/ui/audit/2026-09-22-achilles`.
`src/ui/acceptance.test.ts` reads the source of `src/ui` and fails a change that breaks the colour, blend,
glyph, border or bordered-fill rules; a colour chosen at run time needs a render test (`app.test.tsx`).

## Rules

1. **Flat colour only.** No gradients, shadows, glows or alpha. A terminal cannot blend, so a dialog's
   backdrop is opaque base, never a dim over the screen.
2. **The palette and nothing else.** Every role in `theme.ts` is one palette token; components never use
   a raw hex. Warning and error colour text and glyphs, never a surface, with one exception the owner asked
   for (2026-09-24): a diff's removed line sits on error-26, as its added line sits on accent-18.
3. **Hairlines or fills, never both.** A terminal paints a bordered box's fill under its border too, which
   draws a half-cell band outside the line. A bordered panel (composer, dialog, startup) has no fill; a
   filled card (code block, the startup computer card) has no border. Corners are square.
4. **Badges open panels.** `[ LABEL ]`: uppercase, accent, one space inside the brackets, not bold, from
   `components/badge.tsx`. Metadata follows in subtle.
5. **Nothing until it is used.** The log is the only permanent surface. A plan, a load, a turn summary
   appear when they exist; the views open on demand and only then show their tab row.
6. **One dark theme.** The site is dark only, so Shelra is: a light terminal still gets `#080808`.

## Palette

| Token | Hex | xterm-256 | Use |
| --- | --- | --- | --- |
| base | `#080808` | 232 | app background, dialog backdrop, text on accent |
| surface | `#111111` | 233 | filled cards |
| border | `#1A1A1A` | 234 | hairlines, dividers, empty part of a bar |
| default | `#F0F0F0` | 255 | primary text |
| subtle | `#888888` | 102 | secondary text, metadata, placeholders |
| accent | `#00FF88` | 48 | labels, active tab, links, paths, success, running |
| hover | `#00CF6E` | 41 | pressed accent |
| accent-16 | `#073020` | 234 | the cursor row in lists |
| accent-40 | `#056B3B` | 22 | the focused panel's border |
| white-8 | `#1C1C1C` | 234 | hover on base |
| accent-18 | `#07341F` | 22 | the band behind an added line of a diff |
| error-26 | `#481E1E` | 52 | the band behind a removed line of a diff |
| warning | `#FFB454` | 215 | text and glyphs only |
| error | `#FF5C5C` | 203 | text and glyphs only |

`SHELRA_THEME=256` draws every token as its xterm-256 colour; Apple Terminal gets it by default.

## Type

A terminal cannot load fonts, so the site's roles become weight, case and colour:

| Site | Terminal |
| --- | --- |
| Heading 1 (Geist Mono 500) | bold default, one line: the session title |
| Heading 2, two-tone | bold first clause in default, the rest in subtle: `Describe the change. Shelra plans it…` |
| Section badge (JetBrains Mono 12) | `[ PLAN ]` in accent |
| Body (Inter 14, subtle) | subtle text |
| Body strong | bold default |
| Small mono metadata | subtle, joined by ` · `: `2 files +6 −1 · tests ✓ · 42s`. The site's `model · cost · tokens · elapsed` line is not built |

Recommended fonts: Geist Mono or JetBrains Mono, without ligatures.

## Glyphs

Only `─ │ ┌ ┐ └ ┘ ├ ┤ ● ○ ▸ ▪ ✓ ✗ › · → █ ░`, which render the same in Windows Terminal and Warp.
Prose may use `…`, `–` (a range), `—` and `−`. The one exception is the scrollbar: OpenTUI draws the ends of its thumb
with `▀` and `▄`.

| Meaning | Glyph |
| --- | --- |
| done | `✓` accent |
| running | `●` accent, or the spinner |
| failed | `✗` error |
| queued | `○` subtle |
| folded / open | `▸` / `▪` |
| quiet row | `·` |
| setting on / off | `──●` / `○──` in accent |
| progress | `████████░░` accent on border, then the percent (the local model download); the plan counts steps: `[ PLAN 2/5 ]` |
| numbered step | ` 01 ` on an accent chip, dark text |

## Motion

- The spinner is a dot bouncing in three cells, `▪··` `·▪·` `··▪` `·▪·`, in accent.
- Answers are revealed at a reading pace (120 characters a second) that speeds up only to stay a couple
  of seconds behind the model, and the reveal carries on from the stream into the log (`reveal.ts`).
- Each reasoning sentence on the thinking line stays at least 1.6 s.
- Reduced motion (`/theme`, or `SHELRA_REDUCED_MOTION=1`) stops the spinner and shows text at once.

## Components

- **Header**: `[ AGENT ]` badge and the session title in bold.
- **Composer**: one hairline panel docked at the bottom, its border accent-40 while focused; the mode
  label, the input, then model and context left and the keys that matter now right.
- **Your message**: a prompt line, `$ ` in accent and the text in default.
- **Tool lines**: status glyph, verb in default, the path in accent, metadata right.
- **File changes**: the call it was, `● Update(src/auth.ts)` (`Write` for a new file, `Delete`), the path
  in accent; then `└ Added 12 lines, removed 3 lines`, the counts in accent and error; then the diff: line
  number, `-` or `+`, the code highlighted like a code block. A removed line is on an error-26 band and an
  added one on an accent-18 band, each band the width of the log; its number and marker are in error or
  accent too, so it still reads without colour. A long line wraps inside its band and its marker repeats
  on every row. Removed lines carry the old file's numbers, added and context lines the new one's. The
  log shows 24 rows of an edit, 12 of a new file and 8 of a deleted one, then `… +N lines (ctrl+o to
  expand)`; `ctrl+o` shows all of it. `/diff` lists the changed files with their counts.
- **Plan**: a live checklist under the log while the agent works (at most five rows around the active
  step), numbered chips and status glyphs; it folds to `✓ Plan 4/4` when the turn ends. A step the model marked
  complete with no check Shelra saw pass since it started is `claimed`: `·` subtle and the word `claimed` in warning,
  counted apart (`[ PLAN 1/3 ] · 2 claimed`), and a plan that ends with claimed steps folds to
  `· Plan 1/3 checked · 2 claimed, not checked`, never to a tick.
- **Turn summary**: `─ 2 files +6 −1 · tests ✓ · 42s`, additions in accent, removals in subtle.
- **Views** (`/plan` `/diff` `/checks` `/context`, `alt+2…5`): a tab row `Log Plan Changes Checks Context`
  with the active tab in accent and dark text, a hairline under it, `esc back` on the right.
- **Dialogs**: an opaque backdrop, a hairline panel, a title row with the badge left and `esc` right; the
  cursor row in accent-16.
- **Buttons**: primary is an accent block with dark bold text; secondary is accent text in a hairline;
  disabled is subtle.
- **Tables** in answers: aligned columns, no rules.

## Loads

What Shelra loads is invisible until it matters, and at most one quiet line when it does:

| What | In the log | Detail |
| --- | --- | --- |
| Skill (its `SKILL.md` was read) | `· Loaded skill terminal-ui` | `/skills`, `/context` |
| Memories retrieval injected | `· Recalled 2 memories` | `/memory`, `/context` |
| Instruction files, agents, MCP | nothing | `/context` (LOADED section) |
| Hooks | nothing when they succeed; `✗ PreToolUse hook blocked: <why>` or `! Stop hook failed` | `/context` |

## Keys and commands

`/plan`, `/diff`, `/checks` and `/context` open a full-width view over the log; `alt+2…5` do the same
(`alt+1` and `esc` return to the log). A view with nothing to show does not open: one line says
`Nothing yet: …`. `ctrl+o` shows every step with its evidence, `?` lists the shortcuts. The catalog is
`src/ui/shortcuts.ts`; the help overlay and the composer hints read from it.
