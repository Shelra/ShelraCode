import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CLI_NAME, PRODUCT_NAME } from "../product/identity";

export interface ShelraInstallPaths {
  stateDir: string;
  binDir: string;
  executablePath: string;
  manifestPath: string;
}

export interface ActiveInstallationManifest {
  product: string;
  command: string;
  version: string;
  platform: string;
  architecture: string;
  executable: string;
  installedAt: string;
}

export interface InstallExecutableOptions {
  sourcePath: string;
  version: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  installDir?: string;
  environment?: Record<string, string | undefined>;
  persistUserPath?: boolean;
  now?: Date;
}

export interface InstallExecutableResult {
  paths: ShelraInstallPaths;
  manifest: ActiveInstallationManifest;
  pathPersisted: boolean;
  previousVersionBackedUp: boolean;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function homeDirectory(environment: Record<string, string | undefined>): string {
  return environment.USERPROFILE?.trim() || environment.HOME?.trim() || os.homedir();
}

/** Return the user-level directory that contains the active Shelra command. */
export function defaultInstallDirectory(
  platform: NodeJS.Platform = process.platform,
  environment: Record<string, string | undefined> = process.env,
): string {
  const home = homeDirectory(environment);
  if (platform === "win32") return path.join(home, ".shelra", "bin");
  return environment.XDG_BIN_HOME?.trim() || path.join(home, ".local", "bin");
}

export function installPaths(
  platform: NodeJS.Platform = process.platform,
  environment: Record<string, string | undefined> = process.env,
  installDir?: string,
): ShelraInstallPaths {
  const binDir = path.resolve(installDir ?? defaultInstallDirectory(platform, environment));
  const executable = platform === "win32" ? `${CLI_NAME}.exe` : CLI_NAME;
  return {
    stateDir: path.dirname(binDir),
    binDir,
    executablePath: path.join(binDir, executable),
    manifestPath: path.join(path.dirname(binDir), "active.json"),
  };
}

/** Merge a directory into PATH without adding duplicates. */
export function mergePathEntries(existing: string | undefined, entry: string): string {
  const values = (existing ?? "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const normalizedEntry = path.normalize(entry).replace(/[\\/]$/, "");
  const alreadyPresent = values.some(
    (value) =>
      path
        .normalize(value)
        .replace(/[\\/]$/, "")
        .toLowerCase() === normalizedEntry.toLowerCase(),
  );
  return alreadyPresent ? values.join(path.delimiter) : [...values, entry].join(path.delimiter);
}

function updateCurrentProcessPath(entry: string, environment: Record<string, string | undefined>): void {
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") ?? "Path";
  environment[pathKey] = mergePathEntries(environment[pathKey], entry);
}

function spawnEnvironment(environment: Record<string, string | undefined>, installDir: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) result[key] = value;
  }
  result.SHELRA_INSTALL_BIN = installDir;
  return result;
}

async function persistWindowsUserPath(
  installDir: string,
  environment: Record<string, string | undefined>,
): Promise<void> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$entry = $env:SHELRA_INSTALL_BIN",
    "$existing = [Environment]::GetEnvironmentVariable('Path', 'User')",
    "$items = [System.Collections.Generic.List[string]]::new()",
    "if ($null -ne $existing) {",
    "  foreach ($item in ($existing -split ';')) {",
    "    $trimmed = $item.Trim()",
    "    if ($trimmed.Length -gt 0 -and -not $items.Contains($trimmed)) { $items.Add($trimmed) }",
    "  }",
    "}",
    "$alreadyPresent = $false",
    "foreach ($item in $items) { if ($item.TrimEnd('\\') -ieq $entry.TrimEnd('\\')) { $alreadyPresent = $true } }",
    "if (-not $alreadyPresent) { $items.Add($entry) }",
    "[Environment]::SetEnvironmentVariable('Path', ($items -join ';'), 'User')",
  ].join("\n");

  const [stderr, exitCode] = await new Promise<[string, number]>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
        env: spawnEnvironment(environment, installDir),
        windowsHide: true,
      });
    } catch (error) {
      reject(
        new Error(
          `Unable to start PowerShell while registering Shelra in PATH: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return;
    }
    let errorOutput = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString();
    });
    child.once("error", (error) => {
      reject(new Error(`Unable to start PowerShell while registering Shelra in PATH: ${error.message}`));
    });
    child.once("close", (code) => resolve([errorOutput, code ?? 1]));
  });
  if (exitCode !== 0) {
    throw new Error(
      `Unable to update the user PATH (${exitCode}): ${stderr.trim() || "PowerShell returned no details."}`,
    );
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function unlinkWithRetry(targetPath: string, attempts = 5): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await unlink(targetPath);
      return;
    } catch (error) {
      if (isMissing(error)) return;
      const code = errorCode(error);
      const locked = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (!locked || attempt === attempts - 1) throw error;
      await sleep(120 * (attempt + 1));
    }
  }
}

async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = errorCode(error);
      const locked = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (!locked || attempt === attempts - 1) throw error;
      await sleep(150 * (attempt + 1));
    }
  }
}

async function replaceActiveExecutable(stagedPath: string, executablePath: string): Promise<boolean> {
  const previousPath = `${executablePath}.previous`;
  let previousVersionBackedUp = false;
  try {
    await unlinkWithRetry(previousPath, 3);
  } catch (error) {
    if (!isMissing(error)) {
      const code = errorCode(error);
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") {
        throw error;
      }
    }
  }

  try {
    await renameWithRetry(executablePath, previousPath, 4);
    previousVersionBackedUp = true;
  } catch (error) {
    if (!isMissing(error)) {
      const code = errorCode(error);
      const locked = code === "EPERM" || code === "EBUSY" || code === "EACCES";
      if (locked) {
        throw new Error(
          `Cannot replace the active executable because it is still running or locked (${executablePath}). Close any running shelra terminals and try again, or set SHELRA_BUILD_SKIP_INSTALL=1 to only build dist. Original error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      throw error;
    }
  }

  try {
    await renameWithRetry(stagedPath, executablePath, 4);
  } catch (error) {
    if (previousVersionBackedUp) {
      await rename(previousPath, executablePath).catch(() => undefined);
    }
    throw error;
  }
  return previousVersionBackedUp;
}

