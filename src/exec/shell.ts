/**
 * Shell selection and process-tree termination.
 *
 * The autonomy runtime has to operate real software on the machine it runs on, which on
 * Windows means PowerShell rather than `sh -c`, and means killing whole process trees
 * rather than a single pid (a `bun run dev` shell spawns children that outlive it).
 */

import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export type ShellKind = "powershell" | "cmd" | "posix";

/** Either a well-known shell name, or an absolute path to a shell executable. */
export type ShellPreference = "powershell" | "pwsh" | "cmd" | "bash" | "sh" | "default" | (string & {});

export interface ShellInvocation {
  /** Executable to spawn. */
  file: string;
  /** Full argument vector, with the command already embedded. */
  args: string[];
  kind: ShellKind;
}

const isWindows = process.platform === "win32";

/**
 * PowerShell prelude/epilogue.
 *
 * - `ProgressPreference` silenced: progress records are otherwise serialized into stderr as
 *   CLIXML noise whenever stderr is a pipe.
 * - The epilogue exists because `powershell.exe -Command` does NOT propagate a native
 *   program's exit code; without it `node -e "process.exit(7)"` reports 1. `$?` must be
 *   captured before anything else, because the assignment itself resets it.
 */
const POWERSHELL_PRELUDE = ["$ProgressPreference = 'SilentlyContinue'", "$ErrorActionPreference = 'Continue'", ""].join(
  "\n",
);

const POWERSHELL_EPILOGUE = [
  "",
  "$__shelraOk = $?",
  "$__shelraCode = $LASTEXITCODE",
  "if ($null -eq $__shelraCode) { if ($__shelraOk) { $__shelraCode = 0 } else { $__shelraCode = 1 } }",
  "exit $__shelraCode",
  "",
].join("\n");

let cachedPwshPath: string | null | undefined;

