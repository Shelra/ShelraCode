import { describe, expect, it } from "vitest";
import {
  ansi256Hex,
  colorModeFrom,
  dark,
  dark256,
  PALETTE,
  paletteColors,
  reducedMotionEnabled,
  resolveTheme,
} from "./theme";

function luminance(hex: string): number {
  const values = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (!values || values.length < 3) throw new Error(`Expected a six-digit hex colour: ${hex}`);

  const [red, green, blue] = values.map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("Shelra palette", () => {
  it("is the approved web palette, with exactly two status colours added", () => {
    expect(PALETTE.base.hex).toBe("#080808");
    expect(PALETTE.surface.hex).toBe("#111111");
    expect(PALETTE.border.hex).toBe("#1A1A1A");
    expect(PALETTE.default.hex).toBe("#F0F0F0");
    expect(PALETTE.subtle.hex).toBe("#888888");
    expect(PALETTE.accent.hex).toBe("#00FF88");
    expect(PALETTE.hover.hex).toBe("#00CF6E");
    expect(PALETTE.warning.hex).toBe("#FFB454");
    expect(PALETTE.error.hex).toBe("#FF5C5C");
  });

  it("uses only palette colours for every role, in both colour modes", () => {
    for (const [mode, theme] of [
      ["truecolor", dark],
      ["256", dark256],
    ] as const) {
      const allowed = new Set(Object.values(paletteColors(mode)));
      for (const [role, value] of Object.entries(theme)) {
        expect(allowed.has(value), `${mode} ${role} = ${value}`).toBe(true);
      }
    }
  });

  it("never uses a status colour as a surface", () => {
    const surfaces = [dark.background, dark.surface, dark.surfaceRaised, dark.overlay, dark.selectedBg, dark.diffAdded];
    for (const surface of [...surfaces, dark.diffRemoved, dark.mdCodeBlockBg]) {
      expect([PALETTE.warning.hex, PALETTE.error.hex]).not.toContain(surface);
    }
  });

  it("keeps text readable in both colour modes: 4.5:1 for default and subtle on base and surface", () => {
    for (const theme of [dark, dark256]) {
      for (const text of [theme.text, theme.textMuted]) {
        expect(contrast(text, theme.background)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(text, theme.surface)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(theme.onAccent, theme.accent)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(dark.textMuted, dark.background)).toBeCloseTo(5.65, 1);
  });

  it("tints a diff's rows red and green with the status colours blended on base, and keeps them readable", () => {
    // The owner asked for red removed lines and green added ones (2026-09-24): blends, never the pure colour.
    expect(dark.diffRemoved).toBe(PALETTE.error26.hex);
    expect(dark.diffAdded).toBe(PALETTE.accent18.hex);
    for (const theme of [dark, dark256]) {
      for (const band of [theme.diffRemoved, theme.diffAdded]) {
        expect(contrast(theme.text, band)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(theme.diffRemovedFg, theme.diffRemoved)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme.diffAddedFg, theme.diffAdded)).toBeGreaterThanOrEqual(4.5);
    }
    // The two bands weigh the same to the eye, so neither colour shouts over the other. The xterm cube has
    // no green darker than #005f00, so the 256-colour fallback only has to stay readable.
    expect(Math.abs(luminance(dark.diffRemoved) - luminance(dark.diffAdded))).toBeLessThan(0.01);
  });

  it("maps each token to its exact xterm-256 colour", () => {
    expect(ansi256Hex(232)).toBe("#080808");
    expect(ansi256Hex(233)).toBe("#121212");
    expect(ansi256Hex(234)).toBe("#1c1c1c");
    expect(ansi256Hex(255)).toBe("#eeeeee");
    expect(ansi256Hex(102)).toBe("#878787");
    expect(ansi256Hex(48)).toBe("#00ff87");
    expect(ansi256Hex(41)).toBe("#00d75f");
    expect(ansi256Hex(22)).toBe("#005f00");
    expect(ansi256Hex(215)).toBe("#ffaf5f");
    expect(ansi256Hex(203)).toBe("#ff5f5f");
    expect(dark256.brand).toBe("#00FF87");
  });

  it("chooses the colour mode from SHELRA_THEME, then the terminal", () => {
    expect(colorModeFrom({})).toBe("truecolor");
    expect(colorModeFrom({ SHELRA_THEME: "256" })).toBe("256");
    expect(colorModeFrom({ SHELRA_THEME: "truecolor", TERM_PROGRAM: "Apple_Terminal" })).toBe("truecolor");
    expect(colorModeFrom({ TERM_PROGRAM: "Apple_Terminal" })).toBe("256");
    expect(resolveTheme({})).toBe(dark);
    expect(resolveTheme({ SHELRA_THEME: "256" })).toBe(dark256);
  });

  it("honours the explicit reduced-motion preference and the terminal-safe environment override", () => {
    expect(reducedMotionEnabled("reduced", {})).toBe(true);
    expect(reducedMotionEnabled("full", { SHELRA_REDUCED_MOTION: "1" })).toBe(true);
    expect(reducedMotionEnabled("full", {})).toBe(false);
  });
});
