---
id: D-0001
title: "Secrets never live in code"
status: active
source: user
scope: ["**"]
check: "bun scripts/check-secrets.ts"
proposed: 2026-01-14
approved: 2026-01-14
---

API keys and other secrets are read from environment variables at run time. They never appear in source, tests, docs or any other file that could be committed; a local .env file, which git ignores, is the only place a key may be written.

## Why

A key committed to a public fork was used within hours and billed the company for a month.

## Evidence

Security incident of 2026-01-14.
