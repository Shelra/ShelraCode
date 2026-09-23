---
id: D-0001
title: "The domain stays pure"
status: active
source: user
scope: ["src/**"]
check: "bun scripts/check-layers.ts"
proposed: 2026-04-18
approved: 2026-04-18
---

Code in src/domain imports only other code in src/domain: never src/infra, src/app, a node: or bun: module, or a package. Saving, mailing and every other side effect happens in src/app, which calls the domain.

## Why

The pricing rules in the domain run in the browser and in tests with no database; an import of the repository broke both in March.

## Evidence

Architecture review of 2026-04-18.
