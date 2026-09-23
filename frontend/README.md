# frontend

ShelraCode's website. The design is a Next.js (App Router) port of the Achilles Framer
template (`https://distinct-cube-212471.framer.app`): every text style, colour token,
breakpoint (1200 / 810 / 390), animation and interaction is reproduced 1:1, with two
deliberate improvements (a fixed noise layer and an interruptible, momentum-based slider).
The content is ShelraCode's own: the copy in `src/lib/content.ts` comes from the repository
(README, `shelra --help`, `bench/field/SCOREBOARD.md`, `docs/design`), the "Benchmark"
section is generated from the versioned run history (below), the "Field notes"
section shows measured results instead of testimonials, pricing describes the real cost model
(Free · your key · local), and every product image is a capture of the real TUI
(`public/images/tui-*.png`, made with the `scripts/ui-demo` harness: real app, scripted model,
ConPTY → xterm.js → PNG at 120×32, 28 px Geist Mono). The wordmark is text
(`src/components/ui/Wordmark.tsx`), the favicon `public/images/favicon.svg`, the social image
`public/images/og-shelra.png`.

## Run

```bash
bun install
bun run dev      # http://localhost:3000
bun run build    # production build
bun run start    # serve the production build
```

Type-check with `bunx tsc --noEmit`. Lint and format with the repository's Biome
config from the repo root: `bunx biome check frontend/src`.

## Benchmark section

The "Benchmark" section of the home page shows Shelra Bench as recorded in
`../bench/history/benchmark-history.json` (every run and field case, see `bench/history/README.md`):
the best completed run per agent and model on the core suite (tasks resolved, cost, wall time,
run number, date and harness commit), the product path's progression on the model it was
measured on most, and the field cases with their reference agent and re-runs. The page reads
`src/lib/bench-summary.json`, which `bun run bench:sync` (`scripts/bench-summary.ts`) derives
from the history; nothing is typed in by hand. Reference agents (Claude Code, Codex) appear as
"being recorded" until their runs are imported into the history, then fill in on the next sync.
After importing runs (`bun run scripts/bench-history.ts import …` at the repo root), run
`bun run bench:sync` here and commit both files.

## Sign-in (GitHub, Google, email + password)

`/login`, `/signup` and `/account` use [Auth.js](https://authjs.dev) (`next-auth` v5) with
stateless JWT sessions. Copy `.env.example` to `.env.local` and fill in `AUTH_SECRET`
(`openssl rand -base64 32`).

- **GitHub / Google**: OAuth app credentials (`AUTH_GITHUB_*`, `AUTH_GOOGLE_*`); register
  `<origin>/api/auth/callback/github` and `<origin>/api/auth/callback/google` as callback URLs.
  A provider without credentials is shown as "Not configured" instead of failing.
- **Email + password**: users live in a libSQL database (`src/lib/users.ts`, passwords as scrypt
  hashes). In development it is the local file `.data/auth.db` (created automatically,
  gitignored); in production set `AUTH_DATABASE_URL` + `AUTH_DATABASE_TOKEN` to a
  libSQL/[Turso](https://turso.tech) database — without them the form answers "Email sign-in
  isn't set up on this deployment yet". There is no password reset yet (it needs email delivery).

The marketing pages never depend on auth being set up. Outside Vercel also set
`AUTH_TRUST_HOST=true` and `AUTH_URL`. Code: `src/auth.ts` (configuration),
`src/lib/auth-actions.ts` (server actions), `src/lib/users.ts` (user store),
`src/components/auth/` (the pages' UI) and `src/app/api/auth/[...nextauth]/route.ts` (handlers).

## Dashboard (demo, no backend)

`/dashboard` is the product's web app in demo form: Overview (prompt box, live missions, review
queue, usage, agents), Missions (list, new mission, detail with a live terminal log, plan, files
and PR), Agents, Repositories, Usage, Billing, API keys, Team, Integrations, Activity and
Settings, plus a ⌘K command palette, notifications and an account menu. Everything is simulated
in the browser: `src/lib/demo/` holds the types, a seeded workspace (`seed.ts`), the store
(`store.ts`, persisted to `localStorage`, actions for every button) and the simulation
(`simulation.ts`: running missions print their log, advance their plan, spend tokens and open a
PR or pause for review). Without a session the dashboard shows the demo owner and a
"demo mode" banner; signed-in users see their own identity. "Reset data" (banner or Settings)
reseeds the workspace. Replacing the demo with a real API means swapping `store.ts` actions and
`useDemo()` for fetches; the views only know the types.

## Layout

- `src/app/` — `layout.tsx` (metadata, global CSS, session provider), `page.tsx` (home),
  `not-found.tsx` (404), `login/`, `signup/`, `account/` (auth pages) and `api/auth/` (Auth.js).
- `src/components/auth/` — the auth pages: focused frame, provider buttons, the animated
  terminal session card and the account panel.
- `src/app/dashboard/` — the dashboard routes (thin server pages) and
  `src/components/dashboard/` — its shell (sidebar, top bar, command palette), primitives
  (`ui.tsx`: panels, stats, tables, forms, modals, tabs, toasts), charts, the terminal log and
  one view per page under `views/`. Data: `src/lib/demo/`.
- `src/app/globals.css` — design tokens, resets and the Framer text presets (`.t-h1`, `.t-body`, …).
- `src/app/fonts.css` — the same `@font-face` rules the Framer site serves (Inter, Inter Display,
  Geist Mono, JetBrains Mono), pointing at the self-hosted files in `public/fonts/`.
- `src/lib/content.ts` — all copy and links of the site; `src/lib/guides.ts` — the guide pages' copy.
- `src/app/memory/`, `src/app/local/`, `src/app/free-models/` — the guide pages, rendered by `src/components/doc/`
  (layout, inline markup, and the tables read from `src/lib/bench-summary.json`).
- `src/lib/site.ts`, `src/lib/metadata.ts`, `src/lib/structured-data.ts`, `src/app/robots.ts`, `src/app/sitemap.ts` —
  search: the canonical origin and indexable pages, page metadata, JSON-LD, robots and sitemap (`docs/seo/`).
- `scripts/seo-check.ts` (`bun run seo:check`) — the search regression check; `scripts/optimize-images.ts`
  (`bun run images`) — the WebP copies of the PNG images.
- `src/components/layout/` — the page frame: Lenis smooth scroll, fixed navbar with the mobile
  overlay menu, noise overlay, final call to action and footer.
- `src/components/hero/` — hero section and the WebGL2 "Bands" shader background (same GLSL and
  uniforms as the original, with the still image as fallback).
- `src/components/sections/` — social proof (sliding logos), benchmark (`Benchmark.tsx`, data
  from `src/lib/bench-summary.json`), features (with the three terminal illustrations), use
  cases (tabs), how it works, benefits, testimonials (`Carousel.tsx`: drag with momentum,
  arrows, keyboard, trackpad), pricing (monthly/yearly toggle with the animated price) and
  FAQ (accordion).
- `src/components/ui/` — Button, Badge, SectionBadge, Toggle, SocialsButton and the icon set.
- `src/components/motion/` — `Appear` (scroll-triggered appear effect) and `TextAppear`
  (word/line tokenised text reveal).
- `public/images/` — every image of the site, `public/fonts/` — every font file.

## Conventions

- Plain `<img>` elements and CSS Modules with the exact pixel values of the original; borders are
  drawn with an inner `::after` overlay (`.fb`) so they never change layout, as in Framer.
- Breakpoints: desktop `≥ 1200px`, tablet `810–1199.98px`, phone `≤ 809.98px`
  (`src/lib/useBreakpoint.ts` for the JS side).
