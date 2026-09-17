import { type ChildProcess, spawn } from "child_process";
import { createReadStream, createWriteStream } from "fs";
import { mkdtemp, rm, stat, unlink } from "fs/promises";
import os from "os";
import path from "path";
import { runCommand } from "../exec/command";
import { buildShellInvocation } from "../exec/shell";
import { executeEventHooks } from "../hooks/index";
import type { CwdChangedHookInput } from "../hooks/types";
import type { ToolResult } from "../types/index";
import type { SandboxMode, SandboxSettings } from "../utils/settings";

const MAX_TAIL_BYTES = 8_192;
const MAX_BACKGROUND_PROCESSES = 8;

export interface BackgroundProcess {
  id: number;
  command: string;
  pid: number;
  cwd: string;
  startedAt: Date;
  child: ChildProcess;
  logPath: string;
  alive: boolean;
  exitCode: number | null;
}

interface BashToolOptions {
  sandboxMode?: SandboxMode;
  sandboxSettings?: SandboxSettings;
}

let nextBgId = 1;

export class BashTool {
  private cwd: string;
  /** The workspace the tool was created for; `cd` may move within it but never out of it. */
  private readonly rootCwd: string;
  private bgProcesses = new Map<number, BackgroundProcess>();
  private tmpDir: string | null = null;
  private sandboxMode: SandboxMode;
  private sandboxSettings: SandboxSettings;

  constructor(initialCwd = process.cwd(), options: BashToolOptions = {}) {
    this.cwd = initialCwd;
    this.rootCwd = path.resolve(initialCwd);
    this.sandboxMode = options.sandboxMode ?? "off";
    this.sandboxSettings = options.sandboxSettings ?? {};
  }

  private async ensureTmpDir(): Promise<string> {
    if (!this.tmpDir) {
      this.tmpDir = await mkdtemp(path.join(os.tmpdir(), "grok-bg-"));
    }
    return this.tmpDir;
  }

