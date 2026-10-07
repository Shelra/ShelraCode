/**
 * Builds ShelraCode's npm packages from a GitHub release and, with --publish, publishes them (src/release/npm.ts). The
 * npm registry is what npm, bun, pnpm and yarn all install from.
 *
 *   bun run scripts/npm-publish.ts --version 1.1.9                  # build the tarballs in npm-dist/, publish nothing
 *   bun run scripts/npm-publish.ts --version 1.1.9 --publish        # then publish them, platform packages first
 *   bun run scripts/npm-publish.ts --version 1.1.9 --assets <dir>   # take the release assets from a folder (CI)
 *
 * The binaries are the release's own, checked against its checksums.txt. Publishing needs `npm login` or an npm token
 * in NODE_AUTH_TOKEN; in GitHub Actions the packages carry provenance. A version already on the registry is skipped, so
 * a run that stopped half way can be repeated.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import semverValid from "semver/functions/valid.js";
import {
  launcherManifest,
  NPM_PLATFORMS,
  npmReadme,
  npmTarball,
  platformManifest,
  verifyAssets,
} from "../src/release/npm";
import { parseChecksumsFile, SHELRA_RELEASES_API } from "../src/utils/install-manager";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const version = semverValid((flag("--version") ?? "").replace(/^shelra@/u, "").replace(/^v/u, ""));
const assetsDir = flag("--assets");
const out = flag("--out") ?? join(ROOT, "npm-dist");
const distTag = flag("--tag");
/** A one-time password for npm's two-factor check; without it npm asks in the terminal. */
const otp = flag("--otp");
const publish = argv.includes("--publish");
if (!version) {
  console.error(
    "usage: --version <x.y.z> [--assets <dir>] [--out <dir>] [--publish] [--tag <dist-tag>] [--otp <code>]",
  );
  process.exit(2);
}

/** A file anywhere under `dir` (CI downloads each artifact into a folder of its own). */
function findFile(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry === name) {
      return full;
    }
  }
  return null;
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { Accept: "application/octet-stream" } });
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** The release's checksums.txt and its binaries, from a folder or from GitHub. */
async function releaseFiles(): Promise<{ checksums: string; files: Array<{ name: string; data: Uint8Array }> }> {
  const names = NPM_PLATFORMS.map((platform) => platform.asset);
  if (assetsDir) {
    const read = (name: string) => {
      const path = findFile(assetsDir, name);
      if (!path) throw new Error(`${name} is not under ${assetsDir}`);
      return new Uint8Array(readFileSync(path));
    };
    return {
      checksums: new TextDecoder().decode(read("checksums.txt")),
      files: names.map((name) => ({ name, data: read(name) })),
    };
  }
  const response = await fetch(`${SHELRA_RELEASES_API}/tags/shelra@${version}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`no GitHub release shelra@${version} (${response.status})`);
  const release = (await response.json()) as { assets: Array<{ name: string; browser_download_url: string }> };
  const url = (name: string) => {
    const asset = release.assets.find((item) => item.name === name);
    if (!asset) throw new Error(`release shelra@${version} has no ${name}`);
    return asset.browser_download_url;
  };
  const checksums = new TextDecoder().decode(await download(url("checksums.txt")));
  const files: Array<{ name: string; data: Uint8Array }> = [];
  for (const name of names) {
    console.log(`downloading ${name}`);
    files.push({ name, data: await download(url(name)) });
  }
  return { checksums, files };
}

function npm(args: string[]): { ok: boolean; output: string } {
  const result = spawnSync("npm", args, { encoding: "utf8", shell: process.platform === "win32" });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

const { checksums, files } = await releaseFiles();
const problem = verifyAssets(parseChecksumsFile(checksums), files);
if (problem) {
  console.error(`refusing to package: ${problem}`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const encode = (text: string) => new TextEncoder().encode(text);
const license = new Uint8Array(readFileSync(join(ROOT, "LICENSE")));
const tarballs: Array<{ name: string; file: string }> = [];
for (const platform of NPM_PLATFORMS) {
  const binary = files.find((file) => file.name === platform.asset)?.data ?? new Uint8Array();
  const file = join(out, `${platform.name}-${version}.tgz`);
  writeFileSync(
    file,
    npmTarball([
      {
        path: "package.json",
        data: encode(`${JSON.stringify(platformManifest(platform, version), null, 2)}\n`),
        mode: 0o644,
      },
      { path: "README.md", data: encode(npmReadme(version, platform)), mode: 0o644 },
      { path: "LICENSE", data: license, mode: 0o644 },
      { path: `bin/${platform.binary}`, data: binary, mode: 0o755 },
    ]),
  );
  tarballs.push({ name: platform.name, file });
}
const launcherFile = join(out, `shelra-${version}.tgz`);
writeFileSync(
  launcherFile,
  npmTarball([
    { path: "package.json", data: encode(`${JSON.stringify(launcherManifest(version), null, 2)}\n`), mode: 0o644 },
    { path: "README.md", data: encode(npmReadme(version)), mode: 0o644 },
    { path: "LICENSE", data: license, mode: 0o644 },
    {
      path: "bin/shelra.cjs",
      data: new Uint8Array(readFileSync(join(ROOT, "scripts", "npm", "shelra.cjs"))),
      mode: 0o755,
    },
  ]),
);
// The launcher goes last: it must never point at platform packages the registry does not have yet.
tarballs.push({ name: "shelra", file: launcherFile });
for (const tarball of tarballs)
  console.log(`built ${tarball.file} (${Math.round(statSync(tarball.file).size / 1e6)} MB)`);

if (!publish) process.exit(0);
for (const tarball of tarballs) {
  if (npm(["view", `${tarball.name}@${version}`, "version"]).output.trim() === version) {
    console.log(`${tarball.name}@${version} is already on npm; skipped`);
    continue;
  }
  const args = ["publish", tarball.file, "--access", "public"];
  if (process.env.GITHUB_ACTIONS === "true") args.push("--provenance");
  if (distTag) args.push("--tag", distTag);
  if (otp) args.push("--otp", otp);
  // The terminal goes through: npm asks for its two-factor confirmation there when no token bypasses it.
  const result = spawnSync("npm", args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`npm publish ${tarball.name}@${version} failed; run this script again to publish what is left.`);
    process.exit(1);
  }
  console.log(`published ${tarball.name}@${version}`);
}
