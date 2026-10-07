import { ACCOUNT_API_URL, ACCOUNT_TOKEN_ENV } from "../product/identity";
import { getStoredAccount, type StoredAccount, saveAccount } from "../security/credentials";
import { AccountError, getMe } from "./client";

/*
 * Whether this machine may use Shelra: the account is required (owner, 2026-10-06), and the check is built so a
 * missing network never ends a session (the resilience rule in AGENTS.md).
 *
 * - A stored login is confirmed with the service at most once a day. In between, and whenever the service cannot be
 *   reached, the last confirmation stands for seven days offline; after that the person must sign in again.
 * - Only the service saying the token is invalid (revoked, expired) blocks at once: nothing else can.
 * - A token from SHELRA_TOKEN (made on the website for a script or CI) is checked on every start; when the service
 *   cannot be reached, it is let through, because a script has nowhere to keep a confirmation.
 * - The login's own expiry date is read locally, so an expired login never waits for the network to be refused.
 *
 * This is a product gate, not a lock: the client is open source and runs on the person's machine.
 */
export const VERIFY_INTERVAL_MS = 24 * 60 * 60_000;
export const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60_000;
/** The notice appears this many days before the login ends. */
export const EXPIRY_WARNING_DAYS = 3;
/** Start-up must not wait long on the network. */
const CHECK_TIMEOUT_MS = 4_000;

export type AccountStatus =
  | {
      state: "ok";
      email: string | null;
      name: string | null;
      source: "stored" | "env";
      /** True when the service could not be reached and the last confirmation (or the token alone) was trusted. */
      offline: boolean;
      expiresAt: string | null;
      /** Whole days left, set only when the login ends within the warning window. */
      expiresInDays: number | null;
    }
  | { state: "signed-out" }
  | { state: "invalid"; reason: string }
  | { state: "offline-too-long"; since: string };

export type SessionDeps = {
  env?: Record<string, string | undefined>;
  now?: () => number;
  fetchImpl?: typeof fetch;
  read?: () => StoredAccount | undefined;
  write?: (account: StoredAccount) => void;
};

function daysLeft(expiresAt: string | null | undefined, now: number): number | null {
  if (!expiresAt) return null;
  const days = Math.ceil((Date.parse(expiresAt) - now) / 86_400_000);
  return days <= EXPIRY_WARNING_DAYS ? Math.max(0, days) : null;
}

function isUnreachable(error: unknown): boolean {
  // No status means the request never got an answer; 5xx and 429 are the service being unwell, not a verdict.
  return error instanceof AccountError && (error.status === undefined || error.status >= 500 || error.status === 429);
}

export async function checkAccount(deps: SessionDeps = {}): Promise<AccountStatus> {
  const env = deps.env ?? process.env;
  const now = (deps.now ?? Date.now)();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const read = deps.read ?? getStoredAccount;
  const write = deps.write ?? saveAccount;
  const stored = read();

  const fromEnv = env[ACCOUNT_TOKEN_ENV]?.trim();
  if (fromEnv) {
    const apiUrl = stored?.apiUrl ?? ACCOUNT_API_URL;
    try {
      const { account, credential } = await getMe(apiUrl, fromEnv, fetchImpl, CHECK_TIMEOUT_MS);
      const expiresAt = credential.type === "token" ? (credential.expiresAt ?? null) : null;
      return {
        state: "ok",
        email: account.email,
        name: account.name,
        source: "env",
        offline: false,
        expiresAt,
        expiresInDays: daysLeft(expiresAt, now),
      };
    } catch (error) {
      if (isUnreachable(error)) {
        return {
          state: "ok",
          email: null,
          name: null,
          source: "env",
          offline: true,
          expiresAt: null,
          expiresInDays: null,
        };
      }
      return { state: "invalid", reason: error instanceof Error ? error.message : String(error) };
    }
  }

  if (!stored) return { state: "signed-out" };
  if (stored.expiresAt && Date.parse(stored.expiresAt) <= now) {
    return { state: "invalid", reason: "This machine's login has expired." };
  }
  const ok = (offline: boolean, account: StoredAccount): AccountStatus => ({
    state: "ok",
    email: account.email,
    name: account.name ?? null,
    source: "stored",
    offline,
    expiresAt: account.expiresAt ?? null,
    expiresInDays: daysLeft(account.expiresAt, now),
  });

  const verifiedAt = stored.verifiedAt ? Date.parse(stored.verifiedAt) : Number.NaN;
  if (Number.isFinite(verifiedAt) && now - verifiedAt < VERIFY_INTERVAL_MS) return ok(false, stored);

  try {
    const { account, credential } = await getMe(stored.apiUrl, stored.token, fetchImpl, CHECK_TIMEOUT_MS);
    const confirmed: StoredAccount = {
      ...stored,
      email: account.email ?? stored.email,
      name: account.name,
      expiresAt: credential.type === "token" ? (credential.expiresAt ?? null) : (stored.expiresAt ?? null),
      verifiedAt: new Date(now).toISOString(),
    };
    try {
      write(confirmed);
    } catch {
      // A read-only home must not lock the person out: the confirmation just is not remembered.
    }
    return ok(false, confirmed);
  } catch (error) {
    if (!isUnreachable(error)) {
      return { state: "invalid", reason: error instanceof Error ? error.message : String(error) };
    }
    // A login made before confirmations were recorded starts its grace now, once.
    const since = Number.isFinite(verifiedAt) ? verifiedAt : now;
    if (!Number.isFinite(verifiedAt)) {
      try {
        write({ ...stored, verifiedAt: new Date(now).toISOString() });
      } catch {
        // See above.
      }
    }
    if (now - since <= OFFLINE_GRACE_MS) return ok(true, stored);
    return { state: "offline-too-long", since: new Date(since).toISOString() };
  }
}

/** The sentence a person reads when `status` is not "ok". */
export function describeBlocked(status: Exclude<AccountStatus, { state: "ok" }>, cliName: string): string {
  switch (status.state) {
    case "signed-out":
      return `Sign in to use ShelraCode: run \`${cliName} login\` (or set SHELRA_TOKEN, made at https://www.shelra.dev/account).`;
    case "invalid":
      return `${status.reason} Sign in again with \`${cliName} login\`.`;
    case "offline-too-long":
      return `ShelraCode could not confirm this login with the service since ${status.since.slice(0, 10)} (more than seven days). Connect to the internet, then run \`${cliName} login\` if it still fails.`;
  }
}
