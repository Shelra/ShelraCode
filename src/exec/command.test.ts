import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  dir = undefined;
});

describe("runCommand", () => {
  it("leaves no safety timer armed once a timed-out command has been killed", () => {
    // Review round 3 (2026-09-24): the timeout's 5 s safety timer stayed armed after the child closed, so
    // `shelra decisions check` lingered 5 s after a check that timed out. The child process counts the 5 s
    // timers still armed when the command resolves, so how long the tree kill takes under load does not matter.
    dir = mkdtempSync(join(tmpdir(), "shelra-command-timeout-"));
    const command = fileURLToPath(new URL("./command.ts", import.meta.url)).replaceAll("\\", "/");
    const script = join(dir, "run.ts");
    writeFileSync(
      script,
      [
        `import { runCommand } from "${command}";`,
        "const armed = new Set<unknown>();",
        "const realSet = globalThis.setTimeout;",
        "const realClear = globalThis.clearTimeout;",
        "globalThis.setTimeout = ((handler: () => void, ms?: number, ...rest: unknown[]) => {",
        "  const timer = realSet(() => { armed.delete(timer); handler(); }, ms, ...rest);",
        "  if (ms === 5_000) armed.add(timer);",
        "  return timer;",
        "}) as typeof setTimeout;",
        "globalThis.clearTimeout = ((timer: unknown) => { armed.delete(timer); realClear(timer as never); }) as typeof clearTimeout;",
        "const outcome = await runCommand({ command: 'bun -e \"setTimeout(() => {}, 30000)\"', timeoutMs: 300, log: false, maxMemoryMb: 0 });",
        'console.log(outcome.state + " " + armed.size);',
        "process.exit(0);",
      ].join("\n"),
    );
    const result = spawnSync(process.versions.bun ? process.execPath : "bun", [script], {
      encoding: "utf8",
      env: { ...process.env, SHELRA_DIAGNOSTICS_LOG: "off" },
      timeout: 60_000,
    });

    expect(result.stdout.trim()).toBe("timed_out 0");
  }, 90_000);
});