  async execute(command: string, timeout = 30_000, abortSignal?: AbortSignal): Promise<ToolResult> {
    try {
      const standaloneCd = parseStandaloneCd(command);
      if (standaloneCd !== null) {
        const dir = standaloneCd;
        try {
          const nextCwd = path.resolve(this.cwd, dir);
          // The file tools resolve paths against this cwd, so a `cd` above the workspace would
          // let the agent read and write anywhere on the machine (seen live 2026-09-17: a model
          // ran `cd ../../../` and wrote artifacts into an unrelated repository).
          const escapePath = path.relative(this.rootCwd, nextCwd);
          if (escapePath.startsWith("..") || path.isAbsolute(escapePath)) {
            return {
              success: false,
              error: `Cannot change directory outside the workspace root (${this.rootCwd}). Use paths relative to the workspace instead.`,
            };
          }
          const info = await stat(nextCwd);
          if (!info.isDirectory()) {
            return { success: false, error: `Cannot change directory: ${nextCwd} is not a directory` };
          }
          const oldCwd = this.cwd;
          this.cwd = nextCwd;

          const cwdInput: CwdChangedHookInput = {
            hook_event_name: "CwdChanged",
            old_cwd: oldCwd,
            new_cwd: nextCwd,
            cwd: nextCwd,
          };
          executeEventHooks(cwdInput, nextCwd).catch(() => {});

          return { success: true, output: `Changed directory to: ${this.cwd}` };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: `Cannot change directory: ${msg}` };
        }
      }

      if (abortSignal?.aborted) {
        return { success: false, error: "[Cancelled]" };
      }

      const prepared = this.prepareCommand(command);
      if (!prepared.ok) {
        return { success: false, error: prepared.error };
      }

      const outcome = await runCommand({
        command: prepared.command,
        cwd: this.cwd,
        timeoutMs: timeout,
        signal: abortSignal,
        log: false,
      });
      const output = [outcome.stdout, outcome.stderr ? `STDERR: ${outcome.stderr}` : ""]
        .filter(Boolean)
        .join("\n")
        .trim();

      if (outcome.state === "killed" || abortSignal?.aborted) {
        return { success: false, error: "[Cancelled]" };
      }

      if (outcome.state === "timed_out") {
        return { success: false, error: output || `Command timed out after ${timeout}ms` };
      }

      if (outcome.state !== "completed" || outcome.exitCode !== 0) {
        const sandboxError = this.formatSandboxRuntimeError(output, outcome.stderr || "Command failed");
        if (sandboxError) return { success: false, error: sandboxError };
        return { success: false, error: output || `Command failed with exit code ${outcome.exitCode ?? "unknown"}` };
      }

      return { success: true, output: output || "Command executed successfully (no output)" };
    } catch (err: unknown) {
      if (err && typeof err === "object" && "stdout" in err) {
        const execErr = err as { stdout?: string; stderr?: string; message: string };
        const output = (execErr.stdout || "") + (execErr.stderr ? `\nSTDERR: ${execErr.stderr}` : "");
        if (output.trim()) {
          return { success: false, error: output.trim() };
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Command failed: ${msg}` };
    }
  }

  async startBackground(command: string): Promise<ToolResult> {
    const alive = [...this.bgProcesses.values()].filter((p) => p.alive);
    if (alive.length >= MAX_BACKGROUND_PROCESSES) {
      return {
        success: false,
        output: `Too many background processes (${alive.length}/${MAX_BACKGROUND_PROCESSES}). Stop one first with process_stop.`,
      };
    }

    try {
      const prepared = this.prepareCommand(command);
      if (!prepared.ok) {
        return { success: false, output: prepared.error };
      }
      const tmpDir = await this.ensureTmpDir();
      const id = nextBgId++;
      const logPath = path.join(tmpDir, `bg-${id}.log`);
      const logStream = createWriteStream(logPath, { flags: "a" });

      const invocation = buildShellInvocation(prepared.command);
      const child = spawn(invocation.file, invocation.args, {
        cwd: this.cwd,
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FORCE_COLOR: "0" },
      });

      child.stdout?.pipe(logStream);
      child.stderr?.pipe(logStream);

      const entry: BackgroundProcess = {
        id,
        command,
        pid: child.pid ?? 0,
        cwd: this.cwd,
        startedAt: new Date(),
        child,
        logPath,
        alive: true,
        exitCode: null,
      };

      child.on("exit", (code) => {
        entry.alive = false;
        entry.exitCode = code;
        logStream.end();
      });

      child.on("error", () => {
        entry.alive = false;
        logStream.end();
      });

      this.bgProcesses.set(id, entry);

      return {
        success: true,
        output: [
          `Background process started (id: ${id}, pid: ${entry.pid})`,
          `Command: ${truncCmd(command, 80)}`,
          `Use process_logs(${id}) to view output, process_stop(${id}) to terminate.`,
        ].join("\n"),
        backgroundProcess: { id, pid: entry.pid, command },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Failed to start background process: ${msg}` };
    }
  }

  async getProcessLogs(id: number, tail = 50): Promise<ToolResult> {
    const entry = this.bgProcesses.get(id);
    if (!entry) {
      return { success: false, output: `No background process with id ${id}.` };
    }

    try {
      const stats = await stat(entry.logPath);
      const start = Math.max(0, stats.size - MAX_TAIL_BYTES);

      const content = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const stream = createReadStream(entry.logPath, { start });
        stream.on("data", (chunk: Buffer | string) => {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        });
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        stream.on("error", reject);
      });

      const lines = content.split("\n");
      const tailed = lines.slice(-tail).join("\n").trimEnd();
      const status = entry.alive ? "running" : `exited (code ${entry.exitCode ?? "unknown"})`;

