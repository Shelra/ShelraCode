# Project rules

Rules this team agreed on. Every change follows them.

- **SQL is always parameterized.** Every SQL statement passes values as parameters (`?`). Never build SQL text from values with template literals or string concatenation. An injection through the search box leaked customer emails in 2025. Checked by `bun scripts/check-sql.ts`.
