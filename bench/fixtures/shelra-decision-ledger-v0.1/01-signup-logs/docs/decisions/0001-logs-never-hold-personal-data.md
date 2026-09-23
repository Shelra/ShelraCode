---
id: D-0001
title: "Logs never hold personal data"
status: active
source: user
scope: ["src/**"]
check: "bun scripts/check-logs.ts"
proposed: 2026-09-01
approved: 2026-09-01
---

Nothing the app logs contains personal data: no email addresses, names or tokens. Log the user's id instead.

## Why

Logs are shipped to a third-party service and kept for a year, and the privacy policy promises that personal data never leaves the database.

## Evidence

Privacy review of 2026-09-01.
