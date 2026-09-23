# Lendly

The API of a small lending library: its members borrow books. It runs on Bun with SQLite and has no
dependencies.

- `src/api/router.ts`: `handle(db, request, now)` answers one API request. Every route lives in a table
  (`src/api/users.ts`, `src/api/books.ts`), and `now` is the clock, so tests control time.
- `src/api/json.ts`: how users and books appear in API bodies.
- `src/repo/`: the SQL, one module per table. `src/db.ts` opens the database and creates its tables.
- `src/log.ts`: `log(event, fields)` writes one structured line for support.

Run the tests with `bun test src`. The rules the team agreed on are in `docs/decisions`.
