import os from "os";
import path from "path";

export const PRODUCT_NAME = "ShelraCode";
export const CLI_NAME = "shelra";
export const CONFIG_DIR_NAME = ".shelra";
export const LEGACY_CONFIG_DIR_NAME = ".grok";
export const MIGRATION_MARKER_NAME = "migration.json";
export const API_KEY_ENV = "SHELRA_API_KEY";
export const BASE_URL_ENV = "SHELRA_BASE_URL";
export const OPENROUTER_API_KEY_ENV = "OPENROUTER_API_KEY";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const MAX_SESSION_COST_ENV = "SHELRA_MAX_SESSION_COST_USD";
export const MAX_REQUEST_COST_ENV = "SHELRA_MAX_REQUEST_COST_USD";
export const MODEL_ENV = "SHELRA_MODEL";
export const MAX_TOKENS_ENV = "SHELRA_MAX_TOKENS";
export const BACKGROUND_CHILD_ENV = "SHELRA_BACKGROUND_CHILD";
export const HOOK_EVENT_ENV = "SHELRA_HOOK_EVENT";

export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/** Canonical per-user state directory. New state is always written here. */
export function getProductUserDir(homeDir = getHomeDir()): string {
  return path.join(homeDir, CONFIG_DIR_NAME);
}

/** Legacy directory used only for one-way compatibility reads/migration. */
export function getLegacyUserDir(homeDir = getHomeDir()): string {
  return path.join(homeDir, LEGACY_CONFIG_DIR_NAME);
}
