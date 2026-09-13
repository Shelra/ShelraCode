import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getProductUserDir } from "../product/identity";

interface AuthFile {
  openrouter?: { apiKey?: string };
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

/** Reads a provider key without ever returning it in diagnostics or error text. */
export function getStoredOpenRouterApiKey(): string | undefined {
  const key = readAuth().openrouter?.apiKey;
  return typeof key === "string" && key.trim() ? key.trim() : undefined;
}

/** Stores credentials separately from user settings, with a restrictive file mode. */
export function saveOpenRouterApiKey(apiKey: string): void {
  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error("OpenRouter API key cannot be empty.");
  const dir = getProductUserDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = authPath();
  const temporary = `${path}.tmp-${randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify({ ...readAuth(), openrouter: { apiKey: trimmed } }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows ACLs do not implement POSIX modes; the file was still created privately by the user.
  }
}

export function clearOpenRouterApiKey(): void {
  const auth = readAuth();
  if (!auth.openrouter) return;
  delete auth.openrouter;
  writeFileSync(authPath(), `${JSON.stringify(auth, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function hasStoredCredentials(): boolean {
  return existsSync(authPath());
}
