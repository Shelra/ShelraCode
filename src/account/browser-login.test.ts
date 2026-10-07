import { createHash } from "node:crypto";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type BrowserLoginEvent,
  browserLogin,
  buildLoginUrl,
  challengeOf,
  newVerifier,
  parsePastedCode,
} from "./browser-login";
import { AccountError } from "./client";

/*
 * The browser login with the website played by the test: it reads the address the CLI would open, then does what the
 * website does after the person approves, which is send the browser to the CLI's local port with a code.
 */

type Exchange = { code: string; codeVerifier: string };

let api: Server;
let apiUrl = "";
const exchanges: Exchange[] = [];
/** What the fake API does with a code: the one it issued is `GOOD`, and it checks the verifier like the real one. */
const GOOD = "good-code-that-is-long-enough-to-pass-validation";
let challengeSeen = "";

beforeEach(async () => {
  exchanges.length = 0;
  challengeSeen = "";
  api = createServer((req, res) => {
    let body = "";
    req.on("data", (part) => {
      body += part;
    });
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/v1/cli/token") {
        const exchange = JSON.parse(body) as Exchange;
        exchanges.push(exchange);
        const verifierOk = createHash("sha256").update(exchange.codeVerifier).digest("base64url") === challengeSeen;
        if (exchange.code !== GOOD || !verifierOk) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { code: "invalid_request", message: "The login code is invalid." } }));
          return;
        }
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "tok-1",
            name: "box",
            prefix: "shr_abcdefgh",
            createdAt: "2026-10-06T00:00:00.000Z",
            kind: "cli",
            expiresAt: "2027-01-04T00:00:00.000Z",
            token: "shr_issued",
            email: "alice@example.com",
            displayName: null,
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});

afterEach(async () => {
  api.closeAllConnections();
  await new Promise<void>((resolve) => api.close(() => resolve()));
});

/** Starts a login and, once its address is known, plays the website with `respond`. `done` settles after it ran. */
function run(respond: (url: URL) => Promise<void> | void, extra: Partial<Parameters<typeof browserLogin>[0]> = {}) {
  const events: BrowserLoginEvent[] = [];
  let urlReady: (url: URL) => void = () => {};
  const known = new Promise<URL>((resolve) => {
    urlReady = resolve;
  });
  const result = browserLogin({
    apiUrl,
    webUrl: "https://www.shelra.test",
    deviceName: "box",
    clientInfo: "shelra 9.9 on test",
    openBrowser: async () => true,
    notify: (event) => {
      events.push(event);
      if (event.type === "url") {
        const url = new URL(event.url);
        challengeSeen = url.searchParams.get("challenge") ?? "";
        urlReady(url);
      }
    },
    ...extra,
  });
  // The test awaits `result` itself; this keeps a failure that lands first from being reported as unhandled.
  result.catch(() => undefined);
  const done = known.then((url) => respond(url));
  return { events, result, done };
}

const callback = (url: URL, query: string, host?: string) =>
  fetch(`http://127.0.0.1:${url.searchParams.get("port")}/callback?${query}`, host ? { headers: { host } } : undefined);

