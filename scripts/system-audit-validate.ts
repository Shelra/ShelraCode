/** Final repository checks, exact exit codes and UTF-8 output artifacts. Does not install the built binary. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactPaths } from "../bench/long-horizon/redact";
import { killProcessTree } from "../src/exec/shell";
import { redact } from "../src/utils/session-trace";

const output = "bench/history/system-audit";
mkdirSync(output, { recursive: true });
const results: Record<string, unknown>[] = [];
for (const name of ["format", "lint", "typecheck", "test", "build"]) {
  const started = Date.now();
  const child = Bun.spawn([process.execPath, "run", name], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...process.env, SHELRA_BUILD_SKIP_INSTALL: "1" },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void killProcessTree(child.pid, 500);
    child.kill();
  }, 10 * 60_000);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);
  writeFileSync(join(output, `validation-${name}.txt`), redact(redactPaths(`${stdout}\n${stderr}`)), "utf8");
  const result = {
    command: `bun run ${name}`,
    exitCode,
    timedOut,
    durationMs: Date.now() - started,
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    ...(name === "build" ? { installSkipped: true } : {}),
  };
  results.push(result);
  writeFileSync(
    join(output, "validation.json"),
    `${JSON.stringify({ at: new Date().toISOString(), runtime: Bun.version, results }, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(result));
  if (exitCode !== 0 || timedOut) {
    console.log(redact(redactPaths((stdout + stderr).slice(-12_000))));
    process.exit(1);
  }
}
