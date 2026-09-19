# Shelra terminal design system

The tokens live in `src/ui/theme.ts`; this page is the reasoning behind them. Every colour, border and
label below was taken from the Shelra web identity and translated to terminal cells.

## Rules

1. **Flat colour only.** No gradients, glows, fades or alpha ramps anywhere in the product, the bench
   dashboard or the docs. A working state is a glyph and a flat colour, never an animation of colour.
2. **One accent.** `#00FF88` marks "you are here" and interaction: the active view, focus, section labels,
   selection. Success is the darker `#00CF6E`; it is always paired with `✓`, so the two greens never carry
   meaning alone.
3. **Hairlines, not fills.** Structure comes from `1px` borders (`#222222` on dark) and rounded corners
   (`borderStyle="rounded"`), the terminal equivalent of the web's 16px cards. Panels do not fill their
   corner cells.
4. **Bracket labels.** Section labels are `[ PLAN ]`, `[ KNOWS ]`, `[ SHELRA ]`: caps, dim brackets, accent
   text. This is the web's `[ FEATURES ]` motif, and it reads without colour.
5. **Nothing until it is used.** The conversation is the only permanent surface. There is no header of
   tabs and no sidebar: a plan, a load, a summary of what a turn did appear in the log when they exist,
   and the detail behind them opens on demand (see Loads and Layout). A thing with nothing to show
   never draws.

## Palette

| Role | Dark | Light | Web source |
| --- | --- | --- | --- |
| Page | `#080808` | `#F0F0F0` | body background |
| Surface | `#111111` | `#FFFFFF` | card background |
| Raised | `#1A1A1A` | `#E6E6E6` | second surface token |
| Border | `#222222` | `#D4D4D4` | `#FFFFFF14` hairline, blended |
| Text | `#F0F0F0` | `#080808` | primary text |
| Text, muted | `#888888` | `#5C5C5C` | secondary text |
| Accent | `#00FF88` | `#007A40` | brand green (light uses a readable green) |
| Accent, pressed | `#00CF6E` | `#006633` | darker green token |
| Warning / Plan mode | `#FFB84D` | `#8A5A00` | derived: the web has no warning colour |
| Danger | `#FF5C6C` | `#C42B3A` | derived |
| Info / links | `#5CB8FF` | `#0B62C4` | derived |

The web is dark only; the light theme keeps the same neutrals and swaps the neon for a green that passes
4.5:1 on white. Warning, danger and info are derived because the web palette has no status colours.

## Type

A terminal cannot load fonts, so hierarchy is carried by weight, case, dimness and glyphs:

| Web | Terminal |
| --- | --- |
| Geist Mono, 36-40px headings | bold, `text` colour |
| Inter, 14-16px body | regular, `text` / `textSecondary` |
| JetBrains Mono 12px caps labels | `[ LABEL ]` in accent |
| muted `#888888` captions | `textMuted`, `textDim` |

Recommended terminal font: **Geist Mono** or **JetBrains Mono** (the two the web uses). Avoid ligature fonts:
`->` and `!=` change width and shift columns.

## Vocabulary

`✓` done · `×` failed · `●` working · `·` quiet · `▸`/`▾` folded/open · `!` needs attention · `>` your message.

## Loads

What Shelra loads is invisible until it matters, and at most one quiet line when it does:

| What | In the log | Detail |
| --- | --- | --- |
| Skill (its `SKILL.md` was read) | `· Loaded skill terminal-ui` | `/skills`, `/context` |
| Memories retrieval injected | `· Recalled 2 memories` (same line as skills) | `/memory`, `/context` |
| Instruction files, agents, MCP | nothing | `/context` (LOADED section) |
| Hooks | nothing when they succeed; `× PreToolUse hook blocked: <why>` when one blocks, `! Stop hook failed` when one fails | `/context` |

## Layout

- Header: mode and session title. Nothing else.
- The plan is a live checklist while the agent works (at most five rows around the active step), anchored
  under the log so it never scrolls away; it folds to `✓ Plan 4/4` in the history when the turn ends.
- Each turn that changed files or ran a check ends with one line: `─ 2 files +6 -1 · tests ✓ · 42s`.
  A turn that only talked gets no line.
- Composer: rounded card docked at the bottom on the home screen and in a session, so sending the first
  message never moves it. Model and context on the left, the keys that matter now on the right; the
  views hint (`alt+2-5 views`) appears only once a view has something to open.
- Home: the block logo, `[ PROJECT ]` and `[ KNOWS ]`, composer.

## Keys and commands

`/plan`, `/diff`, `/checks` and `/context` open a full-width view over the log; `alt+2…5` do the same
(`alt+1` and `esc` return to the log). A view with nothing to show does not open: one line says
`Nothing yet: …`. `ctrl+o` shows every step with its evidence, `?` lists the shortcuts. The catalog is
`src/ui/shortcuts.ts`; the help overlay and the composer hints read from it.
