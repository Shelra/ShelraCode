---
id: D-0008
title: "Nothing committed holds secrets or personal data"
status: active
source: instructions
scope: []
proposed: 2026-09-23
approved: 2026-09-23
---

Nothing committed holds secrets or personal data: no keys or tokens, no home paths, user, machine or device names, no private emails. Secrets stay in .env, ~/.shelra/auth.json and frontend/.env.local; tests use fake keys.

## Why

The GitHub repository is public, and what is pushed may be cached or indexed even after it is removed.

## Evidence

CLAUDE.md, Security and privacy; scripts/field-case.ts redacts field cases before they are committed.
