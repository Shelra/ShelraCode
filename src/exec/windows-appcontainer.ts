import { randomUUID } from "node:crypto";
import { constants, existsSync, statSync } from "node:fs";
import { access, copyFile, lstat, mkdir, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative } from "node:path";
import { recordSwallowedError } from "../utils/diagnostics";
import { DEFAULT_COMMAND_MEMORY_MB, runCommand } from "./command";
import { BoundedCapture } from "./logging";
import type { CommandOutcome } from "./types";
import { gradingEnvironment, type VerificationWorkspacePaths } from "./verification-environment";
import { WINDOWS_APPCONTAINER_SOURCE } from "./windows-appcontainer-source";

const LAUNCH_SCRIPT = `param([string]$Config, [switch]$CleanupOnly)
$ErrorActionPreference = 'Stop'
$c = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
Add-Type -TypeDefinition (Get-Content -LiteralPath $c.source -Raw)
if ($CleanupOnly) { $problem = [ShelraAppContainer]::Cleanup($c.profile); if ($problem) { throw $problem }; exit 0 }
$result = [ShelraAppContainer]::Run($c.profile, $c.executable, $c.commandLine, $c.cwd, [string[]]$c.readOnly, [string[]]$c.writable, [string[]]$c.protectedPaths, $c.environment, $c.stdout, $c.stderr, $c.timeout, $c.memoryBytes)
$result | ConvertTo-Json -Compress
`;

interface NativeResult {
  ExitCode: number;
  TimedOut: boolean;
  CleanupError: string | null;
}
function parseResult(value: string): NativeResult {
  const parsed: unknown = JSON.parse(value.trim());
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("ExitCode" in parsed) ||
    !Number.isInteger(parsed.ExitCode) ||
    !("TimedOut" in parsed) ||
    typeof parsed.TimedOut !== "boolean" ||
    !("CleanupError" in parsed) ||
    (parsed.CleanupError !== null && typeof parsed.CleanupError !== "string")
  )
    throw new Error("The Windows sandbox returned no valid host receipt.");
  return parsed as NativeResult;
}

function hostBinary(name: string): string | undefined {
  for (const folder of (process.env.PATH ?? "").split(delimiter)) {
    const path = join(folder.replace(/^"|"$/gu, ""), name);
    if (existsSync(path) && statSync(path).isFile()) return path;
  }
  return undefined;
}

async function capture(path: string, directory: string): Promise<{ text: string; truncated: boolean }> {
  const entry = await lstat(path);
  if (
    !entry.isFile() ||
    entry.isSymbolicLink() ||
    entry.nlink !== 1 ||
    dirname(await realpath(path)) !== directory ||
    entry.size > 128 * 1024 ** 2
  )
    throw new Error("The sandbox returned an unsafe or oversized capture file.");
  const capture = new BoundedCapture();
  const file = await open(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      capture.append(buffer.subarray(0, bytesRead).toString("utf8"));
    }
  } finally {
    await file.close();
  }
  return { text: capture.text(), truncated: capture.truncated };
}

