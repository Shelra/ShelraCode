/**
 * One glyph per state, from the allowed set (docs/ui/DESIGN-SYSTEM.md), shared by the log, the live
 * line, the plan, the inspector and the summaries. Colour reinforces a glyph; it is never the only signal.
 */
export const GLYPH = {
  done: "✓",
  failed: "✗",
  active: "●",
  queued: "○",
  quiet: "·",
  collapsed: "▸",
  expanded: "▪",
} as const;
