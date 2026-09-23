@AGENTS.md

<!-- Loaded when Claude reads files in frontend/. `next dev` writes the AGENTS.md block imported above; leave
it alone. Checked against the app on 2026-09-22. -->

# Web app (`frontend/`)

- A separate app with its own `package.json` and `bun.lock`. From `frontend/`: `bun install`, `bun run dev`
  (http://localhost:3000), `bun run build`, `bunx tsc --noEmit`. Lint and format from the repo root with the
  root Biome config: `bunx biome check frontend/src`. The root scripts and CI do not cover this app.
- Next.js 16 App Router, React 19, strict TypeScript, `@/*` → `src/*`. Read the guide in
  `node_modules/next/dist/docs/` before using a Next API (see the block above).
- The owner approved this UI, and it is the visual reference for the terminal UI too. Change its look only
  when asked; new pages reuse its language: the tokens and text presets in `src/app/globals.css`, `[ LABEL ]`
  section badges, two-tone headings, flat colour, no gradients.
- Styling is CSS Modules plus the CSS variables in `globals.css`; there is no CSS framework. Borders are inner
  `::after` overlays (`.fb`) that never change layout. Breakpoints: desktop ≥1200, tablet 810–1199.98, phone
  ≤809.98 (`src/lib/useBreakpoint.ts`). Animation: `motion/react`; smooth scroll: Lenis
  (`src/components/layout/SmoothScroll.tsx`). Copy and links: `src/lib/content.ts`.
- Sign-in is Auth.js v5 beta (`src/auth.ts`, `src/lib/auth-*.ts`) with JWT sessions: GitHub and Google OAuth,
  plus email and password stored in libSQL (`src/lib/users.ts`: `.data/auth.db` in development,
  `AUTH_DATABASE_URL`/`AUTH_DATABASE_TOKEN` in production). Secrets go only in `.env.local` (template:
  `.env.example`). The marketing pages must keep working with auth unconfigured.
- The landing copy is real and sourced (`src/lib/content.ts` ← README, `shelra --help`,
  `bench/field/SCOREBOARD.md`, `docs/design`); keep it that way — no invented customers, numbers or
  testimonials. Product images are captures of the real TUI (`public/images/tui-*.png`) made with the
  `scripts/ui-demo` harness; re-capture rather than mock when the TUI changes.
- `/dashboard` is the product's web app in demo form: no backend, everything simulated in the browser by
  `src/lib/demo/` (types, seeded workspace, `localStorage` store with an action per button, a tick-based
  mission simulation). Pages are thin server files in `src/app/dashboard/` rendering client views in
  `src/components/dashboard/views/`; the shell, primitives (`ui.tsx`), charts and terminal log live in
  `src/components/dashboard/`. Wiring a real API means replacing the store's actions and `useDemo()`.
- The root `.gitignore` ignores `lib/` (CLI build output) and re-includes `frontend/src/lib/`; keep that negation, or
  the website's content, auth and demo modules silently drop out of commits and the Vercel build fails.
- Deploying: Vercel with Root Directory `frontend` (Bun is detected from `bun.lock`); env `AUTH_SECRET`, the OAuth
  ids/secrets and `AUTH_DATABASE_URL`/`AUTH_DATABASE_TOKEN` (Turso) for email sign-in. Without `AUTH_SECRET` the
  site still serves; `/api/auth/session` answers `null` and the other auth routes 503 with a message.
- Done means `bunx tsc --noEmit`, `bun run build` and Biome pass, and the page was checked in a real browser
  (Playwright or Chrome) at 1440, 1000 and 390 px wide.
