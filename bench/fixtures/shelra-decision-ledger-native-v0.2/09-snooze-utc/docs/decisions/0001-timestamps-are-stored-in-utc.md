---
id: D-0001
title: "Timestamps are stored in UTC ISO-8601"
status: active
source: user
scope: ["src/**"]
check: "bun scripts/check-timestamps.ts"
proposed: 2026-02-27
approved: 2026-02-27
---

Every stored timestamp is a UTC ISO-8601 string made with Date.toISOString(). Local times and friendlier formats appear only where the UI renders a value, never in stored data.

## Why

Reminders fired an hour late for every user outside the server's timezone until timestamps were normalized.

## Evidence

Bug report of 2026-02-27.
