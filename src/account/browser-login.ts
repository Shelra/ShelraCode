import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { AccountError, type ExchangedLogin, exchangeLoginCode } from "./client";

/*
 * The browser login, the way Claude Code does it. The CLI opens the website's sign-in page; the person signs in
 * there and authorizes this machine; the website sends the browser back to a port this process listens on, with a
 * one-time code, and the CLI trades the code and a secret only it holds (PKCE, S256) for a device token. Where the
 * browser cannot reach the port (SSH, WSL, a container) the page shows the code and the person pastes it here.
 *
 * Nothing secret travels in the URL: the challenge is a hash, the state only ties the answer to this attempt, and
 * the code is useless without the verifier. The listener binds to 127.0.0.1, answers one path, and closes at once.
 */

export type BrowserLoginEvent =
  | { type: "url"; url: string; opened: boolean }
  | { type: "waiting"; port: number; seconds: number }
  | { type: "received"; via: "browser" | "paste" }
  /** A pasted line that was blank or belonged to another attempt: it is ignored and the person is asked again. */
  | { type: "paste-ignored"; reason: string };

export type BrowserLoginOptions = {
  apiUrl: string;
  webUrl: string;
  deviceName: string;
  /** "shelra 1.2.3 on win32": shown on the authorization page so the person knows what they are approving. */
  clientInfo: string;
  openBrowser?: (url: string) => Promise<boolean>;
  notify?: (event: BrowserLoginEvent) => void;
  /** Reads a code the person pastes; resolves null when the input ends. Aborted when the login is over. */
  readPasted?: (signal: AbortSignal) => Promise<string | null>;
  fetchImpl?: typeof fetch;
  /** How long to wait for the person; the code itself lives five minutes. */
  timeoutMs?: number;
  signal?: AbortSignal;
};

export const LOGIN_TIMEOUT_MS = 5 * 60_000;

export function newVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function challengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** The page the browser is sent to, with everything the website needs and nothing a thief could use. */
export function buildLoginUrl(
  webUrl: string,
  input: { state: string; challenge: string; port: number; deviceName: string; clientInfo: string },
): string {
  const url = new URL("/cli/login", webUrl);
  url.searchParams.set("state", input.state);
  url.searchParams.set("challenge", input.challenge);
  url.searchParams.set("port", String(input.port));
  url.searchParams.set("name", input.deviceName);
  url.searchParams.set("client", input.clientInfo);
  return url.toString();
}

/** A pasted answer is the code alone or `code#state`; the state, when present, must be this attempt's. */
export function parsePastedCode(raw: string, state: string): string {
  const [code, pastedState] = raw.trim().split("#");
  if (!code) throw new AccountError("No code was pasted.");
  if (pastedState !== undefined && pastedState !== state) {
    throw new AccountError("That code belongs to another sign-in attempt. Start again with `shelra login`.");
  }
  return code;
}

const PAGE_STYLE =
  "body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080808;color:#f2f2f2;font:16px/1.5 ui-monospace,Consolas,monospace}main{max-width:32rem;padding:2rem}h1{font-size:1.1rem;font-weight:600;margin:0 0 .5rem}p{color:#9a9a9a;margin:0}b{color:#00ff88}";

function page(title: string, body: string, status = 200): { status: number; html: string } {
  return {
    status,
    html: `<!doctype html><meta charset="utf-8"><title>ShelraCode</title><style>${PAGE_STYLE}</style><main><h1><b>&gt;_</b> ${title}</h1><p>${body}</p></main>`,
  };
}

