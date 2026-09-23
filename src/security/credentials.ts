import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getProductUserDir } from "../product/identity";

/** The ShelraCode account this machine is connected to (`shelra login`); see src/account/. */
export interface StoredAccount {
  /** The account service that issued the token; every later call goes there, whatever the environment says. */
  apiUrl: string;
  token: string;
  tokenId: string;
  email: string | null;
}

/** A free provider's credentials (`shelra auth groq|gemini|cloudflare`); see src/providers/free-providers.ts. */
export interface ProviderCredential {
  apiKey: string;
  /** Cloudflare's endpoint names the account. */
  accountId?: string;
}

interface AuthFile {
  openrouter?: { apiKey?: string };
  account?: StoredAccount;
  providers?: Record<string, ProviderCredential>;
}

function authPath(): string {
  return join(getProductUserDir(), "auth.json");
}

function readAuth(): AuthFile {
  try {
    return JSON.parse(readFileSync(authPath(), "utf8")) as AuthFile;
  } catch {
    return {};
  }
}

/** Replaces the file atomically, with a restrictive file mode. */
function writeAuth(auth: AuthFile): void {
  const dir = getProductUserDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = authPath();
  const temporary = `${path}.tmp-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(auth, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows ACLs do not implement POSIX modes; the file was still created privately by the user.
  }
}

/** Reads a provider key without ever returning it in diagnostics or error text. */
export function getStoredOpenRouterApiKey(): string | undefined {
  const key = readAuth().openrouter?.apiKey;
  return typeof key === "string" && key.trim() ? key.trim() : undefined;
}

/** Stores credentials separately from user settings, with a restrictive file mode. */
export function saveOpenRouterApiKey(apiKey: string): void {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("OpenRouter API key cannot be empty.");
  writeAuth({ ...readAuth(), openrouter: { apiKey: trimmed } });
}

export function clearOpenRouterApiKey(): void {
  const auth = readAuth();
  if (!auth.openrouter) return;
  delete auth.openrouter;
  writeAuth(auth);
}

/** A stored provider credential, without ever returning it in diagnostics or error text. */
export function getStoredProviderCredential(providerId: string): ProviderCredential | undefined {
  const credential = readAuth().providers?.[providerId];
  const apiKey = typeof credential?.apiKey === "string" ? credential.apiKey.trim() : "";
  if (!apiKey) return undefined;
  const accountId = typeof credential?.accountId === "string" ? credential.accountId.trim() : "";
  return { apiKey, ...(accountId ? { accountId } : {}) };
}

export function saveProviderCredential(providerId: string, credential: ProviderCredential): void {
  const apiKey = credential.apiKey.trim();
  if (!apiKey) throw new Error("The API key cannot be empty.");
  const accountId = credential.accountId?.trim();
  const auth = readAuth();
  writeAuth({
    ...auth,
    providers: { ...(auth.providers ?? {}), [providerId]: { apiKey, ...(accountId ? { accountId } : {}) } },
  });
}

export function clearProviderCredential(providerId: string): void {
  const auth = readAuth();
  if (!auth.providers?.[providerId]) return;
  delete auth.providers[providerId];
  writeAuth(auth);
}

export function getStoredAccount(): StoredAccount | undefined {
  const account = readAuth().account;
  const complete =
    typeof account?.apiUrl === "string" && typeof account.token === "string" && typeof account.tokenId === "string";
  return complete ? account : undefined;
}

export function saveAccount(account: StoredAccount): void {
  writeAuth({ ...readAuth(), account });
}

export function clearAccount(): void {
  const auth = readAuth();
  if (!auth.account) return;
  delete auth.account;
  writeAuth(auth);
}

export function hasStoredCredentials(): boolean {
  return existsSync(authPath());
}
