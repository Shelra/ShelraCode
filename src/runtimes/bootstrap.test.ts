import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectPreferredRuntimeBackend, installManagedRuntime, resolveRuntimeInstallPlan } from "./bootstrap";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Shelra managed runtime bootstrap", () => {
  it("resolves the reviewed llama.cpp artifact for Windows x64", () => {
    const plan = resolveRuntimeInstallPlan("win32", "x64", {});
    expect(plan).toMatchObject({
      runtimeId: "shelra-llama",
      executableName: "llama-server.exe",
      archiveName: expect.stringContaining("win-cpu-x64.zip"),
    });
    expect(plan?.url).toContain("ggml-org/llama.cpp/releases/download");
  });

  it("resolves the reviewed CUDA artifact when NVIDIA acceleration is selected", () => {
    const plan = resolveRuntimeInstallPlan("win32", "x64", {}, "cuda");
    expect(plan).toMatchObject({
      runtimeId: "shelra-llama",
      backend: "cuda",
      archiveName: expect.stringContaining("win-cuda-12.4-x64.zip"),
      sha256: "f330d770f0bc82d06cac26f773b85b23fe4eb409159a8738271fa2881523bfa2",
    });
  });

  it("honors an explicit backend preference without probing a vendor runtime", async () => {
    await expect(detectPreferredRuntimeBackend("win32", "x64", { SHELRA_RUNTIME_BACKEND: "cuda" })).resolves.toBe(
      "cuda",
    );
  });

  it("resolves portable archives for macOS and Linux", () => {
    expect(resolveRuntimeInstallPlan("darwin", "arm64", {})?.archiveName).toContain("macos-arm64.tar.gz");
    expect(resolveRuntimeInstallPlan("linux", "x64", {})?.archiveName).toContain("ubuntu-x64.tar.gz");
  });

  it("fails closed on unsupported architectures", () => {
    expect(resolveRuntimeInstallPlan("win32", "ia32", {})).toBeUndefined();
  });

  it("removes the partial archive when the integrity check fails", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "shelra-runtime-bootstrap-"));
    temporaryDirectories.push(runtimeDirectory);
    const plan = resolveRuntimeInstallPlan("win32", "x64", {}, "cpu");

    const result = await installManagedRuntime({
      runtimeDirectory,
      platform: "win32",
      arch: "x64",
      backend: "cpu",
      env: {},
      fetchImpl: async () => new Response(new TextEncoder().encode("not the real archive"), { status: 200 }),
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain("SHA-256");
    expect(existsSync(path.join(runtimeDirectory, `${plan?.archiveName}.part`))).toBe(false);
    expect(existsSync(path.join(runtimeDirectory, `${plan?.archiveName}`))).toBe(false);
  });

  it("restarts a download instead of trusting a 416 answer for an invalid partial", async () => {
    const runtimeDirectory = await mkdtemp(path.join(tmpdir(), "shelra-runtime-bootstrap-"));
    temporaryDirectories.push(runtimeDirectory);
    const plan = resolveRuntimeInstallPlan("win32", "x64", {}, "cpu");
    const partial = path.join(runtimeDirectory, `${plan?.archiveName}.part`);
    const poisoned = "a complete-looking but wrong partial";
    await writeFile(partial, poisoned);

    const ranges: (string | undefined)[] = [];
    const result = await installManagedRuntime({
      runtimeDirectory,
      platform: "win32",
      arch: "x64",
      backend: "cpu",
      env: {},
      fetchImpl: async (_url, init) => {
        const range = (init?.headers as Record<string, string> | undefined)?.Range;
        ranges.push(range);
        if (range) {
          return new Response(null, {
            status: 416,
            headers: { "content-range": `bytes */${poisoned.length}` },
          });
        }
        return new Response(new TextEncoder().encode("restarted download"), { status: 200 });
      },
    });

    // The range request is answered with 416, the partial is discarded, and the
    // download restarts from zero rather than being declared complete.
    expect(ranges).toEqual([`bytes=${poisoned.length}-`, undefined]);
    expect(result.success).toBe(false);
    expect(result.reason).toContain("SHA-256");
    expect(existsSync(partial)).toBe(false);
  });

  it("honors the explicit no-download safety switch", async () => {
    const result = await installManagedRuntime({ env: { SHELRA_DISABLE_RUNTIME_INSTALL: "1" } });
    expect(result).toEqual({
      success: false,
      reason: "Automatic runtime installation is disabled for this session.",
    });
  });
});
