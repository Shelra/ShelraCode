import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStoredAccount, saveAccount } from "../security/credentials";
import { AccountError, normalizeAccountUrl } from "./client";
import { type AccountIO, login, runLogout, runWhoami } from "./commands";

const API = "http://localhost:3001";
const SUPABASE = "https://ref.supabase.co";
const GOOD_CODE = "123456";

type Call = { method: string; url: string; headers: Record<string, string>; body?: Record<string, unknown> };

/** The account service and Supabase Auth as the CLI sees them, answering from a routing table. */
function fakeServices(overrides: Record<string, () => Response> = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ method, url, headers, body });
    const route = `${method} ${url.replace(API, "api:").replace(SUPABASE, "sb:")}`;
    const override = overrides[route];
    if (override) return override();
    switch (route) {
      case "GET api:/v1/auth/config":
        return Response.json({ supabaseUrl: SUPABASE, supabasePublishableKey: "sb_publishable_x" });
      case "POST sb:/auth/v1/otp":
        return Response.json({});
      case "POST sb:/auth/v1/verify":
        return body?.token === GOOD_CODE
          ? Response.json({ access_token: "session-1", refresh_token: "refresh-1" })
          : Response.json(
              { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" },
              { status: 403 },
            );
      case "POST api:/v1/tokens":
        return headers.authorization === "Bearer session-1"
          ? Response.json(
              {
                id: "tok-2",
                name: String(body?.name),
                prefix: "shr_newtoken",
                createdAt: "2026-09-23T10:00:00.000Z",
                token: "shr_new",
              },
              { status: 201 },
            )
          : Response.json({ error: { code: "unauthenticated", message: "no", requestId: "r0" } }, { status: 401 });
      case "POST sb:/auth/v1/logout?scope=local":
        return new Response(null, { status: 204 });
      case "DELETE api:/v1/tokens/tok-1":
      case "DELETE api:/v1/tokens/tok-2":
        return new Response(null, { status: 204 });
      case "GET api:/v1/me":
        return Response.json({
          account: { id: "user-1", email: "alice@example.com", name: null, createdAt: "2026-09-01T00:00:00Z" },
          credential: {
            type: "token",
            id: "tok-2",
            name: "laptop",
            prefix: "shr_newtoken",
            createdAt: "2026-09-23T10:00:00.000Z",
          },
        });
      default:
        return Response.json(
          { error: { code: "not_found", message: `unexpected ${route}`, requestId: "r?" } },
          { status: 404 },
        );
    }
  });
  return { calls, fetchImpl };
}

function scriptedIO(answers: (string | null)[]) {
  const said: string[] = [];
  const io: AccountIO = {
    ask: async () => (answers.length ? (answers.shift() ?? null) : null),
    say: (line) => said.push(line),
    warn: (line) => said.push(`warn: ${line}`),
  };
  return { io, said };
}

let home: string;
let saved: { HOME?: string; USERPROFILE?: string };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "shelra-account-test-"));
  saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
});

