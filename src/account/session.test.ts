import { describe, expect, it, vi } from "vitest";
import type { StoredAccount } from "../security/credentials";
import { AccountError } from "./client";
import { checkAccount, describeBlocked, OFFLINE_GRACE_MS, VERIFY_INTERVAL_MS } from "./session";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const DAY = 24 * 60 * 60_000;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function stored(extra: Partial<StoredAccount> = {}): StoredAccount {
  return {
    apiUrl: "https://api.shelra.test",
    token: "shr_stored",
    tokenId: "tok-1",
    email: "alice@example.com",
    name: "Alice",
    expiresAt: iso(60 * DAY),
    verifiedAt: iso(-1 * 60_000),
    ...extra,
  };
}

/** The service as `getMe` sees it: a token that is good, one that is refused, or a network that is down. */
function service(mode: "ok" | "revoked" | "down" | "error500" | "slow", expiresAt: string | null = iso(60 * DAY)) {
  return vi.fn<typeof fetch>(async () => {
    if (mode === "down") throw new TypeError("fetch failed");
    if (mode === "slow") throw new DOMException("timed out", "TimeoutError");
    if (mode === "error500") return Response.json({ error: { code: "internal", message: "boom" } }, { status: 500 });
    if (mode === "revoked") {
      return Response.json(
        { error: { code: "unauthenticated", message: "The device token is invalid or has been revoked." } },
        { status: 401 },
      );
    }
    return Response.json({
      account: { id: "u1", email: "alice@example.com", name: "Alice", createdAt: "2026-09-01T00:00:00Z" },
      credential: {
        type: "token",
        id: "tok-1",
        name: "box",
        prefix: "shr_abcdefgh",
        createdAt: "2026-09-01T00:00:00Z",
        kind: "cli",
        expiresAt,
      },
    });
  });
}

function harness(account: StoredAccount | undefined, env: Record<string, string> = {}) {
  let current = account;
  const writes: StoredAccount[] = [];
  return {
    deps: {
      env,
      now: () => NOW,
      read: () => current,
      write: (next: StoredAccount) => {
        current = next;
        writes.push(next);
      },
    },
    writes,
    current: () => current,
  };
}

