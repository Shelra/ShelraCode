import { type ChildProcess, spawn } from "node:child_process";
import { probeHttp } from "./http";
import { allocateLogPath, BoundedCapture, DEFAULT_CAPTURE_CHARS, RunLog } from "./logging";
import { buildShellInvocation, createShellErrorFilter, killProcessTree, spawnOptions } from "./shell";
import type { ManagedProcess, ProcessStartOptions } from "./types";

interface ProcessHandle {
  process: ManagedProcess;
  child: ChildProcess;
  log: RunLog;
  output: BoundedCapture;
  errorOutput: BoundedCapture;
  settled: boolean;
}

const PORT_PATTERN = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0)[:/](\d{2,5})/iu;
const handles = new Map<string, ProcessHandle>();

function findPort(text: string): number | undefined {
  const match = PORT_PATTERN.exec(text);
  const port = match?.[1] ? Number(match[1]) : undefined;
  return port && port > 0 && port < 65_536 ? port : undefined;
}

function closeHandle(handle: ProcessHandle, state: ManagedProcess["state"], exitCode: number | null): void {
  if (handle.settled) return;
  handle.settled = true;
  handle.process.state = state;
  handle.process.exitCode = exitCode;
  void handle.log.close(`# exit: ${exitCode ?? "none"} state: ${state}`);
}

function wireOutput(handle: ProcessHandle): void {
  const filter = createShellErrorFilter();
  handle.child.stdout?.setEncoding("utf8");
  handle.child.stderr?.setEncoding("utf8");
  handle.child.stdout?.on("data", (chunk: string) => {
    handle.output.append(chunk);
    handle.log.write("stdout", chunk);
    if (!handle.process.port) handle.process.port = findPort(chunk);
    if (handle.process.port && !handle.process.url) handle.process.url = `http://127.0.0.1:${handle.process.port}`;
  });
  handle.child.stderr?.on("data", (chunk: string) => {
    const cleaned = filter.push(chunk);
    if (!cleaned) return;
    handle.errorOutput.append(cleaned);
    handle.log.write("stderr", cleaned);
    if (!handle.process.port) handle.process.port = findPort(cleaned);
    if (handle.process.port && !handle.process.url) handle.process.url = `http://127.0.0.1:${handle.process.port}`;
  });
  handle.child.on("error", (error) => {
    handle.process.failureReason = error.message;
    closeHandle(handle, "failed", null);
  });
  handle.child.on("close", (code) => {
    if (!handle.settled) closeHandle(handle, code === 0 ? "exited" : "failed", code);
  });
}

async function waitForReady(handle: ProcessHandle, options: ProcessStartOptions): Promise<void> {
  const timeoutMs = options.readyTimeoutMs ?? 30_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (options.signal?.aborted) {
      await killProcessTree(handle.child.pid, 500);
      closeHandle(handle, "stopped", null);
      throw new Error("Process start was cancelled");
    }
    if (handle.process.state === "failed" || handle.process.state === "exited") {
      throw new Error(
        handle.process.failureReason ?? `Process exited with code ${handle.process.exitCode ?? "unknown"}`,
      );
    }

    const output = `${handle.output.text()}\n${handle.errorOutput.text()}`;
    const patternReady = options.readyPattern?.test(output) ?? false;
    const port = options.port ?? handle.process.port;
    if (port) {
      handle.process.port = port;
      handle.process.url ??= `http://127.0.0.1:${port}`;
      const probe = await probeHttp(handle.process.url, { timeoutMs: 1_000, signal: options.signal });
      if (probe.ok || patternReady) {
        handle.process.state = "ready";
        return;
      }
    } else if (patternReady || (output.trim() && Date.now() - startedAt >= 300)) {
      handle.process.state = "ready";
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  handle.process.failureReason = `Process did not become ready within ${timeoutMs}ms.`;
  await killProcessTree(handle.child.pid, 500);
  closeHandle(handle, "failed", null);
  throw new Error(handle.process.failureReason);
}

/** Starts a long-running process and waits for a bounded readiness signal. */
export class ProcessManager {
  async start(options: ProcessStartOptions): Promise<ManagedProcess> {
    if (options.signal?.aborted) throw new Error("Process start was cancelled");
    const invocation = buildShellInvocation(options.command);
    const id = `proc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const managed: ManagedProcess = {
      id,
      command: options.command,
      cwd: options.cwd,
      state: "starting",
      startedAt: Date.now(),
      logPath: allocateLogPath("process"),
    };
    const log = new RunLog(managed.logPath);
    log.header([
      `# command: ${options.command}`,
      `# cwd: ${options.cwd}`,
      `# started: ${new Date(managed.startedAt).toISOString()}`,
    ]);

    let child: ChildProcess;
    try {
      child = spawn(invocation.file, invocation.args, spawnOptions(options.cwd, { ...process.env, ...options.env }));
    } catch (error) {
      await log.close();
      throw error;
    }
    managed.pid = child.pid;
    managed.port = options.port;
    if (options.port) managed.url = `http://127.0.0.1:${options.port}`;
    const handle: ProcessHandle = {
      process: managed,
      child,
      log,
      output: new BoundedCapture(DEFAULT_CAPTURE_CHARS),
      errorOutput: new BoundedCapture(DEFAULT_CAPTURE_CHARS),
      settled: false,
    };
    handles.set(id, handle);
    wireOutput(handle);
    try {
      await waitForReady(handle, options);
      return managed;
    } catch (error) {
      handles.delete(id);
      throw error;
    }
  }

  async stop(id: string): Promise<void> {
    const handle = handles.get(id);
    if (!handle) return;
    handles.delete(id);
    await killProcessTree(handle.child.pid, 500);
    closeHandle(handle, "stopped", null);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...handles.keys()].map((id) => this.stop(id)));
  }
}
