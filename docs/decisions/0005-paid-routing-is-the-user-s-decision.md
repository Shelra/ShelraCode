---
id: D-0005
title: "Paid routing is the user's decision"
status: active
source: instructions
scope: ["src/providers/**"]
check: "bunx vitest run --pool=forks src/providers/openrouter.test.ts"
proposed: 2026-09-23
approved: 2026-09-23
---

Paid routing is the user's decision. A failing model falls back to OpenRouter's own router for the spending policy (openrouter/free, or openrouter/auto within a paid tier), never to a hand-picked model, and the notice states its cost.

## Why

The owner decides what is spent. Hand-picked fallback models are a mistake this project already paid for, and a fallback is not always free.

## Evidence

AGENTS.md, Resilience (hard rule); CLAUDE.md, The owner's standing rules and Mistakes this project already paid for; src/providers/openrouter.test.ts.