afterEach(() => {
  for (const key of ["HOME", "USERPROFILE"] as const) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

describe("account service URL", () => {
  it("accepts https anywhere and http only on this machine", () => {
    expect(normalizeAccountUrl("https://api.example.com/some/path")).toBe("https://api.example.com");
    expect(normalizeAccountUrl("http://localhost:3001")).toBe("http://localhost:3001");
    expect(() => normalizeAccountUrl("http://api.example.com")).toThrow(/https/);
    expect(() => normalizeAccountUrl("not a url")).toThrow(AccountError);
  });
});

describe("shelra login", () => {
  it("exchanges an emailed code for a device token and keeps only the token", async () => {
    writeFileSync(join(home, ".shelra-placeholder"), "");
    const { calls, fetchImpl } = fakeServices();
    const { io, said } = scriptedIO(["Alice@Example.com", GOOD_CODE]);

    const account = await login({ apiUrl: API, deviceName: "laptop", io, fetchImpl });

    expect(account).toEqual({ apiUrl: API, token: "shr_new", tokenId: "tok-2", email: "alice@example.com" });
    expect(getStoredAccount()).toEqual(account);
    const otp = calls.find((c) => c.url.endsWith("/auth/v1/otp"));
    expect(otp?.headers.apikey).toBe("sb_publishable_x");
    expect(otp?.body).toEqual({ email: "alice@example.com", create_user: true });
    expect(calls.find((c) => c.url.endsWith("/auth/v1/verify"))?.body).toEqual({
      type: "email",
      email: "alice@example.com",
      token: GOOD_CODE,
    });
    expect(calls.find((c) => c.url === `${API}/v1/tokens`)?.body).toEqual({ name: "laptop" });
    // The Supabase session is signed out and never written down.
    expect(calls.find((c) => c.url.includes("/auth/v1/logout"))?.headers.authorization).toBe("Bearer session-1");
    expect(readFileSync(join(home, ".shelra", "auth.json"), "utf8")).not.toMatch(/session-1|refresh-1/);
    expect(said).toContain("A sign-in code was sent to alice@example.com.");
  });

  it("keeps the OpenRouter key and revokes the token it replaces", async () => {
    saveAccount({ apiUrl: API, token: "shr_old", tokenId: "tok-1", email: "alice@example.com" });
    const auth = JSON.parse(readFileSync(join(home, ".shelra", "auth.json"), "utf8"));
    writeFileSync(join(home, ".shelra", "auth.json"), JSON.stringify({ ...auth, openrouter: { apiKey: "or-key" } }));
    const { calls, fetchImpl } = fakeServices();

    await login({ apiUrl: API, email: "alice@example.com", io: scriptedIO([GOOD_CODE]).io, fetchImpl });

    const revoke = calls.find((c) => c.method === "DELETE");
    expect(revoke?.url).toBe(`${API}/v1/tokens/tok-1`);
    expect(revoke?.headers.authorization).toBe("Bearer shr_old");
    const stored = JSON.parse(readFileSync(join(home, ".shelra", "auth.json"), "utf8"));
    expect(stored.openrouter).toEqual({ apiKey: "or-key" });
    expect(stored.account.tokenId).toBe("tok-2");
  });

  it("lets the person retype a wrong code, up to three tries", async () => {
    const { fetchImpl } = fakeServices();
    const retried = scriptedIO(["000000", GOOD_CODE]);
    await login({ apiUrl: API, email: "alice@example.com", io: retried.io, fetchImpl });
    expect(retried.said.some((line) => line.startsWith("warn: That code did not work"))).toBe(true);

    const failing = scriptedIO(["000000", "111111", "222222"]);
    await expect(login({ apiUrl: API, email: "bob@example.com", io: failing.io, fetchImpl })).rejects.toThrow(
      /expired or is invalid/,
    );
  });

  it("stops when the input ends instead of waiting forever", async () => {
    const { fetchImpl } = fakeServices();
    await expect(login({ apiUrl: API, email: "alice@example.com", io: scriptedIO([]).io, fetchImpl })).rejects.toThrow(
      "No code was entered.",
    );
    expect(getStoredAccount()).toBeUndefined();
  });

  it("reports the service's error with its request id and still signs the session out", async () => {
    const { calls, fetchImpl } = fakeServices({
      "POST api:/v1/tokens": () =>
        Response.json(
          { error: { code: "conflict", message: "This account already has 50 active tokens.", requestId: "req-9" } },
          { status: 409 },
        ),
    });
    const attempt = login({ apiUrl: API, email: "alice@example.com", io: scriptedIO([GOOD_CODE]).io, fetchImpl });
    await expect(attempt).rejects.toMatchObject({ status: 409, code: "conflict", requestId: "req-9" });
    expect(calls.some((c) => c.url.includes("/auth/v1/logout"))).toBe(true);
    expect(getStoredAccount()).toBeUndefined();
  });

  it("refuses a plain-http service on another machine before sending anything", async () => {
    const { calls, fetchImpl } = fakeServices();
    const attempt = login({ apiUrl: "http://api.example.com", io: scriptedIO([]).io, fetchImpl });
    await expect(attempt).rejects.toThrow(/https/);
    expect(calls).toHaveLength(0);
  });
});

describe("shelra whoami and logout", () => {
  it("whoami shows the account behind this machine's token", async () => {
    saveAccount({ apiUrl: API, token: "shr_new", tokenId: "tok-2", email: "alice@example.com" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { calls, fetchImpl } = fakeServices();
    expect(await runWhoami(fetchImpl)).toBe(0);
    expect(calls[0]?.headers.authorization).toBe("Bearer shr_new");
    expect(log.mock.calls.flat().join("\n")).toContain("Signed in as alice@example.com");
  });

  it("whoami explains a revoked token and a machine that never signed in", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runWhoami(fakeServices().fetchImpl)).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("Not signed in");

    saveAccount({ apiUrl: API, token: "shr_gone", tokenId: "tok-2", email: "alice@example.com" });
    const { fetchImpl } = fakeServices({
      "GET api:/v1/me": () =>
        Response.json({ error: { code: "unauthenticated", message: "revoked", requestId: "r1" } }, { status: 401 }),
    });
    expect(await runWhoami(fetchImpl)).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("no longer valid");
  });

  it("logout revokes the token on the server and forgets it", async () => {
    saveAccount({ apiUrl: API, token: "shr_new", tokenId: "tok-2", email: "alice@example.com" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { calls, fetchImpl } = fakeServices();
    expect(await runLogout(fetchImpl)).toBe(0);
    expect(calls[0]).toMatchObject({ method: "DELETE", url: `${API}/v1/tokens/tok-2` });
    expect(getStoredAccount()).toBeUndefined();
  });

  it("logout still forgets the token when the service is unreachable, and says it stays active", async () => {
    saveAccount({ apiUrl: API, token: "shr_new", tokenId: "tok-2", email: "alice@example.com" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await runLogout(offline)).toBe(1);
    expect(getStoredAccount()).toBeUndefined();
    expect(log.mock.calls.flat().join("\n")).toContain("still active");
  });
});