      return {
        success: true,
        output: [
          `[Process ${id} — ${status} — pid ${entry.pid}]`,
          `[${truncCmd(entry.command, 70)}]`,
          "",
          tailed || "(no output yet)",
        ].join("\n"),
      };
    } catch {
      return {
        success: true,
        output: `[Process ${id} — ${entry.alive ? "running" : "exited"}] (no output yet)`,
      };
    }
  }

  async stopProcess(id: number): Promise<ToolResult> {
    const entry = this.bgProcesses.get(id);
    if (!entry) {
      return { success: false, output: `No background process with id ${id}.` };
    }

    if (!entry.alive) {
      return {
        success: true,
        output: `Process ${id} already exited (code ${entry.exitCode ?? "unknown"}).`,
      };
    }

    try {
      entry.child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          try {
            entry.child.kill("SIGKILL");
          } catch {
            /* already dead */
          }
          resolve();
        }, 3_000);
        entry.child.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      return {
        success: true,
        output: `Process ${id} (pid ${entry.pid}) stopped.`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Failed to stop process ${id}: ${msg}` };
    }
  }

  listProcesses(): ToolResult {
    const entries = [...this.bgProcesses.values()];
    if (entries.length === 0) {
      return { success: true, output: "No background processes." };
    }

    const lines = entries.map((entry) => {
      const status = entry.alive ? "running" : `exited(${entry.exitCode ?? "?"})`;
      const age = formatAge(entry.startedAt);
      return `${entry.id}  ${status}  pid:${entry.pid}  ${age}  ${truncCmd(entry.command, 50)}`;
    });

    return {
      success: true,
      output: ["ID  STATUS       PID    AGE     COMMAND", ...lines].join("\n"),
    };
  }

  async cleanup(): Promise<void> {
    for (const entry of this.bgProcesses.values()) {
      if (entry.alive) {
        try {
          entry.child.kill("SIGTERM");
        } catch {
          /* */
        }
      }
      try {
        await unlink(entry.logPath);
      } catch {
        /* */
      }
    }
    this.bgProcesses.clear();
    if (this.tmpDir) {
      try {
        await rm(this.tmpDir, { recursive: true, force: true });
      } catch {
        /* */
      }
    }
  }

  getCwd(): string {
    return this.cwd;
  }

  getSandboxMode(): SandboxMode {
    return this.sandboxMode;
  }

  setSandboxMode(mode: SandboxMode): void {
    this.sandboxMode = mode;
  }

  getSandboxSettings(): SandboxSettings {
    return this.sandboxSettings;
  }

  setSandboxSettings(settings: SandboxSettings): void {
    this.sandboxSettings = settings;
  }

  getToolDescription(): string {
    if (this.sandboxMode === "shuru") {
      const s = this.sandboxSettings;
      const netStatus = s.allowNet
        ? s.allowedHosts?.length
          ? `network is restricted to: ${s.allowedHosts.join(", ")}`
          : "network access is enabled"
        : "network is disabled";
      const hostBrowserNote = s.hostBrowserCommandsOnHost
        ? " Commands that invoke agent-browser run on the host instead of inside Shuru so they can interact with forwarded localhost services."
        : "";
      return `Execute a bash command inside a Shuru sandbox. Use for find, ls, git inspection, build tools, test runners, and other shell commands that should stay isolated. For content search, prefer the dedicated grep tool. The current workspace is mounted inside the sandbox at /workspace, ${netStatus}, and shell-side workspace file changes do not persist back to the host in this version, so prefer the dedicated file tools for durable edits.${hostBrowserNote} Set background=true for long-running processes like dev servers or watchers.`;
    }
    if (process.platform === "win32") {
      return "Execute a Windows PowerShell command. Use for Get-ChildItem, Get-Content, git, build tools, package managers, running tests, and other shell commands. Do not use POSIX paths or syntax such as /d/..., ls -la, find, or &&. For content search, prefer the dedicated grep tool. Set background=true for long-running processes like dev servers or watchers. Never create or modify files here (no >, echo, Set-Content, Out-File): PowerShell writes UTF-16/BOM that corrupts JSON and source files — use write_file/edit_file for every file change.";
    }
    return "Execute a POSIX shell command. Use for find, ls, git, build tools, package managers, running tests, and any other shell command. For content search, prefer the dedicated grep tool. Set background=true for long-running processes like dev servers, watchers, or anything that should keep running while you continue working. For file read/write/edit, prefer the dedicated file tools instead.";
  }

  private prepareCommand(command: string): { ok: true; command: string } | { ok: false; error: string } {
    if (this.sandboxMode !== "shuru") {
      return { ok: true, command };
    }
    if (shouldRunOnHostInSandboxMode(command, this.sandboxSettings)) {
      return { ok: true, command: wrapHostBrowserCommand(command) };
    }
    const unsupportedReason = getSandboxUnsupportedReason();
    if (unsupportedReason) {
      return { ok: false, error: unsupportedReason };
    }
    const blockedReason = getSandboxMutationBlockReason(command, this.sandboxSettings);
    if (blockedReason) {
      return { ok: false, error: blockedReason };
    }
    return { ok: true, command: wrapCommandForShuru(this.cwd, command, this.sandboxSettings) };
  }

  private formatSandboxRuntimeError(output: string, fallbackMessage: string): string | null {
    if (this.sandboxMode !== "shuru") {
      return null;
    }
    if (output.includes("shuru: command not found") || output.includes("sh: shuru: not found")) {
      return "Shuru sandbox mode is enabled, but the `shuru` CLI is not installed or not on PATH. Install Shuru or disable sandbox mode.";
    }
    if (output.includes("Apple Silicon") || fallbackMessage.includes("Apple Silicon")) {
      return "Shuru sandbox mode requires macOS on Apple Silicon.";
    }
    return null;
  }
}

/**
 * Only a bare `cd <dir>` changes the tool's persistent working directory. Anything else that
 * merely starts with `cd` (`cd src && bun test`, `cd a; ls`) runs through the shell as written —
 * treating everything after `cd ` as a directory name turned those into "no such directory"
 * failures (observed live 2026-09-17).
 */
export function parseStandaloneCd(command: string): string | null {
  const match = /^\s*cd\s+(?:"([^"]*)"|'([^']*)'|([^\s;&|<>]+))\s*$/u.exec(command);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

function truncCmd(cmd: string, max: number): string {
  const oneLine = cmd.replace(/\n/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function formatAge(start: Date): string {
  const sec = Math.round((Date.now() - start.getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h${min % 60}m`;
}

