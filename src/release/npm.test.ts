import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { launcherManifest, NPM_PLATFORMS, npmTarball, platformManifest, verifyAssets } from "./npm";

/** The entries of an uncompressed tar: name, mode and size, read from their ustar headers. */
function entries(tar: Uint8Array): Array<{ name: string; mode: number; size: number; checksumOk: boolean }> {
  const out: Array<{ name: string; mode: number; size: number; checksumOk: boolean }> = [];
  const text = (start: number, length: number) =>
    new TextDecoder().decode(tar.subarray(start, start + length)).replace(/\0.*$/su, "");
  let offset = 0;
  while (offset + 512 <= tar.length && tar[offset] !== 0) {
    const header = tar.subarray(offset, offset + 512);
    const size = Number.parseInt(text(offset + 124, 12), 8);
    const stored = Number.parseInt(text(offset + 148, 8).trim(), 8);
    const sum = header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 0x20 : byte), 0);
    out.push({
      name: text(offset, 100),
      mode: Number.parseInt(text(offset + 100, 8), 8),
      size,
      checksumOk: sum === stored,
    });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

describe("ShelraCode's npm packages", () => {
  it("make the launcher depend on every platform package at the same version, each limited to its platform", () => {
    const launcher = launcherManifest("1.1.9");
    expect(launcher).toMatchObject({ name: "shelra", version: "1.1.9", bin: { shelra: "bin/shelra.cjs" } });
    expect(launcher.optionalDependencies).toEqual({
      "shelra-windows-x64": "1.1.9",
      "shelra-linux-x64": "1.1.9",
      "shelra-darwin-arm64": "1.1.9",
    });
    for (const platform of NPM_PLATFORMS) {
      expect(platformManifest(platform, "1.1.9")).toMatchObject({
        name: platform.name,
        version: "1.1.9",
        os: [platform.os],
        cpu: [platform.cpu],
      });
    }
  });

  it("write tarballs under package/ with the modes given, so a Linux or macOS binary stays executable", () => {
    const binary = new Uint8Array(1500).fill(7);
    const tar = gunzipSync(
      npmTarball([
        { path: "package.json", data: new TextEncoder().encode("{}"), mode: 0o644 },
        { path: "bin/shelra", data: binary, mode: 0o755 },
      ]),
    );
    expect(entries(tar)).toEqual([
      { name: "package/bin/shelra", mode: 0o755, size: 1500, checksumOk: true },
      { name: "package/package.json", mode: 0o644, size: 2, checksumOk: true },
    ]);
  });

  it.skipIf(spawnSync("tar", ["--version"]).status !== 0)("write tarballs the system tar reads", () => {
    const dir = mkdtempSync(join(tmpdir(), "shelra-npm-tar-"));
    try {
      const file = join(dir, "x.tgz");
      writeFileSync(
        file,
        npmTarball([{ path: "bin/shelra", data: new TextEncoder().encode("#!/bin/sh\n"), mode: 0o755 }]),
      );
      const listed = spawnSync("tar", ["-tvzf", "x.tgz"], { cwd: dir, encoding: "utf8" });
      expect(listed.status).toBe(0);
      expect(listed.stdout).toMatch(/^-rwxr-xr-x .*package\/bin\/shelra/mu);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuse a binary whose hash differs from checksums.txt, or that it does not name", () => {
    const data = new TextEncoder().encode("binary");
    const hash = createHash("sha256").update(data).digest("hex");
    expect(verifyAssets(new Map([["shelra-linux-x64", hash]]), [{ name: "shelra-linux-x64", data }])).toBeNull();
    expect(verifyAssets(new Map([["shelra-linux-x64", "0".repeat(64)]]), [{ name: "shelra-linux-x64", data }])).toBe(
      "checksum mismatch for shelra-linux-x64",
    );
    expect(verifyAssets(new Map(), [{ name: "shelra-linux-x64", data }])).toBe(
      "checksums.txt does not name shelra-linux-x64",
    );
  });
});
