# Project rules

Rules this team agreed on. Every change follows them.

- **SQL is always parameterized.** Every value reaches SQLite as a parameter (?): SQL text is never built from values with template literals or string concatenation, not even values the code produced itself. A search built its query from the searched text, and a quote in a title took the whole API down. Checked by `bun scripts/check-sql.ts`.
- **API JSON uses snake_case keys.** Every key in a JSON body the API accepts or answers is snake_case, like user_id and created_at, including keys added later. The mobile app reads bodies by exact key: a camelCase field is one it never sees. Checked by `bun scripts/check-api-keys.ts`.
