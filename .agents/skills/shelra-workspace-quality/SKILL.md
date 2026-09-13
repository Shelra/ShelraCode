---
name: shelra-workspace-quality
description: Audit or refine ShelraCode's main OpenTUI coding workspace when chat activity, live status, plan/context sidebar, agent visibility, or verification UX must match a supplied visual specification. Do not use for onboarding, settings, or unrelated screens.
---

# Shelra workspace quality

Treat the user's wireframe as an acceptance specification. Preserve Shelra's existing theme and runtime architecture while matching its layout, hierarchy, density, and behavior closely.

Before editing, perform bounded external research against current official CLI documentation and trace the repository's actual message, tool, plan, agent, context, token, and verification state. Never create a parallel transcript or UI-only task state.

## Non-negotiable presentation rules

- Conversation is the primary surface; the right sidebar supports it.
- Render user intent, Shelra narrative, and operational activity with distinct semantics.
- Keep exactly one updating live-action row immediately above the composer.
- Render active/relevant agents below the composer, separated by a subtle divider.
- Keep the sidebar ordered as plan, current task, context, agents, tokens, verification, session.
- Group repetitive reads, searches, edits, and commands into meaningful activity.
- Never show provider/model cycles such as `Step N`, `Model turn started`, or raw reasoning.
- Never fabricate progress, agents, next actions, context, tokens, cost, or verification.
- Failures, repair, permission blocks, and verification outcomes stay prominent.

## Three-pass gate

Run the same rendered workflow three times. A source-only review does not count.

1. Structure: verify the two-column layout, transcript/activity distinction, live row, composer, agent strip, and sidebar order.
2. Hierarchy: verify spacing, alignment, wrapping, density, tree indentation, markers, elapsed time, and semantic event grouping.
3. Behavior: verify active updates in place, failure → repair → re-verification, plan state, delegation state, narrow width, long content, and interruption affordances.

After each pass, repair observed failures before starting the next. Record concrete evidence and keep unresolved criteria failed. Run focused tests after each repair, then format, lint, typecheck, the full test suite, and a safe build before completion.

Use the built-in `ui-verify` sub-agent for an independent three-pass visual audit when a tool-capable model is available. Use `verify` for build/test/runtime checks. Neither agent may mark a criterion passed without observable evidence.
