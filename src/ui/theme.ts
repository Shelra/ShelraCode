/** User-controlled appearance. `system` follows OpenTUI's terminal scheme signal. */
export type ThemePreference = "system" | "dark" | "light";
export type MotionPreference = "full" | "reduced";
export type TerminalThemeMode = "dark" | "light" | null | undefined;

/**
 * Semantic presentation contract for Shelra's terminal UI. Terminal renderers
 * own the font, radius, shadows, and gradients; components consume these roles
 * rather than smuggling palette values into their layout code.
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
  /** Non-semantic mode label; violet appears only in this compact context. */
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
  aurora: {
    green: string;
    cyan: string;
    violet: string;
    durationMs: number;
    frames: number;
  };
}

export const dark: Theme = {
  background: "#090B0A",
  surface: "#101312",
  surfaceRaised: "#161A18",
  surfaceMuted: "#0D100F",
  backgroundPanel: "#101312",
  backgroundElement: "#161A18",
  overlay: "#000000CC",
  border: "#252B28",
  borderStrong: "#56625B",
  borderActive: "#28E59A",
  composerFocusBorder: "#28E59A",
  text: "#F2F5F3",
  textSecondary: "#A8B2AC",
  textMuted: "#7C8780",
  textDim: "#59635E",
  primary: "#F2F5F3",
  brand: "#28E59A",
  brandHover: "#20CC88",
  brandSoft: "#123B2A",
  accent: "#28E59A",
  success: "#3ABF81",
  warning: "#F0B35A",
  danger: "#F07178",
  info: "#67A7FF",
  modePlan: "#A99BFF",
  subagentAccent: "#00CFE8",
  selected: "#F2F5F3",
  selectedBg: "#123B2A",
  disabled: "#7C8780",
  diffAdded: "#123526",
  diffAddedFg: "#A5E8C6",
  diffAddedLineNum: "#3A8B63",
  diffRemoved: "#3A2024",
  diffRemovedFg: "#FFB7BD",
  diffRemovedLineNum: "#B95862",
  diffContext: "#161A18",
  diffContextFg: "#A8B2AC",
  diffLineNumber: "#7C8780",
  diffHeader: "#101312",
  diffHeaderFg: "#A8B2AC",
  diffSeparator: "#0D100F",
  diffSeparatorFg: "#59635E",
  mdHeading: "#F2F5F3",
  mdBold: "#F0B35A",
  mdItalic: "#A8B2AC",
  mdCode: "#7EE7B4",
  mdCodeBlockBg: "#0D100F",
  mdCodeBlockFg: "#DDE5E0",
  mdLink: "#67A7FF",
  mdLinkText: "#B7D2FF",
  mdHr: "#252B28",
  mdListBullet: "#7C8780",
  planBorder: "#67A7FF",
  planTitle: "#F2F5F3",
  planStepNum: "#67A7FF",
  planStepTitle: "#F2F5F3",
  planStepDesc: "#A8B2AC",
  planStepFile: "#67A7FF",
  planQuestionText: "#F2F5F3",
  planOptionDefault: "#A8B2AC",
  planOptionSelected: "#28E59A",
  planOptionCheck: "#3ABF81",
  planInputBg: "#161A18",
  planInputText: "#F2F5F3",
  planHint: "#7C8780",
  queueBg: "#0D100F",
  aurora: {
    green: "#28E59A",
    cyan: "#00CFE8",
    violet: "#7967FF",
    durationMs: 16_000,
    frames: 32,
  },
};

export const light: Theme = {
  background: "#F7F9F8",
  surface: "#FFFFFF",
  surfaceRaised: "#F1F4F2",
  surfaceMuted: "#E9EEEB",
  backgroundPanel: "#FFFFFF",
  backgroundElement: "#F1F4F2",
  overlay: "#11141266",
  border: "#DFE5E1",
  borderStrong: "#858F89",
  borderActive: "#087D4C",
  composerFocusBorder: "#087D4C",
  text: "#111412",
  textSecondary: "#56615B",
  textMuted: "#68736C",
  textDim: "#7D8881",
  primary: "#111412",
  brand: "#087D4C",
  brandHover: "#066B40",
  brandSoft: "#DDF9EE",
  accent: "#087D4C",
  success: "#167C5B",
  warning: "#8B5700",
  danger: "#C1333D",
  info: "#246BDB",
  modePlan: "#5E4EDB",
  subagentAccent: "#087E8F",
  selected: "#111412",
  selectedBg: "#DDF9EE",
  disabled: "#68736C",
  diffAdded: "#E6F6EC",
  diffAddedFg: "#146543",
  diffAddedLineNum: "#3C936C",
  diffRemoved: "#FBEAEC",
  diffRemovedFg: "#A22D38",
  diffRemovedLineNum: "#C55B63",
  diffContext: "#F1F4F2",
  diffContextFg: "#56615B",
  diffLineNumber: "#68736C",
  diffHeader: "#FFFFFF",
  diffHeaderFg: "#56615B",
  diffSeparator: "#E9EEEB",
  diffSeparatorFg: "#7D8881",
  mdHeading: "#111412",
  mdBold: "#8B5700",
  mdItalic: "#56615B",
  mdCode: "#087D4C",
  mdCodeBlockBg: "#F1F4F2",
  mdCodeBlockFg: "#26302B",
  mdLink: "#246BDB",
  mdLinkText: "#1D55AE",
  mdHr: "#DFE5E1",
  mdListBullet: "#68736C",
  planBorder: "#246BDB",
  planTitle: "#111412",
  planStepNum: "#246BDB",
  planStepTitle: "#111412",
  planStepDesc: "#56615B",
  planStepFile: "#246BDB",
  planQuestionText: "#111412",
  planOptionDefault: "#56615B",
  planOptionSelected: "#087D4C",
  planOptionCheck: "#167C5B",
  planInputBg: "#F1F4F2",
  planInputText: "#111412",
  planHint: "#68736C",
  queueBg: "#E9EEEB",
  aurora: {
    green: "#087D4C",
    cyan: "#087E8F",
    violet: "#5E4EDB",
    durationMs: 16_000,
    frames: 32,
  },
};

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
