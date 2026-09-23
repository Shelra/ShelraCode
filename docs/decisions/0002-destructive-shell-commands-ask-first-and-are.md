---
id: D-0002
title: "Destructive shell commands ask first, and are refused where nobody can be asked"
status: active
source: instructions
scope: ["src/tools/bash.ts","src/exec/**","src/security/**","src/toolset/tools.ts"]
check: "bunx vitest run --pool=forks src/security/destructive.test.ts src/toolset/tools.test.ts"
proposed: 2026-09-23
approved: 2026-09-23
---

A shell command the host classifies as destructive runs only after the user says yes; where nobody can be asked, as in a headless run, it is refused. The user's settings may block such commands outright or allow them.

## Why

The owner's decision of 2026-09-23. Shelra runs shell commands on the host by default, so one wrong command can erase work that no checkpoint covers.

## Evidence

CLAUDE.md, Security and privacy; src/security/destructive.ts; the destructive-command cases in src/toolset/tools.test.ts.