function findOnPath(executable: string): string | null {
  const rawPath = process.env.PATH ?? process.env.Path ?? "";
  const separator = isWindows ? ";" : ":";
  for (const entry of rawPath.split(separator)) {
    if (!entry) continue;
    const candidate = path.join(entry.replace(/^"|"$/g, ""), executable);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function windowsPowerShellPath(): string {
  if (cachedPwshPath === undefined) {
    cachedPwshPath = findOnPath("pwsh.exe");
  }
  if (cachedPwshPath) return cachedPwshPath;
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows";
  const builtin = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return existsSync(builtin) ? builtin : "powershell.exe";
}

function posixShellPath(): string {
  const fromEnv = process.env.SHELL;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (existsSync("/bin/bash")) return "/bin/bash";
  return "/bin/sh";
}

function encodePowerShellCommand(command: string): string {
  // -EncodedCommand sidesteps every layer of Windows command-line quoting: no amount of
  // quotes, backticks, pipes or newlines in `command` can break out of the argument.
  return Buffer.from(`${POWERSHELL_PRELUDE}${command}${POWERSHELL_EPILOGUE}`, "utf16le").toString("base64");
}

function powerShellInvocation(file: string, command: string): ShellInvocation {
  return {
    file,
    args: [
      "-NoProfile",
      "-NoLogo",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-OutputFormat",
      "Text",
      "-EncodedCommand",
      encodePowerShellCommand(command),
    ],
    kind: "powershell",
  };
}

/** Builds the exact argv used to run `command`, honouring an explicit shell override. */
export function buildShellInvocation(command: string, shell: ShellPreference = "default"): ShellInvocation {
  const preference = shell === "default" ? (isWindows ? "powershell" : "sh") : shell;

  if (preference === "powershell" || preference === "pwsh") {
    const file =
      preference === "pwsh" ? (findOnPath(isWindows ? "pwsh.exe" : "pwsh") ?? "pwsh") : windowsPowerShellPath();
    return powerShellInvocation(file, command);
  }

  if (preference === "cmd") {
    const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows";
    const cmdPath = path.join(systemRoot, "System32", "cmd.exe");
    return { file: existsSync(cmdPath) ? cmdPath : "cmd.exe", args: ["/d", "/s", "/c", command], kind: "cmd" };
  }

  if (preference === "bash") {
    const bash = findOnPath(isWindows ? "bash.exe" : "bash") ?? (isWindows ? "bash.exe" : "/bin/bash");
    return { file: bash, args: ["-lc", command], kind: "posix" };
  }

  if (preference === "sh") {
    return {
      file: isWindows ? (findOnPath("sh.exe") ?? "sh.exe") : posixShellPath(),
      args: ["-c", command],
      kind: "posix",
    };
  }

  // An explicit path to some other shell.
  const lower = preference.toLowerCase();
  if (lower.endsWith("powershell.exe") || lower.endsWith("pwsh.exe") || lower.endsWith("pwsh")) {
    return powerShellInvocation(preference, command);
  }
  if (lower.endsWith("cmd.exe")) {
    return { file: preference, args: ["/d", "/s", "/c", command], kind: "cmd" };
  }
  return { file: preference, args: ["-c", command], kind: "posix" };
}

/**
 * Kills a process and every descendant it spawned.
 *
 * Windows has no process groups that `kill` understands, so the tree has to be walked by
 * `taskkill /T`. POSIX gets a negative-pid group signal, which requires the child to have
 * been spawned detached (see `spawnOptions`).
 */
export async function killProcessTree(pid: number | undefined, graceMs = 2_000): Promise<void> {
  if (!pid || pid <= 0) return;

  if (isWindows) {
    await new Promise<void>((resolve) => {
      execFile("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    });
    return;
  }

  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        /* already gone */
      }
    }
  };

  signalGroup("SIGTERM");
  await new Promise<void>((resolve) => setTimeout(resolve, graceMs));
  signalGroup("SIGKILL");
}

/** Synchronous tree kill, for `process.on("exit")` handlers where async work never runs. */
export function killProcessTreeSync(pid: number | undefined): void {
  if (!pid || pid <= 0) return;
  if (isWindows) {
    try {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      /* best effort */
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/** Spawn options shared by one-shot commands and managed processes. */
export function spawnOptions(
  cwd: string,
  env: NodeJS.ProcessEnv,
): {
  cwd: string;
  env: NodeJS.ProcessEnv;
  windowsHide: boolean;
  detached: boolean;
  stdio: ["ignore", "pipe", "pipe"];
} {
  return {
    cwd,
    env,
    windowsHide: true,
    // POSIX needs its own process group so the whole tree can be signalled. On Windows a
    // detached child gets its own console, which we do not want; `taskkill /T` covers it.
    detached: !isWindows,
    stdio: ["ignore", "pipe", "pipe"],
  };
}

const CLIXML_HEADER = "#< CLIXML";

function decodeClixmlText(raw: string): string {
  return raw
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Turns one line of PowerShell's stderr into plain text.
 *
 * When stderr is a pipe, PowerShell serializes its own error records as CLIXML instead of
 * text. Native programs' stderr passes through untouched, so only these lines need work.
 * Returns `null` for lines that should be dropped entirely.
 */
export function normalizeShellErrorLine(line: string): string | null {
  const trimmed = line.trimEnd();
  if (trimmed === CLIXML_HEADER) return null;
  if (!trimmed.startsWith("<Objs ")) return line;

  const parts: string[] = [];
  const matcher = /<S(?:\s[^>]*)?>([\s\S]*?)<\/S>/g;
  let match = matcher.exec(trimmed);
  while (match) {
    parts.push(decodeClixmlText(match[1] ?? ""));
    match = matcher.exec(trimmed);
  }
  if (parts.length === 0) return null;
  return parts.join("").replace(/\r?\n$/, "");
}

/**
 * Line-buffered stderr cleaner. Chunks arrive split at arbitrary byte boundaries, so
 * partial lines are held until their newline shows up.
 */
export function createShellErrorFilter(): { push(chunk: string): string; flush(): string } {
  let pending = "";
  const convert = (line: string): string | null => normalizeShellErrorLine(line);

  return {
    push(chunk: string): string {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      const out: string[] = [];
      for (const line of lines) {
        const cleaned = convert(line);
        if (cleaned !== null) out.push(`${cleaned.replace(/\r$/, "")}\n`);
      }
      return out.join("");
    },
    flush(): string {
      if (!pending) return "";
      const cleaned = convert(pending);
      pending = "";
      return cleaned === null ? "" : cleaned;
    },
  };
}
