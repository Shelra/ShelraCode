import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getProductUserDir } from "../product/identity";

const execFile = promisify(execFileCallback);

export interface RuntimeBootstrapProgress {
  status: string;
  detail?: string;
  percent?: number;
  completed?: number;
  total?: number;
  speedBytesPerSecond?: number;
  etaSeconds?: number;
  elapsedSeconds?: number;
}

export interface RuntimeBootstrapResult {
  success: boolean;
  runtimeId?: "shelra-llama";
  executablePath?: string;
  reason?: string;
}

export type RuntimeBackend = "cpu" | "cuda";

export interface RuntimeBootstrapOptions {
  signal?: AbortSignal;
  onProgress?: (progress: RuntimeBootstrapProgress) => void;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  arch?: string;
  fetchImpl?: typeof fetch;
  runtimeDirectory?: string;
  /** Force a backend in tests or advanced configuration. Auto-detection is the default. */
  backend?: RuntimeBackend;
}

export interface RuntimeInstallPlan {
  runtimeId: "shelra-llama";
  backend: RuntimeBackend;
  url: string;
  archiveName: string;
  executableName: string;
  release: string;
  sha256: string;
  dependencies?: RuntimeDependencyPlan[];
}

export interface RuntimeDependencyPlan {
  url: string;
  archiveName: string;
  sha256: string;
}

// Pinned to a real upstream release asset. Updating this pin is deliberate so
// a startup cannot silently execute an unreviewed binary after a tag changes.
export const MANAGED_LLAMA_RELEASE = "b10826";

/**
 * Select the local backend from actual host capability. NVIDIA's official
 * llama.cpp Windows CUDA 12.4 asset supports the GTX 1650 generation and is
 * preferred whenever nvidia-smi reports a device. CPU remains the safe
 * fallback for machines without NVIDIA acceleration.
 */
