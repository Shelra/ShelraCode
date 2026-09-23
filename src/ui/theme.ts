export type MotionPreference = "full" | "reduced";
/** How many colours the terminal can show: exact 24-bit colour, or the xterm 256-colour palette. */
export type ColorMode = "truecolor" | "256";

/**
 * The Shelra palette: the tokens of the approved landing page (`frontend/src/app/globals.css`), each
 * with its xterm-256 fallback. A terminal has no alpha, so the site's alpha tokens are blended on base
 * here. Warning and error are the only colours the site does not have; they colour text and glyphs,
 * never a surface. Nothing else may appear on screen: no gradients, shadows or glows.
 */
export const PALETTE = {
  /** App background, every full-screen surface. */
  base: { hex: "#080808", ansi256: 232 },
  /** Panels, cards, inputs. */
  surface: { hex: "#111111", ansi256: 233 },
  /** Hairlines, dividers, the empty part of a progress bar. */
  border: { hex: "#1A1A1A", ansi256: 234 },
  /** Primary text. */
  default: { hex: "#F0F0F0", ansi256: 255 },
  /** Secondary text, metadata, placeholders. */
  subtle: { hex: "#888888", ansi256: 102 },
  /** Brand green: labels, the active tab, links, success, running. */
  accent: { hex: "#00FF88", ansi256: 48 },
  /** Pressed or active state of the accent. */
  hover: { hex: "#00CF6E", ansi256: 41 },
  /** Text on an accent surface. */
  onLight: { hex: "#080808", ansi256: 232 },
  /** Accent at 16% on base: the cursor row, badge fills. */
  accent16: { hex: "#073020", ansi256: 234 },
  /** Accent at 40% on base: the border of the focused panel. */
  accent40: { hex: "#056B3B", ansi256: 22 },
  /** White at 8% on base: hover on base. */
  white8: { hex: "#1C1C1C", ansi256: 234 },
  warning: { hex: "#FFB454", ansi256: 215 },
  error: { hex: "#FF5C5C", ansi256: 203 },
} as const;

export type PaletteToken = keyof typeof PALETTE;

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const;

/** The colour an xterm-256 index shows, as `#rrggbb`: 16-231 is the 6x6x6 cube, 232-255 the greys. */
export function ansi256Hex(index: number): string {
  const hex = (value: number) => value.toString(16).padStart(2, "0");
  if (index >= 232 && index <= 255) {
    const grey = 8 + (index - 232) * 10;
    return `#${hex(grey)}${hex(grey)}${hex(grey)}`;
  }
  if (index >= 16 && index <= 231) {
    const offset = index - 16;
    const red = CUBE_LEVELS[Math.floor(offset / 36)] ?? 0;
    const green = CUBE_LEVELS[Math.floor((offset % 36) / 6)] ?? 0;
    const blue = CUBE_LEVELS[offset % 6] ?? 0;
    return `#${hex(red)}${hex(green)}${hex(blue)}`;
  }
  throw new Error(`Shelra's palette uses xterm-256 indices 16-255, not ${index}`);
}

/**
 * The palette for a colour mode. In 256-colour mode every token is exactly one of the terminal's own
 * 256 colours, so a terminal that maps 24-bit colour to its palette lands on the intended one.
 */
export function paletteColors(mode: ColorMode): Record<PaletteToken, string> {
  const entries = Object.entries(PALETTE) as Array<[PaletteToken, { hex: string; ansi256: number }]>;
  return Object.fromEntries(
    entries.map(([token, value]) => [token, mode === "256" ? ansi256Hex(value.ansi256).toUpperCase() : value.hex]),
  ) as Record<PaletteToken, string>;
}

/** `SHELRA_THEME=256` or `truecolor` forces a mode; Apple Terminal has no 24-bit colour. */
export function colorModeFrom(environment: Record<string, string | undefined>): ColorMode {
  const forced = environment.SHELRA_THEME?.trim().toLowerCase();
  if (forced === "256") return "256";
  if (forced === "truecolor") return "truecolor";
  return environment.TERM_PROGRAM === "Apple_Terminal" ? "256" : "truecolor";
}

/**
 * Semantic roles for Shelra's terminal UI. Components use roles, never palette values, and every
 * role is one palette token. The terminal owns the font, so the site's type hierarchy is carried by
 * weight, case, brackets and these two text colours.
 */
