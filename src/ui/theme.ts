/** User-controlled appearance. `system` follows OpenTUI's terminal scheme signal. */
export type ThemePreference = "system" | "dark" | "light";
export type MotionPreference = "full" | "reduced";
export type TerminalThemeMode = "dark" | "light" | null | undefined;

/**
 * Semantic presentation contract for Shelra's terminal UI. Every value is a flat
 * colour: Shelra draws no gradients, glows or fades. The terminal owns the font;
 * components consume these roles rather than smuggling palette values into layout code.
 *
 * The dark palette is the Shelra web palette: near-black `#080808`, surfaces `#111111` and
 * `#1A1A1A`, text `#F0F0F0` and `#888888`, one neon accent `#00FF88` (`#00CF6E` pressed).
 * The web fonts are Geist Mono (headings), Inter (body) and JetBrains Mono (labels); a
 * terminal cannot load fonts, so the same hierarchy is carried by weight, case and colour.
 */
export interface Theme {
  background: string;
  /** Standard application surface: composer shell, picker, and sidebar. */
  surface: string;
  /** Raised/selected technical surface. */
  surfaceRaised: string;
  /** Quiet, disabled, or queue surface. */
  surfaceMuted: string;
  backgroundPanel: string;
  backgroundElement: string;
  overlay: string;
  border: string;
  borderStrong: string;
  borderActive: string;
  composerFocusBorder: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textDim: string;
  /** Existing neutral heading/control alias; use `brand` for interaction. */
  primary: string;
  brand: string;
  brandHover: string;
  brandSoft: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  /** Mode label for Plan; amber, so it never reads as brand or as a link. */
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

export const dark: Theme = {
  background: "#080808",
  surface: "#111111",
  surfaceRaised: "#1A1A1A",
  surfaceMuted: "#0C0C0C",
  backgroundPanel: "#111111",
  backgroundElement: "#1A1A1A",
  overlay: "#000000CC",
  border: "#222222",
  borderStrong: "#444444",
  borderActive: "#00FF88",
  composerFocusBorder: "#00FF88",
  text: "#F0F0F0",
  textSecondary: "#B8B8B8",
  textMuted: "#888888",
  textDim: "#5E5E5E",
  primary: "#F0F0F0",
  brand: "#00FF88",
  brandHover: "#00CF6E",
  brandSoft: "#07301C",
  accent: "#00FF88",
  success: "#00CF6E",
  warning: "#FFB84D",
  danger: "#FF5C6C",
  info: "#5CB8FF",
  modePlan: "#FFB84D",
  subagentAccent: "#8AC7FF",
  selected: "#F0F0F0",
  selectedBg: "#07301C",
  disabled: "#6B6B6B",
  diffAdded: "#0B2E1D",
  diffAddedFg: "#8CFFC4",
  diffAddedLineNum: "#00A85A",
  diffRemoved: "#33161B",
  diffRemovedFg: "#FF9AA4",
  diffRemovedLineNum: "#B04A57",
  diffContext: "#141414",
  diffContextFg: "#B8B8B8",
  diffLineNumber: "#6B6B6B",
  diffHeader: "#111111",
  diffHeaderFg: "#B8B8B8",
  diffSeparator: "#0C0C0C",
  diffSeparatorFg: "#5E5E5E",
  mdHeading: "#F0F0F0",
  mdBold: "#FFFFFF",
  mdItalic: "#B8B8B8",
  mdCode: "#8CFFC4",
  mdCodeBlockBg: "#141414",
  mdCodeBlockFg: "#E0E0E0",
  mdLink: "#5CB8FF",
  mdLinkText: "#A6D8FF",
  mdHr: "#222222",
  mdListBullet: "#888888",
  planBorder: "#00FF88",
  planTitle: "#F0F0F0",
  planStepNum: "#00FF88",
  planStepTitle: "#F0F0F0",
  planStepDesc: "#B8B8B8",
  planStepFile: "#5CB8FF",
  planQuestionText: "#F0F0F0",
  planOptionDefault: "#B8B8B8",
  planOptionSelected: "#00FF88",
  planOptionCheck: "#00CF6E",
  planInputBg: "#1A1A1A",
  planInputText: "#F0F0F0",
  planHint: "#888888",
  queueBg: "#0C0C0C",
};

/** The web palette is dark-only; the light theme keeps its neutrals and swaps the neon for a readable green. */
export const light: Theme = {
  background: "#F0F0F0",
  surface: "#FFFFFF",
  surfaceRaised: "#E6E6E6",
  surfaceMuted: "#DCDCDC",
  backgroundPanel: "#FFFFFF",
  backgroundElement: "#E6E6E6",
  overlay: "#08080866",
  border: "#D4D4D4",
  borderStrong: "#8A8A8A",
  borderActive: "#007A40",
  composerFocusBorder: "#007A40",
  text: "#080808",
  textSecondary: "#3E3E3E",
  textMuted: "#5C5C5C",
  textDim: "#767676",
  primary: "#080808",
  brand: "#007A40",
  brandHover: "#006633",
  brandSoft: "#CFF7E1",
  accent: "#007A40",
  success: "#087A47",
  warning: "#8A5A00",
  danger: "#C42B3A",
  info: "#0B62C4",
  modePlan: "#8A5A00",
  subagentAccent: "#0B62C4",
  selected: "#080808",
  selectedBg: "#CFF7E1",
  disabled: "#767676",
  diffAdded: "#DDF7E8",
  diffAddedFg: "#0B5A34",
  diffAddedLineNum: "#2E9A62",
  diffRemoved: "#FBE3E6",
  diffRemovedFg: "#A01F2D",
  diffRemovedLineNum: "#C55B63",
  diffContext: "#E6E6E6",
  diffContextFg: "#3E3E3E",
  diffLineNumber: "#5C5C5C",
  diffHeader: "#FFFFFF",
  diffHeaderFg: "#3E3E3E",
  diffSeparator: "#DCDCDC",
  diffSeparatorFg: "#767676",
  mdHeading: "#080808",
  mdBold: "#080808",
  mdItalic: "#3E3E3E",
  mdCode: "#007A40",
  mdCodeBlockBg: "#E6E6E6",
  mdCodeBlockFg: "#1F1F1F",
  mdLink: "#0B62C4",
  mdLinkText: "#0A4F9E",
  mdHr: "#D4D4D4",
  mdListBullet: "#5C5C5C",
  planBorder: "#007A40",
  planTitle: "#080808",
  planStepNum: "#007A40",
  planStepTitle: "#080808",
  planStepDesc: "#3E3E3E",
  planStepFile: "#0B62C4",
  planQuestionText: "#080808",
  planOptionDefault: "#3E3E3E",
  planOptionSelected: "#007A40",
  planOptionCheck: "#087A47",
  planInputBg: "#E6E6E6",
  planInputText: "#080808",
  planHint: "#5C5C5C",
  queueBg: "#DCDCDC",
};

/** Flat scrollbar: a quiet thumb on the page colour, so a long list never draws a heavy bar. */
export function scrollbarStyle(t: Theme) {
  return { trackOptions: { foregroundColor: t.borderStrong, backgroundColor: t.background } };
}

export function resolveTheme(preference: ThemePreference, systemTheme: TerminalThemeMode = null): Theme {
  if (preference === "light") return light;
  if (preference === "dark") return dark;
  return systemTheme === "light" ? light : dark;
}

export function reducedMotionEnabled(
  preference: MotionPreference,
  environment: Record<string, string | undefined>,
): boolean {
  return preference === "reduced" || environment.SHELRA_REDUCED_MOTION === "1";
}
