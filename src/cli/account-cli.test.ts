import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The account requirement and the browser login, with the real CLI as a person runs it, in a scratch home, against a
 * fake account service. The website's part (approving the machine) is played by the test: it sends the browser's
 * request to the port the CLI is listening on.
 */
vi.setConfig({ testTimeout: 150_000 });

const ENTRY = fileURLToPath(new URL("../index.ts", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "shelra-account-cli-"));
const GOOD_CODE = "good-code-that-is-long-enough-to-pass-validation";
const GOOD_TOKEN = `shr_${"G".repeat(43)}`;
const ISSUED_TOKEN = `shr_${"I".repeat(43)}`;

let home = "";
let work = "";
let service: Server;
let apiUrl = "";
let challenge = "";
const hits: string[] = [];
let meAnswer: "ok" | "revoked" = "ok";

beforeAll(async () => {
  service = createServer((req, res) => {
    let body = "";
    req.on("data", (part) => {
      body += part;
    });
    req.on("end", () => {
      hits.push(`${req.method} ${req.url}`);
      const bearer = /^Bearer (\S+)$/.exec(String(req.headers.authorization ?? ""))?.[1];
      if (req.method === "GET" && req.url === "/v1/me") {
        if (meAnswer === "revoked" || (bearer !== GOOD_TOKEN && bearer !== ISSUED_TOKEN)) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: { code: "unauthenticated", message: "The device token is invalid or has been revoked." },
            }),
          );
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            account: { id: "u1", email: "alice@example.com", name: "Alice", createdAt: "2026-09-01T00:00:00Z" },
            credential: {
              type: "token",
              id: "tok-1",
              name: "box",
              prefix: "shr_GGGGGGGG",
              createdAt: "2026-09-01T00:00:00Z",
              kind: "cli",
              expiresAt: new Date(Date.now() + 40 * 86_400_000).toISOString(),
            },
          }),
        );
        return;
      }
      if (req.method === "POST" && req.url === "/v1/cli/token") {
        const { code, codeVerifier } = JSON.parse(body) as { code: string; codeVerifier: string };
        const verified = createHash("sha256").update(codeVerifier).digest("base64url") === challenge;
        if (code !== GOOD_CODE || !verified) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { code: "invalid_request", message: "The login code is invalid." } }));
          return;
        }
        res.writeHead(201, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "tok-issued",
            name: "box",
            prefix: "shr_IIIIIIII",
            createdAt: new Date().toISOString(),
            kind: "cli",
            expiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
            token: ISSUED_TOKEN,
            email: "alice@example.com",
            displayName: "Alice",
          }),
        );
        return;
      }
      if (req.method === "DELETE" && req.url?.startsWith("/v1/tokens/")) {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(service.address() as AddressInfo).port}`;
});

afterAll(async () => {
  service.closeAllConnections();
  await new Promise<void>((resolve) => service.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  home = mkdtempSync(join(root, "home-"));
  work = join(home, "work");
  mkdirSync(work);
  mkdirSync(join(home, ".shelra"), { recursive: true });
  hits.length = 0;
  meAnswer = "ok";
  challenge = "";
});

const DAY = 86_400_000;
function signedIn(extra: Record<string, unknown> = {}, url = apiUrl) {
  writeFileSync(
    join(home, ".shelra", "auth.json"),
    JSON.stringify({
      account: {
        apiUrl: url,
        token: GOOD_TOKEN,
        tokenId: "tok-1",
        email: "alice@example.com",
        expiresAt: new Date(Date.now() + 60 * DAY).toISOString(),
        verifiedAt: new Date().toISOString(),
        ...extra,
      },
    }),
  );
}

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { ...process.env };
  for (const name of [
    "OPENROUTER_API_KEY",
    "KEY_OPENROUTER",
    "GROQ_API_KEY",
    "KEY_GROQ",
    "GEMINI_API_KEY",
    "CLOUDFLARE_API_TOKEN",
    "OMNIROUTE_BASE_URL",
    "SHELRA_TOKEN",
    "SHELRA_BASE_URL",
    "SHELRA_API_KEY",
  ]) {
    delete clean[name];
  }
  return { ...clean, HOME: home, USERPROFILE: home, SHELRA_TRACE: "off", SHELRA_NO_BROWSER: "1", ...extra };
}

function cli(args: string[], extra: Record<string, string> = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(
      "bun",
      ["run", ENTRY, ...args],
      { cwd: work, env: env(extra), timeout: 90_000, windowsHide: true },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

/** The stored credentials; nothing at all (no file) reads as an empty object. */
const auth = (): { account?: Record<string, unknown> } => {
  try {
    return JSON.parse(readFileSync(join(home, ".shelra", "auth.json"), "utf8"));
  } catch {
    return {};
  }
};

describe("the account is required to run", () => {
  it("stops a headless run with no login, and says how to get one", async () => {
    const result = await cli(["-p", "say hi"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Sign in to use ShelraCode");
    expect(result.stderr).toContain("shelra login");
    expect(result.stderr).toContain("SHELRA_TOKEN");
  });

  it("lets a run through with a token from SHELRA_TOKEN, and checks it with the service", async () => {
    signedIn({ verifiedAt: undefined, token: "shr_unused" });
    const result = await cli(["-p", "say hi"], { SHELRA_TOKEN: GOOD_TOKEN });
    // Past the gate, the run stops for want of a model provider, which is a different, later message.
    expect(result.stderr).toContain("needs a model provider");
    expect(result.stderr).not.toContain("Sign in");
    expect(hits).toContain("GET /v1/me");
  });

  it("refuses a login the service says was revoked", async () => {
    meAnswer = "revoked";
    signedIn({ verifiedAt: new Date(Date.now() - 3 * DAY).toISOString() });
    const result = await cli(["-p", "say hi"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("invalid or has been revoked");
    expect(result.stderr).toContain("shelra login");
  });

  it("keeps working offline within the week after the last confirmation, and says so", async () => {
    signedIn({ verifiedAt: new Date(Date.now() - 3 * DAY).toISOString() }, "http://127.0.0.1:9");
    const result = await cli(["-p", "say hi"]);
    expect(result.stderr).toContain("could not be reached; continuing on the last confirmed login");
    expect(result.stderr).toContain("needs a model provider");
  });

  it("asks to sign in again after more than a week without confirming", async () => {
    signedIn({ verifiedAt: new Date(Date.now() - 9 * DAY).toISOString() }, "http://127.0.0.1:9");
    const result = await cli(["-p", "say hi"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("more than seven days");
  });

  it("refuses an expired login without asking the network", async () => {
    signedIn({ expiresAt: new Date(Date.now() - DAY).toISOString() });
    const result = await cli(["-p", "say hi"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("has expired");
    expect(hits).toEqual([]);
  });

  it("warns once when the login is about to end", async () => {
    signedIn({ expiresAt: new Date(Date.now() + 2 * DAY).toISOString() });
    const result = await cli(["-p", "say hi"]);
    expect(result.stderr).toMatch(/login ends in [23] days?: run `shelra login` to renew/);
  });

  it("does not stand in the way of the commands that manage accounts and providers", async () => {
    const result = await cli(["providers", "--json"]);
    expect(result.code).toBe(0);
    expect((await cli(["whoami"])).code).toBe(1);
    expect((await cli(["logout"])).code).toBe(0);
  });
});

describe("shelra login", () => {
  /** Starts the real `shelra login` and reads what it prints until the sign-in address appears. */
  function startLogin(extraArgs: string[] = []) {
    const child = spawn(
      "bun",
      ["run", ENTRY, "login", "--api-url", apiUrl, "--web-url", "http://127.0.0.1:1", ...extraArgs],
      {
        cwd: work,
        env: env(),
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (part) => {
      stdout += part;
    });
    child.stderr.on("data", (part) => {
      stderr += part;
    });
    const address = new Promise<URL>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no address printed:\n${stdout}\n${stderr}`)), 60_000);
      const watch = setInterval(() => {
        const match = /(http:\/\/127\.0\.0\.1:1\/cli\/login\?\S+)/.exec(stdout);
        if (match) {
          clearTimeout(timer);
          clearInterval(watch);
          resolve(new URL(match[1] as string));
        }
      }, 50);
    });
    const exited = new Promise<number>((resolve) => child.once("close", (code) => resolve(code ?? 1)));
    return { child, address, exited, output: () => ({ stdout, stderr }) };
  }

  it("signs in through the browser's callback, stores the token and then signs out", async () => {
    const login = startLogin();
    const url = await login.address;
    challenge = url.searchParams.get("challenge") ?? "";
    expect(url.searchParams.get("name")).toMatch(/^shelra on /);
    expect(url.searchParams.get("client")).toMatch(/^shelra \S+ on /);

    // What the website does once the person approves: the browser goes to the CLI's port with a code.
    const done = await fetch(
      `http://127.0.0.1:${url.searchParams.get("port")}/callback?code=${GOOD_CODE}&state=${url.searchParams.get("state")}`,
    );
    expect(done.status).toBe(200);
    expect(await login.exited).toBe(0);
    expect(login.output().stdout).toContain("Signed in as alice@example.com");

    const stored = auth().account;
    expect(stored).toMatchObject({
      token: ISSUED_TOKEN,
      tokenId: "tok-issued",
      email: "alice@example.com",
      name: "Alice",
    });
    expect(stored?.expiresAt).toBeTruthy();
    expect(stored?.verifiedAt).toBeTruthy();

    const who = await cli(["whoami"]);
    expect(who.code).toBe(0);
    expect(who.stdout).toContain("alice@example.com");
    expect(who.stdout).toContain("valid until");

    const out = await cli(["logout"]);
    expect(out.code).toBe(0);
    expect(hits).toContain("DELETE /v1/tokens/tok-issued");
    expect(auth().account).toBeUndefined();
  });

  it("takes the code pasted into the terminal when the browser cannot reach it", async () => {
    const login = startLogin();
    const url = await login.address;
    challenge = url.searchParams.get("challenge") ?? "";
    login.child.stdin.write(`${GOOD_CODE}#${url.searchParams.get("state")}\n`);
    expect(await login.exited).toBe(0);
    expect(auth().account).toMatchObject({ token: ISSUED_TOKEN });
  });

  it("fails clearly when the code is wrong, and stores nothing", async () => {
    const login = startLogin();
    const url = await login.address;
    challenge = url.searchParams.get("challenge") ?? "";
    login.child.stdin.write(`${"x".repeat(48)}\n`);
    expect(await login.exited).toBe(1);
    expect(login.output().stderr).toContain("Login failed: The login code is invalid.");
    expect(auth().account).toBeUndefined();
  });

  it("asks for the sign-in page of a service that is not the default", async () => {
    const result = await cli(["login", "--api-url", apiUrl]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("--web-url");
  });
});
