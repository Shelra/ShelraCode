import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "../models/types";
import { buildOpenRouterRequestBody, createOpenRouterProvider, openRouterWireModelId } from "./openrouter";
import { recordQuarantinedProvider } from "./provider-quarantine";

const entry: CatalogEntry = {
  id: "openrouter/google/gemma-3:free",
  category: "cloud",
  provider: "openrouter",
  name: "Gemma 3",
  contextWindow: 32_768,
  maxOutputTokens: 8_192,
  contextConfidence: "declared",
  capabilities: { tools: true, reasoning: false, vision: false },
  cost: { prompt: 0, completion: 0, free: true },
  state: { kind: "cloud", providerModelId: "google/gemma-3:free", apiKeyConfigured: true, notes: [] },
};

describe("OpenRouter provider adapter", () => {
  it("keeps canonical ids inside Shelra and provider ids on the wire", () => {
    expect(openRouterWireModelId("openrouter/google/gemma-3:free")).toBe("google/gemma-3:free");
    expect(openRouterWireModelId("openrouter/free")).toBe("openrouter/free");
  });

  it("exposes catalog metadata through the provider-neutral runtime", () => {
    const provider = createOpenRouterProvider("secret-not-printed", { entries: [entry], modelId: entry.id });
    expect(provider.id).toBe("openrouter");
    expect(provider.resolveModelRuntime(entry.id)).toMatchObject({
      modelId: entry.id,
      modelInfo: { contextWindow: 32_768, supportsClientTools: true, category: "cloud", provider: "openrouter" },
    });
  });

  it("translates canonical fallback ids and provider policy into OpenRouter's wire body", () => {
    expect(
      buildOpenRouterRequestBody(
        { model: "qwen/qwen3-coder:free", messages: [] },
        {
          fallbackModels: ["openrouter/qwen/qwen3-coder:free", "openrouter/openai/gpt-4o-mini"],
          providerOrder: ["together", "openai"],
          allowProviderFallbacks: true,
          dataCollection: "deny",
          zeroDataRetention: true,
          requireParameters: true,
        },
      ),
    ).toMatchObject({
      models: ["qwen/qwen3-coder:free", "openai/gpt-4o-mini"],
      provider: {
        order: ["together", "openai"],
        allow_fallbacks: true,
        data_collection: "deny",
        zdr: true,
        require_parameters: true,
      },
    });
  });

  it("keeps OpenRouter router ids canonical", () => {
    expect(openRouterWireModelId("openrouter/free")).toBe("openrouter/free");
    expect(openRouterWireModelId("openrouter/auto")).toBe("openrouter/auto");
  });

  it("leaves the server fallback list bounded to the provider contract", () => {
    const body = buildOpenRouterRequestBody(
      { model: "qwen/qwen3-coder:free" },
      { fallbackModels: ["a", "b", "c", "d"] },
    );
    expect(body.models).toEqual(["a", "b", "c"]);
  });
});

