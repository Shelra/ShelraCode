import { describe, expect, it } from "vitest";
import { createLocalRuntimeAdapters, discoverLocalRuntimes } from "./discovery";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("local runtime discovery", () => {
  it("uses the Shelra-managed runtime by default and only probes explicit endpoints", async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      const url = String(input);
      calls.push(url);
      return response({ data: [{ id: "local-coder", context_length: 65_536 }] });
    };
    const adapters = createLocalRuntimeAdapters({ SHELRA_LOCAL_ENDPOINT: "http://127.0.0.1:8080/v1" }, fetchImpl);
    expect(adapters.map((adapter) => adapter.id)).toEqual(["shelra-llama", "local-openai"]);
    const result = await discoverLocalRuntimes(adapters.slice(1));
    expect(result.models.map((model) => model.name)).toEqual(["local-coder"]);
    expect(calls.some((url) => url.includes("/models"))).toBe(true);
  });

  it("does not discover vendor runtimes implicitly", () => {
    const adapters = createLocalRuntimeAdapters({
      SOME_VENDOR_URL: "http://127.0.0.1:11434",
      OTHER_VENDOR_URL: "http://127.0.0.1:1234/v1",
      LEGACY_LOCAL_URL: "http://127.0.0.1:8080/v1",
    });
    expect(adapters.map((adapter) => adapter.id)).toEqual(["shelra-llama"]);
  });

  it("keeps an installable managed runtime visible before its binary exists", async () => {
    const adapter = {
      id: "shelra-llama",
      kind: "managed-llama" as const,
      baseURL: "http://127.0.0.1:19199/v1",
      detect: async () => false,
      health: async () => ({ healthy: false, reason: "binary missing" }),
      listModels: async () => [],
      installModel: async () => ({ success: true }),
      provider: () => {
        throw new Error("provider should not be needed during discovery");
      },
    };
    const result = await discoverLocalRuntimes([adapter]);
    expect(result.runtimes.map((runtime) => runtime.id)).toEqual(["shelra-llama"]);
    expect(result.models).toHaveLength(0);
  });
});
