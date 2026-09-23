import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { SQL } from "bun";
import { MAX_TOKENS } from "../src/app";
import { alice, bob, startApi, startDatabase, startFakeAuth, testConfig } from "./harness";

type ErrorBody = { error: { code: string; message: string; requestId: string; issues?: unknown[] } };
type IssuedToken = { id: string; name: string; prefix: string; createdAt: string; token: string };

let database: Awaited<ReturnType<typeof startDatabase>>;
let auth: ReturnType<typeof startFakeAuth>;
let api: ReturnType<typeof startApi>;

beforeAll(async () => {
  database = await startDatabase();
  auth = startFakeAuth([alice, bob]);
  api = startApi(testConfig(auth.url, database.url), database.sql);
});

afterAll(async () => {
  await api.stop();
  await auth.stop();
  await database.stop();
});

async function issue(person: typeof alice, name = "laptop"): Promise<IssuedToken> {
  const res = await api.call("POST", "/v1/tokens", { bearer: person.session, body: { name } });
  expect(res.status).toBe(201);
  return (await res.json()) as IssuedToken;
}

async function expectError(res: Response, status: number, code: string): Promise<ErrorBody> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as ErrorBody;
  expect(body.error.code).toBe(code);
  expect(body.error.requestId).toBe(res.headers.get("x-request-id") ?? "missing");
  return body;
}

describe("service", () => {
  test("health answers without touching a dependency", async () => {
    auth.state.calls = 0;
    const res = await api.call("GET", "/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(auth.state.calls).toBe(0);
  });

  test("auth config names the Supabase project and only its public key", async () => {
    const res = await api.call("GET", "/v1/auth/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ supabaseUrl: auth.url, supabasePublishableKey: "sb_publishable_test" });
  });

  test("an unknown route or method is a JSON 404", async () => {
    await expectError(await api.call("GET", "/v1/nothing"), 404, "not_found");
    await expectError(await api.call("GET", "/v1/tokens"), 404, "not_found");
  });
});

describe("authentication", () => {
  test("no credential is 401 with a Bearer challenge", async () => {
    const res = await api.call("GET", "/v1/me");
    await expectError(res, 401, "unauthenticated");
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
  });

  test("a session Supabase rejects is 401", async () => {
    await expectError(await api.call("GET", "/v1/me", { bearer: "not-a-session" }), 401, "unauthenticated");
  });

  test("a malformed or unknown device token is 401", async () => {
    await expectError(await api.call("GET", "/v1/me", { bearer: "shr_short" }), 401, "unauthenticated");
    const unknown = `shr_${"A".repeat(43)}`;
    await expectError(await api.call("GET", "/v1/me", { bearer: unknown }), 401, "unauthenticated");
  });

  test("a signed-in session reads its account", async () => {
    const res = await api.call("GET", "/v1/me", { bearer: alice.session });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      account: { id: alice.id, email: alice.email, name: null, createdAt: "2026-09-23T00:00:00Z" },
      credential: { type: "session" },
    });
  });

  test("Supabase Auth failing is 503, logged with its cause", async () => {
    auth.state.failWith = 500;
    try {
      await expectError(await api.call("GET", "/v1/me", { bearer: alice.session }), 503, "unavailable");
    } finally {
      auth.state.failWith = 0;
    }
    const entry = api.logs.at(-1);
    expect(entry?.level).toBe("error");
    expect(JSON.stringify(entry?.error)).toContain("Supabase Auth answered 500");
  });
});