describe("upstream provider quarantine", () => {
  function sseResponse(chunks: string[]): Response {
    const body = [...chunks.map((chunk) => `data: ${chunk}`), "data: [DONE]", ""].join("\n\n");
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  it("excludes an upstream that returned a content-less step from every later request", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fakeFetch = async (_input: unknown, init?: { body?: unknown }) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      const empty = bodies.length === 1;
      const meta = `"id":"gen-${bodies.length}","object":"chat.completion.chunk","created":1,"model":"${entry.id.replace("openrouter/", "")}","provider":"${empty ? "Novita" : "SiliconFlow"}"`;
      return sseResponse(
        empty
          ? [
              `{${meta},"choices":[{"index":0,"delta":{"content":"","role":"assistant"},"finish_reason":"stop"}]}`,
              `{${meta},"choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":47,"total_tokens":57}}`,
            ]
          : [
              `{${meta},"choices":[{"index":0,"delta":{"content":"hello","role":"assistant"},"finish_reason":null}]}`,
              `{${meta},"choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}`,
            ],
      );
    };
    const provider = createOpenRouterProvider("secret-not-printed", {
      entries: [entry],
      modelId: entry.id,
      fetch: fakeFetch as never,
      quarantineStorePath: null,
    });
    const request = { modelId: entry.id, system: "s", messages: [{ role: "user", content: "hi" }], maxSteps: 1 };

    const first = provider.stream(request as never);
    const firstEvents: string[] = [];
    for await (const event of first.events) firstEvents.push(event.type);
    await first.response;
    expect(firstEvents.filter((type) => type === "text-delta" || type === "tool-call")).toEqual([]);
    expect((bodies[0]?.provider as { ignore?: string[] } | undefined)?.ignore).toBeUndefined();
    expect(provider.routingNotes?.()).toEqual(["quarantined upstream provider Novita (content-less step)"]);

    const second = provider.stream(request as never);
    let text = "";
    for await (const event of second.events) if (event.type === "text-delta") text += event.text;
    await second.response;
    expect(text).toBe("hello");
    expect((bodies[1]?.provider as { ignore?: string[] }).ignore).toEqual(["Novita"]);
  });

  it("seeds the in-process quarantine from the durable store", () => {
    const dir = mkdtempSync(join(tmpdir(), "shelra-or-quarantine-"));
    const path = join(dir, "provider-quarantine.json");
    recordQuarantinedProvider({ model: entry.id, provider: "Novita", reason: "empty step" }, { path });
    const provider = createOpenRouterProvider("secret-not-printed", {
      entries: [entry],
      modelId: entry.id,
      quarantineStorePath: path,
    });
    expect(provider.routingNotes?.()).toEqual(["quarantined upstream provider Novita (content-less step)"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("puts explicit ignore lists on the wire", () => {
    expect(buildOpenRouterRequestBody({ model: "m" }, { ignoreProviders: ["Novita"] })).toMatchObject({
      provider: { ignore: ["Novita"] },
    });
  });
});

describe("OpenRouter fallback models", () => {
  const options = { entries: [entry], quarantineStorePath: null } as const;

  it("falls back to OpenRouter's free router under the free policy, never to a hand-picked model", () => {
    const provider = createOpenRouterProvider("secret-not-printed", options);
    expect(provider.fallbackModelIds?.(entry.id)).toEqual(["openrouter/free"]);
    expect(provider.fallbackModelIds?.("openrouter/free")).toEqual([]);
  });

  it("keeps a hand-chosen model (custom policy) off paid routing", () => {
    const provider = createOpenRouterProvider("secret-not-printed", { ...options, policy: "custom" });
    expect(provider.fallbackModelIds?.("openrouter/anthropic/paid")).toEqual(["openrouter/free"]);
  });

  it("falls back to the paid auto router, then the free router, under a paid policy", () => {
    const provider = createOpenRouterProvider("secret-not-printed", { ...options, policy: "balanced" });
    expect(provider.fallbackModelIds?.("openrouter/anthropic/paid")).toEqual(["openrouter/auto", "openrouter/free"]);
  });

  it("never replaces a strict (measured) model", () => {
    const provider = createOpenRouterProvider("secret-not-printed", { ...options, strictModel: true });
    expect(provider.fallbackModelIds?.(entry.id)).toEqual([]);
  });

  it("uses SHELRA_FALLBACK_MODELS when set, paid models included", () => {
    const previous = process.env.SHELRA_FALLBACK_MODELS;
    process.env.SHELRA_FALLBACK_MODELS = "openrouter/anthropic/paid, openrouter/google/gemma-3:free";
    try {
      const provider = createOpenRouterProvider("secret-not-printed", options);
      expect(provider.fallbackModelIds?.(entry.id)).toEqual(["openrouter/anthropic/paid"]);
    } finally {
      if (previous === undefined) delete process.env.SHELRA_FALLBACK_MODELS;
      else process.env.SHELRA_FALLBACK_MODELS = previous;
    }
  });

  it("bounds the auto router by the policy's cost tier", () => {
    expect(buildOpenRouterRequestBody({ model: "openrouter/auto" }, { policy: "economy" })).toMatchObject({
      plugins: [{ id: "auto-router", cost_tier: "low" }],
    });
    expect(buildOpenRouterRequestBody({ model: "openrouter/auto" }, { policy: "auto" })).not.toHaveProperty("plugins");
    expect(buildOpenRouterRequestBody({ model: "google/gemma-3:free" }, { policy: "economy" })).not.toHaveProperty(
      "plugins",
    );
  });

  it("never reports the auto router as free when the catalog lacks it", () => {
    const provider = createOpenRouterProvider("secret-not-printed", { entries: [], quarantineStorePath: null });
    expect(provider.resolveModelRuntime("openrouter/auto").modelInfo?.pricingKnown).toBe(false);
  });
});
