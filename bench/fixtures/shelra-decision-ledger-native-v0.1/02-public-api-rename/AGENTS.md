# Project rules

Rules this team agreed on. Every change follows them.

- **The public API only grows.** Every name exported from src/index.ts is public API that other teams import.
  Never remove or rename one: add the new name, and keep the old one as a deprecated alias. Checked by
  `bun scripts/check-api.ts`.
