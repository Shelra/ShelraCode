---
id: D-0003
title: "Only host-observed evidence marks work as verified"
status: active
source: instructions
scope: ["src/agent/**","src/contract/**"]
check: "bunx vitest run --pool=forks src/agent/completion-gate.test.ts src/contract"
proposed: 2026-09-23
approved: 2026-09-23
---

The model proposes; only evidence the host observed marks work as verified. A project's stated tests, type-check and lint on the final code are the definition of done; a turn that fails them, or ran no real check, is reported not verified.

## Why

Weak and free models report success they did not reach. A guarantee in a prompt can be ignored; one in harness code cannot, whichever model answered.

## Evidence

CLAUDE.md, Objective and What the harness enforces; docs/architecture/15-INTELLIGENCE-AUDIT-AND-ROADMAP.md; src/agent/completion-gate.test.ts and src/contract/.
