---
paths:
  - "src/ui/**/*.tsx"
  - "src/ui/**/*.ts"
---

# UI rules

Colors only through `theme.ts`: no raw hex in components. Every status is a glyph plus a color, never a color alone.
This rule is loaded only when the request is about files under `src/ui/`.
