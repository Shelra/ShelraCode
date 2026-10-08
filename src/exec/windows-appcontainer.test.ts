import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type FrozenWorkspace, freezeWorkspace } from "./frozen-workspace";
import { runWindowsVerification } from "./windows-appcontainer";

let root: string;
let workspace: string;
let oracle: string;
let frozen: FrozenWorkspace | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "shelra-native-test-"));
  workspace = join(root, "project");
  oracle = join(root, "expectations");
  mkdirSync(workspace);
  mkdirSync(oracle);
  writeFileSync(join(oracle, "expected.txt"), "twenty");
});
afterEach(async () => {
  await frozen?.cleanup();
  frozen = undefined;
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform !== "win32")("native Windows verification boundary", () => {
  it("protects tests inside the writable candidate, including ancestor rename and hard-link aliases", async () => {
    mkdirSync(join(workspace, ".shelra", "verify"), { recursive: true });
    writeFileSync(join(workspace, ".shelra", "verify", "original.txt"), "expected");
    writeFileSync(
      join(workspace, "probe.ts"),
      `import { readFileSync, writeFileSync, renameSync, rmSync, linkSync } from 'node:fs';
      import { spawnSync } from 'node:child_process';
      const result={read:false,write:false,remove:false,ancestorRename:false,aliasWrite:false,changePermissions:false};
      const path='.shelra/verify/original.txt';
      try { result.read=readFileSync(path,'utf8')==='expected'; } catch {}
      try { writeFileSync(path,'forged'); result.write=true; } catch {}
      try { rmSync('.shelra/verify',{recursive:true}); result.remove=true; } catch {}
      try { renameSync('.shelra','.counterfeit'); result.ancestorRename=true; } catch {}
      try { linkSync(path,'alias.txt'); writeFileSync('alias.txt','forged'); result.aliasWrite=true; } catch {}
      try { result.changePermissions=spawnSync('icacls.exe',[path,'/grant','*S-1-15-2-1:F'],{windowsHide:true}).status===0; } catch {}
      console.log(JSON.stringify(result));`,
    );
    frozen = await freezeWorkspace(workspace, oracle);
    const outcome = await runWindowsVerification("bun run probe.ts", frozen, {
      timeoutMs: 10_000,
      protectedPaths: [".shelra/verify"],
    });
    expect(outcome).toMatchObject({ isolated: true, state: "completed", exitCode: 0 });
    expect(JSON.parse(outcome.stdout.trim())).toEqual({
      read: true,
      write: false,
      remove: false,
      ancestorRename: false,
      aliasWrite: false,
      changePermissions: false,
    });
    expect(readFileSync(join(frozen.workspace, ".shelra", "verify", "original.txt"), "utf8")).toBe("expected");
  }, 30_000);

  it("allows candidate writes and oracle reads, refusing external files, oracle writes and network", async () => {
    const secret = join(root, "host-secret.txt");
    writeFileSync(secret, "dummy secret");
    let requests = 0;
    const server = createServer((_req, res) => {
      requests += 1;
      res.end("unexpected network access");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server did not listen.");
    writeFileSync(
      join(workspace, "probe.ts"),
      `import { readFileSync, writeFileSync } from 'node:fs';
      const result = { hostRead:false, oracleRead:false, oracleWrite:false, candidateWrite:false, network:false };
      try { readFileSync(${JSON.stringify(secret)}); result.hostRead=true; } catch {}
      try { readFileSync(process.env.SHELRA_BENCH_ROOT+'/expected.txt'); result.oracleRead=true; } catch {}
      try { writeFileSync(process.env.SHELRA_BENCH_ROOT+'/expected.txt','forged'); result.oracleWrite=true; } catch {}
      try { writeFileSync('allowed.txt','ok'); result.candidateWrite=true; } catch {}
      try { await fetch('http://127.0.0.1:${address.port}',{signal:AbortSignal.timeout(1500)}); result.network=true; } catch {}
      console.log(JSON.stringify(result));`,
    );
    try {
      frozen = await freezeWorkspace(workspace, oracle);
      const outcome = await runWindowsVerification("bun run probe.ts", frozen, {
        env: { SHELRA_BENCH_ROOT: frozen.benchmarkRoot as string },
        timeoutMs: 10_000,
      });
      expect(outcome).toMatchObject({ isolated: true, state: "completed", exitCode: 0 });
      expect(JSON.parse(outcome.stdout.trim())).toEqual({
        hostRead: false,
        oracleRead: true,
        oracleWrite: false,
        candidateWrite: true,
        network: false,
      });
      expect(requests).toBe(0);
      expect(readFileSync(join(frozen.benchmarkRoot as string, "expected.txt"), "utf8")).toBe("twenty");
      expect(existsSync(join(workspace, "allowed.txt"))).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 30_000);

  it("terminates descendants on timeout, including a child still holding no output handles", async () => {
    writeFileSync(
      join(workspace, "child.ts"),
      `import { writeFileSync } from 'node:fs';
      writeFileSync('child-pid.txt',String(process.pid)); let n=0;
      setInterval(()=>writeFileSync('heartbeat.txt',String(++n)),30);`,
    );
    writeFileSync(
      join(workspace, "parent.ts"),
      `import { spawn } from 'node:child_process';
      spawn(process.execPath,['run','child.ts'],{stdio:'ignore'}); setInterval(()=>{},1000);`,
    );
    frozen = await freezeWorkspace(workspace, oracle);
    const outcome = await runWindowsVerification("bun run parent.ts", frozen, { timeoutMs: 1_500, maxMemoryMb: 512 });
    expect(outcome).toMatchObject({ isolated: true, state: "timed_out", timedOut: true, exitCode: null });
    expect(existsSync(join(frozen.workspace, "child-pid.txt"))).toBe(true);
    const heartbeat = readFileSync(join(frozen.workspace, "heartbeat.txt"), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(readFileSync(join(frozen.workspace, "heartbeat.txt"), "utf8")).toBe(heartbeat);
  }, 30_000);

  it("kills the job if the host cancels while the native helper is waiting", async () => {
    writeFileSync(
      join(workspace, "waiting.ts"),
      `import { writeFileSync } from 'node:fs';
      let n=0; setInterval(()=>writeFileSync('heartbeat.txt',String(++n)),30);`,
    );
    frozen = await freezeWorkspace(workspace, oracle);
    const cancellation = new AbortController();
    const running = runWindowsVerification("bun run waiting.ts", frozen, {
      timeoutMs: 20_000,
      signal: cancellation.signal,
    });
    const deadline = Date.now() + 10_000;
    while (!existsSync(join(frozen.workspace, "heartbeat.txt")) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 50));
    expect(existsSync(join(frozen.workspace, "heartbeat.txt"))).toBe(true);
    cancellation.abort();
    const outcome = await running;
    expect(outcome.state).toBe("killed");
    const heartbeat = readFileSync(join(frozen.workspace, "heartbeat.txt"), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(readFileSync(join(frozen.workspace, "heartbeat.txt"), "utf8")).toBe(heartbeat);
  }, 30_000);
});
