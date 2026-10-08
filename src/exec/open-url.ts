import { spawn } from "node:child_process";

/*
 * Opening something in the person's own browser or viewer: the login page, an authorization page, an image the agent
 * made, and a page the agent wants to show (a dev server it started). One implementation, so every caller is right on
 * every platform and obeys SHELRA_NO_BROWSER; before this each had its own, and two of them worked on one platform
 * only (review 2026-10-07).
 */

/** Set to anything non-empty to never open a browser: a server, a container, a test. The address is still printed. */
export const NO_BROWSER_ENV = "SHELRA_NO_BROWSER";

/**
 * Opens `target` (a URL or a file path) with the system's default program. False when this machine has no way to (a
 * server, a container, SHELRA_NO_BROWSER). True means the opener started, not that a window is on screen.
 * Windows goes through `rundll32 url.dll,FileProtocolHandler` with the target as one argument: no shell, so `&` and
 * `?` in a URL need no quoting.
 */
export function openWithSystem(target: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (env[NO_BROWSER_ENV]) return Promise.resolve(false);
  const [command, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", target]]
      : process.platform === "darwin"
        ? ["open", [target]]
        : ["xdg-open", [target]];
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

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export type OpenableUrl = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Whether the agent may open this address for the person without asking: an http(s) page on this machine, such as the
 * dev server it just started. Anything else is refused, because a page opened on a model's say-so is a way to put an
 * unexpected site in front of a person (a prompt injection could ask for one): the model can give the address in its
 * answer instead.
 */
export function checkOpenableUrl(raw: string): OpenableUrl {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, reason: `"${raw}" is not a valid address. Use a full URL such as http://localhost:5173.` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: `Only http and https pages can be opened, not ${parsed.protocol}` };
  }
  if (!LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) {
    return {
      ok: false,
      reason: `${parsed.origin} is not on this machine. Only local pages (localhost, 127.0.0.1) are opened for the person; give them this address in your answer instead.`,
    };
  }
  // 0.0.0.0 is what a server says it listens on, not an address a browser can visit.
  if (parsed.hostname === "0.0.0.0") parsed.hostname = "localhost";
  return { ok: true, url: parsed.href };
}
