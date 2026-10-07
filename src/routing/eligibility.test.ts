import { describe, expect, it } from "vitest";
import { classifyFreeEligibility, type FreeAttestations, isFreeEligible, NO_ATTESTATIONS } from "./eligibility";
import { entry, freeTier, gatewayModel, paid, publishedFree } from "./test-fixtures";

const attest = (partial: Partial<{ plans: string[]; models: Record<string, string[]> }> = {}): FreeAttestations => ({
  freePlanProviders: new Set(partial.plans ?? []),
  freeModelPatterns: partial.models ?? {},
});

describe("classifyFreeEligibility", () => {
  it("trusts OpenRouter's own zero price and its free router", () => {
    expect(classifyFreeEligibility(publishedFree("openrouter", "google/gemma-3:free")).level).toBe("guaranteed-free");
    const router = entry({ provider: "openrouter", providerModelId: "free", free: true, router: true });
    router.id = "openrouter/free";
    expect(isFreeEligible(router)).toBe(true);
  });

  it("never treats OpenRouter's auto routers as free: they bill whichever model they pick", () => {
    for (const id of ["auto", "auto-beta"]) {
      const router = entry({ provider: "openrouter", providerModelId: id, free: true, pricingKnown: false });
      expect(isFreeEligible(router, attest({ plans: ["openrouter"], models: { openrouter: ["*"] } }))).toBe(false);
    }
  });

  it("refuses a model priced above zero, whatever the user declares", () => {
    const model = paid("groq", "some-model");
    expect(classifyFreeEligibility(model).level).toBe("paid");
    expect(isFreeEligible(model, attest({ plans: ["groq"], models: { groq: ["*"] } }))).toBe(false);
  });

  it("refuses a request-level charge even when the token prices are zero", () => {
    const model = publishedFree("openrouter", "odd:free");
    model.cost.request = 0.01;
    expect(isFreeEligible(model)).toBe(false);
  });

  it("does not turn an unknown price into free", () => {
    const model = entry({
      provider: "openrouter",
      providerModelId: "mystery",
      pricingKnown: false,
      basis: "published-zero",
    });
    const result = classifyFreeEligibility(model);
    expect(result.eligible).toBe(false);
    expect(result.level).toBe("unknown");
  });

  it("keeps a free plan out of Free mode until the user says the key has no billing", () => {
    const model = freeTier("groq", "openai/gpt-oss-120b");
    const before = classifyFreeEligibility(model, NO_ATTESTATIONS);
    expect(before).toMatchObject({ level: "free-tier", eligible: false });
    expect(before.evidence).toContain("shelra providers allow-free groq");
    expect(isFreeEligible(model, attest({ plans: ["groq"] }))).toBe(true);
    // A declaration about one provider says nothing about another.
    expect(isFreeEligible(freeTier("gemini", "gemini-2.5-flash"), attest({ plans: ["groq"] }))).toBe(false);
  });

  it("treats a gateway's zero as unverified, however it is listed", () => {
    const model = gatewayModel("groq/openai/gpt-oss-120b", { upstream: "groq", pricingKnown: true, free: true });
    expect(isFreeEligible(model)).toBe(false);
    expect(classifyFreeEligibility(model).level).toBe("unknown");
  });

  it("admits a gateway model only when the user vouched for it by name", () => {
    const model = gatewayModel("opencode-free/big-pickle", { upstream: "opencode-free" });
    expect(isFreeEligible(model, attest({ models: { omniroute: ["opencode-free/*"] } }))).toBe(true);
    expect(isFreeEligible(model, attest({ models: { omniroute: ["groq/*"] } }))).toBe(false);
    expect(isFreeEligible(model, attest({ models: { omniroute: ["opencode-free/big-pickle"] } }))).toBe(true);
  });

  it("never admits a routing alias, even one the user's pattern matches", () => {
    for (const id of ["auto", "auto/coding", "auto/coding:free", "my-combo"]) {
      const alias = gatewayModel(id, { router: true });
      expect(isFreeEligible(alias, attest({ models: { omniroute: ["*"] } })), id).toBe(false);
      expect(classifyFreeEligibility(alias).level).toBe("paid");
    }
  });

  it("runs a local model as free", () => {
    const local = entry({ provider: "local", providerModelId: "qwen", free: true });
    local.category = "local";
    local.state = { kind: "local", install: "installed" };
    expect(classifyFreeEligibility(local)).toMatchObject({ level: "guaranteed-free", eligible: true });
  });

  it("is deterministic: the same entry and declarations always give the same answer", () => {
    const model = freeTier("gemini", "gemini-2.5-flash");
    const a = classifyFreeEligibility(model, attest({ plans: ["gemini"] }));
    const b = classifyFreeEligibility(model, attest({ plans: ["gemini"] }));
    expect(a).toEqual(b);
  });
});