export async function detectPreferredRuntimeBackend(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  environment: Record<string, string | undefined> = process.env,
): Promise<RuntimeBackend> {
  const requested = environment.SHELRA_RUNTIME_BACKEND?.trim().toLowerCase();
  if (requested === "cpu" || requested === "cuda") return requested;
  if (platform !== "win32" || arch !== "x64") return "cpu";
  try {
    const result = await execFile("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader,nounits"], {
      timeout: 2_500,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    return result.stdout.trim().length > 0 ? "cuda" : "cpu";
  } catch {
    return "cpu";
  }
}

export function managedRuntimeDirectory(): string {
  return path.join(getProductUserDir(), "runtime", "llama-cpp");
}

export function resolveRuntimeInstallPlan(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  env: Record<string, string | undefined> = process.env,
  backend?: RuntimeBackend,
): RuntimeInstallPlan | undefined {
  if (arch !== "x64" && arch !== "arm64") return undefined;
  const selectedBackend = backend ?? (env.SHELRA_RUNTIME_BACKEND?.trim().toLowerCase() === "cuda" ? "cuda" : "cpu");
  if (platform === "win32" && arch === "x64") {
    if (selectedBackend === "cuda") {
      return {
        runtimeId: "shelra-llama",
        backend: "cuda",
        url: `https://github.com/ggml-org/llama.cpp/releases/download/${MANAGED_LLAMA_RELEASE}/llama-${MANAGED_LLAMA_RELEASE}-bin-win-cuda-12.4-x64.zip`,
        archiveName: `llama-${MANAGED_LLAMA_RELEASE}-win-cuda-12.4-x64.zip`,
        executableName: "llama-server.exe",
        release: MANAGED_LLAMA_RELEASE,
        sha256: "f330d770f0bc82d06cac26f773b85b23fe4eb409159a8738271fa2881523bfa2",
        dependencies: [
          {
            url: `https://github.com/ggml-org/llama.cpp/releases/download/${MANAGED_LLAMA_RELEASE}/cudart-llama-bin-win-cuda-12.4-x64.zip`,
            archiveName: `cudart-${MANAGED_LLAMA_RELEASE}-win-cuda-12.4-x64.zip`,
            sha256: "8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6",
          },
        ],
      };
    }
    return {
      runtimeId: "shelra-llama",
      backend: "cpu",
      url: `https://github.com/ggml-org/llama.cpp/releases/download/${MANAGED_LLAMA_RELEASE}/llama-${MANAGED_LLAMA_RELEASE}-bin-win-cpu-x64.zip`,
      archiveName: `llama-${MANAGED_LLAMA_RELEASE}-win-cpu-x64.zip`,
      executableName: "llama-server.exe",
      release: MANAGED_LLAMA_RELEASE,
      sha256: "5828cccc7261b14607d23de3144f35fac4249d9fd207e13bff5e31dd8ae39d56",
    };
  }
  if (platform === "darwin") {
    const suffix = arch === "arm64" ? "macos-arm64" : "macos-x64";
    return {
      runtimeId: "shelra-llama",
      backend: "cpu",
      url: `https://github.com/ggml-org/llama.cpp/releases/download/${MANAGED_LLAMA_RELEASE}/llama-${MANAGED_LLAMA_RELEASE}-bin-${suffix}.tar.gz`,
      archiveName: `llama-${MANAGED_LLAMA_RELEASE}-${suffix}.tar.gz`,
      executableName: "llama-server",
      release: MANAGED_LLAMA_RELEASE,
      sha256: "15c1b2f460331d9a20709ebde21240d7e60fdb5cf15e1f8db0309af3a5bbc6d2",
    };
  }
  if (platform === "linux" && arch === "x64") {
    return {
      runtimeId: "shelra-llama",
      backend: "cpu",
      url: `https://github.com/ggml-org/llama.cpp/releases/download/${MANAGED_LLAMA_RELEASE}/llama-${MANAGED_LLAMA_RELEASE}-bin-ubuntu-x64.tar.gz`,
      archiveName: `llama-${MANAGED_LLAMA_RELEASE}-ubuntu-x64.tar.gz`,
      executableName: "llama-server",
      release: MANAGED_LLAMA_RELEASE,
      sha256: "c708a8d84853c86ad3400428b5d6ef2b504e297d98ccdcf8362195c6638b7fd9",
    };
  }
  return undefined;
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Runtime download cancelled", "AbortError");
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function downloadArchive(
  url: string,
  archivePath: string,
  options: RuntimeBootstrapOptions,
  startedAt: number,
  expectedSha256?: string,
): Promise<number> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let offset = await fileSize(archivePath);
  const headers: Record<string, string> = offset > 0 ? { Range: `bytes=${offset}-` } : {};
  let response = await fetchImpl(url, { headers, signal: options.signal });
  if (response.status === 416 && offset > 0) {
    // The server refused the range. Accept the partial only when its bytes are
    // provably the finished archive; otherwise discard it and start over, so a
    // poisoned partial can never be mistaken for a completed download.
    const completeSize = response.headers.get("content-range")?.match(/\*\/(\d+)/u)?.[1];
    const sizeMatches = completeSize !== undefined && Number(completeSize) === offset;
    if (sizeMatches && expectedSha256 && (await sha256(archivePath).catch(() => "")) === expectedSha256) return offset;
    await unlink(archivePath).catch(() => undefined);
    offset = 0;
    abortIfNeeded(options.signal);
    response = await fetchImpl(url, { signal: options.signal });
  }
  if (!response.ok && response.status !== 206) throw new Error(`Runtime download returned HTTP ${response.status}.`);
  if (!response.body) throw new Error("Runtime download returned an empty archive.");
  const resumed = offset > 0 && response.status === 206;
  const start = resumed ? offset : 0;
  const contentRange = response.headers.get("content-range")?.match(/\/(\d+)/u)?.[1];
  const contentLength = response.headers.get("content-length");
  const total = contentRange ? Number(contentRange) : contentLength ? Number(contentLength) + start : undefined;
  const file = await (await import("node:fs/promises")).open(archivePath, resumed ? "a" : "w");
  let completed = start;
  let lastReport = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      abortIfNeeded(options.signal);
      await file.write(chunk);
      completed += chunk.byteLength;
      const now = Date.now();
      if (now - lastReport >= 150 || completed === total) {
        lastReport = now;
        const elapsed = Math.max(1, now - startedAt) / 1000;
        const speed = (completed - start) / elapsed;
        options.onProgress?.({
          status: "downloading",
          completed,
          ...(total === undefined ? {} : { total, percent: Math.round((completed / total) * 100) }),
          ...(speed > 0 ? { speedBytesPerSecond: speed } : {}),
          ...(total !== undefined && speed > 0
            ? { etaSeconds: Math.ceil(Math.max(0, total - completed) / speed) }
            : {}),
          elapsedSeconds: Math.floor((now - startedAt) / 1000),
        });
      }
    }
  } finally {
    await file.close();
  }
  return completed;
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

