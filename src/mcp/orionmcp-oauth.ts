import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import {
  auth,
  type OAuthClientInformation,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
} from "@ai-sdk/mcp";
import { orionMcpHttpServer } from "./orionmcp";

interface Credentials {
  endpoint: string;
  redirect: string;
  client?: OAuthClientInformation;
  tokens?: OAuthTokens;
  verifier?: string;
}
/** Only ORIONMCP credentials are read. DPAPI binds ciphertext to this Windows user. */
function dpapi(input: string, protect: boolean): string {
  if (process.platform !== "win32") throw new Error("ORIONMCP OAuth credential storage currently requires Windows.");
  const script = `Add-Type -AssemblyName System.Security; $raw = [Convert]::FromBase64String([Console]::In.ReadToEnd()); $out = [Security.Cryptography.ProtectedData]::${protect ? "Protect" : "Unprotect"}($raw, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($out))`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    input,
    encoding: "utf8",
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 1_048_576,
  });
  if (result.status !== 0 || result.error)
    throw new Error("Windows could not access the protected ORIONMCP credentials. Sign in again.");
  return result.stdout.trim();
}
export class OrionOAuthProvider implements OAuthClientProvider {
  private record: Credentials;
  private file: string;
  private csrf = randomBytes(32).toString("hex");
  constructor(
    readonly endpoint: string,
    private redirect?: (url: URL) => Promise<void>,
    root = path.join(os.homedir(), ".shelra", "orionmcp-auth"),
  ) {
    orionMcpHttpServer(endpoint);
    this.file = path.join(root, `${createHash("sha256").update(endpoint).digest("hex")}.bin`);
    this.record = existsSync(this.file)
      ? (JSON.parse(
          Buffer.from(dpapi(readFileSync(this.file, "utf8"), false), "base64").toString("utf8"),
        ) as Credentials)
      : { endpoint, redirect: "http://127.0.0.1:49931/orionmcp/callback" };
    if (this.record.endpoint !== endpoint) throw new Error("ORIONMCP credential endpoint mismatch.");
  }
  private save() {
    const encrypted = dpapi(Buffer.from(JSON.stringify(this.record)).toString("base64"), true);
    mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.tmp-${randomBytes(8).toString("hex")}`;
    writeFileSync(temporary, encrypted, { mode: 0o600, flag: "wx" });
    renameSync(temporary, this.file);
  }
  get redirectUrl() {
    return this.record.redirect;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.record.redirect],
      client_name: "Shelra — ORIONMCP",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "revit",
    };
  }
  clientInformation() {
    return this.record.client;
  }
  saveClientInformation(client: OAuthClientInformation) {
    this.record.client = client;
    this.save();
  }
  tokens() {
    return this.record.tokens;
  }
  saveTokens(tokens: OAuthTokens) {
    this.record.tokens = tokens;
    this.save();
  }
  state() {
    return this.csrf;
  }
  saveCodeVerifier(verifier: string) {
    this.record.verifier = verifier;
    this.save();
  }
  codeVerifier() {
    if (!this.record.verifier) throw new Error("ORIONMCP login expired. Sign in again.");
    return this.record.verifier;
  }
  async redirectToAuthorization(url: URL) {
    if (!this.redirect) throw new Error("ORIONMCP authentication required. Run shelra mcp orionmcp login.");
    await this.redirect(url);
  }
  async validateResourceURL(server: string | URL, resource?: string) {
    if (String(server) !== this.endpoint || (resource && resource !== this.endpoint))
      throw new Error("ORIONMCP OAuth resource mismatch.");
    return new URL(this.endpoint);
  }
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier") {
    if (scope === "all") {
      rmSync(this.file, { force: true });
      this.record = { endpoint: this.endpoint, redirect: this.record.redirect };
    } else {
      if (scope === "client") delete this.record.client;
      if (scope === "tokens") delete this.record.tokens;
      if (scope === "verifier") delete this.record.verifier;
      this.save();
    }
  }
  async login() {
    if (!this.redirect) throw new Error("Interactive login is required.");
    // Fixed, registered loopback redirect. Occupied ports fail clearly instead of intercepting another session.
    let finish: (code: string) => void, fail: (error: Error) => void;
    const callback = new Promise<string>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const listener = createServer((req, res) => {
      const url = new URL(req.url ?? "/", this.redirectUrl);
      if (
        req.method !== "GET" ||
        url.pathname !== "/orionmcp/callback" ||
        url.searchParams.get("state") !== this.csrf ||
        req.headers.host !== "127.0.0.1:49931"
      ) {
        res.writeHead(400);
        res.end("Invalid OAuth callback.");
        return;
      }
      const code = url.searchParams.get("code");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      if (url.searchParams.has("error") || !code) {
        res.writeHead(403);
        res.end("Connection denied. Return to Shelra.");
        fail(new Error("ORIONMCP connection was denied."));
        return;
      }
      res.end("ORIONMCP authorization received. Return to Shelra to check the connection.");
      finish(code);
    });
    // Attach rejection handling before a denied browser callback can arrive.
    void callback.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        listener.once("error", () =>
          reject(new Error("The ORIONMCP login port is busy. Finish the other login first.")),
        );
        listener.listen(49931, "127.0.0.1", resolve);
      });
      timer = setTimeout(() => fail(new Error("ORIONMCP login expired. Run the login again.")), 300_000);
      const result = await auth(this, { serverUrl: this.endpoint, scope: "revit", fetchFn: this.safeFetch });
      if (result === "AUTHORIZED") return;
      const code = await callback;
      if (
        (await auth(this, {
          serverUrl: this.endpoint,
          authorizationCode: code,
          scope: "revit",
          fetchFn: this.safeFetch,
        })) !== "AUTHORIZED"
      )
        throw new Error("ORIONMCP authentication incomplete.");
    } finally {
      if (timer) clearTimeout(timer);
      listener.closeAllConnections();
      listener.close();
    }
  }
  /** This product's issuer uses the same origin; prevent metadata from exfiltrating tokens. */
  readonly safeFetch: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== new URL(this.endpoint).origin)
      return Promise.reject(new Error("ORIONMCP OAuth endpoint origin mismatch."));
    return fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) });
  };
}

export async function loginOrionMcp(
  endpoint: string,
  announce: (message: string) => void = (message) => console.log(message),
) {
  const provider = new OrionOAuthProvider(endpoint, async (url) => {
    if (url.origin !== new URL(endpoint).origin) throw new Error("ORIONMCP authorization origin mismatch.");
    const script = "$address = [Console]::In.ReadToEnd(); Start-Process -FilePath $address -WindowStyle Hidden";
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      input: url.href,
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    });
    if (result.status !== 0) throw new Error("Could not open the browser for ORIONMCP login.");
    announce("Se abrió tu navegador: pulsa «Permitir» en OrionBIM para conectar Shelra con tu Revit.");
  });
  await provider.login();
}
