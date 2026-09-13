# Shelra Aurora visual specification

Status: implementation specification for the OpenTUI workspace. It changes visual presentation, not the agent runtime, navigation model, or information architecture.

## Platform decision

Shelra is a true-colour terminal interface built with React/OpenTUI, not a browser UI. Its theme is a TypeScript object (`src/ui/theme.ts`), rendered in terminal cells. There are no CSS variables, web fonts, shadows, border radii, `prefers-reduced-motion`, or CSS gradients to extend.

Use one typed semantic `Theme` contract with `dark` and `light` values. Resolve the chosen theme before the React root is mounted so a session does not flash the wrong palette. The eventual preference is `appearance: "dark" | "light" | "system"`; if a reliable OS colour-scheme signal is not available in the terminal host, `system` must deterministically fall back to `dark`, rather than guessing. Do not add a second styling system.

Terminal font choice belongs to the user's terminal emulator. Do not add a font dependency that OpenTUI cannot apply. The intended terminal recommendation is Geist Mono (or an equivalent legible programming face); all interface and technical text share that cell font. Use regular text for body/metadata and bold sparingly for a heading, active title, or destructive action. If Shelra later gains a graphical client, use Geist Sans for interface text and Geist Mono for code and metadata.

## Principles

- Calm, compact, and neutral while idle; conversation is the primary surface and the inspector is supportive.
- Electric emerald is Shelra's interaction identity, not the universal success colour.
- Aurora is a scarce work-in-progress signal. It never fills the app background, ordinary buttons, body copy, code, or every border.
- Hierarchy comes from surface steps, text contrast, divider rhythm, indentation, and labels—not cards, pills, shadows, or decorative glow.
- The outcome of work is calm: motion during work, a stable semantic confirmation when verified, and an explicit diagnostic when blocked or failed.

## Token contract

The first migration adds these roles to `Theme`. Existing component-facing aliases (`backgroundPanel`, `backgroundElement`, `text`, `textMuted`, `border`, diff and markdown tokens) should resolve to these roles during the migration; do not scatter replacement literals.

| Role | Dark | Light | Intended use |
| --- | --- | --- | --- |
| `background` | `#090B0A` | `#F7F9F8` | application canvas |
| `surface` | `#101312` | `#FFFFFF` | composer shell, modal and sidebar surface |
| `surfaceRaised` | `#161A18` | `#F1F4F2` | selected/raised technical region |
| `surfaceMuted` | `#0D100F` | `#E9EEEB` | queue, quiet callout, disabled fill |
| `border` | `#252B28` | `#DFE5E1` | ordinary dividers only |
| `borderStrong` | `#56625B` | `#858F89` | interactive input edge and important separation |
| `text` | `#F2F5F3` | `#111412` | primary copy |
| `textSecondary` | `#A8B2AC` | `#56615B` | supporting copy |
| `textMuted` | `#7C8780` | `#68736C` | metadata only, never required instruction text |
| `brand` | `#28E59A` | `#087D4C` | primary action, current selection, keyboard focus |
| `brandHover` | `#20CC88` | `#066B40` | selected/pressed emphasis |
| `brandSoft` | `#123B2A` | `#DDF9EE` | quiet brand selection fill |
| `success` | `#3ABF81` | `#167C5B` | completed/verified state |
| `warning` | `#F0B35A` | `#8B5700` | attention, pending verification |
| `danger` | `#F07178` | `#C1333D` | failure, destructive action, blocked state |
| `info` | `#67A7FF` | `#246BDB` | informational / plan mode |
| `modePlan` | `#A99BFF` | `#5E4EDB` | compact Plan-mode label only; not a semantic state |
| `overlay` | `#000000CC` | `#11141266` | modal scrim |

`#28E59A` remains the canonical Shelra emerald. Its light-mode interaction value is deliberately darker (`#087D4C`): the supplied light green is attractive but fails when used as normal-sized foreground text on white. The primary-fill foreground is `#FFFFFF` in both modes.

### Technical, markdown, and diff roles