export function wrapCommandForShuru(cwd: string, command: string, settings: SandboxSettings = {}): string {
  const parts: string[] = ["shuru", "run"];

  if (settings.cpus) parts.push("--cpus", String(settings.cpus));
  if (settings.memory) parts.push("--memory", String(settings.memory));
  if (settings.diskSize) parts.push("--disk-size", String(settings.diskSize));
  if (settings.allowNet) parts.push("--allow-net");
  if (settings.allowedHosts) {
    for (const host of settings.allowedHosts) parts.push("--allow-host", host);
  }
  if (settings.ports) {
    for (const port of settings.ports) parts.push("-p", port);
  }
  if (settings.secrets) {
    for (const s of settings.secrets) {
      parts.push("--secret", `${s.name}=${s.fromEnv}@${s.hosts.join(",")}`);
    }
  }
  if (settings.from) parts.push("--from", settings.from);

  const mountArg = `${cwd}:/workspace`;
  parts.push("--mount", shellQuote(mountArg));
  const shellInit = buildShellInitScript(settings);
  const guestPrelude = buildGuestWorkspacePrelude(settings);
  const guestSteps = [
    shellInit,
    guestPrelude,
    `cd ${shellPathForScript(settings.guestWorkdir || "/workspace")}`,
    command,
  ].filter(Boolean);
  const guestCommand = guestSteps.join(" && ");
  parts.push("--", "sh", "-lc", shellQuote(guestCommand));
  return parts.join(" ");
}

const HOST_SAFE_SEGMENT_RE =
  /^\s*(?:(?:npx(?:\s+-y)?|bunx)\s+)?agent-browser\b|^\s*mkdir\s|^\s*sleep\s|^\s*echo\s|^\s*true\s*$|^\s*$/;

