---
id: D-0001
title: "The public API only grows"
status: active
source: user
scope: ["src/**"]
check: "bun scripts/check-api.ts"
proposed: 2026-08-14
approved: 2026-08-14
---

Every name exported from src/index.ts is public API that other teams import. Never remove or rename one: add the new name, and keep the old one as a deprecated alias.

## Why

Three internal services pin this package, and a removed export broke their builds in August.

## Evidence

Incident review of 2026-08-14. api-baseline.json lists the published names.