Keep code and diff visually distinct but neutral. Use `codeSurface` `#0E1110` / `#F1F4F2`, `codeText` `#CBD3CE` / `#37423C`, `diffContext` `#161A18` / `#FFFFFF`, `diffSeparator` `#0D100F` / `#E9EEEB`, and `diffHeader` `#161A18` / `#F1F4F2` (dark/light). Added diff: background `#102B20` / `#E8F7EE`, foreground `#86E8B7` / `#12633D`. Removed diff: background `#351B20` / `#FCEBED`, foreground `#F5A5AB` / `#992832`. Markdown heading uses `text`; links use `info`; inline code uses `brand` only as a foreground accent, never a bright green background. Markdown table borders must consume `border`, not a raw `#333333`.

## Typography and density

- Body and activity copy: regular terminal face; avoid all-caps except established short structural labels such as `PLAN` and `AGENTS`.
- Heading / current work / agent name: bold; do not create oversized display text in a cell UI.
- Metadata, paths, timings, token counts, and commands: regular with `textMuted` or `textSecondary`; truncate at the component boundary rather than allowing a border to wrap.
- Preserve existing one-cell spacing rhythm. Prefer a divider or indentation to a nested surface. There is no terminal radius/shadow primitive: use single-line borders and low-contrast fills instead of attempting web-card treatments.

## States and component rules

| State | Treatment | Must remain explicit |
| --- | --- | --- |
| Idle | neutral composer border; no autonomous animation | `Ask Shelra…`, mode and shortcuts |
| Keyboard focus | static `brand` border/marker plus native cursor | focus is not colour-only |
| Working | Aurora composer edge plus one compact live-activity marker | activity label and elapsed time |
| Verifying | stable `info` or `warning` marker depending on status | `Running verification` / `Verification required` |
| Verified | stable `success`; no animation | `Verified` / observed evidence |
| Failed / blocked | `danger`, `×` or `!!`, and repair/diagnostic copy | cause and next safe action |
| Disabled | `surfaceMuted`, `textMuted`, and an explicit unavailable reason | not merely lower saturation |

The `PromptBox` is the signature surface. Add a single reusable `AuroraEdge` primitive around its textarea region:

1. idle: `borderStrong`;
2. focused but not working: static `brand`;
3. working: a thin coloured top/bottom edge and the existing compact work indicator;
4. completed: immediately return to the neutral edge; success belongs in the status row, not an animated input.

Do not animate the sidebar. Current selection, active agent, plan step, and focus may use `brandSoft` plus a marker. Keep chat activity mostly text/shape-led: marker + label + elapsed time first, semantic colour second. Preserve current explicit status symbols and labels so green/yellow/red is never the only distinction.

### Aurora primitive and motion

Aurora has one token group:

```ts
aurora = {
  green: "#28E59A",
  cyan: "#00CFE8",
  violet: "#7967FF",
  durationMs: 16_000,
  frames: 32,
};
```

OpenTUI cannot paint a CSS gradient in one border property. `AuroraEdge` should therefore render a narrow sequence of coloured terminal cells (for example `━` segments) whose three colours shift one position per frame; it is an Aurora approximation, not a fake RGB glow. Render it only while the agent is working and only for the composer plus, at most, one tiny live-status marker. One timer at `16_000 / 32 = 500 ms` is enough; it must be mounted only while active and cleared on completion/unmount. No JS animation may update the full transcript or sidebar.

The terminal equivalent of `prefers-reduced-motion` is an explicit preference (`motion: "full" | "reduced"`) and a documented environment override such as `SHELRA_REDUCED_MOTION=1`. Under reduced motion, select one static emerald/cyan/violet frame; retain the working marker and labels. A browser client must use the actual `prefers-reduced-motion` media query when one exists.

## Migration order

