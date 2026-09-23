---
id: D-0001
title: "SQL is always parameterized"
status: active
source: user
scope: ["src/**"]
check: "bun scripts/check-sql.ts"
proposed: 2026-06-10
approved: 2026-06-10
---

Every SQL statement passes values as parameters (`?`). Never build SQL text from values with template literals or string concatenation.

## Why

An injection through the search box leaked customer emails in 2025.

## Evidence

Security review of 2026-06-10.
