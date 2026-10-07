/** Confirm log/environment exposure using artificial credentials only and an isolated subprocess environment. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "../src/exec/command";
import { setExecLogRoot } from "../src/exec/logging";
import { redact } from "../src/utils/session-trace";

const knownKey = "sk-or-v1-audit_seeded_token_do_not_use_000000";
const password = "AUDIT_PRIVATE_PASSWORD_FIXTURE_DO_NOT_USE";
if (process.argv[2] === "--child") {
  const root = process.argv[3]!;
  setExecLogRoot(join(root, "logs"));
  const quote = (value: string) => `'${value.replaceAll("'", process.platform === "win32" ? "''" : "'\\''")}'`;
  const command =
    process.platform === "win32"
      ? "[Console]::WriteLine($env:SHELRA_AUDIT_SEEDED_TOKEN); [Console]::WriteLine($env:SHELRA_AUDIT_SEEDED_PASSWORD)"
      : `${quote(process.execPath)} ${quote(join(root, "producer.ts"))}`;
  const started = Date.now();
  const outcome = await runCommand({ command, cwd: tmpdir(), timeoutMs: 5_000 });
  const log = outcome.logPath ? readFileSync(outcome.logPath, "utf8") : "";
  const capture = `${outcome.stdout}\n${outcome.stderr}`;
  writeFileSync(
    join(root, "result.json"),
    JSON.stringify({
      durationMs: Date.now() - started,
      commandSucceeded: outcome.state === "completed" && outcome.exitCode === 0,
      processHasSeededToken: process.env.SHELRA_AUDIT_SEEDED_TOKEN === knownKey,
      stdoutChars: outcome.stdout.length,
      stderrChars: outcome.stderr.length,
      seededEnvironmentReachedChild: capture.includes(knownKey) && capture.includes(password),
      captureContainsKnownKey: capture.includes(knownKey),
      diskLogContainsKnownKey: log.includes(knownKey),
      diskLogContainsArbitraryPassword: log.includes(password),
      traceRedactsKnownKey: !redact(capture).includes(knownKey),
      traceRedactsArbitraryPassword: !redact(capture).includes(password),
      diskBytes: Buffer.byteLength(log),
    }),
    "utf8",
  );
  process.exit(0);
}

const root = mkdtempSync(join(tmpdir(), "shelra-audit-privacy-"));
const cleanupTarget = resolve(root);
if (
  !cleanupTarget.startsWith(`${resolve(tmpdir())}${sep}`) ||
  !cleanupTarget.split(sep).at(-1)?.startsWith("shelra-audit-privacy-")
)
  throw new Error("Refusing cleanup outside the privacy probe's temporary directory.");
try {
  writeFileSync(
    join(root, "producer.ts"),
    "console.log(process.env.SHELRA_AUDIT_SEEDED_TOKEN); console.log(process.env.SHELRA_AUDIT_SEEDED_PASSWORD);\n",
    "utf8",
  );
  const env: Record<string, string> = {
    HOME: root,
    USERPROFILE: root,
    SHELRA_TRACE: "off",
    SHELRA_DIAGNOSTICS_LOG: "off",
    SHELRA_AUDIT_SEEDED_TOKEN: knownKey,
    SHELRA_AUDIT_SEEDED_PASSWORD: password,
  };
  // Do not pass any of the owner's credentials to this child. Retain only OS process/temporary path requirements.
  for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP", "COMSPEC"]) {
    if (process.env[name]) env[name] = process.env[name]!;
  }
  const child = Bun.spawn([process.execPath, fileURLToPath(import.meta.url), "--child", root], {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill(), 15_000);
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  clearTimeout(timer);
  if (code !== 0)
    throw new Error(`Isolated privacy probe failed: exit ${code}, ${stdout.length + stderr.length} diagnostic bytes`);
  const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
  const output = "bench/history/system-audit";
  mkdirSync(output, { recursive: true });
  const artifact = {
    at: new Date().toISOString(),
    runtime: Bun.version,
    method:
      "Production runCommand/RunLog and trace redactor; isolated child receives seeded fake key/password and OS variables only. No real credential, network or exfiltration.",
    result,
  };
  writeFileSync(join(output, "privacy.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(artifact));
} finally {
  rmSync(cleanupTarget, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
