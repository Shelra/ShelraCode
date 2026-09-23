---
id: D-0001
title: "Users are never removed from the database"
status: active
source: user
scope: ["src/**"]
check: "bun scripts/check-soft-delete.ts"
proposed: 2026-07-21
approved: 2026-07-21
---

Deleting a user sets its deleted_at to the time of deletion and keeps the row; no code runs DELETE on the users table. Queries hide rows whose deleted_at is set.

## Why

Audits and legal holds need every account that ever existed, and a hard delete lost one in July.

## Evidence

Legal hold notice of 2026-07-21.
