import { describe, expect, it } from "vitest";
import { freePlanDefinition } from "../providers/definitions/free-plan";
import { omniRouteDefinition } from "../providers/definitions/omniroute";
import { FREE_PROVIDERS } from "../providers/free-providers";
import { ProviderRegistry, type ResolveDeps } from "../providers/registry";
import { createProviderAdmin } from "./provider-admin";

/*
 * Every provider asks for its key alone (owner, 2026-10-07). What the key already says is worked out, and the person
 * is asked for a field only when the provider could not find it.
 */
const TOKEN = "cf-token-abcdefghijklmnop";

function accountsFetch(response: { status?: number; accounts?: { id: string; name: string }[] }): typeof fetch {
  return (async (url: string | URL | Request) => {
    expect(String(url)).toContain("https://api.cloudflare.com/client/v4/accounts");
    return new Response(JSON.stringify({ result: response.accounts ?? [] }), { status: response.status ?? 200 });
  }) as typeof fetch;
}

function cloudflareAdmin(fetchImpl: typeof fetch) {
  const saved: Array<{ id: string; input: unknown }> = [];
  const service = createProviderAdmin({
    registry: new ProviderRegistry([freePlanDefinition(FREE_PROVIDERS.cloudflare)]),
    resolveDeps: () => ({ env: {}, storedCredential: () => undefined, settings: {} }),
    attestations: () => ({ freePlanProviders: new Set(), freeModelPatterns: {} }),
    save: (id, input) => {
      saved.push({ id, input });
    },
    remove: () => {},
    setFreePlan: () => {},
    setPatterns: () => {},
    stored: () => false,
    fetch: fetchImpl,
  });
  return { service, saved };
}

describe("a provider that needs an account id", () => {
  it("lists the key first and the account id as a field the provider can work out", () => {
    const fields = freePlanDefinition(FREE_PROVIDERS.cloudflare).fields;
    expect(fields.map((field) => [field.name, field.derived ?? false])).toEqual([
      ["apiKey", false],
      ["accountId", true],
    ]);
  });

  it("connects with the token alone when it reaches exactly one account", async () => {
    const { service, saved } = cloudflareAdmin(accountsFetch({ accounts: [{ id: "a".repeat(32), name: "Mine" }] }));
    const result = await service.connect("cloudflare", { apiKey: TOKEN });
    expect(result.ok).toBe(true);
    expect(saved).toEqual([{ id: "cloudflare", input: { apiKey: TOKEN, accountId: "a".repeat(32) } }]);
  });

  it("asks for the account id, and only that, when the token may not list its accounts", async () => {
    const { service, saved } = cloudflareAdmin(accountsFetch({ status: 403 }));
    const result = await service.connect("cloudflare", { apiKey: TOKEN });
    expect(result).toMatchObject({ ok: false, needs: "accountId" });
    expect(result.ok ? "" : result.error).toContain("Paste the account id");
    expect(saved).toEqual([]);
    // Typing it finishes the connection.
    const again = await service.connect("cloudflare", { apiKey: TOKEN, accountId: "b".repeat(32) });
    expect(again.ok).toBe(true);
    expect(saved).toEqual([{ id: "cloudflare", input: { apiKey: TOKEN, accountId: "b".repeat(32) } }]);
  });

  it("names the accounts when the token reaches several, and never echoes the token", async () => {
    const { service } = cloudflareAdmin(
      accountsFetch({
        accounts: [
          { id: "a".repeat(32), name: "One" },
          { id: "c".repeat(32), name: "Two" },
        ],
      }),
    );
    const result = await service.connect("cloudflare", { apiKey: TOKEN });
    expect(result).toMatchObject({ ok: false, needs: "accountId" });
    const text = result.ok ? "" : result.error;
    expect(text).toContain("One");
    expect(text).toContain("Two");
    expect(text).not.toContain(TOKEN);
  });

  it("leaves a rejected token to the connection test instead of asking for an id", async () => {
    const { service, saved } = cloudflareAdmin(accountsFetch({ status: 401 }));
    const result = await service.connect("cloudflare", { apiKey: TOKEN });
    expect(result.ok ? undefined : result.needs).toBeUndefined();
    expect(result).toMatchObject({ ok: false });
    expect(saved).toEqual([]);
  });
});

describe("OmniRoute", () => {
  const deps = (over: Partial<ResolveDeps> = {}): ResolveDeps => ({
    env: {},
    storedCredential: () => undefined,
    settings: {},
    ...over,
  });
  const PRODUCTION = "https://omniroute.example/v1";

  it("asks for the key alone once a production gateway is set", () => {
    expect(omniRouteDefinition(PRODUCTION).fields.map((field) => [field.name, field.optional ?? false])).toEqual([
      ["apiKey", false],
    ]);
  });

  it("still asks for the address while no production gateway is set", () => {
    expect(omniRouteDefinition("").fields.map((field) => field.name)).toEqual(["url", "apiKey"]);
  });

  it("points at production with a key, and is not configured without one", () => {
    const definition = omniRouteDefinition(PRODUCTION);
    expect(definition.resolveConfigs(deps())).toEqual([]);
    const [config] = definition.resolveConfigs(deps({ storedCredential: () => ({ apiKey: "k-123456789" }) }));
    expect(config?.baseURL).toBe(PRODUCTION);
    expect(config?.credential?.apiKey).toBe("k-123456789");
  });

  it("lets a gateway the user runs win over production", () => {
    const definition = omniRouteDefinition(PRODUCTION);
    const [config] = definition.resolveConfigs(
      deps({
        env: { OMNIROUTE_BASE_URL: "http://localhost:20128/v1" },
        storedCredential: () => ({ apiKey: "k-123456789" }),
      }),
    );
    expect(config?.baseURL).toBe("http://localhost:20128/v1");
  });
});
