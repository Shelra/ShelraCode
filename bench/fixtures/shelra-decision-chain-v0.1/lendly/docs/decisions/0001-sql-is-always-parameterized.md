---
id: D-0001
title: "SQL is always parameterized"
status: active
source: user
scope: ["src/**"]
check: "bun scripts/check-sql.ts"
proposed: 2026-06-02
approved: 2026-06-02
---

Every value reaches SQLite as a parameter (?): SQL text is never built from values with template literals or string concatenation, not even values the code produced itself.

## Why

A search built its query from the searched text, and a quote in a title took the whole API down.

## Evidence

Incident review of 2026-06-02.