describe("browserLogin", () => {
  it("sends the website everything it needs and nothing a thief could use", async () => {
    const verifier = newVerifier();
    const url = new URL(
      buildLoginUrl("https://www.shelra.dev", {
        state: "s",
        challenge: challengeOf(verifier),
        port: 5123,
        deviceName: "work laptop",
        clientInfo: "shelra 1.0 on win32",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://www.shelra.dev/cli/login");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      state: "s",
      challenge: challengeOf(verifier),
      port: "5123",
      name: "work laptop",
      client: "shelra 1.0 on win32",
    });
    expect(url.toString()).not.toContain(verifier);
    expect(challengeOf(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("trades the code the browser brings back for a device token", async () => {
    const { result, events, done } = run(async (url) => {
      const response = await callback(url, `code=${GOOD}&state=${url.searchParams.get("state")}`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("You are signed in");
    });
    const issued = await result;
    await done;
    expect(issued).toMatchObject({ token: "shr_issued", id: "tok-1", email: "alice@example.com" });
    expect(exchanges).toHaveLength(1);
    // The CLI proves it is the one that asked: the verifier it sends hashes to the challenge in the address.
    expect(challengeOf(exchanges[0]?.codeVerifier as string)).toBe(challengeSeen);
    expect(events.map((event) => event.type)).toEqual(["url", "waiting", "received"]);
  });

  it("ignores an answer that belongs to another attempt, then accepts the right one", async () => {
    const { result, done } = run(async (url) => {
      const wrong = await callback(url, `code=${GOOD}&state=somebody-elses`);
      expect(wrong.status).toBe(400);
      expect(exchanges).toHaveLength(0);
      expect((await callback(url, `code=${GOOD}&state=${url.searchParams.get("state")}`)).status).toBe(200);
    });
    expect((await result).token).toBe("shr_issued");
    await done;
  });

  it("answers only /callback, only for this machine", async () => {
    const { result, done } = run(async (url) => {
      const port = url.searchParams.get("port");
      expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${port}/callback`, { method: "POST" })).status).toBe(404);
      // A page on another host name reaching the port (DNS rebinding) gets nothing. `fetch` will not let a test set
      // the Host header, so this one goes through `http.request`.
      const rebound = await new Promise<number>((resolve, reject) => {
        const request = httpRequest(
          {
            host: "127.0.0.1",
            port: Number(port),
            path: `/callback?code=${GOOD}&state=${url.searchParams.get("state")}`,
            headers: { host: "evil.example" },
          },
          (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          },
        );
        request.once("error", reject);
        request.end();
      });
      expect(rebound).toBe(404);
      expect(exchanges).toHaveLength(0);
      await callback(url, `code=${GOOD}&state=${url.searchParams.get("state")}`);
    });
    await result;
    await done;
  });

  it("takes a code pasted by the person when the browser cannot reach the terminal", async () => {
    let pasteNow: (value: string) => void = () => {};
    const { result, events, done } = run(
      (url) => {
        pasteNow(`${GOOD}#${url.searchParams.get("state")}`);
      },
      {
        readPasted: () =>
          new Promise<string | null>((resolve) => {
            pasteNow = resolve;
          }),
      },
    );
    expect((await result).token).toBe("shr_issued");
    await done;
    expect(events.at(-1)).toEqual({ type: "received", via: "paste" });
  });

  it("ignores a blank line or another attempt's code and still takes the right one", async () => {
    let answers: string[] = [];
    const asked: string[] = [];
    const { result, events, done } = run(
      (url) => {
        answers = ["", "   ", "abc#another-state", `${GOOD}#${url.searchParams.get("state")}`];
      },
      {
        readPasted: async () => {
          while (answers.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
          const next = answers.shift() as string;
          asked.push(next);
          return next;
        },
      },
    );
    expect((await result).token).toBe("shr_issued");
    await done;
    expect(asked).toHaveLength(4);
    expect(events.filter((event) => event.type === "paste-ignored")).toHaveLength(3);
    expect(events.at(-1)).toEqual({ type: "received", via: "paste" });
  });

  it("refuses a pasted code from another attempt", () => {
    expect(parsePastedCode("abc#state-1", "state-1")).toBe("abc");
    expect(parsePastedCode("  abc  ", "state-1")).toBe("abc");
    expect(() => parsePastedCode("abc#other", "state-1")).toThrow(/another sign-in attempt/);
    expect(() => parsePastedCode("   ", "state-1")).toThrow(AccountError);
  });

  it("says so when the person cancels in the browser", async () => {
    const { result, done } = run(async (url) => {
      await callback(url, `error=access_denied&state=${url.searchParams.get("state")}`);
    });
    await expect(result).rejects.toThrow(/cancelled in the browser/);
    await done;
    expect(exchanges).toHaveLength(0);
  });

  it("fails with the service's reason when the code is refused", async () => {
    const { result, done } = run(async (url) => {
      await callback(url, `code=${"x".repeat(44)}&state=${url.searchParams.get("state")}`);
    });
    await expect(result).rejects.toThrow(/login code is invalid/);
    await done;
  });

  it("gives up after the time allowed, and closes its port", async () => {
    let port = "";
    const { result, done } = run(
      (url) => {
        port = url.searchParams.get("port") ?? "";
      },
      { timeoutMs: 150 },
    );
    await expect(result).rejects.toThrow(/timed out/);
    await done;
    await expect(fetch(`http://127.0.0.1:${port}/callback`)).rejects.toThrow();
  });

  it("stops when the caller cancels", async () => {
    const controller = new AbortController();
    const { result, done } = run(
      () => {
        controller.abort();
      },
      { signal: controller.signal },
    );
    await expect(result).rejects.toThrow(/cancelled/);
    await done;
  });

  it("closes its port after a success too", async () => {
    let port = "";
    const { result, done } = run(async (url) => {
      port = url.searchParams.get("port") ?? "";
      await callback(url, `code=${GOOD}&state=${url.searchParams.get("state")}`);
    });
    await result;
    await done;
    await expect(fetch(`http://127.0.0.1:${port}/callback`)).rejects.toThrow();
  });
});