async function removeControl(control: string, parent: string): Promise<void> {
  if (dirname(control) !== parent || (await realpath(control)) !== control || (await lstat(control)).isSymbolicLink())
    throw new Error("Windows verifier refuses a replaced control directory.");
  await rm(control, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

async function cleanupProfile(launcher: string, config: string, control: string): Promise<void> {
  const quote = (path: string) => `'${path.replaceAll("'", "''")}'`;
  const cleanup = await runCommand({
    command: `& ${quote(launcher)} -Config ${quote(config)} -CleanupOnly`,
    env: gradingEnvironment({ home: control, temp: control }),
    inheritEnv: false,
    timeoutMs: 30_000,
    log: false,
  });
  if (cleanup.state !== "completed" || cleanup.exitCode !== 0)
    throw new Error(`Windows sandbox cleanup unavailable: ${cleanup.stderr}`);
}

/** Fail closed: never run the requested command on the host when native isolation fails. */
export async function runWindowsVerification(
  command: string,
  frozen: VerificationWorkspacePaths,
  options: {
    env?: Record<string, string>;
    timeoutMs?: number;
    signal?: AbortSignal;
    maxMemoryMb?: number;
    protectedPaths?: string[];
  } = {},
): Promise<CommandOutcome & { isolated: boolean }> {
  const started = Date.now();
  const base: CommandOutcome & { isolated: boolean } = {
    command,
    cwd: frozen.workspace,
    exitCode: null,
    stdout: "",
    stderr: "",
    state: "spawn_error",
    durationMs: 0,
    timedOut: false,
    truncated: false,
    isolated: false,
  };
  if (process.platform !== "win32")
    return { ...base, stderr: "Windows AppContainer verification is unavailable on this platform." };
  if (options.signal?.aborted) return { ...base, state: "killed", stderr: "Windows verification cancelled." };
  let parent: string;
  let control: string;
  try {
    parent = await realpath(tmpdir());
    control = await mkdtemp(join(parent, "shelra-verifier-control-"));
  } catch (error) {
    return {
      ...base,
      durationMs: Date.now() - started,
      stderr: `Windows verifier preparation failed: ${String(error)}`,
    };
  }
  const profile = `Shelra.Verify.${randomUUID().replaceAll("-", "")}`;
  const config = join(control, "config.json");
  const launcher = join(control, "launch.ps1");
  let profileCleaned = false;
  let configured = false;
  let result = base;
  try {
    const privateRoot = dirname(frozen.workspace);
    if (
      dirname(privateRoot) !== parent ||
      !privateRoot.startsWith(join(parent, "shelra-grade-")) ||
      (await realpath(privateRoot)) !== privateRoot
    )
      throw new Error("Windows verification only grants access to a host-created private candidate.");
    for (const path of [
      frozen.workspace,
      frozen.home,
      frozen.temp,
      ...(frozen.benchmarkRoot ? [frozen.benchmarkRoot] : []),
    ]) {
      if (dirname(path) !== privateRoot || (await realpath(path)) !== path || (await lstat(path)).isSymbolicLink())
        throw new Error("Windows verification refuses a replaced private directory.");
    }
    const runtime = join(privateRoot, "runtime");
    const protectedPaths = (options.protectedPaths ?? []).map((path) => join(frozen.workspace, path));
    for (const path of protectedPaths) {
      const rel = relative(frozen.workspace, await realpath(path));
      if (
        rel === "" ||
        rel === ".." ||
        rel.startsWith("..\\") ||
        isAbsolute(rel) ||
        (await lstat(path)).isSymbolicLink()
      )
        throw new Error("Windows verification refuses an expectation path outside its candidate.");
    }
    await mkdir(runtime, { recursive: true });
    if (dirname(await realpath(runtime)) !== privateRoot || (await lstat(runtime)).isSymbolicLink())
      throw new Error("Windows verification refuses a replaced runtime directory.");
    for (const name of ["bun.exe", "node.exe"]) {
      const binary = hostBinary(name);
      if (!binary) continue;
      const target = join(runtime, name);
      try {
        await access(target, constants.F_OK);
      } catch {
        await copyFile(await realpath(binary), target, constants.COPYFILE_EXCL);
      }
    }
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows";
    const executable = join(systemRoot, "System32", "cmd.exe");
    const environment: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries({ ...gradingEnvironment(frozen), ...options.env }).map(([key, value]) => [
          key.toUpperCase(),
          value,
        ]),
      ),
      PATH: [runtime, join(systemRoot, "System32"), systemRoot].join(delimiter),
      COMSPEC: executable,
      SYSTEMROOT: systemRoot,
      WINDIR: systemRoot,
    };
    const stdout = join(frozen.temp, `stdout-${randomUUID()}.log`);
    const stderr = join(frozen.temp, `stderr-${randomUUID()}.log`);
    const source = join(control, "native.cs");
    await writeFile(source, WINDOWS_APPCONTAINER_SOURCE);
    await writeFile(launcher, LAUNCH_SCRIPT);
    await writeFile(
      config,
      JSON.stringify({
        source,
        profile,
        executable,
        commandLine: `"${executable}" /d /v:off /s /c "${command}"`,
        cwd: frozen.workspace,
        readOnly: [runtime, ...(frozen.benchmarkRoot ? [frozen.benchmarkRoot] : [])],
        writable: [frozen.workspace, frozen.home, frozen.temp],
        protectedPaths,
        environment: `${Object.entries(environment)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => `${key}=${value}`)
          .join("\0")}\0\0`,
        stdout,
        stderr,
        timeout: options.timeoutMs ?? 180_000,
        memoryBytes: (options.maxMemoryMb ?? DEFAULT_COMMAND_MEMORY_MB) * 1024 ** 2,
      }),
    );
    configured = true;
    const hostEnvironment = gradingEnvironment({ home: control, temp: control });
    const quote = (path: string) => `'${path.replaceAll("'", "''")}'`;
    const launch = await runCommand({
      command: `& ${quote(launcher)} -Config ${quote(config)}`,
      env: hostEnvironment,
      inheritEnv: false,
      signal: options.signal,
      timeoutMs: (options.timeoutMs ?? 180_000) + 30_000,
      log: false,
    });
    if (launch.state !== "completed" || launch.exitCode !== 0)
      result = {
        ...base,
        state: launch.state === "completed" ? "spawn_error" : launch.state,
        timedOut: launch.timedOut,
        stderr: `Windows sandbox unavailable: ${launch.stderr || launch.stdout}`,
      };
    else {
      const native = parseResult(launch.stdout);
      profileCleaned = native.CleanupError === null;
      if (native.CleanupError) throw new Error(native.CleanupError);
      const output = await capture(stdout, frozen.temp);
      const error = await capture(stderr, frozen.temp);
      result = {
        ...base,
        isolated: true,
        exitCode: native.TimedOut ? null : native.ExitCode,
        state: native.TimedOut ? "timed_out" : "completed",
        timedOut: native.TimedOut,
        stdout: output.text,
        stderr: error.text,
        truncated: output.truncated || error.truncated,
      };
    }
  } catch (error) {
    result = { ...base, stderr: `Windows sandbox unavailable or invalid: ${String(error)}` };
  } finally {
    if (configured && !profileCleaned) {
      try {
        await cleanupProfile(launcher, config, control);
      } catch (error) {
        recordSwallowedError("windows-verification-profile-cleanup", error);
        result = { ...base, stderr: `Windows sandbox cleanup failed: ${String(error)}` };
      }
    }
    try {
      await removeControl(control, parent);
    } catch (error) {
      recordSwallowedError("windows-verification-cleanup", error);
      result = { ...base, stderr: `Windows verifier control cleanup failed: ${String(error)}` };
    }
  }
  return { ...result, durationMs: Date.now() - started };
}
