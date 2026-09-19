import { describe, expect, it } from "vitest";
import { dark, light, reducedMotionEnabled, resolveTheme } from "./theme";

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

describe("Shelra themes", () => {
  it("resolves explicit and system appearance without an inversion fallback", () => {
    expect(resolveTheme("dark", "light")).toBe(dark);
    expect(resolveTheme("light", "dark")).toBe(light);
    expect(resolveTheme("system", "light")).toBe(light);
    expect(resolveTheme("system", null)).toBe(dark);
  });

  it("keeps the interactive brand accent readable in both themes", () => {
    expect(contrast(dark.brand, dark.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(light.brand, light.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps semantic states distinct from the brand role", () => {
    for (const theme of [dark, light]) {
      expect(new Set([theme.brand, theme.success, theme.warning, theme.danger, theme.info]).size).toBe(5);
    }
  });

  it("honours the explicit reduced-motion preference and the terminal-safe environment override", () => {
    expect(reducedMotionEnabled("reduced", {})).toBe(true);
    expect(reducedMotionEnabled("full", { SHELRA_REDUCED_MOTION: "1" })).toBe(true);
    expect(reducedMotionEnabled("full", {})).toBe(false);
  });
});