export interface Theme {
  background: string;
  /** Standard application surface: composer, pickers, panels. */
  surface: string;
  /** Hover on base. */
  surfaceRaised: string;
  surfaceMuted: string;
  backgroundPanel: string;
  backgroundElement: string;
  /** Behind a dialog. Opaque: a terminal cannot dim what is under it. */
  overlay: string;
  border: string;
  borderStrong: string;
  borderActive: string;
  composerFocusBorder: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textDim: string;
  primary: string;
  brand: string;
  brandHover: string;
  brandSoft: string;
  accent: string;
  /** Text on an accent surface: the active tab, a primary action, the chosen item. */
  onAccent: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  modePlan: string;
  subagentAccent: string;
  selected: string;
  selectedBg: string;
  disabled: string;
  diffAdded: string;
  diffAddedFg: string;
  diffAddedLineNum: string;
  diffRemoved: string;
  diffRemovedFg: string;
  diffRemovedLineNum: string;
  diffContext: string;
  diffContextFg: string;
  diffLineNumber: string;
  diffHeader: string;
  diffHeaderFg: string;
  diffSeparator: string;
  diffSeparatorFg: string;
  mdHeading: string;
  mdBold: string;
  mdItalic: string;
  mdCode: string;
  mdCodeBlockBg: string;
  mdCodeBlockFg: string;
  mdLink: string;
  mdLinkText: string;
  mdHr: string;
  mdListBullet: string;
  planBorder: string;
  planTitle: string;
  planStepNum: string;
  planStepTitle: string;
  planStepDesc: string;
  planStepFile: string;
  planQuestionText: string;
  planOptionDefault: string;
  planOptionSelected: string;
  planOptionCheck: string;
  planInputBg: string;
  planInputText: string;
  planHint: string;
  queueBg: string;
}

function themeFrom(p: Record<PaletteToken, string>): Theme {
  return {
    background: p.base,
    surface: p.surface,
    surfaceRaised: p.white8,
    surfaceMuted: p.base,
    backgroundPanel: p.surface,
    backgroundElement: p.surface,
    overlay: p.base,
    border: p.border,
    borderStrong: p.border,
    borderActive: p.accent40,
    composerFocusBorder: p.accent40,
    text: p.default,
    textSecondary: p.subtle,
    textMuted: p.subtle,
    textDim: p.subtle,
    primary: p.default,
    brand: p.accent,
    brandHover: p.hover,
    brandSoft: p.accent16,
    accent: p.accent,
    onAccent: p.onLight,
    success: p.accent,
    warning: p.warning,
    danger: p.error,
    info: p.default,
    modePlan: p.accent,
    subagentAccent: p.accent,
    selected: p.default,
    selectedBg: p.accent16,
    disabled: p.subtle,
    // Diffs: no tinted rows; added text in accent, removed text in the error colour.
    diffAdded: p.base,
    diffAddedFg: p.accent,
    diffAddedLineNum: p.subtle,
    diffRemoved: p.base,
    diffRemovedFg: p.error,
    diffRemovedLineNum: p.subtle,
    diffContext: p.base,
    diffContextFg: p.subtle,
    diffLineNumber: p.subtle,
    diffHeader: p.surface,
    diffHeaderFg: p.default,
    diffSeparator: p.base,
    diffSeparatorFg: p.subtle,
    mdHeading: p.default,
    mdBold: p.default,
    mdItalic: p.subtle,
    mdCode: p.accent,
    mdCodeBlockBg: p.surface,
    mdCodeBlockFg: p.default,
    mdLink: p.accent,
    mdLinkText: p.accent,
    mdHr: p.border,
    mdListBullet: p.subtle,
    planBorder: p.border,
    planTitle: p.default,
    planStepNum: p.accent,
    planStepTitle: p.default,
    planStepDesc: p.subtle,
    planStepFile: p.accent,
    planQuestionText: p.default,
    planOptionDefault: p.default,
    planOptionSelected: p.accent,
    planOptionCheck: p.accent,
    planInputBg: p.surface,
    planInputText: p.default,
    planHint: p.subtle,
    queueBg: p.surface,
  };
}

/** The Shelra theme in 24-bit colour. */
export const dark: Theme = themeFrom(paletteColors("truecolor"));
/** The same roles on the xterm 256-colour palette. */
export const dark256: Theme = themeFrom(paletteColors("256"));

/** Flat scrollbar: a hairline thumb on the page colour. */
export function scrollbarStyle(t: Theme) {
  return { trackOptions: { foregroundColor: t.textMuted, backgroundColor: t.background } };
}

/**
 * The theme to draw with. There is one, dark like the approved web design: the terminal's own scheme is
 * never used for brand surfaces, so a light terminal still gets the dark palette.
 */
export function resolveTheme(environment: Record<string, string | undefined> = process.env): Theme {
  return colorModeFrom(environment) === "256" ? dark256 : dark;
}

export function reducedMotionEnabled(
  preference: MotionPreference,
  environment: Record<string, string | undefined>,
): boolean {
  return preference === "reduced" || environment.SHELRA_REDUCED_MOTION === "1";
}
