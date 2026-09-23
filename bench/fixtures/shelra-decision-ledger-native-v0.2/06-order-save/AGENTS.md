# Project rules

Rules this team agreed on. Every change follows them.

- **The domain stays pure.** Code in src/domain imports only other code in src/domain: never src/infra, src/app, a node: or bun: module, or a package. Saving, mailing and every other side effect happens in src/app, which calls the domain. The pricing rules in the domain run in the browser and in tests with no database; an import of the repository broke both in March. Checked by `bun scripts/check-layers.ts`.
