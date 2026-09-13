import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverInstalledHuggingFaceModels,
  downloadHuggingFaceModel,
  HUGGING_FACE_MODELS,
  type HuggingFaceModelSpec,
} from "./huggingface";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function spec(sha256: string): HuggingFaceModelSpec {
  return {
    id: "hf:test/model:Q4_K_M",
    displayName: "Test model",
    repoId: "test/model",
    filename: "test.gguf",
    revision: "main",
    quantization: "Q4_K_M",
    parameters: 1_500_000_000,
    contextWindow: 4_096,
    estimatedMemoryGb: 1,
    sha256,
  };
}

describe("Hugging Face model downloader", () => {
  it("resumes a partial artifact, reports progress, verifies it, and finalizes atomically", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "shelra-hf-"));
    temporaryDirectories.push(directory);
    const body = new TextEncoder().encode("hello world");
    await writeFile(path.join(directory, "test.gguf.part"), body.slice(0, 6));
    const progress: string[] = [];
    const result = await downloadHuggingFaceModel(spec(createHash("sha256").update(body).digest("hex")), {
      modelDirectory: directory,
      fetchImpl: async (_url, init) => {
        expect(init?.headers).toEqual({ Range: "bytes=6-" });
        return new Response(body.slice(6), {
          status: 206,
          headers: { "content-range": `bytes 6-10/${body.byteLength}` },
        });
      },
      onProgress: (item) => progress.push(item.status),
    });
    expect(await readFile(result.path, "utf8")).toBe("hello world");
    expect(progress).toEqual(expect.arrayContaining(["connecting", "downloading", "verifying", "complete"]));
  });

  it("rejects a corrupt artifact without exposing it as installed", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "shelra-hf-"));
    temporaryDirectories.push(directory);
    await expect(
      downloadHuggingFaceModel(spec("00".repeat(32)), {
        modelDirectory: directory,
        fetchImpl: async () => new Response(new TextEncoder().encode("corrupt"), { status: 200 }),
      }),
    ).rejects.toThrow(/SHA-256/iu);
    await expect(readFile(path.join(directory, "test.gguf"))).rejects.toThrow();
  });

  it("returns the installed artifact without contacting the network", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "shelra-hf-installed-"));
    temporaryDirectories.push(directory);
    const body = new TextEncoder().encode("hello world");
    const installed = { ...spec(createHash("sha256").update(body).digest("hex")), sizeBytes: body.byteLength };
    await writeFile(path.join(directory, "test.gguf"), body);

    let calls = 0;
    const result = await downloadHuggingFaceModel(installed, {
      modelDirectory: directory,
      fetchImpl: async () => {
        calls += 1;
        throw new Error("the network must not be used for an installed model");
      },
    });

    expect(calls).toBe(0);
    expect(result.path).toBe(path.join(directory, "test.gguf"));
    expect(result.bytes).toBe(body.byteLength);
  });

  it("restarts from zero when the server rejects the range of an invalid partial", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "shelra-hf-416-"));
    temporaryDirectories.push(directory);
    const body = new TextEncoder().encode("hello world");
    const target = { ...spec(createHash("sha256").update(body).digest("hex")), sizeBytes: body.byteLength };
    // A complete-length but wrong-content partial: 416 must not be success.
    await writeFile(path.join(directory, "test.gguf.part"), new TextEncoder().encode("XXXXXXXXXXX"));

    const ranges: (string | undefined)[] = [];
    const result = await downloadHuggingFaceModel(target, {
      modelDirectory: directory,
      fetchImpl: async (_url, init) => {
        const range = (init?.headers as Record<string, string> | undefined)?.Range;
        ranges.push(range);
        if (range) return new Response(null, { status: 416 });
        return new Response(body, { status: 200 });
      },
    });

    expect(ranges).toEqual([`bytes=${body.byteLength}-`, undefined]);
    expect(await readFile(result.path, "utf8")).toBe("hello world");
  });

  it("falls back to the catalog identity when a sidecar is corrupt", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "shelra-hf-corrupt-"));
    temporaryDirectories.push(directory);
    const catalogued = HUGGING_FACE_MODELS[0] as HuggingFaceModelSpec;
    const modelPath = path.join(directory, catalogued.filename);
    await writeFile(modelPath, "model");
    await writeFile(`${modelPath}.json`, "{ not json at all", "utf8");

    const discovered = await discoverInstalledHuggingFaceModels(directory);

    expect(discovered[0]?.spec.id).toBe(catalogued.id);
    expect(discovered[0]?.spec.parameters).toBe(catalogued.parameters);
  });

  it("recognizes sidecars written with a Windows BOM or legacy literal newline", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "shelra-hf-sidecar-"));
    temporaryDirectories.push(directory);
    const modelPath = path.join(directory, "test.gguf");
    await writeFile(modelPath, "model");
    const metadata = { ...spec("00".repeat(32)), path: modelPath };
    await writeFile(`${modelPath}.json`, `\uFEFF${JSON.stringify(metadata, null, 2)}\\n`, "utf8");

    const discovered = await discoverInstalledHuggingFaceModels(directory);
    expect(discovered[0]?.spec.id).toBe(metadata.id);
    expect(discovered[0]?.spec.quantization).toBe("Q4_K_M");
  });
});
