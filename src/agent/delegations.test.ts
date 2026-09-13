import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function readStoredDelegationRecord(home: string, configDir = ".shelra"): Record<string, unknown> {
  const delegationsRoot = path.join(home, configDir, "delegations");
  const projectDirs = fs.readdirSync(delegationsRoot);
  expect(projectDirs).toHaveLength(1);
  const projectDir = path.join(delegationsRoot, projectDirs[0] as string);
  const files = fs.readdirSync(projectDir).filter((file) => file.endsWith(".json"));
  expect(files).toHaveLength(1);
  return JSON.parse(fs.readFileSync(path.join(projectDir, files[0] as string), "utf8")) as Record<string, unknown>;
}

async function importDelegationsModule(options: { home?: string; spawnMock?: ReturnType<typeof vi.fn> } = {}) {
  vi.resetModules();
  vi.doUnmock("child_process");

  if (options.home) {
    process.env.HOME = options.home;
  }

  if (options.spawnMock) {
    vi.doMock("child_process", async () => {
      const actual = await vi.importActual<typeof import("child_process")>("child_process");
      return {
        ...actual,
        spawn: options.spawnMock,
      };
    });
  }

  return import("./delegations");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.env.HOME = originalHome;
  vi.restoreAllMocks();
  vi.resetModules();
  vi.doUnmock("child_process");
});

describe("DelegationManager sandbox propagation", () => {
  it("persists sandbox mode in background delegation records", async () => {
    const home = makeTempDir("grok-delegation-home-");
    const cwd = makeTempDir("grok-delegation-cwd-");
    const spawnMock = vi.fn(() => ({
      pid: 2468,
      unref: vi.fn(),
    }));
    const mod = await importDelegationsModule({ home, spawnMock });
    const manager = new mod.DelegationManager(() => cwd, spawnMock as never);

    const result = await manager.start(
      {
        agent: "explore",
        description: "Inspect the repo",
        prompt: "Find the execution path.",
      },
      {
        model: "grok-test-model",
        sandboxMode: "shuru",
        maxToolRounds: 25,
        maxTokens: 2048,
      },
    );

    expect(result.success).toBe(true);
    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining(["--directory", cwd]),
      expect.objectContaining({ cwd }),
    );

    const record = readStoredDelegationRecord(home) as {
      sandboxMode: string;
      pid: number;
    };

    expect(record.sandboxMode).toBe("shuru");
    expect(record.pid).toBe(2468);
  });

  it("persists sandbox settings in background delegation records", async () => {
    const home = makeTempDir("grok-delegation-home-");
    const cwd = makeTempDir("grok-delegation-cwd-");
    const spawnMock = vi.fn(() => ({
      pid: 3579,
      unref: vi.fn(),
    }));
    const mod = await importDelegationsModule({ home, spawnMock });
    const manager = new mod.DelegationManager(() => cwd, spawnMock as never);

    const sandboxSettings = {
      allowNet: true,
      allowedHosts: ["api.openai.com"],
      cpus: 4,
      memory: 4096,
    };

    await manager.start(
      {
        agent: "explore",
        description: "Inspect",
        prompt: "Look around",
      },
      {
        model: "grok-test-model",
        sandboxMode: "shuru",
        sandboxSettings,
        maxToolRounds: 25,
        maxTokens: 2048,
      },
    );

    const record = readStoredDelegationRecord(home) as {
      sandboxMode: string;
      sandboxSettings?: {
        allowNet: boolean;
        allowedHosts: string[];
        cpus: number;
        memory: number;
      };
    };

    expect(record.sandboxMode).toBe("shuru");
    expect(record.sandboxSettings).toEqual(sandboxSettings);
  });
});

describe("legacy delegation mirror", () => {
  async function startDelegation(home: string) {
    const cwd = makeTempDir("grok-delegation-cwd-");
    const spawnMock = vi.fn(() => ({ pid: 1234, unref: vi.fn() }));
    const mod = await importDelegationsModule({ home, spawnMock });
    const manager = new mod.DelegationManager(() => cwd, spawnMock as never);
    await manager.start(
      { agent: "explore", description: "Inspect", prompt: "Look around" },
      { model: "grok-test-model", sandboxMode: "shuru", maxToolRounds: 25, maxTokens: 2048 },
    );
  }

  it("never creates the legacy directory for a fresh install", async () => {
    const home = makeTempDir("grok-delegation-home-");
    await startDelegation(home);

    expect(fs.existsSync(path.join(home, ".shelra", "delegations"))).toBe(true);
    expect(fs.existsSync(path.join(home, ".grok", "delegations"))).toBe(false);
  });

  it("still mirrors when the legacy directory already exists", async () => {
    const home = makeTempDir("grok-delegation-home-");
    fs.mkdirSync(path.join(home, ".grok", "delegations"), { recursive: true });
    await startDelegation(home);

    const canonical = readStoredDelegationRecord(home);
    const legacy = readStoredDelegationRecord(home, ".grok");
    expect(legacy).toEqual(canonical);
  });
});
