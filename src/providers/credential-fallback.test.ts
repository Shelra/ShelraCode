import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CredentialFallback, credentialFallbackChain, thenFallback } from "./credential-fallback";
import type { ProviderAdapter } from "./types";

const { storedKey } = vi.hoisted(() => ({ storedKey: { value: undefined as string | undefined } }));

vi.mock("../security/credentials", () => ({
  getStoredOpenRouterApiKey: () => storedKey.value,
}));

const { listOpenRouterApiKeys } = await import("../utils/settings");

const request = () => ({ modelId: "m", signal: new AbortController().signal });
const fallback = (label: string): CredentialFallback => ({ provider: {} as ProviderAdapter, modelId: "m", label });

describe("credentialFallbackChain", () => {
  it("returns each source's fallback once, in order, then null", async () => {
    const next = credentialFallbackChain([async () => fallback("second key"), async () => fallback("local model")]);
    expect((await next(request()))?.label).toBe("second key");
    expect((await next(request()))?.label).toBe("local model");
    expect(await next(request())).toBeNull();
  });

  it("skips a source that is unavailable or throws", async () => {
    const next = credentialFallbackChain([
      async () => null,
      async () => {
        throw new Error("engine missing");
      },
      async () => fallback("local model"),
    ]);
    expect((await next(request()))?.label).toBe("local model");
  });

  it("shares a chain with another failure and ends on the last source only once the chain is spent", async () => {
    // Review round 3 (2026-09-24): a chain nested in another chain was dropped after its first answer, so a
    // second rejected key skipped OpenRouter Free and went straight to the local model.
    const shared = credentialFallbackChain([async () => fallback("gemini"), async () => fallback("openrouter free")]);
    const onRejectedKey = thenFallback(shared, async () => fallback("local model"));
    expect((await onRejectedKey(request()))?.label).toBe("gemini");
    expect((await onRejectedKey(request()))?.label).toBe("openrouter free");
    expect((await onRejectedKey(request()))?.label).toBe("local model");
  });

  it("tries a chain shared by both failures once, whichever failure reaches it first", async () => {
    // Review of round 3: a custom endpoint built OpenRouter Free into both chains, so it was tried twice.
    const openRouterFree = credentialFallbackChain([async () => fallback("openrouter free")]);
    const onRejectedKey = thenFallback(openRouterFree, async () => fallback("local model"));
    const onNoModel = thenFallback(credentialFallbackChain([async () => fallback("groq")]), openRouterFree);
    expect((await onRejectedKey(request()))?.label).toBe("openrouter free");
    expect((await onNoModel(request()))?.label).toBe("groq");
    expect(await onNoModel(request())).toBeNull();
    expect((await onRejectedKey(request()))?.label).toBe("local model");
  });

  it("tries nothing once the turn is cancelled", async () => {
    const source = vi.fn(async () => fallback("key"));
    const controller = new AbortController();
    controller.abort();
    expect(await credentialFallbackChain([source])({ modelId: "m", signal: controller.signal })).toBeNull();
    expect(source).not.toHaveBeenCalled();
  });
});

describe("listOpenRouterApiKeys", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.KEY_OPENROUTER;
    delete process.env.SHELRA_API_KEY;
    storedKey.value = undefined;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("lists every configured OpenRouter key once, in the order they are preferred", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-stale";
    process.env.KEY_OPENROUTER = "sk-or-stale";
    storedKey.value = "sk-or-saved";
    expect(listOpenRouterApiKeys()).toEqual([
      { key: "sk-or-stale", source: "OPENROUTER_API_KEY" },
      { key: "sk-or-saved", source: "`shelra auth openrouter`" },
    ]);
  });

  it("never offers a key meant for another service", () => {
    process.env.SHELRA_API_KEY = "sk-other-service";
    expect(listOpenRouterApiKeys()).toEqual([]);
  });
});
