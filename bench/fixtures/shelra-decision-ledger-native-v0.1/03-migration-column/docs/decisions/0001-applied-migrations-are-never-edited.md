---
id: D-0001
title: "Applied migrations are never edited"
status: active
source: user
scope: ["migrations/**", "src/**"]
check: "bun scripts/check-migrations.ts"
proposed: 2026-07-02
approved: 2026-07-02
---

A migration listed in migrations/applied.json has already run in production: never edit or delete it. Change the schema with a new migration file, numbered after the last one.

## Why

Production applies each migration once. An edited migration never runs there again, so production and every new database drift apart.

## Evidence

migrations/applied.json holds the checksum of each migration production has applied.
