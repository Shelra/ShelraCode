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

  it("reports, with each step, which model the auto router picked for that request", async () => {
    const meta = `"id":"gen-1","object":"chat.completion.chunk","created":1,"model":"vendor-x/picked-model","provider":"VendorX"`;
    const fakeFetch = async () =>
      sseResponse([
        `{${meta},"choices":[{"index":0,"delta":{"content":"hi","role":"assistant"},"finish_reason":null}]}`,
        `{${meta},"choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}`,
      ]);
    const provider = createOpenRouterProvider("secret-not-printed", {
      entries: [entry],
      modelId: "openrouter/auto",
      fetch: fakeFetch as never,
      quarantineStorePath: null,
      policy: "mixed",
    });
    const served: Array<string | undefined> = [];
    const stream = provider.stream({
      modelId: "openrouter/auto",
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      maxSteps: 1,
      onStepFinish: (event: { servedModelId?: string }) => served.push(event.servedModelId),
    } as never);
    for await (const _event of stream.events) {
      // drained
    }
    await stream.response;
    expect(served).toEqual(["openrouter/vendor-x/picked-model"]);
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
    // A session on the free router itself moves to the ranked free models.
    expect(provider.fallbackModelIds?.("openrouter/free")).toEqual([entry.id]);
  });

  it("tries the most capable free models by the catalog's ranking before the free router in Free mode", () => {
    // Seen live 2026-09-24: with the free router as the only fallback, a game was spread over ten free models, one
    // of 2.6B parameters. The router, which answers with any free model, is now the last resort.
    const free = (id: string): CatalogEntry => ({
      ...entry,
      id: `openrouter/${id}`,
      name: id,
      capabilities: { tools: true, reasoning: true, vision: false },
      state: { kind: "cloud", providerModelId: id, apiKeyConfigured: true, notes: [] },
    });
    const paid: CatalogEntry = {
      ...free("vendor/paid-400b"),
      cost: { prompt: 0.00001, completion: 0.00002, free: false },
    };
    const entries = [
      free("vendor/tiny-2.6b:free"),
      free("vendor/ultra-550b:free"),
      free("vendor/super-120b:free"),
      free("vendor/mid-32b:free"),
      paid,
    ];
    const provider = createOpenRouterProvider("secret-not-printed", { entries, quarantineStorePath: null });
    expect(provider.fallbackModelIds?.("openrouter/vendor/ultra-550b:free")).toEqual([
      "openrouter/vendor/super-120b:free",
      "openrouter/vendor/mid-32b:free",
      "openrouter/vendor/tiny-2.6b:free",
      "openrouter/free",
    ]);
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

  it("uses SHELRA_FALLBACK_MODELS when set: paid models in Mixed mode, never in Free mode", () => {
    const previous = process.env.SHELRA_FALLBACK_MODELS;
    process.env.SHELRA_FALLBACK_MODELS = "openrouter/anthropic/paid, openrouter/free, openrouter/google/gemma-3:free";
    try {
      const mixed = createOpenRouterProvider("secret-not-printed", { ...options, policy: "mixed" });
      expect(mixed.fallbackModelIds?.(entry.id)).toEqual(["openrouter/anthropic/paid", "openrouter/free"]);
      const free = createOpenRouterProvider("secret-not-printed", options);
      expect(free.fallbackModelIds?.(entry.id)).toEqual(["openrouter/free"]);
    } finally {
      if (previous === undefined) delete process.env.SHELRA_FALLBACK_MODELS;
      else process.env.SHELRA_FALLBACK_MODELS = previous;
    }
  });

  it("refuses a paid model in Free mode before any request leaves, however the turn reached it", async () => {
    // Owner, 2026-09-24: with Free active, never a paid model. A custom sub-agent's model, a per-mode model or a
    // fallback id reaches the provider without routing; the provider refuses it without calling the network.
    const calls: unknown[] = [];
    const fakeFetch = async (...args: unknown[]) => {
      calls.push(args);
      return new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 });
    };
    const paid: CatalogEntry = {
      ...entry,
      id: "openrouter/openai/gpt-6-luna-pro",
      name: "OpenAI: GPT-6 Luna Pro",
      cost: { prompt: 0.0000001, completion: 0.0000005, free: false },
      state: { kind: "cloud", providerModelId: "openai/gpt-6-luna-pro", apiKeyConfigured: true, notes: [] },
    };
    const request = { modelId: paid.id, system: "s", messages: [{ role: "user", content: "hi" }], maxSteps: 1 };
    const free = createOpenRouterProvider("secret-not-printed", {
      entries: [entry, paid],
      modelId: entry.id,
      fetch: fakeFetch as never,
      quarantineStorePath: null,
    });
    await expect(free.stream(request as never).response).rejects.toThrow("Free mode uses free models only");
    await expect(free.generateText({ modelId: paid.id, prompt: "hi" } as never)).rejects.toThrow(
      "Free mode uses free models only",
    );
    await expect(free.generateText({ modelId: "openrouter/auto", prompt: "hi" } as never)).rejects.toThrow(
      "Free mode uses free models only",
    );
    // A ":free" id the catalog does not list proves nothing about its price (review, 2026-09-24).
    for (const unlisted of ["openrouter/anthropic/claude-opus-4.1:free", "openrouter/openrouter/auto:free"]) {
      await expect(free.generateText({ modelId: unlisted, prompt: "hi" } as never)).rejects.toThrow(
        "Free mode uses free models only",
      );
    }
    expect(calls).toHaveLength(0);

    const mixed = createOpenRouterProvider("secret-not-printed", {
      entries: [entry, paid],
      modelId: paid.id,
      fetch: fakeFetch as never,
      quarantineStorePath: null,
      policy: "mixed",
    });
    const stream = mixed.stream(request as never);
    try {
      for await (const _event of stream.events) {
        // drained
      }
      await stream.response;
    } catch {
      // The fake endpoint answers 400; only that the request left matters here.
    }
    expect(calls.length).toBeGreaterThan(0);
  });

  it("never lets OpenRouter fall back to a paid model on its own side in Free mode", async () => {
    // A key fallback after a switch from Mixed to Free can carry the Mixed route's candidates.
    const bodies: Array<{ models?: string[] }> = [];
    const fakeFetch = async (_input: unknown, init?: { body?: unknown }) => {
      bodies.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 });
    };
    const paid: CatalogEntry = {
      ...entry,
      id: "openrouter/openai/gpt-6-luna-pro",
      cost: { prompt: 0.0000001, completion: 0.0000005, free: false },
      state: { kind: "cloud", providerModelId: "openai/gpt-6-luna-pro", apiKeyConfigured: true, notes: [] },
    };
    const send = async (policy: "free" | "mixed") => {
      const provider = createOpenRouterProvider("secret-not-printed", {
        entries: [entry, paid],
        modelId: entry.id,
        fallbackModels: [paid.id, "openrouter/free"],
        fetch: fakeFetch as never,
        quarantineStorePath: null,
        policy,
      });
      const stream = provider.stream({
        modelId: entry.id,
        system: "s",
        messages: [{ role: "user", content: "hi" }],
        maxSteps: 1,
      } as never);
      try {
        for await (const _event of stream.events) {
          // drained
        }
        await stream.response;
      } catch {
        // The fake endpoint answers 400; only the body that left matters here.
      }
      return bodies.at(-1)?.models;
    };

    expect(await send("free")).toEqual(["openrouter/free"]);
    expect(await send("mixed")).toEqual(["openai/gpt-6-luna-pro", "openrouter/free"]);
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