export function shouldRunOnHostInSandboxMode(command: string, settings: SandboxSettings = {}): boolean {
  if (!settings.hostBrowserCommandsOnHost) {
    return false;
  }
  if (!/\bagent-browser\b/.test(command)) {
    return false;
  }
  if (/\$\(|`/.test(command)) {
    return false;
  }
  const segments = command.split(/\s*(?:&&|\|\||;|\|[^|]|>>?)\s*/);
  return segments.every((segment) => HOST_SAFE_SEGMENT_RE.test(segment));
}

export function wrapHostBrowserCommand(command: string): string {
  const normalized = command
    .replace(/\bbunx\s+agent-browser\b/g, "__grok_ab")
    .replace(/\bnpx(?:\s+-y)?\s+agent-browser\b/g, "__grok_ab")
    .replace(/\bagent-browser\b/g, "__grok_ab");
  return [
    "__grok_ab() {",
    "  if command -v agent-browser >/dev/null 2>&1; then",
    '    command agent-browser "$@"',
    "  elif command -v bunx >/dev/null 2>&1; then",
    '    bunx agent-browser "$@"',
    "  elif command -v npx >/dev/null 2>&1; then",
    '    npx -y agent-browser "$@"',
    "  else",
    '    echo "agent-browser: not found (no bunx/npx fallback)" >&2',
    "    return 127",
    "  fi",
    "}",
    normalized,
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function shellPathForScript(value: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(value) ? value : shellQuote(value);
}

function buildGuestWorkspacePrelude(settings: SandboxSettings): string {
  if (!settings.guestWorkdir || !settings.syncHostWorkspace) {
    return "";
  }

  const guest = shellQuote(settings.guestWorkdir);
  const exclusions = [
    ".git",
    "node_modules",
    ".venv",
    ".next",
    "dist",
    "build",
    "target",
    ".pytest_cache",
    ".mypy_cache",
  ];
  const tarExcludes = exclusions.map((entry) => `--exclude=${shellQuote(entry)}`).join(" ");
  return [
    `mkdir -p ${guest}`,
    `find ${guest} -mindepth 1 -maxdepth 1 ${exclusions
      .map((entry) => `! -name ${shellQuote(entry)}`)
      .join(" ")} -exec rm -rf {} + 2>/dev/null || true`,
    `tar -C /workspace ${tarExcludes} -cf - . | tar -C ${guest} -xf -`,
  ].join(" && ");
}

function buildShellInitScript(settings: SandboxSettings): string {
  return (settings.shellInit ?? []).filter(Boolean).join(" && ");
}

function getSandboxUnsupportedReason(): string | null {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    return "Shuru sandbox mode currently requires macOS on Apple Silicon.";
  }
  return null;
}

export function getSandboxMutationBlockReason(command: string, settings: SandboxSettings = {}): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  if (/\bgit\s+/.test(trimmed) && !/\bgit\s+(status|diff|log|show|rev-parse|grep|ls-files)\b/.test(trimmed)) {
    return [
      "Sandbox mode blocks git commands that mutate repository state because Shuru guest-side workspace changes do not persist back to the host.",
      "Disable sandbox mode to run persistent git mutations on the real workspace.",
    ].join(" ");
  }

  const blockedPatterns: Array<{ pattern: RegExp; reason: string }> = [
    {
      pattern:
        /\b(?:prettier\s+--write|eslint\b.*--fix|biome\s+check\b.*--write|ruff\s+check\b.*--fix|gofmt\s+-w|rustfmt\b|clang-format\b.*-i)\b/,
      reason:
        "Shell-driven formatters that rewrite files are blocked in sandbox mode because those file changes would not persist back to the host workspace.",
    },
  ];

  if (!settings.allowEphemeralInstall) {
    const installPatterns: Array<{ pattern: RegExp; reason: string }> = [
      {
        pattern: /\b(?:npm|pnpm|yarn|bun)\s+(?:add|install|remove|unlink|update|upgrade)\b/,
        reason:
          "Package-manager installs are blocked in sandbox mode because workspace changes like lockfile updates would stay inside the Shuru guest overlay.",
      },
      {
        pattern: /\b(?:pip|pip3)\s+install\b|\bpoetry\s+add\b|\buv\s+add\b|\bcargo\s+add\b/,
        reason:
          "Dependency install commands are blocked in sandbox mode because resulting workspace changes would not persist back to the host.",
      },
    ];
    const installMatch = installPatterns.find(({ pattern }) => pattern.test(trimmed));
    if (installMatch) {
      return `${installMatch.reason} Use read_file/edit_file/write_file for durable edits, or disable sandbox mode for host-persistent shell changes.`;
    }
  }

  const matched = blockedPatterns.find(({ pattern }) => pattern.test(trimmed));
  if (!matched) return null;
  return `${matched.reason} Use read_file/edit_file/write_file for durable edits, or disable sandbox mode for host-persistent shell changes.`;
}
