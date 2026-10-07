import { parseModelPolicy } from "../models/routing";
import { loadUserSettings, saveUserSettings, type UserSettings } from "../utils/settings";

/*
 * The defaults a person sets in the first-run setup and in `/config`, saved in the user settings
 * (~/.shelra/user-settings.json) the way Claude Code's `/config` saves to its user settings: every change is written at
 * once, and a project that fixes its own model (`.shelra/settings.json`) still wins in that project.
 *
 * - mode: the model mode a session starts in (the saved `modelMode`; `--model-policy` overrides it for one run)
 * - provider: where Mixed mode starts when no model was picked. Free mode is automatic and never reads it.
 * - model: the model Mixed mode starts on, as `provider/model`
 */
export type DefaultMode = "free" | "mixed";

export interface Defaults {
  mode: DefaultMode;
  provider?: string;
  model?: string;
}

export function loadDefaults(settings: UserSettings = loadUserSettings()): Defaults {
  const mode: DefaultMode = parseModelPolicy(settings.modelMode) === "mixed" ? "mixed" : "free";
  return {
    mode,
    ...(settings.defaultProvider ? { provider: settings.defaultProvider } : {}),
    ...(settings.defaultModel ? { model: settings.defaultModel } : {}),
  };
}

export function saveDefaultMode(mode: DefaultMode): void {
  saveUserSettings({ modelMode: mode });
}

export function saveDefaultProvider(providerId: string | undefined): void {
  saveUserSettings({ defaultProvider: providerId });
}

export function saveDefaultModel(modelId: string | undefined): void {
  saveUserSettings({ defaultModel: modelId });
}

/**
 * Whether the first-run setup should run. It runs once, for a person at the keyboard: not for a headless run, and
 * not for someone who already had Shelra set up before the setup existed (a provider, a saved mode or a saved model),
 * who would only be asked what they have already answered. After `/logout` it runs again whatever is set up.
 */
export function needsOnboarding(input: {
  settings: UserSettings;
  hasProvider: boolean;
  interactive: boolean;
}): boolean {
  if (!input.interactive || input.settings.onboarded) return false;
  if (input.settings.onboarded === false) return true;
  const configuredBefore =
    input.hasProvider || input.settings.modelMode !== undefined || input.settings.defaultModel !== undefined;
  return !configuredBefore;
}

export function markOnboarded(): void {
  saveUserSettings({ onboarded: true });
}

/** `/logout` runs the setup again at the next start. */
export function resetOnboarding(): void {
  saveUserSettings({ onboarded: false });
}