describe("device tokens", () => {
  test("a session issues a token that is stored only as its hash", async () => {
    const issued = await issue(alice, "  work laptop  ");
    expect(issued.token).toMatch(/^shr_[A-Za-z0-9_-]{43}$/);
    expect(issued.name).toBe("work laptop");
    expect(issued.prefix).toBe(issued.token.slice(0, 12));

    const [row] = await database.sql`select * from shelra.access_tokens where id = ${issued.id}`;
    expect(row.user_id).toBe(alice.id);
    expect(row.token_hash).toBe(createHash("sha256").update(issued.token).digest("hex"));
    expect(Object.values(row)).not.toContain(issued.token);
  });

  test("the token identifies its owner", async () => {
    const issued = await issue(alice);
    const res = await api.call("GET", "/v1/me", { bearer: issued.token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { account: { id: string }; credential: Record<string, unknown> };
    expect(body.account.id).toBe(alice.id);
    expect(body.credential).toEqual({
      type: "token",
      id: issued.id,
      name: "laptop",
      prefix: issued.prefix,
      createdAt: issued.createdAt,
    });
  });

  test("a device token cannot issue tokens", async () => {
    const issued = await issue(alice);
    const res = await api.call("POST", "/v1/tokens", { bearer: issued.token, body: { name: "copy" } });
    await expectError(res, 403, "forbidden");
  });

  test("an invalid body is 400 with the field that is wrong", async () => {
    const tooLong = await api.call("POST", "/v1/tokens", { bearer: alice.session, body: { name: "x".repeat(65) } });
    const body = await expectError(tooLong, 400, "invalid_request");
    expect(body.error.issues).toEqual([expect.objectContaining({ path: "name" })]);
    await expectError(
      await api.call("POST", "/v1/tokens", { bearer: alice.session, body: { name: "   " } }),
      400,
      "invalid_request",
    );
    await expectError(
      await api.call("POST", "/v1/tokens", { bearer: alice.session, rawBody: "{not json" }),
      400,
      "invalid_request",
    );
  });

  test("authentication is checked before the body", async () => {
    await expectError(await api.call("POST", "/v1/tokens", { rawBody: "{not json" }), 401, "unauthenticated");
  });

  test("a device token revokes itself and then stops working", async () => {
    const issued = await issue(alice);
    expect((await api.call("DELETE", `/v1/tokens/${issued.id}`, { bearer: issued.token })).status).toBe(204);
    await expectError(await api.call("GET", "/v1/me", { bearer: issued.token }), 401, "unauthenticated");
    await expectError(await api.call("DELETE", `/v1/tokens/${issued.id}`, { bearer: alice.session }), 404, "not_found");
  });

  test("a device token cannot revoke another of its owner's tokens", async () => {
    const first = await issue(alice);
    const second = await issue(alice);
    await expectError(await api.call("DELETE", `/v1/tokens/${second.id}`, { bearer: first.token }), 403, "forbidden");
    expect((await api.call("GET", "/v1/me", { bearer: second.token })).status).toBe(200);
  });

  test("nobody can revoke someone else's token by changing the id", async () => {
    const bobs = await issue(bob);
    await expectError(await api.call("DELETE", `/v1/tokens/${bobs.id}`, { bearer: alice.session }), 404, "not_found");
    await expectError(await api.call("DELETE", "/v1/tokens/not-a-uuid", { bearer: alice.session }), 404, "not_found");
    expect((await api.call("GET", "/v1/me", { bearer: bobs.token })).status).toBe(200);
  });

  test("an account holding the maximum of tokens gets 409", async () => {
    await database.sql`delete from shelra.access_tokens where user_id = ${bob.id}`;
    for (let i = 0; i < MAX_TOKENS; i++) await issue(bob, `machine ${i}`);
    await expectError(
      await api.call("POST", "/v1/tokens", { bearer: bob.session, body: { name: "one more" } }),
      409,
      "conflict",
    );
  });
});

describe("failures", () => {
  test("a database outage is a 500 that tells the client nothing internal", async () => {
    const unreachable = new SQL({ url: "postgres://postgres@127.0.0.1:1/postgres", max: 1, connectionTimeout: 2 });
    const broken = startApi(testConfig(auth.url, "postgres://postgres@127.0.0.1:1/postgres"), unreachable);
    try {
      const issued = `shr_${"B".repeat(43)}`;
      const res = await broken.call("GET", "/v1/me", { bearer: issued });
      const body = await expectError(res, 500, "internal");
      expect(JSON.stringify(body)).not.toMatch(/postgres|127\.0\.0\.1|stack|ECONNREFUSED/i);
      const entry = broken.logs.at(-1);
      expect(entry).toMatchObject({ level: "error", route: "me.get", status: 500 });
      expect(entry?.error).toBeDefined();
    } finally {
      await broken.stop();
      await unreachable.close();
    }
  });

  test("every request is logged once with its route, status and duration", async () => {
    const before = api.logs.length;
    const res = await api.call("GET", "/v1/me", { bearer: bob.session });
    expect(api.logs.length).toBe(before + 1);
    expect(api.logs.at(-1)).toMatchObject({
      level: "info",
      msg: "request",
      requestId: res.headers.get("x-request-id") ?? "missing",
      method: "GET",
      route: "me.get",
      status: 200,
      userId: bob.id,
    });
    expect(typeof api.logs.at(-1)?.ms).toBe("number");
  });
});
