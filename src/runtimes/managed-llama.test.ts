import type { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HUGGING_FACE_MODELS, modelArtifactPath } from "../models/huggingface";
import {
  DEFAULT_CPU_CONTEXT_CAP,
  llamaServerEnvironment,
  ManagedLlamaRuntime,
  serverContextSize,
} from "./managed-llama";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

interface Fixture {
  runtimeDirectory: string;
  modelDirectory: string;
  modelPaths: string[];
}

async function createFixture(
  specs = [HUGGING_FACE_MODELS[0]] as (typeof HUGGING_FACE_MODELS)[number][],
): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "shelra-managed-llama-"));
  temporaryDirectories.push(root);
  const runtimeDirectory = path.join(root, "runtime");
  const modelDirectory = path.join(root, "models");
  await mkdir(runtimeDirectory, { recursive: true });
  await mkdir(modelDirectory, { recursive: true });
  await writeFile(path.join(runtimeDirectory, "llama-server.exe"), "managed-test-binary");
  const modelPaths: string[] = [];
  for (const spec of specs) {
    const modelPath = modelArtifactPath(spec, modelDirectory);
    await writeFile(modelPath, "managed-test-model");
    await writeFile(`${modelPath}.json`, JSON.stringify(spec));
    modelPaths.push(modelPath);
  }
  return { runtimeDirectory, modelDirectory, modelPaths };
}

function fakeChild(): EventEmitter & ChildProcess & { killed: boolean } {
  const child = new EventEmitter() as EventEmitter & ChildProcess & { killed: boolean };
  child.killed = false;
  child.kill = (() => {
    child.killed = true;
    child.emit("exit", 0, null);
    return true;
  }) as ChildProcess["kill"];
  return child;
}

const okFetch: typeof fetch = async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 });

/** Health always succeeds; `/props` answers with whatever the test supplies. */
function fetchWithProps(props: unknown, status = 200): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    if (String(input).endsWith("/props")) {
      return new Response(props === undefined ? "" : JSON.stringify(props), { status });
    }
    return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
  }) as typeof fetch;
}

function capturingSpawn(launched: string[][]): typeof spawn {
  return ((_executable: string, args: string[]) => {
    launched.push(args);
    return fakeChild();
  }) as unknown as typeof spawn;
}

function contextSizeArgument(args: string[]): number {
  return Number(args[args.indexOf("--ctx-size") + 1]);
}

