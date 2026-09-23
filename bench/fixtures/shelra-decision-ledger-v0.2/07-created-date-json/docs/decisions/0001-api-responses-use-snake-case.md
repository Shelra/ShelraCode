---
id: D-0001
title: "API responses use snake_case keys"
status: active
source: user
scope: ["src/**"]
check: "bun scripts/check-api-keys.ts"
proposed: 2026-03-09
approved: 2026-03-09
---

Every key in an API response is snake_case, like user_id and display_name: the mobile apps parse responses by exact key, so a camelCase key is a field they never see.

## Why

The Android app shipped a blank profile screen after a camelCase field went out in February.

## Evidence

Incident review of 2026-03-09.
