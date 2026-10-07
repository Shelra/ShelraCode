# Example project instructions

This file is read by Shelra at the start of every turn (not only once per session), so an edit applies from the next
turn. Keep it short and specific: what is true of this project that the code does not say.

## Commands

- Install: `bun install`. Check: `bun run typecheck`, `bun run lint`, `bun run test`.
- Run one test file: `bunx vitest run --pool=forks <file>`.

## Conventions

- TypeScript strict; no `any` without a comment saying why.
- User-facing text is English; no raw hex colors outside `theme.ts`.
- A change to behavior comes with a test that fails before it and passes after.

## What not to do

- Do not edit `dist/`, generated files, or lockfiles by hand.

<!-- Another file can be pulled in with @path, inside the project:
@docs/architecture.md
-->
