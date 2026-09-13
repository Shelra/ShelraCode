import type { StartupState } from "../startup/types";

export type StartupAction = "install" | "retry" | "exit";

export interface StartupKeyInput {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
}

function isEnterKey(key: StartupKeyInput): boolean {
  const name = key.name?.toLowerCase();
  return name === "return" || name === "enter" || key.sequence === "\r" || key.sequence === "\n";
}

function isRetryKey(key: StartupKeyInput): boolean {
  return key.name?.toLowerCase() === "r" || key.sequence?.toLowerCase() === "r";
}

/** Keep startup input policy independent from OpenTUI for deterministic tests. */
export function resolveStartupKeyAction(
  key: StartupKeyInput,
  state: StartupState,
  canInstall: boolean,
): StartupAction | undefined {
  if (key.name === "escape" || (key.name === "c" && key.ctrl)) return "exit";

  const actionable = state === "onboarding" || state === "recoverable-error";
  if (!actionable) return undefined;

  if (isEnterKey(key) && state === "onboarding" && canInstall) return "install";
  if (isRetryKey(key)) return "retry";
  return undefined;
}