async function writeManifestAtomically(manifestPath: string, manifest: ActiveInstallationManifest): Promise<void> {
  const stagedManifest = `${manifestPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(stagedManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await renameWithRetry(stagedManifest, manifestPath, 4);
  } finally {
    await unlink(stagedManifest).catch(() => undefined);
  }
}

export async function installExecutable(options: InstallExecutableOptions): Promise<InstallExecutableResult> {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const paths = installPaths(platform, environment, options.installDir);
  const sourcePath = path.resolve(options.sourcePath);
  const source = await stat(sourcePath);
  if (!source.isFile()) {
    throw new Error(`Cannot install Shelra: source is not a file: ${sourcePath}`);
  }
  if (path.resolve(paths.executablePath) === sourcePath) {
    throw new Error("Cannot install Shelra over the build source itself.");
  }

  await mkdir(paths.binDir, { recursive: true });
  await mkdir(paths.stateDir, { recursive: true });
  const stagedPath = path.join(
    paths.binDir,
    `.${path.basename(paths.executablePath)}.installing-${process.pid}-${Date.now()}`,
  );
  try {
    await copyFile(sourcePath, stagedPath);
    const previousVersionBackedUp = await replaceActiveExecutable(stagedPath, paths.executablePath);
    const manifest: ActiveInstallationManifest = {
      product: PRODUCT_NAME,
      command: CLI_NAME,
      version: options.version,
      platform,
      architecture: options.architecture ?? process.arch,
      executable: path.basename(paths.executablePath),
      installedAt: (options.now ?? new Date()).toISOString(),
    };
    await writeManifestAtomically(paths.manifestPath, manifest);

    const shouldPersistPath = options.persistUserPath ?? platform === "win32";
    let pathPersisted = false;
    if (shouldPersistPath && platform === "win32") {
      await persistWindowsUserPath(paths.binDir, environment);
      pathPersisted = true;
    }
    updateCurrentProcessPath(paths.binDir, environment);
    return {
      paths,
      manifest,
      pathPersisted,
      previousVersionBackedUp,
    };
  } finally {
    await unlink(stagedPath).catch(() => undefined);
  }
}

export async function readActiveInstallation(
  homeDir?: string,
): Promise<{ manifest: ActiveInstallationManifest; paths: ShelraInstallPaths } | null> {
  const environment = homeDir ? { USERPROFILE: homeDir, HOME: homeDir } : process.env;
  const paths = installPaths(process.platform, environment);
  try {
    const raw = await readFile(paths.manifestPath, "utf8");
    const value = JSON.parse(raw) as Partial<ActiveInstallationManifest>;
    if (
      typeof value.product !== "string" ||
      typeof value.command !== "string" ||
      typeof value.version !== "string" ||
      typeof value.platform !== "string" ||
      typeof value.architecture !== "string" ||
      typeof value.executable !== "string"
    ) {
      return null;
    }
    return {
      manifest: value as ActiveInstallationManifest,
      paths,
    };
  } catch {
    return null;
  }
}
