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
  it("lets the process exit once a timed-out command has been killed", () => {
    // Review round 3 (2026-09-24): the timeout's 5 s safety timer stayed armed after the child closed, so
    // `shelra decisions check` lingered 5 s after a check that timed out.
    dir = mkdtempSync(join(tmpdir(), "shelra-command-timeout-"));
    const command = fileURLToPath(new URL("./command.ts", import.meta.url)).replaceAll("\\", "/");
    const script = join(dir, "run.ts");
    writeFileSync(
      script,
      [
        `import { runCommand } from "${command}";`,
        "const outcome = await runCommand({ command: 'bun -e \"setTimeout(() => {}, 30000)\"', timeoutMs: 300, log: false, maxMemoryMb: 0 });",
        "console.log(outcome.state);",
      ].join("\n"),
    );
    const started = Date.now();
    const result = spawnSync(process.versions.bun ? process.execPath : "bun", [script], {
      encoding: "utf8",
      env: { ...process.env, SHELRA_DIAGNOSTICS_LOG: "off" },
      timeout: 20_000,
    });
    const elapsed = Date.now() - started;

    expect(result.stdout.trim()).toBe("timed_out");
    expect(elapsed).toBeLessThan(4_500);
  }, 30_000);
});
