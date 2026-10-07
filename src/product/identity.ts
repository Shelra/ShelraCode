import os from "os";
import path from "path";

export const PRODUCT_NAME = "ShelraCode";
export const CLI_NAME = "shelra";
export const CONFIG_DIR_NAME = ".shelra";
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
/**
 * The ShelraCode account (owner, 2026-10-06: the account is required to use Shelra). The CLI signs in at the website
 * and talks to the API; both are fixed here, never read from the environment, because a project's `.env` must not be
 * able to send a person's sign-in somewhere else. `shelra login --api-url/--web-url` stores another pair, for
 * development, with the token it obtains.
 */
export const ACCOUNT_API_URL = "https://api.shelra.dev";
export const ACCOUNT_WEB_URL = "https://www.shelra.dev";
/**
 * The OmniRoute gateway Shelra's users reach, ending in `/v1` (owner, 2026-10-07: every provider asks for its key
 * alone and points at production). OmniRoute is self-hosted software, and its authors' hosted gateway is Cheaper
 * Inference, whose documented production API is this one (keys start with `ci_live_`, paid from a wallet, so Free mode
 * never uses it: https://www.cheaperinference.com/docs). A person who runs their own OmniRoute overrides it with
 * `OMNIROUTE_BASE_URL` or `shelra auth omniroute --url`.
 */
export const OMNIROUTE_PRODUCTION_URL = "https://api.cheaperinference.com/v1";
/** A token made on the website for a script or CI, used instead of a stored login. */
export const ACCOUNT_TOKEN_ENV = "SHELRA_TOKEN";

export function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/** Canonical per-user state directory. New state is always written here. */
export function getProductUserDir(homeDir = getHomeDir()): string {
  return path.join(homeDir, CONFIG_DIR_NAME);
}
