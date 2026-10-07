import { describe, expect, it } from "vitest";
import { guardUndeclaredEndpoint, isLoopbackEndpoint } from "./free-guard";
import { FreeModeRefusalError } from "./routing-provider";
import type { ProviderAdapter } from "./types";

function adapter(calls: string[]): ProviderAdapter {
  return {
    id: "custom-model",
    resolveModelRuntime: (modelId) => ({ modelId, modelInfo: undefined }),
    stream: () => {
      calls.push("stream");
      return { events: (async function* () {})(), response: Promise.resolve({}) } as never;
    },
    generateText: async () => {
      calls.push("text");
      return { text: "ok", modelId: "custom-model" };
    },
    getToolContext: () => ({}) as never,
  } as ProviderAdapter;
}

describe("the user's own endpoint in Free mode", () => {
  const remote = "https://api.example-llm.invalid/v1";

  it("is refused: Shelra cannot see its price, and unknown cost is not free", async () => {
    const calls: string[] = [];
    const guarded = guardUndeclaredEndpoint(adapter(calls), { endpoint: remote, policy: () => "free", env: {} });
    await expect(guarded.generateText({ modelId: "m", system: "s", prompt: "p" })).rejects.toBeInstanceOf(
      FreeModeRefusalError,
    );
    await expect(guarded.stream({ modelId: "m" } as never).response).rejects.toBeInstanceOf(FreeModeRefusalError);
    expect(calls).toEqual([]);
  });

  it("is used when the person declared it free, or it runs on this machine", async () => {
    const calls: string[] = [];
    const declared = guardUndeclaredEndpoint(adapter(calls), {
      endpoint: remote,
      policy: () => "free",
      env: { SHELRA_ENDPOINT_FREE: "1" },
    });
    await declared.generateText({ modelId: "m", system: "s", prompt: "p" });
    const local = guardUndeclaredEndpoint(adapter(calls), {
      endpoint: "http://127.0.0.1:8080/v1",
      policy: () => "free",
      env: {},
    });
    await local.generateText({ modelId: "m", system: "s", prompt: "p" });
    expect(calls).toEqual(["text", "text"]);
  });

  it("is used in Mixed mode as before", async () => {
    const calls: string[] = [];
    const guarded = guardUndeclaredEndpoint(adapter(calls), { endpoint: remote, policy: () => "mixed", env: {} });
    await guarded.generateText({ modelId: "m", system: "s", prompt: "p" });
    expect(calls).toEqual(["text"]);
  });

  it("recognizes this machine's own addresses and nothing that merely looks like one", () => {
    for (const url of ["http://localhost:1234/v1", "http://127.0.0.1/v1", "http://[::1]:8080/v1"])
      expect(isLoopbackEndpoint(url), url).toBe(true);
    for (const url of ["https://localhost.evil.example/v1", "http://127.0.0.1.evil.example/v1", "not a url"])
      expect(isLoopbackEndpoint(url), url).toBe(false);
  });
});
