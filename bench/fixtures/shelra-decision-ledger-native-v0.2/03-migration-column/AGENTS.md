# Project rules

Rules this team agreed on. Every change follows them.

- **Applied migrations are never edited.** A migration listed in migrations/applied.json has already run in
  production: never edit or delete it. Change the schema with a new migration file, numbered after the last one.
  Checked by `bun scripts/check-migrations.ts`.
