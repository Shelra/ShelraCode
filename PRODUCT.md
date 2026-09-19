# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Developers who work in a terminal. The maintainer runs ShelraCode in Windows Terminal and Warp; those two are the confirmed test terminals.
- The interface language is English only (confirmed 2026-09-18).
- Not confirmed: a primary audience beyond the maintainer. The init question about it was left unanswered, so no wider persona is asserted here.

## Product Purpose

ShelraCode (CLI `shelra`) is a cloud-first coding agent for the terminal. It reads a project, plans, edits files, runs checks and reports what changed and what was verified. Work routes through OpenRouter first, with the Free policy by default; a managed local llama.cpp runtime is an explicit private/offline mode (`--local`).

The agreed objective (2026-09-18) is an agent that does not lose the project's thread: come back after three months and it knows what was decided, why, and what still holds.

## Positioning

Confirmed at init: **it never loses the project's thread.**

- Shipped today: persistent project memory under `.shelra/memory/`. Retrieval ranks entries against every request and sub-agent brief; a bounded reflection call proposes durable facts and a deterministic write gate admits, merges or rejects them.
- Not shipped and unproven: the decision ledger, meaning decisions and commitments recorded with re-verifiable evidence and checked before a task is reported done. It is under test. The decision date is 2026-10-16; if fewer than 5% of real merged PRs silently violate a prior commitment, the thesis stops. Do not present the ledger as a capability.
- Not selected as positioning: harness-enforced honesty and the free-first/private-local mix. Both are real properties of the product (see below), but the user did not stand behind them as the differentiator.

## Operating Context

- Runs in the developer's terminal, against a project directory. Windows 11 is the maintainer's platform; Bun is required at runtime, and the build produces `dist/shelra.exe` (`shelra` on Unix).
- User state lives in `~/.shelra`, project state in `.shelra/`. Session state is a local SQLite database. No Docker and no long-running services.
- Work sessions read `AGENTS.md`, project memory and skills, then plan, edit, run checks (tests, types, lint, builds) and report. Sub-agents (explore, plan, general, vision, verify, computer) and MCP servers extend a session.
- Real model runs use OpenRouter Free with the user's own key, so free-tier rate limits are part of normal operation.
- Opt-in tool groups: desktop automation, schedules, payments. A Telegram bridge is opt-in.

## Capabilities and Constraints

Confirmed capabilities:

- OpenRouter-first routing with dynamic model discovery, capability filtering and spend controls (`--max-cost`, `--max-request-cost`); another OpenAI-compatible provider through `--remote`.
- A coding-core tool set: files, grep, LSP, bash and background processes, web research (`search_web`, `open_web`), sub-agents, memory and plan.
- A terminal interface built around the conversation log, with four views that open on demand (Plan, Changes, Checks, Context), keyboard-first, dark and light themes, and a reduced-motion setting.
- Headless mode (`-p "..." --format json`) and `/verify`.

Constraints:

- Terminal only, built with Bun, React 19 and OpenTUI. The platform is recorded as `web` because Impeccable has no terminal value and none of the native ones fit. The confirmed scope is the terminal UI with no graphical client (2026-09-18, reconfirmed at init on 2026-09-19).
- A terminal cannot load fonts, so typography is cell-level hierarchy plus a recommended terminal font.
- English-only interface text.
- Model-agnostic guarantees (user requirement 2026-09-19): the model only proposes; enforcement is deterministic harness code, so any model, free or paid, gets the same behaviour.
- No inference budget: free models first; if rate limits block work, the user decides whether to spend.
- Every registered tool costs schema tokens on every request, so the default tool set stays the coding core.

Terminology: product **ShelraCode**, CLI and interface **Shelra**; views **Log, Plan, Changes, Checks, Context**; **memory** and **skills**.

Undecided facts:

- The primary audience beyond the maintainer.
- The copyright holder and year in `LICENSE`, which is still the unfilled MIT template.

## Brand Commitments

Stated by the user (2026-09-19) and recorded without expansion:

- The name is ShelraCode; the CLI is `shelra`.
- The block-letter "SHELRA CODE" logo is the definitive mark. It was restored from the original and matches `ShelraCode/src/tui/views/HomeView.tsx`.
- Gradients are totally forbidden.
- The Shelra website (https://distinct-cube-212471.framer.app/) is the source of the palette, typography and borders, with its gradients excluded. Where that lands in the terminal is recorded in `src/ui/theme.ts` and `docs/ui/DESIGN-SYSTEM.md`.
- The interface must not resemble OpenCode, and nothing may trace back to the original Grok CLI repository.

## Evidence on Hand

- The product-path bench: the real turn loop measured on 2026-09-17, from 1/8 to 5/8 on the same model. Suite `bench/suites/shelra-agent-core-v0.2.json`; results page `bench/dashboard.html`. Eight tasks and one model: small evidence, the maintainer's own measurement.
- The research corpus in `research/` and `docs/future-research/`, which produced the selected thesis. The kill test that decides it has not been run to its end.
- Short real runs on OpenRouter Free in temporary projects, done during the 2026-09-19 interface work.
- Absent, and not to be fabricated: users, testimonials, usage data, pricing, a result from the decision-ledger kill test, and any check in a real Windows Terminal or Warp window (verification so far used ConPTY with xterm.js).

## Product Principles

1. **Keep the thread.** What was decided, and why, outlives the session. Nothing enters memory without passing a deterministic gate.
2. **Enforcement belongs to the harness.** A model can propose; only host-observed evidence can mark work done, verified or passing.
3. **Transparent by default.** The user can always see what ShelraCode read, changed, ran and verified, at a default level that is understandable and an expanded level that is inspectable.
4. **Any model, free first.** The guarantees do not depend on which model answered, and paid routing is the user's decision.
5. **Private stays possible.** Cloud is the default; an offline path with no API key remains available.

## Accessibility & Inclusion

Requested in the 2026-09-18 brief: keyboard-only operation, visible focus, contrast checked on both themes, reduced motion respected, and no state conveyed by colour alone (every status is a glyph plus a colour). No formal standard is required beyond these.
