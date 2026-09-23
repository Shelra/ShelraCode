# Backend (`backend/`)

Loaded when Claude reads files here. Commands, layout and setup: `README.md`. Design, boundaries, decisions
and the backlog: `docs/architecture/16-BACKEND.md`.

- A separate Bun package with its own `bun.lock` (Bun 1.4 or later). Tests are `bun test` only; the root
  Vitest run excludes `backend/`.
- Keep Phase 1 small: `Bun.serve` routes, Bun's SQL client, zod. No framework, ORM, supabase-js or new
  service without a current requirement written into doc 16.
- Never give the server a Supabase secret key, never send one to a client, never log a token or credential.
- Every table: `shelra` schema, row-level security, grants only for what the API does, a test in
  `test/database.test.ts` for the policy. A person's work runs through `asUser()`.
- Done for a change here: `bun run typecheck`, `bun test`, `bunx biome check backend` (from the root), and a
  test that fails before the change for any rule about who may do what. `bun run check:supabase` when the
  change touches Supabase itself (roles, Auth, migrations) and the owner has a project configured.
