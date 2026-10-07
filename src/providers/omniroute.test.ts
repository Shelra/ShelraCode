import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { jsonSchema, tool } from "ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CatalogService } from "../routing/catalog-service";
import { HealthTracker } from "../routing/health";
import { drain } from "../routing/test-fixtures";
import { omniRouteDefinition } from "./definitions/omniroute";
import {
  fetchOmniRouteCatalog,
  isOmniRouteRouterId,
  isValidOmniRouteBaseURL,
  normalizeOmniRouteBaseURL,
  omniRouteUpstream,
  parseOmniRouteModels,
  readServedHeaders,
} from "./omniroute";
import { type ProviderConfig, ProviderRegistry, type ResolveDeps } from "./registry";
import { NoFreeRouteError, RoutingProvider } from "./routing-provider";
import type { ProviderEvent, ProviderStreamRequest } from "./types";

/** A fake OmniRoute: the parts of its documented HTTP surface Shelra uses, scripted per test. */
interface Fake {
  server: Server;
  url: string;
  requests: Array<{ method: string; path: string; headers: IncomingMessage["headers"]; body: string }>;
  chatRequests(): number;
  behavior: {
    apiKey?: string;
    models: unknown;
    modelsStatus: number;
    modelsBody?: string;
    modelsHang: boolean;
    chat: "ok" | "tool" | "reasoning" | "401" | "429" | "500" | "garbage" | "hang" | "diverted";
    servedProvider: string;
    servedModel: string;
    cost?: string;
  };
}

function sse(response: ServerResponse, chunks: unknown[], headers: Record<string, string> = {}): void {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", ...headers });
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  response.write("data: [DONE]\n\n");
  response.end();
}

const chunk = (delta: Record<string, unknown>, finish: string | null = null, extra: Record<string, unknown> = {}) => ({
  id: "chatcmpl-1",
  object: "chat.completion.chunk",
  created: 1,
  model: "served-by-omniroute",
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...extra,
});

const USAGE = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };

