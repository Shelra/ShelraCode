# Terminal UI (`src/ui/`)

<!-- Loaded when Claude reads files in src/ui/. Written 2026-09-22 while the restyle onto the approved web
palette was in flight (theme.ts moving to a single dark palette); re-check token names against theme.ts. -->

- OpenTUI React (`@opentui/react`, `@opentui/core`), not Ink: lowercase intrinsics (`<box>`, `<text>`,
  `<scrollbox>`), and the JSX runtime comes from `jsxImportSource`, so no `import React` for JSX.
- Colours only through `theme.ts` (the approved web palette with xterm-256 fallbacks); no raw hex in
  components. No gradients, shadows or glows. Every status is a glyph plus a colour, never colour alone.
- The approved `frontend/` UI is the visual reference. `docs/ui/DESIGN-SYSTEM.md` explains the translation
  but lags `theme.ts` during the restyle; the code wins.
- The log is the only permanent surface. A plan, a load or a turn summary appears when it exists, and the
  detail opens on demand (`/plan`, `/diff`, `/checks`, `/context`). Something with nothing to show never draws.
- Show only what the runtime knows: read progress, tokens, agents and verification from `Agent` state, never
  from model text. UI text is English.
- Known traps: OpenTUI's `<textarea>` keeps the `onSubmit` it was created with, so use
  `components/text-area.tsx`. Markdown and code blocks use the local renderers (`markdown.tsx`,
  `code-highlight.ts`) because OpenTUI's built-in rendering broke list indents, block margins and code colours.
- Render tests (`testRender`) run only under `bun test` (see the Bun-only rule in the root CLAUDE.md); pure
  logic such as `activity.ts` and `observability.ts` stays in Vitest.
- Verify the rendered result, not the source: `SHELRA_DEMO_SCENARIO=<name> bun run scripts/ui-demo/main.tsx`
  mounts the real `App` and `Agent` with real tools on a throw-away fixture; only the model is scripted
  (scenarios in `scripts/ui-demo/scenarios.ts`; point `HOME`/`USERPROFILE` at a scratch directory). Check
  80x24 and 120x40. The owner uses Windows Terminal and Warp.
- UI deliverables get three rendered passes, each improving on the last (owner's rule). Load the
  `terminal-ui` skill for TUI work.
