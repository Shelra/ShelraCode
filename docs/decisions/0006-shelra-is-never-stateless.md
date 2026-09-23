---
id: D-0006
title: "Shelra is never stateless"
status: active
source: instructions
scope: ["src/memory/**"]
check: "bunx vitest run --pool=forks src/memory"
proposed: 2026-09-23
approved: 2026-09-23
---

Shelra retrieves project memory (.shelra/memory/) for every request and sub-agent brief, and after a turn worth learning from, a deterministic write gate admits what a bounded reflection proposes: no secrets, no instruction-shaped text.

## Why

The owner's hard rule of 2026-09-17: every project must make Shelra better over time instead of starting from zero each session.

## Evidence

AGENTS.md, Persistent memory (hard rule); docs/design/shelra-memory-engine.md; the suites in src/memory/.
