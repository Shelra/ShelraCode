---
id: D-0002
title: "API JSON uses snake_case keys"
status: active
source: user
scope: ["src/api/**"]
check: "bun scripts/check-api-keys.ts"
proposed: 2026-06-10
approved: 2026-06-10
---

Every key in a JSON body the API accepts or answers is snake_case, like user_id and created_at, including keys added later.

## Why

The mobile app reads bodies by exact key: a camelCase field is one it never sees.

## Evidence

Agreed with the mobile team on 2026-06-10.
