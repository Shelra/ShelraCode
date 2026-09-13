import { mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOpenRouterCatalog, normalizeOpenRouterModel, parseOpenRouterModels } from "./openrouter";

const rawModel = {
  id: "qwen/qwen3-coder:free",
  name: "Qwen 3 Coder",
  description: "A coding model",
  context_length: 32_768,
  supported_parameters: ["tools", "tool_choice", "reasoning", "structured_outputs"],
  architecture: { input_modalities: ["text", "image"] },
  pricing: { prompt: "0", completion: "0", request: "0" },
  top_provider: { context_length: 16_384, max_completion_tokens: 4_096, is_moderated: false },
};

describe("OpenRouter model catalog", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("normalizes current OpenRouter fields and does not assume top-level context", () => {
    const entry = normalizeOpenRouterModel(rawModel, true, "2026-09-12T00:00:00.000Z");
    expect(entry).toMatchObject({
      id: "openrouter/qwen/qwen3-coder:free",
      contextWindow: 16_384,
      maxOutputTokens: 4_096,
      capabilities: { tools: true, reasoning: true, vision: true, structuredOutput: true },
      cost: { prompt: 0, completion: 0, free: true },
      state: { kind: "cloud", providerModelId: "qwen/qwen3-coder:free", apiKeyConfigured: true },
    });
  });

  it("does not double-prefix OpenRouter's free router catalog entry", () => {
    const entry = normalizeOpenRouterModel({
      id: "openrouter/free",
      name: "Free Models Router",
      context_length: 32_768,
      pricing: { prompt: "0", completion: "0" },
    });
    expect(entry?.id).toBe("openrouter/free");
    expect(entry?.state).toMatchObject({ providerModelId: "openrouter/free" });
  });

  it("never classifies OpenRouter auto routers as free from zero router pricing", () => {
    const auto = normalizeOpenRouterModel({
      id: "openrouter/auto",
      name: "Auto Router",
      pricing: { prompt: "0", completion: "0", request: "0" },
    });
    const free = normalizeOpenRouterModel({
      id: "openrouter/free",
      name: "Free Models Router",
      pricing: {},
    });

    expect(auto?.cost).toMatchObject({ free: false, pricingKnown: false });
    expect(free?.cost).toMatchObject({ free: true, pricingKnown: true });
  });

  it("skips malformed entries and preserves sparse catalog responses", () => {
    expect(parseOpenRouterModels({ data: [null, { name: "missing id" }, rawModel] })).toHaveLength(1);
    const sparse = normalizeOpenRouterModel({ id: "vendor/sparse", pricing: {} });
    expect(sparse?.contextWindow).toBe(8_192);
    expect(sparse?.contextConfidence).toBe("assumed");
    expect(sparse?.cost.free).toBe(false);
  });

  it("uses a fresh cache without a network request", async () => {
    const root = mkdtempSync(join(tmpdir(), "shelra-openrouter-"));
    roots.push(root);
    const cachePath = join(root, "catalog.json");
    const fetchedAt = new Date(1_700_000_000_000).toISOString();
    const entries = parseOpenRouterModels({ data: [rawModel] }, false, fetchedAt);
    await mkdir(root, { recursive: true });
    await writeFile(cachePath, JSON.stringify({ version: 1, fetchedAt, entries }));
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await fetchOpenRouterCatalog({ cachePath, now: () => 1_700_000_100_000, fetchImpl });
    expect(result.source).toBe("cache");
    expect(result.entries).toHaveLength(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refreshes stale cache and falls back to it when the API is unavailable", async () => {
    const root = mkdtempSync(join(tmpdir(), "shelra-openrouter-"));
    roots.push(root);
    const cachePath = join(root, "catalog.json");
    const fetchedAt = new Date(1_700_000_000_000).toISOString();
    const entries = parseOpenRouterModels({ data: [rawModel] }, false, fetchedAt);
    await writeFile(cachePath, JSON.stringify({ version: 1, fetchedAt, entries }));
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    const result = await fetchOpenRouterCatalog({ cachePath, now: () => 1_800_000_000_000, fetchImpl });
    expect(result.source).toBe("stale-cache");
    expect(result.error).toContain("offline");
    expect(result.entries[0]?.state).toMatchObject({ apiKeyConfigured: false });
  });

  it("repairs the previous double-prefixed free-router id when reading cache", async () => {
    const root = mkdtempSync(join(tmpdir(), "shelra-openrouter-"));
    roots.push(root);
    const cachePath = join(root, "catalog.json");
    const fetchedAt = new Date(1_700_000_000_000).toISOString();
    const entry = normalizeOpenRouterModel(
      { id: "openrouter/free", name: "Free Router", pricing: { prompt: "0", completion: "0" } },
      false,
      fetchedAt,
    );
    await writeFile(
      cachePath,
      JSON.stringify({ version: 1, fetchedAt, entries: [{ ...entry, id: "openrouter/openrouter/free" }] }),
    );
    const result = await fetchOpenRouterCatalog({ cachePath, now: () => 1_700_000_100_000 });
    expect(result.entries[0]?.id).toBe("openrouter/free");
  });
});
