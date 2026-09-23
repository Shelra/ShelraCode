---
id: D-0001
title: "A failing resource never ends a turn"
status: active
source: instructions
scope: ["src/agent/**","src/providers/**","src/toolset/**","src/tools/**"]
check: "bunx vitest run --pool=forks src/agent/resilience.test.ts"
proposed: 2026-09-23
approved: 2026-09-23
---

A missing or failing resource (a model round, a key, a tool, an MCP server, a hook) never ends a turn: it is retried, falls back, or returns a failed result the model routes around. Only the user's cancellation ends a turn at once.

## Why

The owner's hard rule of 2026-09-19. Free models and free tiers fail often, and a turn that dies on the first failure throws away the work it had done.

## Evidence

AGENTS.md, Resilience (hard rule); docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md §26; src/agent/resilience.test.ts.