describe("managed llama runtime lifecycle", () => {
  it("enumerates runtimes and models without starting a server", async () => {
    const { runtimeDirectory, modelDirectory } = await createFixture();
    let spawnCount = 0;
    const spawnImpl = (() => {
      spawnCount += 1;
      return fakeChild();
    }) as unknown as typeof spawn;
    const runtime = new ManagedLlamaRuntime({
      runtimeDirectory,
      modelDirectory,
      spawnImpl,
      fetchImpl: okFetch,
      backend: "cpu",
    });

    const [detected, health, models] = await Promise.all([runtime.detect(), runtime.health(), runtime.listModels()]);

    expect(detected).toBe(true);
    expect(health.healthy).toBe(true);
    expect(models).toHaveLength(1);
    expect(spawnCount).toBe(0);
    await runtime.dispose();
  });

  it("serializes concurrent model preparation into one server", async () => {
    const { runtimeDirectory, modelDirectory } = await createFixture();
    let spawnCount = 0;
    const spawnImpl = (() => {
      spawnCount += 1;
      return fakeChild();
    }) as unknown as typeof spawn;
    const runtime = new ManagedLlamaRuntime({
      runtimeDirectory,
      modelDirectory,
      spawnImpl,
      fetchImpl: okFetch,
      backend: "cpu",
    });
    const modelId = HUGGING_FACE_MODELS[0].id;

    const [first, second] = await Promise.all([runtime.prepareModel(modelId), runtime.prepareModel(modelId)]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(spawnCount).toBe(1);
    expect((await runtime.health(undefined, modelId)).healthy).toBe(true);
    await runtime.dispose();
  });

  it("serves the requested model rather than the first installed one", async () => {
    const specs = [HUGGING_FACE_MODELS[0], HUGGING_FACE_MODELS[1]];
    const { runtimeDirectory, modelDirectory, modelPaths } = await createFixture(specs);
    const launched: string[] = [];
    const spawnImpl = ((_executable: string, args: string[]) => {
      launched.push(args[args.indexOf("-m") + 1] as string);
      return fakeChild();
    }) as unknown as typeof spawn;
    const runtime = new ManagedLlamaRuntime({
      runtimeDirectory,
      modelDirectory,
      spawnImpl,
      fetchImpl: okFetch,
      backend: "cpu",
    });

    expect(await runtime.prepareModel(specs[1].id)).toBe(true);
    const health = await runtime.health(undefined, specs[1].id);

    expect(health.healthy).toBe(true);
    expect(launched).toEqual([modelPaths[1]]);
    expect((await runtime.health(undefined, "hf:not/installed:Q4_K_M")).healthy).toBe(false);
    await runtime.dispose();
  });

  it("gives up as soon as the server exits during loading", async () => {
    const { runtimeDirectory, modelDirectory } = await createFixture();
    const spawnImpl = (() => {
      const child = fakeChild();
      // The engine dies while the model is loading (OOM, corrupt GGUF, ...).
      setTimeout(() => child.emit("exit", 1, null), 10);
      return child;
    }) as unknown as typeof spawn;
    const runtime = new ManagedLlamaRuntime({
      runtimeDirectory,
      modelDirectory,
      spawnImpl,
      fetchImpl: async () => {
        throw new Error("connection refused");
      },
      backend: "cpu",
    });

    const started = Date.now();
    await expect(runtime.prepareModel(HUGGING_FACE_MODELS[0].id)).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(5_000);
    await runtime.dispose();
  });

  it("reports the context window the running server loaded, not the catalog value", async () => {
    const { runtimeDirectory, modelDirectory } = await createFixture();
    const runtime = new ManagedLlamaRuntime({
      runtimeDirectory,
      modelDirectory,
      spawnImpl: capturingSpawn([]),
      fetchImpl: fetchWithProps({ n_ctx: 4096 }),
      backend: "cpu",
    });
    const spec = HUGGING_FACE_MODELS[0];

    expect(await runtime.prepareModel(spec.id)).toBe(true);
    const [candidate] = await runtime.listModels();

    expect(spec.contextWindow).not.toBe(4096);
    expect(candidate.contextWindow).toBe(4096);
    expect(runtime.provider(candidate).resolveModelRuntime(spec.id).modelInfo?.contextWindow).toBe(4096);
    await runtime.dispose();
  });

  it("reads the legacy /props shape and falls back to the spec window on failure", async () => {
    const { runtimeDirectory, modelDirectory } = await createFixture();
    const spec = HUGGING_FACE_MODELS[0];

    const legacy = new ManagedLlamaRuntime({
      runtimeDirectory,
      modelDirectory,
      spawnImpl: capturingSpawn([]),
      fetchImpl: fetchWithProps({ default_generation_settings: { n_ctx: 3072 } }),
      backend: "cpu",
    });
    expect(await legacy.prepareModel(spec.id)).toBe(true);
    expect((await legacy.listModels())[0].contextWindow).toBe(3072);
    await legacy.dispose();

    const unavailable = new ManagedLlamaRuntime({
      runtimeDirectory,
      modelDirectory,
      spawnImpl: capturingSpawn([]),
      fetchImpl: fetchWithProps(undefined, 404),
      backend: "cpu",
    });
    expect(await unavailable.prepareModel(spec.id)).toBe(true);
    expect((await unavailable.listModels())[0].contextWindow).toBe(spec.contextWindow);
    await unavailable.dispose();
  });

  it("bounds the CPU context size and honours SHELRA_CONTEXT", async () => {
    const { runtimeDirectory, modelDirectory } = await createFixture();
    const spec = HUGGING_FACE_MODELS[0];
    const previous = process.env.SHELRA_CONTEXT;
    const launched: string[][] = [];

    try {
      delete process.env.SHELRA_CONTEXT;
      const bounded = new ManagedLlamaRuntime({
        runtimeDirectory,
        modelDirectory,
        spawnImpl: capturingSpawn(launched),
        fetchImpl: okFetch,
        backend: "cpu",
      });
      expect(await bounded.prepareModel(spec.id)).toBe(true);
      await bounded.dispose();

      expect(contextSizeArgument(launched[0])).toBe(DEFAULT_CPU_CONTEXT_CAP);
      expect(contextSizeArgument(launched[0])).toBeLessThan(spec.contextWindow);

      process.env.SHELRA_CONTEXT = "6144";
      const overridden = new ManagedLlamaRuntime({
        runtimeDirectory,
        modelDirectory,
        spawnImpl: capturingSpawn(launched),
        fetchImpl: okFetch,
        backend: "cpu",
      });
      expect(await overridden.prepareModel(spec.id)).toBe(true);
      await overridden.dispose();

      expect(contextSizeArgument(launched[1])).toBe(6144);
    } finally {
      if (previous === undefined) delete process.env.SHELRA_CONTEXT;
      else process.env.SHELRA_CONTEXT = previous;
    }
  });

  it("never asks either backend for more context than its cap", () => {
    expect(serverContextSize(32_768, "cpu", {})).toBe(DEFAULT_CPU_CONTEXT_CAP);
    expect(serverContextSize(2048, "cpu", {})).toBe(2048);
    expect(serverContextSize(32_768, "cuda", {})).toBe(16_384);
    expect(serverContextSize(32_768, "cuda", { SHELRA_GPU_CONTEXT: "4096" })).toBe(4096);
    expect(serverContextSize(undefined, "cpu", { SHELRA_CONTEXT: "0" })).toBe(DEFAULT_CPU_CONTEXT_CAP);
  });

  it("does not forward credentials to the engine child", () => {
    const environment = llamaServerEnvironment({
      PATH: "/usr/bin",
      SystemRoot: "C:\\Windows",
      GGML_CUDA_ENABLE_UNIFIED_MEMORY: "1",
      XAI_API_KEY: "secret",
      OPENAI_API_KEY: "secret",
      HF_TOKEN: "secret",
      WALLET_PRIVATE_KEY: "secret",
      DB_PASSWORD: "secret",
    });

    expect(environment.PATH).toBe("/usr/bin");
    expect(environment.SystemRoot).toBe("C:\\Windows");
    expect(environment.GGML_CUDA_ENABLE_UNIFIED_MEMORY).toBe("1");
    expect(environment).not.toHaveProperty("XAI_API_KEY");
    expect(environment).not.toHaveProperty("OPENAI_API_KEY");
    expect(environment).not.toHaveProperty("HF_TOKEN");
    expect(environment).not.toHaveProperty("WALLET_PRIVATE_KEY");
    expect(environment).not.toHaveProperty("DB_PASSWORD");
  });
});