function send(res: ServerResponse, content: { status: number; html: string }): void {
  res.writeHead(content.status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  res.end(content.html);
}

/** Only this machine, by name or address, may talk to the listener (DNS rebinding sends another Host). */
function hostIsLocal(req: IncomingMessage, port: number): boolean {
  const host = (req.headers.host ?? "").toLowerCase();
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

type Callback = { code: string } | { error: string };

function listen(state: string): Promise<{ server: Server; port: number; callback: Promise<Callback> }> {
  return new Promise((resolve, reject) => {
    let settle: (value: Callback) => void = () => {};
    const callback = new Promise<Callback>((done) => {
      settle = done;
    });
    let port = 0;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || url.pathname !== "/callback" || !hostIsLocal(req, port)) {
        send(res, page("Not found", "Nothing is served here.", 404));
        return;
      }
      if (url.searchParams.get("state") !== state) {
        send(res, page("This link is not for this terminal", "Start again with <b>shelra login</b>.", 400));
        return;
      }
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      if (error) {
        send(res, page("Sign-in cancelled", "You can close this tab and go back to the terminal."));
        settle({ error });
      } else if (code) {
        send(res, page("You are signed in", "You can close this tab and go back to the terminal."));
        settle({ code });
      } else {
        send(res, page("Nothing to receive", "The sign-in answer had no code.", 400));
      }
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as AddressInfo).port;
      resolve({ server, port, callback });
    });
  });
}

/** Set to anything non-empty to never open a browser: a server, a container, a test. The address is still printed. */
export const NO_BROWSER_ENV = "SHELRA_NO_BROWSER";

/** Opens `url` in the person's browser. False when this machine has no way to (a server, a container). */
export function openInBrowser(url: string): Promise<boolean> {
  if (process.env[NO_BROWSER_ENV]) return Promise.resolve(false);
  const [command, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  return new Promise((resolve) => {
    try {
      const child = spawn(command as string, args as string[], { stdio: "ignore", detached: true, windowsHide: true });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

/** Signs in through the browser and returns the device token. Throws an AccountError the person can act on. */
export async function browserLogin(options: BrowserLoginOptions): Promise<ExchangedLogin> {
  const verifier = newVerifier();
  const state = randomBytes(16).toString("base64url");
  const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS;
  const { server, port, callback } = await listen(state);
  const stop = new AbortController();
  const closeAll = () => {
    stop.abort();
    server.close();
    server.closeAllConnections?.();
  };
  const onAbort = () => closeAll();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const url = buildLoginUrl(options.webUrl, {
      state,
      challenge: challengeOf(verifier),
      port,
      deviceName: options.deviceName,
      clientInfo: options.clientInfo,
    });
    const opened = await (options.openBrowser ?? openInBrowser)(url);
    options.notify?.({ type: "url", url, opened });
    options.notify?.({ type: "waiting", port, seconds: Math.round(timeoutMs / 1000) });

    const outcomes: Promise<{ via: "browser" | "paste"; result: Callback }>[] = [
      callback.then((result) => ({ via: "browser" as const, result })),
      new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(new AccountError("Sign-in timed out. Start again with `shelra login`.")),
          timeoutMs,
        );
        stop.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
        options.signal?.addEventListener("abort", () => reject(new AccountError("Sign-in was cancelled.")), {
          once: true,
        });
      }),
    ];
    if (options.readPasted) {
      const readPasted = options.readPasted;
      // A stray Enter or a code from another attempt must not cancel the sign-in the browser may still finish.
      const paste = async (): Promise<{ via: "paste"; result: Callback }> => {
        while (!stop.signal.aborted) {
          const raw = await readPasted(stop.signal);
          if (stop.signal.aborted) break;
          if (raw === null) return new Promise(() => {}); // the input ended: only the browser can finish now
          try {
            return { via: "paste", result: { code: parsePastedCode(raw, state) } };
          } catch (error) {
            options.notify?.({
              type: "paste-ignored",
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return new Promise<never>(() => {}); // the login is over: nothing more to read
      };
      outcomes.push(paste());
    }
    const { via, result } = await Promise.race(outcomes);
    if ("error" in result) throw new AccountError("Sign-in was cancelled in the browser.");
    options.notify?.({ type: "received", via });
    return await exchangeLoginCode(options.apiUrl, result.code, verifier, options.fetchImpl ?? fetch);
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    closeAll();
  }
}