1. Replace the single `dark` literal map with typed dark/light semantic themes and a pure resolver. Add unit tests for preference precedence and the token contract.
2. Eliminate raw UI hex values: modal overlays, sandbox/update/payment notices, `MODES` in `src/types/index.ts`, markdown table border, and sidebar overlay. Mode definitions should expose a semantic tone key, resolved through the active theme—not a colour string persisted into transcript data.
3. Migrate shared primitives first: prompt/composer, status strip, active agents strip, message/activity tree, selection rows, modal shells, textarea/input, and suggestion overlay.
4. Migrate inspector, plans, markdown, code/LSP, diff, startup, schedule/MCP/agent pickers, payment and update views. Preserve layout and state sources.
5. Add `AuroraEdge` only after the neutral/focus states are correct. Use it in the working composer and compact live row; do not propagate it further.

## Accessibility acceptance criteria

- Normal text meets WCAG AA contrast in its intended mode. Token checks: dark `text/background` 17.98:1, `textMuted/background` 5.30:1, `brand/background` 12.00:1; light `text/background` 17.53:1, `textMuted/background` 4.66:1, `brand/white` 5.19:1. Light semantic foregrounds are also at least 4.5:1 on white (`success` 5.16, `warning` 4.60, `danger` 5.51, `info` 5.00).
- The composer/input must use `borderStrong`, not the subtle divider token: it has at least 3:1 contrast against its app canvas (`#56625B` on dark 3.10:1; `#858F89` on light 3.16:1). Its focus brand is higher still.
- Never place required text on an Aurora edge; Aurora is decorative/status affordance only.
- Every selectable/focused control has a static border or marker and native cursor/focus behaviour. Hover is not a primary terminal interaction state; keyboard selection must be equally clear.
- Status always combines colour with a stable symbol and label. Verify success, warning, failure, pending, and disabled states in both modes.
- Long paths, agent names, token values, activity descriptions, and modal headings must truncate/wrap without splitting a border or hiding the focused row.

## Visual QA gate

Do not call this complete from snapshots alone. After implementation, run the built CLI in a true-colour terminal and capture evidence at 160×65, 120×42, and 80×30 (also 58 columns for the compact logo boundary), in each theme. Inspect: home, populated chat, long transcript, sidebar hidden/shown boundary, focused composer, working Aurora, reduced-motion static Aurora, verifying, verified, failure/repair, queue, selection lists, every modal, markdown/table/code/diff, disabled controls, and long-content fixtures.

Add deterministic OpenTUI `testRender` cases for both themes at those dimensions, the 118-column sidebar threshold, long agent/path/token fixtures, and the Aurora lifecycle (idle static, working updates only its edge, reduced-motion static, completion clears its timer). Then run the existing UI tests, formatter, lint, typecheck, full tests, and a safe build. Use a fresh reviewer to look for noise, generic dashboard/card styling, colour-only status, contrast regressions, and idle CPU/redraws.

## Do / do not

Do use neutral surfaces, one primary emerald, restrained dividers, compact clear labels, and motion that reports active work. Do not use a full-screen gradient, animated buttons, rainbow borders, heavy glow, card stacks, huge headings, pill badges for every datum, or emerald as a synonym for every positive state.

## Research basis

- [TuneCore](https://www.tunecore.com/) was used for the principle of containing high-energy brand expression to promotion/hero moments rather than applying it to dense operational content.
- [Linear](https://linear.app/) demonstrates dense activity, state labels, elapsed time, and supporting metadata without displacing the work item from the primary surface.
- [Vercel Design and Geist](https://vercel.com/design) and [Geist typography](https://vercel.com/geist/typography) support a system-first, precise type treatment.
- [Claude Code](https://code.claude.com/docs/en/overview), [OpenAI Codex](https://openai.com/codex/), [Raycast](https://www.raycast.com/), and [Cursor](https://cursor.com/) were studied as developer/agent workflow references: keep actions, evidence, and execution status readable before brand decoration.
- [GitHub Primer colour usage](https://primer.style/product/getting-started/foundations/color-usage/) and [Primer accessibility colour guidance](https://primer.style/accessibility/design-guidance/color-considerations/) informed the semantic-token and dual-mode accessibility requirements.
