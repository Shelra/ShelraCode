---
name: frontend-performance
description: Diagnose UI freezes, slow rendering and layout thrashing in a frontend by measuring first. Use when the interface lags, scrolls badly or blocks while streaming output.
metadata:
  shelra-keywords: jank stutter lag freeze scroll render frame
  shelra-requires: git
  shelra-version: "1"
---

# Frontend performance

1. **Measure before changing anything.** Record how long a frame takes and what runs in it. A guess that is not
   backed by a measurement is a hypothesis, and must be reported as one.
2. **Find the cost that grows.** Compare a short session with a long one: a cost that grows with the transcript or the
   number of items is the usual cause of a freeze that appears "after a while".
3. **Check the render path for work that does not belong there**: synchronous file or process calls, recomputation on
   every token, subscriptions that are never cleaned up.
4. **Change one thing, measure again, keep the number.** Report before and after with the command that produced them.

See [measuring](references/measuring.md) for what to record and how to report it.
