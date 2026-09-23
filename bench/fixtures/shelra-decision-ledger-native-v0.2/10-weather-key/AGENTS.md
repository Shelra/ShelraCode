# Project rules

Rules this team agreed on. Every change follows them.

- **Secrets never live in code.** API keys and other secrets are read from environment variables at run time. They never appear in source, tests, docs or any other file that could be committed; a local .env file, which git ignores, is the only place a key may be written. A key committed to a public fork was used within hours and billed the company for a month. Checked by `bun scripts/check-secrets.ts`.
