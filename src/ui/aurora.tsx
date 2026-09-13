import { useEffect, useState } from "react";
import type { Theme } from "./theme";

const EDGE_GLYPH = "━";

export interface AuroraEdgeProps {
  t: Theme;
  width: number;
  /** Only active work earns animation; focus is intentionally static. */
  active: boolean;
  focused: boolean;
  reducedMotion: boolean;
}

/**
 * Computes the colour of a single terminal-cell segment. OpenTUI borders accept
 * one colour only, so this is the controlled terminal equivalent of Shelra's
 * Aurora gradient rather than a fake CSS glow.
 */
export function auroraEdgeColor(t: Theme, index: number, frame: number): string {
  const colors = [t.aurora.green, t.aurora.cyan, t.aurora.violet];
  // A complete cell pattern spans the configured number of frames. Keeping
  // the bands broad prevents a short, gaming-style three-colour loop.
  const cycle = Math.max(t.aurora.frames, colors.length);
  const position = (((index + frame) % cycle) + cycle) % cycle;
  const segment = Math.min(colors.length - 1, Math.floor((position / cycle) * colors.length));
  return colors[segment] ?? t.aurora.green;
}

export function AuroraEdge({ t, width, active, focused, reducedMotion }: AuroraEdgeProps) {
  const [frame, setFrame] = useState(0);
  const cells = Math.max(12, Math.min(120, width));

  useEffect(() => {
    if (!active || reducedMotion) {
      setFrame(0);
      return;
    }

    const interval = setInterval(
      () => setFrame((current) => (current + 1) % t.aurora.frames),
      t.aurora.durationMs / t.aurora.frames,
    );
    return () => clearInterval(interval);
  }, [active, reducedMotion, t]);

  return (
    <text wrapMode="none">
      {Array.from({ length: cells }, (_, index) => {
        const color = active ? auroraEdgeColor(t, index, frame) : focused ? t.composerFocusBorder : t.border;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: terminal edge cells are static positions
          <span key={index} style={{ fg: color }}>
            {EDGE_GLYPH}
          </span>
        );
      })}
    </text>
  );
}
