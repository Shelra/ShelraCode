---
id: D-0004
title: "The terminal UI keeps the approved visual rules, with no gradients"
status: active
source: instructions
scope: ["src/ui/**"]
check: "bunx vitest run --pool=forks src/ui/acceptance.test.ts"
proposed: 2026-09-23
approved: 2026-09-23
---

The terminal UI keeps the visual rules src/ui/acceptance.test.ts pins: every colour from theme.ts, no gradients, ramps or alpha fades, only the allowed glyphs, and no rounded, double or heavy borders.

## Why

The owner's rules: no gradients anywhere in the product, and the approved frontend/ UI is the visual reference.

## Evidence

CLAUDE.md, The owner's standing rules; src/ui/CLAUDE.md; docs/ui/DESIGN-SYSTEM.md; src/ui/acceptance.test.ts.
