import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FrozenWorkspace, freezeWorkspace } from "../exec/frozen-workspace";
import { gradingEnvironment } from "../exec/verification-environment";

let root: string;
let workspace: string;
let oracle: string;
let frozen: FrozenWorkspace | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "shelra-frozen-test-"));
  workspace = join(root, "project");
  oracle = join(root, "expectations");
  mkdirSync(workspace);
  mkdirSync(oracle);
  writeFileSync(join(workspace, "main.ts"), "export const value = 20;\n");
  writeFileSync(join(oracle, "oracle.ts"), "// host expectation\n");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  if (frozen && existsSync(frozen.workspace)) await frozen.cleanup();
  frozen = undefined;
  rmSync(root, { recursive: true, force: true });
});

describe("private benchmark candidate", () => {
  it("preserves source code, dependencies and memory while grading may modify its copy", async () => {
    mkdirSync(join(workspace, "node_modules", "dependency"), { recursive: true });
    mkdirSync(join(workspace, ".shelra", "memory"), { recursive: true });
    mkdirSync(join(workspace, ".git"));
    writeFileSync(join(workspace, "node_modules", "dependency", "index.js"), "export default 1;\n");
    writeFileSync(join(workspace, ".shelra", "memory", "index.md"), "durable rule\n");
    frozen = await freezeWorkspace(workspace, oracle);
    expect(frozen.receipt).toMatchObject({
      mode: "private-copy",
      candidateFiles: 3,
      omitted: [".git"],
      processIsolation: "unavailable",
    });
    expect(existsSync(join(frozen.workspace, ".git"))).toBe(false);
    expect(readFileSync(join(frozen.workspace, ".shelra", "memory", "index.md"), "utf8")).toBe("durable rule\n");
    writeFileSync(join(frozen.workspace, "main.ts"), "restored oracle tests or generated output\n");
    await frozen.integrity();
    expect(readFileSync(join(workspace, "main.ts"), "utf8")).toBe("export const value = 20;\n");
    const allocated = dirname(frozen.workspace);
    await frozen.cleanup();
    expect(existsSync(allocated)).toBe(false);
  });

  it("invalidates a source rewrite of equal length", async () => {
    frozen = await freezeWorkspace(workspace, oracle);
    writeFileSync(join(workspace, "main.ts"), "export const value = 10;\n");
    await expect(frozen.integrity()).rejects.toThrow("original candidate changed");
  });

  it("invalidates modified expectations while originals stay untouched", async () => {
    frozen = await freezeWorkspace(workspace, oracle);
    writeFileSync(join(frozen.benchmarkRoot as string, "oracle.ts"), "// counterfeit expectation\n");
    await expect(frozen.integrity()).rejects.toThrow("expectations changed");
    expect(readFileSync(join(oracle, "oracle.ts"), "utf8")).toBe("// host expectation\n");
  });

  it("materializes a hard link as an independent file", async () => {
    linkSync(join(workspace, "main.ts"), join(workspace, "alias.ts"));
    frozen = await freezeWorkspace(workspace, oracle);
    writeFileSync(join(frozen.workspace, "alias.ts"), "copy modified\n");
    expect(readFileSync(join(workspace, "main.ts"), "utf8")).toBe("export const value = 20;\n");
    expect(readFileSync(join(frozen.workspace, "main.ts"), "utf8")).toBe("export const value = 20;\n");
  });

  it("refuses an external directory link", async () => {
    symlinkSync(oracle, join(workspace, "escape"), process.platform === "win32" ? "junction" : "dir");
    await expect(freezeWorkspace(workspace, oracle)).rejects.toThrow("external link");
    expect(existsSync(join(oracle, "oracle.ts"))).toBe(true);
  });

  it("materializes an internal directory link without retaining an alias to the source", async () => {
    mkdirSync(join(workspace, "lib"));
    writeFileSync(join(workspace, "lib", "a.ts"), "original\n");
    symlinkSync(join(workspace, "lib"), join(workspace, "alias"), process.platform === "win32" ? "junction" : "dir");
    frozen = await freezeWorkspace(workspace, oracle);
    writeFileSync(join(frozen.workspace, "alias", "a.ts"), "changed\n");
    expect(readFileSync(join(workspace, "lib", "a.ts"), "utf8")).toBe("original\n");
    expect(readFileSync(join(frozen.workspace, "lib", "a.ts"), "utf8")).toBe("original\n");
  });

  it("rejects a cycle rather than copying a partial candidate", async () => {
    symlinkSync(workspace, join(workspace, "cycle"), process.platform === "win32" ? "junction" : "dir");
    await expect(freezeWorkspace(workspace, oracle)).rejects.toThrow("directory cycle");
  });

  it.each([
    { maxFiles: 0 },
    { maxBytes: 1 },
    { maxFileBytes: 1 },
  ])("rejects a partial copy at limit %j", async (limits) => {
    await expect(freezeWorkspace(workspace, oracle, { limits })).rejects.toThrow("limit");
  });

  it("declares the standard oracle roots instead of copying repository credentials or histories", async () => {
    mkdirSync(join(oracle, "bench", "oracles"), { recursive: true });
    mkdirSync(join(oracle, "bench", "fixtures"), { recursive: true });
    writeFileSync(join(oracle, "bench", "oracles", "check.ts"), "// check\n");
    writeFileSync(join(oracle, ".env"), "host secret fixture\n");
    frozen = await freezeWorkspace(workspace, oracle, { oracleRoots: ["bench/oracles", "bench/fixtures"] });
    expect(frozen.receipt.oracleRoots).toEqual(["bench/oracles", "bench/fixtures"]);
    expect(existsSync(join(frozen.benchmarkRoot as string, ".env"))).toBe(false);
  });

  it("does not inherit provider keys, tokens or runtime injection options", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "dummy-key");
    vi.stubEnv("SHELRA_TOKEN", "dummy-token");
    vi.stubEnv("NODE_OPTIONS", "--import=dummy.ts");
    vi.stubEnv("BUN_OPTIONS", "--preload dummy.ts");
    expect(gradingEnvironment({ home: "private-home", temp: "private-temp" })).toMatchObject({
      HOME: "private-home",
      TEMP: "private-temp",
    });
    for (const key of ["OPENROUTER_API_KEY", "SHELRA_TOKEN", "NODE_OPTIONS", "BUN_OPTIONS"])
      expect(gradingEnvironment({ home: "private-home", temp: "private-temp" })).not.toHaveProperty(key);
  });
});