async function extractArchive(plan: RuntimeInstallPlan, archivePath: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  if (plan.archiveName.endsWith(".zip")) {
    if (process.platform !== "win32")
      throw new Error("The managed Windows runtime archive cannot run on this platform.");
    await execFile("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -LiteralPath ${quotePowerShell(archivePath)} -DestinationPath ${quotePowerShell(destination)} -Force`,
    ]);
    return;
  }
  await execFile("tar", ["-xzf", archivePath, "-C", destination]);
}

async function findFiles(root: string, predicate: (name: string) => boolean): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const matches: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && predicate(entry.name)) matches.push(fullPath);
    if (entry.isDirectory()) matches.push(...(await findFiles(fullPath, predicate)));
  }
  return matches;
}

/** Keep CUDA DLLs beside llama-server even if an archive adds a subdirectory. */
async function flattenRuntimeLibraries(root: string): Promise<void> {
  const libraries = await findFiles(root, (name) => name.toLowerCase().endsWith(".dll"));
  for (const library of libraries) {
    if (path.dirname(library) === path.resolve(root)) continue;
    const destination = path.join(root, path.basename(library));
    try {
      await stat(destination);
    } catch {
      await copyFile(library, destination);
    }
  }
}

async function hasCudaDevice(executablePath: string): Promise<boolean> {
  try {
    const result = await execFile(executablePath, ["--list-devices"], {
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    return /CUDA\d+/iu.test(result.stdout);
  } catch {
    return false;
  }
}

async function installRuntimeDependencies(
  plan: RuntimeInstallPlan,
  destination: string,
  root: string,
  options: RuntimeBootstrapOptions,
  startedAt: number,
  emit: (progress: Omit<RuntimeBootstrapProgress, "elapsedSeconds">) => void,
): Promise<void> {
  for (const dependency of plan.dependencies ?? []) {
    const archivePath = path.join(root, `${dependency.archiveName}.part`);
    const archiveFinalPath = path.join(root, dependency.archiveName);
    let archiveReady = false;
    try {
      archiveReady = (await sha256(archiveFinalPath)) === dependency.sha256;
    } catch {
      archiveReady = false;
    }
    if (!archiveReady) {
      await unlink(archiveFinalPath).catch(() => undefined);
      emit({ status: "Downloading CUDA runtime libraries", detail: "Fetching the NVIDIA acceleration package" });
      const bytes = await downloadArchive(dependency.url, archivePath, options, startedAt, dependency.sha256);
      emit({ status: "Verifying CUDA runtime libraries", detail: `${bytes} bytes downloaded` });
      const actualHash = await sha256(archivePath);
      if (actualHash !== dependency.sha256) {
        await unlink(archivePath).catch(() => undefined);
        throw new Error("The CUDA runtime dependency failed its SHA-256 integrity check.");
      }
      await rename(archivePath, archiveFinalPath);
    }
    emit({ status: "Preparing CUDA runtime libraries", detail: "Installing NVIDIA libraries beside llama.cpp" });
    await extractArchive({ ...plan, archiveName: dependency.archiveName }, archiveFinalPath, destination);
    await flattenRuntimeLibraries(destination);
  }
}

async function findExecutables(root: string, executableName: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  let entries: Array<import("node:fs").Dirent>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const matches: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === executableName.toLowerCase()) matches.push(fullPath);
    if (entry.isDirectory()) matches.push(...(await findExecutables(fullPath, executableName)));
  }
  return matches;
}

async function findExecutable(root: string, executableName: string): Promise<string | undefined> {
  return (await findExecutables(root, executableName))[0];
}

export async function findManagedLlamaServer(
  runtimeDirectory = managedRuntimeDirectory(),
  platform: NodeJS.Platform = process.platform,
  backend: RuntimeBackend | "auto" = "auto",
): Promise<string | undefined> {
  const executableName = platform === "win32" ? "llama-server.exe" : "llama-server";
  const candidates = await findExecutables(runtimeDirectory, executableName);
  const isCuda = (candidate: string) => /(?:^|[\\/_-])cuda(?:[\\/_-]|$)/iu.test(candidate);
  if (backend === "cuda") return candidates.find(isCuda);
  if (backend === "cpu") return candidates.find((candidate) => !isCuda(candidate));
  return candidates.sort((left, right) => Number(isCuda(right)) - Number(isCuda(left)))[0];
}