async function startFake(): Promise<Fake> {
  const fake = {} as Fake;
  fake.requests = [];
  fake.chatRequests = () => fake.requests.filter((request) => request.path.endsWith("/chat/completions")).length;
  fake.behavior = {
    models: {
      object: "list",
      data: [
        { id: "auto", object: "model", owned_by: "omniroute" },
        { id: "auto/coding:free", object: "model", owned_by: "omniroute" },
        { id: "my-combo", object: "model", owned_by: "combo" },
        { id: "groq/openai/gpt-oss-120b", object: "model", owned_by: "groq", context_length: 131_072 },
        { id: "opencode-free/big-pickle", object: "model", owned_by: "opencode-free" },
        {
          id: "openai/gpt-5",
          object: "model",
          owned_by: "openai",
          pricing: { prompt: "0.00000125", completion: "0.00001" },
        },
        { id: "groq/whisper-large-v3", object: "model", owned_by: "groq" },
        { id: "groq/openai/gpt-oss-120b", object: "model", owned_by: "groq" },
      ],
    },
    modelsStatus: 200,
    modelsHang: false,
    chat: "ok",
    servedProvider: "groq",
    servedModel: "openai/gpt-oss-120b",
  };
  fake.server = createServer((request, response) => {
    let body = "";
    request.on("data", (part) => {
      body += part;
    });
    request.on("end", () => {
      fake.requests.push({ method: request.method ?? "", path: request.url ?? "", headers: request.headers, body });
      const { behavior } = fake;
      if (behavior.apiKey && request.headers.authorization !== `Bearer ${behavior.apiKey}`) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Invalid API key" } }));
        return;
      }
      if (request.url?.startsWith("/v1/models")) {
        if (behavior.modelsHang) return;
        response.writeHead(behavior.modelsStatus, { "content-type": "application/json" });
        response.end(behavior.modelsBody ?? JSON.stringify(behavior.models));
        return;
      }
      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        const served: Record<string, string> = {
          "x-omniroute-provider": behavior.servedProvider,
          "x-omniroute-model": behavior.servedModel,
          ...(behavior.cost ? { "x-omniroute-response-cost": behavior.cost } : {}),
        };
        const wantsStream = (JSON.parse(body) as { stream?: boolean }).stream === true;
        switch (behavior.chat) {
          case "401":
            response.writeHead(401, { "content-type": "application/json" });
            response.end(JSON.stringify({ error: { message: "Invalid API key" } }));
            return;
          case "429":
            response.writeHead(429, { "content-type": "application/json", "retry-after": "30" });
            response.end(JSON.stringify({ error: { message: "Rate limit reached" } }));
            return;
          case "500":
            response.writeHead(500, { "content-type": "application/json" });
            response.end(JSON.stringify({ error: { message: "upstream exploded" } }));
            return;
          case "hang":
            return;
          case "garbage":
            response.writeHead(200, { "content-type": "text/event-stream", ...served });
            response.write("data: {this is not json\n\n");
            response.end();
            return;
          case "tool":
            sse(
              response,
              [
                chunk({
                  role: "assistant",
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: { name: "read_file", arguments: '{"path":"a.ts"}' },
                    },
                  ],
                }),
                chunk({}, "tool_calls", { usage: USAGE }),
              ],
              served,
            );
            return;
          case "reasoning":
            sse(
              response,
              [
                chunk({ role: "assistant", reasoning_content: "thinking about it" }),
                chunk({ content: "The answer" }),
                chunk({}, "stop", { usage: USAGE }),
              ],
              served,
            );
            return;
          default:
            if (!wantsStream) {
              response.writeHead(200, { "content-type": "application/json", ...served });
              response.end(
                JSON.stringify({
                  id: "x",
                  object: "chat.completion",
                  created: 1,
                  model: "served-by-omniroute",
                  choices: [{ index: 0, message: { role: "assistant", content: "A title" }, finish_reason: "stop" }],
                  usage: USAGE,
                }),
              );
              return;
            }
            sse(
              response,
              [
                chunk({ role: "assistant", content: "Hel" }),
                chunk({ content: "lo" }),
                chunk({}, "stop", { usage: USAGE }),
              ],
              served,
            );
        }
        return;
      }
      response.writeHead(404);
      response.end();
    });
  });
  await new Promise<void>((resolve) => fake.server.listen(0, "127.0.0.1", resolve));
  fake.url = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}/v1`;
  return fake;
}

let fake: Fake;
beforeEach(async () => {
  fake = await startFake();
  process.env.SHELRA_STREAM_IDLE_MS = "1500";
});
afterEach(async () => {
  delete process.env.SHELRA_STREAM_IDLE_MS;
  fake.server.closeAllConnections();
  await new Promise<void>((resolve) => fake.server.close(() => resolve()));
});

const config = (baseURL: string, apiKey?: string): ProviderConfig => ({
  providerId: "omniroute",
  baseURL,
  ...(apiKey ? { credential: { apiKey } } : {}),
  source: "test",
});

const deps =
  (baseUrl: string, apiKey?: string): (() => ResolveDeps) =>
  () => ({
    env: {},
    storedCredential: (id) => (id === "omniroute" && apiKey ? { apiKey } : undefined),
    settings: { omniroute: { baseUrl } },
  });

describe("OmniRoute catalog", () => {
  it("lists models once each, with routers and upstreams identified and non-chat models left out", async () => {
    const entries = await fetchOmniRouteCatalog(config(fake.url));
    const ids = entries.map((entry) => entry.id);
    expect(ids).toEqual([
      "omniroute/auto",
      "omniroute/auto/coding:free",
      "omniroute/my-combo",
      "omniroute/groq/openai/gpt-oss-120b",
      "omniroute/opencode-free/big-pickle",
      "omniroute/openai/gpt-5",
    ]);
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    for (const router of ["omniroute/auto", "omniroute/auto/coding:free", "omniroute/my-combo"]) {
      expect(byId.get(router)?.state).toMatchObject({ router: true });
    }
    expect(byId.get("omniroute/groq/openai/gpt-oss-120b")).toMatchObject({
      provider: "omniroute",
      contextWindow: 131_072,
      cost: { free: false, basis: "unverified" },
      state: { upstream: "groq", providerModelId: "groq/openai/gpt-oss-120b" },
    });
    // A price a gateway lists is read; any positive price marks the model paid.
    expect(byId.get("omniroute/openai/gpt-5")?.cost.prompt).toBeGreaterThan(0);
    // The request asked for one canonical id per model.
    expect(fake.requests[0]?.path).toBe("/v1/models?prefix=canonical");
  });

  it("sends the key as a Bearer token, and nothing on a keyless install", async () => {
    fake.behavior.apiKey = "omni-secret";
    await expect(fetchOmniRouteCatalog(config(fake.url))).rejects.toThrow(/refused the key/);
    await fetchOmniRouteCatalog(config(fake.url, "omni-secret"));
    const keyed = fake.requests.at(-1);
    expect(keyed?.headers.authorization).toBe("Bearer omni-secret");

    fake.behavior.apiKey = undefined;
    fake.requests.length = 0;
    await fetchOmniRouteCatalog(config(fake.url));
    expect(fake.requests[0]?.headers.authorization).toBeUndefined();
  });

  it("fails cleanly on a refused key, a server error, a payload that is not JSON and an empty list", async () => {
    fake.behavior.apiKey = "right";
    await expect(fetchOmniRouteCatalog(config(fake.url, "wrong"))).rejects.toThrow(/refused the key \(HTTP 401\)/);
    fake.behavior.apiKey = undefined;
    fake.behavior.modelsStatus = 500;
    await expect(fetchOmniRouteCatalog(config(fake.url))).rejects.toThrow(/HTTP 500/);
    fake.behavior.modelsStatus = 200;
    fake.behavior.modelsBody = "<html>not json</html>";
    await expect(fetchOmniRouteCatalog(config(fake.url))).rejects.toThrow(/not JSON/);
    fake.behavior.modelsBody = JSON.stringify({ data: [] });
    await expect(fetchOmniRouteCatalog(config(fake.url))).rejects.toThrow(/no usable models/);
    fake.behavior.modelsBody = JSON.stringify({ data: [null, 5, { id: 7 }, { nope: true }] });
    await expect(fetchOmniRouteCatalog(config(fake.url))).rejects.toThrow(/no usable models/);
  });

  it("gives up on a gateway that does not answer, within its bound", async () => {
    fake.behavior.modelsHang = true;
    const started = Date.now();
    await expect(fetchOmniRouteCatalog(config(fake.url), {}, 150)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("fails fast when nothing listens on the address", async () => {
    const dead = fake.url.replace(/:\d+/u, ":9");
    const started = Date.now();
    await expect(fetchOmniRouteCatalog(config(dead), {}, 1_000)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("reads addresses the way a person writes them", () => {
    expect(normalizeOmniRouteBaseURL("http://localhost:20128")).toBe("http://localhost:20128/v1");
    expect(normalizeOmniRouteBaseURL("http://localhost:20128/")).toBe("http://localhost:20128/v1");
    expect(normalizeOmniRouteBaseURL("http://localhost:20128/v1/")).toBe("http://localhost:20128/v1");
    expect(normalizeOmniRouteBaseURL("https://gateway.example/proxy/v1")).toBe("https://gateway.example/proxy/v1");
    expect(isValidOmniRouteBaseURL("http://localhost:20128")).toBe(true);
    expect(isValidOmniRouteBaseURL("ftp://x")).toBe(false);
    expect(isValidOmniRouteBaseURL("localhost:20128")).toBe(false);
  });

  it("tells a routing alias from a concrete provider/model", () => {
    for (const id of ["auto", "auto/coding", "auto/fast:free", "AUTO/CHEAP"])
      expect(isOmniRouteRouterId(id), id).toBe(true);
    expect(isOmniRouteRouterId("my-combo", "combo")).toBe(true);
    expect(isOmniRouteRouterId("groq/llama")).toBe(false);
    expect(omniRouteUpstream("groq/openai/gpt-oss-120b")).toBe("groq");
    expect(omniRouteUpstream("auto/coding")).toBeUndefined();
    expect(omniRouteUpstream("bare-model")).toBeUndefined();
  });

  it("never lets a gateway's zero price or free flag mark a model free", () => {
    const [model] = parseOmniRouteModels(
      { data: [{ id: "groq/zero", pricing: { prompt: 0, completion: 0 }, free: true }] },
      "2026-10-06T00:00:00Z",
    );
    expect(model?.cost).toMatchObject({ prompt: 0, completion: 0, free: false, basis: "unverified" });
  });
});

describe("OmniRoute adapter", () => {
  const adapterFor = (apiKey?: string, onServed?: (routeId: string, served: unknown) => void) =>
    omniRouteDefinition().createAdapter(config(fake.url, apiKey), {
      policy: () => "mixed",
      entries: () => [],
      ...(onServed ? { onServed: onServed as never } : {}),
    });
  const request = (extra: Partial<ProviderStreamRequest> = {}): ProviderStreamRequest => ({
    modelId: "omniroute/groq/openai/gpt-oss-120b",
    system: "be brief",
    messages: [{ role: "user", content: "hi" }],
    maxSteps: 1,
    ...extra,
  });

  it("streams text and reports which provider and model really answered, and what it cost", async () => {
    fake.behavior.cost = "0.0000123450";
    const steps: Array<Parameters<NonNullable<ProviderStreamRequest["onStepFinish"]>>[0]> = [];
    const adapter = adapterFor("k");
    const result = await drain(adapter.stream(request({ onStepFinish: (event) => steps.push(event) })));
    expect(result.error).toBeUndefined();
    expect(
      result.events
        .filter((event) => event.type === "text-delta")
        .map((event) => (event as { text: string }).text)
        .join(""),
    ).toBe("Hello");
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      servedProviderId: "groq",
      servedModelId: "omniroute/groq/openai/gpt-oss-120b",
      usage: { inputTokens: 11, outputTokens: 7, costUsdTicks: 12 },
    });
    // The wire id is the provider's own, not the canonical one.
    const sent = JSON.parse(fake.requests.find((item) => item.path.endsWith("/chat/completions"))?.body ?? "{}");
    expect(sent.model).toBe("groq/openai/gpt-oss-120b");
  });

  it("does not claim the alias was the underlying model", async () => {
    fake.behavior.servedProvider = "cerebras";
    fake.behavior.servedModel = "qwen-3-235b";
    const steps: Array<{ servedModelId?: string; servedProviderId?: string }> = [];
    await drain(
      adapterFor().stream(request({ modelId: "omniroute/auto/coding", onStepFinish: (event) => steps.push(event) })),
    );
    expect(steps[0]).toEqual(
      expect.objectContaining({ servedProviderId: "cerebras", servedModelId: "omniroute/cerebras/qwen-3-235b" }),
    );
  });

  it("streams tool calls", async () => {
    fake.behavior.chat = "tool";
    const tools = {
      read_file: tool({
        description: "read",
        inputSchema: jsonSchema({ type: "object", properties: { path: { type: "string" } } }),
      }),
    };
    const result = await drain(adapterFor().stream(request({ tools })));
    const call = result.events.find(
      (event): event is Extract<ProviderEvent, { type: "tool-call" }> => event.type === "tool-call",
    );
    expect(call?.toolCall.function.name).toBe("read_file");
    expect(JSON.parse(call?.toolCall.function.arguments ?? "{}")).toEqual({ path: "a.ts" });
  });

  it("streams reasoning apart from the answer", async () => {
    fake.behavior.chat = "reasoning";
    const result = await drain(adapterFor().stream(request()));
    expect(result.events.some((event) => event.type === "reasoning-delta")).toBe(true);
    expect(
      result.events
        .filter((event) => event.type === "text-delta")
        .map((event) => (event as { text: string }).text)
        .join(""),
    ).toBe("The answer");
  });

  it("works without a key, and sends none", async () => {
    await drain(adapterFor().stream(request()));
    const chat = fake.requests.find((item) => item.path.endsWith("/chat/completions"));
    expect(chat?.headers.authorization).toBeUndefined();
  });

  it("sends the key when there is one", async () => {
    fake.behavior.apiKey = "omni-secret";
    const ok = await drain(adapterFor("omni-secret").stream(request()));
    expect(ok.error).toBeUndefined();
    const refused = await drain(adapterFor("wrong").stream(request()));
    expect(refused.error).toBeDefined();
  });

  for (const [mode, status] of [
    ["401", 401],
    ["429", 429],
    ["500", 500],
  ] as const) {
    it(`surfaces HTTP ${status} as an error the turn can classify, without hanging`, async () => {
      fake.behavior.chat = mode;
      const started = Date.now();
      const result = await drain(adapterFor("k").stream(request()));
      expect(Date.now() - started).toBeLessThan(10_000);
      const error = result.error as { statusCode?: number; lastError?: { statusCode?: number } } | undefined;
      expect(error?.statusCode ?? error?.lastError?.statusCode).toBe(status);
    });
  }

  it("ends a malformed stream with an error instead of waiting", async () => {
    fake.behavior.chat = "garbage";
    const started = Date.now();
    const result = await drain(adapterFor().stream(request()));
    expect(result.error).toBeDefined();
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("ends a stream the gateway never answers by its idle budget", async () => {
    fake.behavior.chat = "hang";
    process.env.SHELRA_STREAM_IDLE_MS = "400";
    const started = Date.now();
    const result = await drain(adapterFor().stream(request({ timeout: { chunkMs: 300 } })));
    expect(result.error).toBeDefined();
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  it("reports the served route of an auxiliary call too", async () => {
    fake.behavior.cost = "0";
    const seen: unknown[] = [];
    const adapter = adapterFor("k", (routeId, served) => seen.push({ routeId, served }));
    const text = await adapter.generateText({
      modelId: "omniroute/groq/openai/gpt-oss-120b",
      system: "s",
      prompt: "p",
    });
    expect(text.text).toBe("A title");
    expect(seen).toEqual([
      {
        routeId: "omniroute/groq/openai/gpt-oss-120b",
        served: { servedProviderId: "groq", servedModelId: "groq/openai/gpt-oss-120b", costUsd: 0 },
      },
    ]);
  });

  it("reads the served headers, whatever is present", () => {
    const headers = new Headers({
      "x-omniroute-provider": "Groq",
      "x-omniroute-model": "groq/llama",
      "x-omniroute-response-cost": "0.5",
    });
    expect(readServedHeaders(headers)).toEqual({ servedProviderId: "groq", servedModelId: "groq/llama", costUsd: 0.5 });
    expect(readServedHeaders(new Headers())).toBeNull();
    expect(readServedHeaders(new Headers({ "x-omniroute-model": "m" }))).toEqual({ servedModelId: "m" });
    expect(readServedHeaders(new Headers({ "x-omniroute-response-cost": "oops" }))).toBeNull();
  });
});

describe("OmniRoute in the router: the fail-open defense", () => {
  function routed(options: { vouched?: string[]; extraDeps?: ResolveDeps["settings"] } = {}) {
    const registry = new ProviderRegistry([omniRouteDefinition()]);
    const resolveDeps = deps(fake.url, "k");
    const catalog = new CatalogService({ registry, resolveDeps, cacheDir: null });
    const clock = { now: 20_000_000 };
    const events: unknown[] = [];
    const provider = new RoutingProvider({
      registry,
      catalog,
      health: new HealthTracker({ now: () => clock.now }),
      resolveDeps,
      policy: () => "free",
      attestations: () => ({
        freePlanProviders: new Set(),
        freeModelPatterns: (options.vouched ? { omniroute: options.vouched } : {}) as Record<string, readonly string[]>,
      }),
      now: () => clock.now,
      onEvent: (event) => events.push(event),
      catalogWaitMs: 3_000,
    });
    return { provider, catalog, clock, events };
  }
  const free = (): ProviderStreamRequest => ({
    modelId: "shelra/free",
    system: "s",
    messages: [{ role: "user", content: "hi" }],
    maxSteps: 1,
  });

  it("sends nothing when OmniRoute's catalog proves nothing free, even with auto/…:free listed", async () => {
    const { provider, catalog } = routed();
    await catalog.refresh();
    const result = await drain(provider.stream(free()));
    expect(result.error).toBeInstanceOf(NoFreeRouteError);
    expect(fake.chatRequests()).toBe(0);
    // Pinning the alias, or an unvouched model by name, is refused as well.
    for (const modelId of [
      "omniroute/auto/coding:free",
      "omniroute/groq/openai/gpt-oss-120b",
      "omniroute/openai/gpt-5",
    ]) {
      const pinned = await drain(provider.stream({ ...free(), modelId }));
      expect(pinned.error, modelId).toBeDefined();
    }
    expect(fake.chatRequests()).toBe(0);
  });

  it("runs a model the user vouched for, and never an alias even when the pattern is a wildcard", async () => {
    const { provider, catalog } = routed({ vouched: ["opencode-free/*", "*"] });
    await catalog.refresh();
    fake.behavior.servedProvider = "opencode-free";
    fake.behavior.servedModel = "big-pickle";
    const result = await drain(provider.stream(free()));
    expect(result.error).toBeUndefined();
    const chat = fake.requests.find((item) => item.path.endsWith("/chat/completions"));
    const model = (JSON.parse(chat?.body ?? "{}") as { model: string }).model;
    expect(["opencode-free/big-pickle", "groq/openai/gpt-oss-120b", "openai/gpt-5"]).toContain(model);
    // "*" vouches for every concrete model name, including the paid one's: the price listing refuses that one.
    expect(model).not.toBe("openai/gpt-5");
    expect(["auto", "auto/coding:free", "my-combo"]).not.toContain(model);
  });

  it("catches a gateway that fails open: the first charged answer takes OmniRoute out of Free for the session", async () => {
    const { provider, catalog, clock, events } = routed({ vouched: ["groq/*"] });
    await catalog.refresh();
    // The free-filtered route has no candidate left, and the gateway quietly serves a paid model.
    fake.behavior.servedProvider = "openai";
    fake.behavior.servedModel = "gpt-5";
    fake.behavior.cost = "0.0213";
    const first = await drain(provider.stream(free()));
    expect(first.error).toBeUndefined();
    expect(fake.chatRequests()).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({ type: "violation" }));
    // It happens once: later Free requests no longer reach OmniRoute.
    clock.now += 3_600_000;
    const second = await drain(provider.stream(free()));
    expect(second.error).toBeInstanceOf(NoFreeRouteError);
    const aux = provider.generateText({ modelId: "shelra/free", system: "s", prompt: "p" });
    await expect(aux).rejects.toBeInstanceOf(NoFreeRouteError);
    expect(fake.chatRequests()).toBe(1);
  });

  it("catches a gateway that forwards to another provider than the model names, even at no charge", async () => {
    const { provider, catalog, events } = routed({ vouched: ["groq/*"] });
    await catalog.refresh();
    fake.behavior.servedProvider = "openai";
    fake.behavior.servedModel = "gpt-5";
    delete fake.behavior.cost;
    await drain(provider.stream(free()));
    expect(events).toContainEqual(expect.objectContaining({ type: "violation" }));
  });

  it("stays responsive when OmniRoute is offline, and the other providers are unaffected", async () => {
    const { provider, catalog } = routed({ vouched: ["opencode-free/*"] });
    fake.behavior.modelsHang = true;
    const registry = new ProviderRegistry([omniRouteDefinition()]);
    void registry;
    const started = Date.now();
    await catalog.refresh();
    // The discovery bound is a few seconds; a stalled gateway never holds the UI longer.
    expect(Date.now() - started).toBeLessThan(6_000);
    expect(catalog.snapshot().entries).toHaveLength(0);
    expect(catalog.status()[0]?.status).toBe("unavailable");
    const result = await drain(provider.stream(free()));
    expect(result.error).toBeInstanceOf(NoFreeRouteError);
  }, 15_000);
});

describe("the hosted gateway's model list (Cheaper Inference, the production default)", () => {
  // The shape its /v1/models answers with: prices per million tokens as strings, capabilities as an object, a type.
  const body = {
    data: [
      {
        id: "claude-sonnet-5.5",
        owned_by: "Anthropic",
        type: "text",
        endpoint: "/v1/chat/completions",
        context_length: 200_000,
        is_free: false,
        capabilities: { vision: true, reasoning: true, streaming: true },
        pricing: { input_per_million: "3.000000", output_per_million: "15.000000" },
      },
      {
        id: "deepseek-v4.1-flash",
        owned_by: "DeepSeek",
        type: "text",
        endpoint: "/v1/chat/completions",
        context_length: 128_000,
        capabilities: { vision: false, reasoning: false },
        pricing: { input_per_million: "0.140000", output_per_million: "0.280000" },
      },
      { id: "nano-banana", type: "image", endpoint: "/v1/images/generations", pricing: { input_per_million: "0" } },
      { id: "seedance-2.0", type: "video", endpoint: "/v1/videos/generations" },
    ],
  };

  it("lists the chat models only, with their real prices, context and capabilities", () => {
    const entries = parseOmniRouteModels(body, "2026-10-07T00:00:00.000Z");
    expect(entries.map((entry) => entry.id)).toEqual(["omniroute/claude-sonnet-5.5", "omniroute/deepseek-v4.1-flash"]);
    const sonnet = entries[0];
    expect(sonnet?.cost).toMatchObject({ pricingKnown: true, free: false });
    expect(sonnet?.cost.prompt).toBeCloseTo(0.000003, 9);
    expect(sonnet?.cost.completion).toBeCloseTo(0.000015, 9);
    expect(sonnet?.contextWindow).toBe(200_000);
    expect(sonnet?.capabilities).toMatchObject({ vision: true, reasoning: true });
    expect(entries[1]?.capabilities).toMatchObject({ vision: false, reasoning: false });
  });

  it("is never Free mode's, whatever its prices say", () => {
    const flagged = {
      data: [{ id: "tiny", type: "text", is_free: true, pricing: { input_per_million: "0", output_per_million: "0" } }],
    };
    const [entry] = parseOmniRouteModels(flagged, "2026-10-07T00:00:00.000Z");
    expect(entry?.cost.free).toBe(false);
  });
});
