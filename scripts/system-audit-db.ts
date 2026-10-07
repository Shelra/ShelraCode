/** Actual product SQLite contention: cancellation timer cannot interrupt its synchronous five-second busy wait. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv[2] === "--owner") {
  const { Database } = await import("bun:sqlite");
  const db = new Database(process.argv[3]!);
  db.exec("BEGIN IMMEDIATE");
  console.log("LOCK_READY");
  await new Promise<void>((done) => setTimeout(done, 6_000));
  db.exec("ROLLBACK");
  db.close();
  process.exit(0);
}

const root = mkdtempSync(join(tmpdir(), "shelra-audit-db-"));
const cleanupTarget = resolve(root);
if (
  !cleanupTarget.startsWith(`${resolve(tmpdir())}${sep}`) ||
  !cleanupTarget.split(sep).at(-1)?.startsWith("shelra-audit-db-")
)
  throw new Error("Refusing cleanup outside the database probe's temporary directory.");
process.env.HOME = root;
process.env.USERPROFILE = root;
process.env.SHELRA_TRACE = "off";
process.env.SHELRA_DIAGNOSTICS_LOG = "off";
const { getDatabase, getDatabasePath, closeDatabase } = await import("../src/storage/db");
const { SessionStore } = await import("../src/storage/sessions");
const trials: Record<string, unknown>[] = [];
try {
  const store = new SessionStore(root);
  const session = store.createSession("audit-fake", "agent", root);
  const database = getDatabase();
  for (let repeat = 0; repeat < 3; repeat++) {
    const env: Record<string, string> = { HOME: root, USERPROFILE: root };
    for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"]) {
      if (process.env[name]) env[name] = process.env[name]!;
    }
    const owner = Bun.spawn([process.execPath, fileURLToPath(import.meta.url), "--owner", getDatabasePath()], {
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = new Response(owner.stderr).text();
    const watchdog = setTimeout(() => owner.kill(), 12_000);
    try {
      const reader = owner.stdout.getReader();
      const readiness = await reader.read();
      if (readiness.done || !new TextDecoder().decode(readiness.value).includes("LOCK_READY"))
        throw new Error("The isolated SQLite owner did not establish its lock.");
      await reader.cancel();
      const controller = new AbortController();
      const started = performance.now();
      let cancellationFiredMs: number | null = null;
      const cancel = setTimeout(() => {
        cancellationFiredMs = performance.now() - started;
        controller.abort();
      }, 20);
      let failure: string | null = null;
      try {
        database.prepare("UPDATE sessions SET title = ? WHERE id = ?").run("must not be admitted", session.id);
      } catch (error) {
        failure = String((error as { code?: string }).code ?? (error instanceof Error ? error.message : error));
      }
      const databaseReturnedMs = performance.now() - started;
      await new Promise<void>((done) => setTimeout(done, 0));
      clearTimeout(cancel);
      const exitCode = await owner.exited;
      const stderrBytes = Buffer.byteLength(await stderr);
      trials.push({
        repeat,
        configuredBusyTimeoutMs: 5_000,
        intendedCancellationMs: 20,
        databaseReturnedMs,
        cancellationFiredMs,
        abortedAfterReturn: controller.signal.aborted,
        failure,
        ownerExitCode: exitCode,
        ownerStderrBytes: stderrBytes,
        titleUnchanged: store.getSessionById(session.id)?.title == null,
        integrity: database.pragma("integrity_check", { simple: true }),
      });
    } finally {
      clearTimeout(watchdog);
      owner.kill();
      await owner.exited;
    }
  }
  const output = "bench/history/system-audit";
  mkdirSync(output, { recursive: true });
  const artifact = {
    at: new Date().toISOString(),
    runtime: Bun.version,
    method:
      "Actual product getDatabase/SessionStore, isolated HOME and seeded session, external SQLite writer holds BEGIN IMMEDIATE six seconds. Timer attempts cancellation at 20ms. No provider/network/private database.",
    trials,
  };
  writeFileSync(join(output, "database-contention.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(artifact));
} finally {
  closeDatabase();
  rmSync(cleanupTarget, { recursive: true, force: true });
}