describe("checkAccount: a stored login", () => {
  it("is signed out when there is no login", async () => {
    const h = harness(undefined);
    const fetchImpl = service("ok");
    expect(await checkAccount({ ...h.deps, fetchImpl })).toEqual({ state: "signed-out" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is trusted without the network for a day after the last confirmation", async () => {
    const h = harness(stored({ verifiedAt: iso(-VERIFY_INTERVAL_MS + 60_000) }));
    const fetchImpl = service("down");
    const status = await checkAccount({ ...h.deps, fetchImpl });
    expect(status).toMatchObject({ state: "ok", email: "alice@example.com", source: "stored", offline: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is confirmed with the service once the day has passed, and remembers it", async () => {
    const h = harness(stored({ verifiedAt: iso(-VERIFY_INTERVAL_MS - 60_000), expiresAt: iso(40 * DAY) }));
    const fetchImpl = service("ok", iso(90 * DAY));
    const status = await checkAccount({ ...h.deps, fetchImpl });
    expect(status).toMatchObject({ state: "ok", offline: false, expiresAt: iso(90 * DAY) });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]).toMatchObject({ verifiedAt: iso(0), expiresAt: iso(90 * DAY) });
  });

  it("keeps working when the service is down, for seven days after the last confirmation", async () => {
    for (const mode of ["down", "error500", "slow"] as const) {
      const h = harness(stored({ verifiedAt: iso(-3 * DAY) }));
      const status = await checkAccount({ ...h.deps, fetchImpl: service(mode) });
      expect(status, mode).toMatchObject({ state: "ok", offline: true });
      // An outage does not renew the confirmation.
      expect(h.writes, mode).toHaveLength(0);
    }
  });

  it("stops asking to be trusted after the grace has passed", async () => {
    const h = harness(stored({ verifiedAt: iso(-OFFLINE_GRACE_MS - 60_000) }));
    const status = await checkAccount({ ...h.deps, fetchImpl: service("down") });
    expect(status).toMatchObject({ state: "offline-too-long" });
    expect(describeBlocked(status as never, "shelra")).toContain("more than seven days");
  });

  it("blocks at once, with the service's own words, when the token was revoked", async () => {
    const h = harness(stored({ verifiedAt: iso(-3 * DAY) }));
    const status = await checkAccount({ ...h.deps, fetchImpl: service("revoked") });
    expect(status).toEqual({ state: "invalid", reason: "The device token is invalid or has been revoked." });
    expect(describeBlocked(status as never, "shelra")).toContain("`shelra login`");
  });

  it("reads the login's own expiry without waiting for the network", async () => {
    const h = harness(stored({ expiresAt: iso(-60_000) }));
    const fetchImpl = service("ok");
    const status = await checkAccount({ ...h.deps, fetchImpl });
    expect(status).toMatchObject({ state: "invalid" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("warns three days before the login ends, and not earlier", async () => {
    const soon = await checkAccount({
      ...harness(stored({ expiresAt: iso(2.2 * DAY) })).deps,
      fetchImpl: service("ok"),
    });
    expect(soon).toMatchObject({ state: "ok", expiresInDays: 3 });
    const later = await checkAccount({
      ...harness(stored({ expiresAt: iso(10 * DAY) })).deps,
      fetchImpl: service("ok"),
    });
    expect(later).toMatchObject({ state: "ok", expiresInDays: null });
    const never = await checkAccount({ ...harness(stored({ expiresAt: null })).deps, fetchImpl: service("ok") });
    expect(never).toMatchObject({ state: "ok", expiresInDays: null });
  });

  it("starts the grace of a login made before confirmations were recorded, once", async () => {
    const h = harness(stored({ verifiedAt: undefined }));
    const status = await checkAccount({ ...h.deps, fetchImpl: service("down") });
    expect(status).toMatchObject({ state: "ok", offline: true });
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]?.verifiedAt).toBe(iso(0));
  });

  it("is not locked out by a home it cannot write to", async () => {
    const h = harness(stored({ verifiedAt: iso(-2 * DAY) }));
    const status = await checkAccount({
      ...h.deps,
      write: () => {
        throw new Error("EROFS");
      },
      fetchImpl: service("ok"),
    });
    expect(status).toMatchObject({ state: "ok", offline: false });
  });
});

describe("checkAccount: a token from SHELRA_TOKEN", () => {
  it("is checked on every start and used instead of any stored login", async () => {
    const h = harness(stored({ token: "shr_stored" }), { SHELRA_TOKEN: "shr_from_env" });
    const fetchImpl = service("ok", null);
    const status = await checkAccount({ ...h.deps, fetchImpl });
    expect(status).toMatchObject({ state: "ok", source: "env", expiresAt: null });
    const [, init] = fetchImpl.mock.calls[0] ?? [];
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer shr_from_env");
  });

  it("works without any stored login, against the default service", async () => {
    const h = harness(undefined, { SHELRA_TOKEN: "shr_from_env" });
    const fetchImpl = service("ok");
    expect(await checkAccount({ ...h.deps, fetchImpl })).toMatchObject({ state: "ok", source: "env" });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://api.shelra.dev/v1/me");
  });

  it("is refused when the service says it is not valid", async () => {
    const h = harness(undefined, { SHELRA_TOKEN: "shr_revoked" });
    expect(await checkAccount({ ...h.deps, fetchImpl: service("revoked") })).toMatchObject({ state: "invalid" });
  });

  it("is let through when the service cannot be reached: a script has nowhere to keep a confirmation", async () => {
    const h = harness(undefined, { SHELRA_TOKEN: "shr_from_env" });
    expect(await checkAccount({ ...h.deps, fetchImpl: service("down") })).toMatchObject({
      state: "ok",
      source: "env",
      offline: true,
    });
  });

  it("does not take a blank variable for a token", async () => {
    const h = harness(undefined, { SHELRA_TOKEN: "   " });
    expect(await checkAccount({ ...h.deps, fetchImpl: service("ok") })).toEqual({ state: "signed-out" });
  });
});

describe("describeBlocked", () => {
  it("tells a person with no login how to get one, including the CI route", () => {
    const text = describeBlocked({ state: "signed-out" }, "shelra");
    expect(text).toContain("shelra login");
    expect(text).toContain("SHELRA_TOKEN");
    expect(new AccountError("x")).toBeInstanceOf(Error);
  });
});