export async function installManagedRuntime(options: RuntimeBootstrapOptions = {}): Promise<RuntimeBootstrapResult> {
  const env = options.env ?? process.env;
  if (env.SHELRA_DISABLE_RUNTIME_INSTALL === "1") {
    return { success: false, reason: "Automatic runtime installation is disabled for this session." };
  }
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const backend = options.backend ?? (await detectPreferredRuntimeBackend(platform, arch, env));
  const plan = resolveRuntimeInstallPlan(platform, arch, env, backend);
  if (!plan) return { success: false, reason: "Shelra cannot provide a managed local runtime for this platform yet." };
  const root = options.runtimeDirectory ?? managedRuntimeDirectory();
  const versionDirectory = path.join(root, `${plan.release}-${plan.backend}`);
  const existing = await findExecutable(versionDirectory, plan.executableName);
  if (existing) {
    if (plan.backend !== "cuda" || (await hasCudaDevice(existing))) {
      return { success: true, runtimeId: plan.runtimeId, executablePath: existing };
    }
    // A previous interrupted setup may contain the CUDA executable without
    // the separate cudart DLL archive. Complete that setup in place.
    const startedAt = Date.now();
    const emit = (progress: Omit<RuntimeBootstrapProgress, "elapsedSeconds">) =>
      options.onProgress?.({ ...progress, elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000) });
    try {
      await installRuntimeDependencies(plan, path.dirname(existing), root, options, startedAt, emit);
      if (await hasCudaDevice(existing)) {
        emit({ status: "Shelra CUDA runtime ready", detail: "NVIDIA GPU acceleration is active", percent: 100 });
        return { success: true, runtimeId: plan.runtimeId, executablePath: existing };
      }
      return { success: false, reason: "The CUDA runtime was installed but llama.cpp still cannot see a CUDA device." };
    } catch (error) {
      return { success: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }
  await mkdir(root, { recursive: true });
  const archivePath = path.join(root, `${plan.archiveName}.part`);
  const archiveFinalPath = path.join(root, plan.archiveName);
  const extractionDirectory = path.join(root, `${plan.release}.staging`);
  const startedAt = Date.now();
  const emit = (progress: Omit<RuntimeBootstrapProgress, "elapsedSeconds">) =>
    options.onProgress?.({ ...progress, elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000) });
  try {
    emit({ status: "Downloading Shelra local runtime", detail: "Fetching the signed llama.cpp engine" });
    const bytes = await downloadArchive(plan.url, archivePath, options, startedAt, plan.sha256);
    emit({ status: "Verifying Shelra local runtime", detail: `${bytes} bytes downloaded` });
    const actualHash = await sha256(archivePath);
    if (actualHash !== plan.sha256) throw new Error("The managed runtime archive failed its SHA-256 integrity check.");
    emit({ status: "Preparing Shelra local runtime", detail: "Unpacking the private inference engine" });
    // Expand-Archive/tar use the extension to select a decoder. Keep the
    // resumable `.part` while downloading, then expose the completed archive
    // under its real extension before extraction.
    await rename(archivePath, archiveFinalPath);
    await extractArchive(plan, archiveFinalPath, extractionDirectory);
    await installRuntimeDependencies(plan, extractionDirectory, root, options, startedAt, emit);
    const executable = await findExecutable(extractionDirectory, plan.executableName);
    if (!executable) throw new Error("The downloaded runtime did not contain llama-server.");
    await rename(extractionDirectory, versionDirectory);
    const installed = await findExecutable(versionDirectory, plan.executableName);
    if (!installed) throw new Error("The managed runtime could not be finalized.");
    emit({ status: "Shelra local runtime ready", detail: "No external runtime application is required", percent: 100 });
    return { success: true, runtimeId: plan.runtimeId, executablePath: installed };
  } catch (error) {
    // A failed install must not leave a poisoned partial or a half-extracted
    // staging directory behind: the next attempt would resume a full-size
    // archive, be answered with 416, and fail forever. A user-cancelled
    // download keeps its partial so it can genuinely resume.
    const cancelled = error instanceof Error && error.name === "AbortError";
    if (!cancelled) {
      await unlink(archivePath).catch(() => undefined);
      await unlink(archiveFinalPath).catch(() => undefined);
    }
    await rm(extractionDirectory, { recursive: true, force: true }).catch(() => undefined);
    return { success: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
