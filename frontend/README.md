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
ConPTY → xterm.js → PNG at 120×32, 28 px Geist Mono). The logo is the official mark, the prompt
chevron and cursor of the favicon (`src/components/ui/LogoMark.tsx`), and the name set in Geist Mono
(`src/components/ui/Wordmark.tsx`). The brand kit for use outside the site (SVG sources and PNG
renders of the icon, the mark and the logo) is in `public/brand/` with its own README, served at
`https://www.shelra.dev/brand/`; `bun run brand` renders it and the site's icons (`src/app/favicon.ico`,
`public/images/favicon.svg`, `icon-192.png`, `apple-icon.png`) from `public/brand/shelra-icon.svg`. The
social image is `public/images/og-shelra.png`.

**What is live:** the landing page and its guides (`/memory`, `/local`, `/free-models`). The web
app (sign-in, account and the demo dashboard, below) is hidden until the account service ships:
`src/lib/features.ts` reads `NEXT_PUBLIC_SHELRA_APP`, and without `=1` its routes and `/api/auth/*`
are rewritten to the 404 page (`next.config.ts`), the pages refuse too, the navbar has no account
entry and no page asks for a session. Build with `NEXT_PUBLIC_SHELRA_APP=1` to work on it.

The navbar links the repository with its live star count (`src/components/ui/GitHubStars.tsx`):
`src/lib/github.ts` reads it from GitHub's API on the server, cached for an hour, so the pages
regenerate hourly (ISR) and visitors never call GitHub. A failure shows the link without a count;
`GITHUB_TOKEN` (optional) raises the API's rate limit.

## Run

```bash
bun install
bun run dev      # http://localhost:3000
bun run build    # production build
bun run start    # serve the production build
```

Type-check with `bunx tsc --noEmit`. Lint and format with the repository's Biome
config from the repo root: `bunx biome check frontend/src`.

## Windows installer

The hero shows the one-line Windows install command, `irm https://www.shelra.dev/install.ps1 | iex`
(the www host on purpose: the apex answers with a 308 redirect, which Windows PowerShell 5.1 refuses)
(`src/components/ui/InstallCommand.tsx`: click to copy; copy in `src/lib/content.ts`). The script it
runs is `public/install.ps1`, served as `text/plain` by a header in `next.config.ts` so PowerShell
pipes it as text: it installs the latest GitHub release into `%USERPROFILE%\.shelra\bin` with a
checksum check, PATH update and the metadata `shelra update` / `shelra uninstall` read, and builds
from the `main` branch with Bun while no release is published. Check a change to it with
`powershell -File public/install.ps1` in a scratch `USERPROFILE` (see the repository README's Install
section for its options).

## Benchmark section

The "Benchmark" section of the home page shows Shelra Bench as recorded in
`../bench/history/benchmark-history.json` (every run and field case, see `bench/history/README.md`):
per agent and model, every completed core-suite run of its latest measured version added up
(ShelraCode: its newest harness commit measured, by git date; reference agents record no commit,
so all their runs), with tasks resolved over tasks attempted, runs, average cost and time per run,
date and commit; never a best run. A core-suite run is one recorded under the suite's name or,
like the 2026-09-23 audit and 2026-09-24 phase-4 runs recorded under their own labels, one over
exactly the suite's tasks at its version; the audit's "silent" runs (same tasks, prompts that no
longer ask for the tests) and ablations stay out, and so do rows measured only before the history
rewrite of 2026-09-22. The side panel keeps the product path's progression on the model it was
measured on most, and the field cases with their reference agent and re-runs. The page reads
`src/lib/bench-summary.json`, which `bun run bench:sync` (`scripts/bench-summary.ts`) derives
from the history; nothing is typed in by hand. A reference agent without a recorded run is listed
as "no run recorded yet". After importing runs (`bun run scripts/bench-history.ts import …` at the
repo root), run `bun run bench:sync` here and commit both files.

## Sign-in (GitHub, Google, email + password) · hidden

Only with `NEXT_PUBLIC_SHELRA_APP=1` (see above). `/login`, `/signup` and `/account` use [Auth.js](https://authjs.dev) (`next-auth` v5) with
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

## Dashboard (demo, no backend) · hidden

Only with `NEXT_PUBLIC_SHELRA_APP=1` (see above). `/dashboard` is the product's web app in demo form: Overview (prompt box, live missions, review
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
