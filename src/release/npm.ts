/**
 * ShelraCode on the npm registry, which npm, bun, pnpm and yarn all install from (`scripts/npm-publish.ts` builds and
 * publishes it from a GitHub release). The package `shelra` is a small launcher; each platform's release binary is a
 * package of its own (`shelra-windows-x64`, `shelra-linux-x64`, `shelra-darwin-arm64`), an optional dependency the
 * package manager installs only on that platform. Nothing runs at install time: pnpm and bun do not run dependencies'
 * install scripts by default, and the binary is the same file the GitHub release and `install.ps1` ship.
 *
 * The tarballs are written here, not by `npm pack`: packed on Windows, every file loses its executable bit, and a
 * Linux or macOS binary that is not executable cannot be launched.
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

export interface NpmPlatform {
  /** The package's name on npm. */
  name: string;
  /** The GitHub release asset that becomes its binary. */
  asset: string;
  /** The binary's name inside the package (`bin/<binary>`). */
  binary: string;
  os: NodeJS.Platform;
  cpu: string;
  label: string;
}

export const NPM_PLATFORMS: readonly NpmPlatform[] = [
  {
    name: "shelra-windows-x64",
    asset: "shelra-windows-x64.exe",
    binary: "shelra.exe",
    os: "win32",
    cpu: "x64",
    label: "Windows x64",
  },
  {
    name: "shelra-linux-x64",
    asset: "shelra-linux-x64",
    binary: "shelra",
    os: "linux",
    cpu: "x64",
    label: "Linux x64",
  },
  {
    name: "shelra-darwin-arm64",
    asset: "shelra-darwin-arm64",
    binary: "shelra",
    os: "darwin",
    cpu: "arm64",
    label: "macOS Apple Silicon",
  },
];

const SHARED = {
  license: "MIT",
  homepage: "https://www.shelra.dev",
  repository: { type: "git", url: "git+https://github.com/Shelra/ShelraCode.git" },
  bugs: { url: "https://github.com/Shelra/ShelraCode/issues" },
};

/** The launcher package: what `npm install -g shelra` puts on the PATH. */
export function launcherManifest(version: string): Record<string, unknown> {
  return {
    name: "shelra",
    version,
    description: "ShelraCode: a terminal coding agent that solves real tasks with any model, free models first.",
    keywords: ["cli", "agent", "coding-agent", "ai", "terminal", "openrouter", "shelra"],
    ...SHARED,
    bin: { shelra: "bin/shelra.cjs" },
    engines: { node: ">=18" },
    optionalDependencies: Object.fromEntries(NPM_PLATFORMS.map((platform) => [platform.name, version])),
  };
}

/** One platform's binary package; the package manager skips it on any other platform. */
export function platformManifest(platform: NpmPlatform, version: string): Record<string, unknown> {
  return {
    name: platform.name,
    version,
    description: `The ShelraCode binary for ${platform.label}. Install \`shelra\` instead; it uses this package.`,
    ...SHARED,
    os: [platform.os],
    cpu: [platform.cpu],
    // Yarn's Plug'n'Play keeps a binary package unpacked so it can be executed.
    preferUnplugged: true,
  };
}

/** The packages' README: how to install with each package manager. */
export function npmReadme(version: string, platform?: NpmPlatform): string {
  const lines = [
    "# ShelraCode",
    "",
    platform
      ? `The ShelraCode ${version} binary for ${platform.label}. Install the \`shelra\` package, which uses it:`
      : "A terminal coding agent that solves real tasks with any model, free models first. The model proposes; only what Shelra observes marks work as verified.",
    "",
    "```bash",
    "npm install -g shelra",
    "bun add -g shelra",
    "pnpm add -g shelra",
    "yarn global add shelra",
    "```",
    "",
    "Then run `shelra`. Update with the same package manager (`npm install -g shelra@latest`). Windows, macOS and",
    "Linux without a package manager: see https://www.shelra.dev and https://github.com/Shelra/ShelraCode.",
    "",
  ];
  return lines.join("\n");
}

export interface TarEntry {
  /** Path inside the archive, below `package/`. */
  path: string;
  data: Uint8Array;
  /** File mode: 0o755 for an executable, 0o644 otherwise. */
  mode: number;
}

const BLOCK = 512;
/** npm's own fixed timestamp for packed files (1985-10-26), so a tarball depends only on its contents. */
const MTIME = 499162500;

function writeString(header: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > length) throw new Error(`tar field too long: ${value}`);
  header.set(bytes, offset);
}

function writeOctal(header: Uint8Array, offset: number, length: number, value: number): void {
  writeString(header, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
}

/** One ustar header for a regular file. */
function tarHeader(name: string, size: number, mode: number): Uint8Array {
  const header = new Uint8Array(BLOCK);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, MTIME);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

/** A gzipped tar of the entries under `package/`, the layout npm publishes and installs. */
export function npmTarball(entries: readonly TarEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    const name = `package/${entry.path.replaceAll("\\", "/")}`;
    parts.push(tarHeader(name, entry.data.length, entry.mode), entry.data);
    const pad = (BLOCK - (entry.data.length % BLOCK)) % BLOCK;
    if (pad > 0) parts.push(new Uint8Array(pad));
  }
  parts.push(new Uint8Array(BLOCK * 2));
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const tar = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    tar.set(part, offset);
    offset += part.length;
  }
  return gzipSync(tar, { level: 9 });
}

/** The release assets checksums.txt names, checked: a file whose hash differs, or that it does not name, is refused. */
export function verifyAssets(
  checksums: ReadonlyMap<string, string>,
  files: ReadonlyArray<{ name: string; data: Uint8Array }>,
): string | null {
  for (const file of files) {
    const expected = checksums.get(file.name);
    if (!expected) return `checksums.txt does not name ${file.name}`;
    const actual = createHash("sha256").update(file.data).digest("hex");
    if (actual !== expected) return `checksum mismatch for ${file.name}`;
  }
  return null;
}
