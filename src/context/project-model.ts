import { createHash } from "node:crypto";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";

const MAX_MANIFESTS = 256;
const MAX_TARGETS = 12;
const MAX_MANIFEST_BYTES = 64 * 1024;
const DEPENDENCY_KINDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

export interface ProjectPackage {
  manifest: string;
  root: string;
  fingerprint: string;
  name?: string;
  scripts: Record<string, string>;
  dependencies: { name: string; version: string; kind: DependencyKind }[];
  documents: string[];
  documentsTruncated: boolean;
}
export interface DeclaredPackageDependency {
  source: { manifest: string; fingerprint: string };
  name: string;
  version: string;
  kind: DependencyKind;
  resolution: "name-match" | "ambiguous" | "external-or-unobserved" | "unresolved";
  manifests: string[];
}
export interface ProjectStructure {
  status: "complete" | "partial";
  coverage: { inventoryComplete: boolean; manifestsDiscovered: number; manifestsRead: number; limit: number };
  packages: ProjectPackage[];
  owners: { file: string; manifest?: string; reason?: string }[];
  dependencies: DeclaredPackageDependency[];
  warnings: string[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function strings(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value)).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}
function canonical(path: string): boolean {
  return (
    path !== "" &&
    !isAbsolute(path) &&
    !/[\\:\0]/u.test(path) &&
    !path.split("/").some((part) => part === ".." || part === ".")
  );
}
function sameVersion(a: Awaited<ReturnType<typeof stat>>, b: Awaited<ReturnType<typeof stat>>): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

async function readPackage(root: string, manifest: string): Promise<ProjectPackage> {
  const path = join(root, manifest);
  const actual = await realpath(path);
  const rel = relative(root, actual);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error("manifest resolves outside the workspace");
  const file = await open(actual, "r");
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > MAX_MANIFEST_BYTES) throw new Error("manifest is not a bounded regular file");
    const bytes = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = await file.read(bytes, count, bytes.length - count, null);
      if (read.bytesRead === 0) break;
      count += read.bytesRead;
    }
    if (
      count !== before.size ||
      !sameVersion(before, await file.stat()) ||
      !sameVersion(before, await stat(actual)) ||
      actual !== (await realpath(path))
    )
      throw new Error("manifest changed during observation");
    const body = bytes.subarray(0, count);
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("manifest is not a JSON object");
    const data = record(parsed);
    return {
      manifest,
      root: posix.dirname(manifest) === "." ? "" : posix.dirname(manifest),
      fingerprint: `sha256:${createHash("sha256").update(body).digest("hex")}`,
      ...(typeof data.name === "string" ? { name: data.name } : {}),
      scripts: strings(data.scripts),
      documents: [],
      documentsTruncated: false,
      dependencies: DEPENDENCY_KINDS.flatMap((kind) =>
        Object.entries(strings(data[kind])).map(([name, version]) => ({ name, version, kind })),
      ),
    };
  } finally {
    await file.close();
  }
}

/** Structural manifest data, not a semantic ownership or call graph. Only manifest bodies are read. */
export async function compileProjectStructure(
  workspace: string,
  inventory: { files: readonly string[]; complete: boolean },
  targets: readonly string[],
): Promise<ProjectStructure> {
  const root = await realpath(resolve(workspace));
  const warnings: string[] = [];
  const targetCandidates = targets.slice(0, MAX_TARGETS);
  const validTargets = targetCandidates.filter(canonical).map((path) => path.replace(/\/$/u, ""));
  if (targets.length > MAX_TARGETS)
    warnings.push(`Target budget reached: ${MAX_TARGETS} of ${targets.length} targets inspected.`);
  if (validTargets.length !== targetCandidates.length)
    warnings.push("Some target paths were outside the canonical workspace-relative scope.");
  const manifests = new Set(
    inventory.files.filter((file) => canonical(file) && posix.basename(file) === "package.json"),
  );
  const priorities: string[][] = [];
  for (const target of validTargets) {
    const ancestors: string[] = [];
    let directory = target;
    for (let depth = 0; depth < 64; depth += 1) {
      const manifest = directory === "." || directory === "" ? "package.json" : `${directory}/package.json`;
      try {
        await lstat(join(root, manifest));
        manifests.add(manifest);
        ancestors.push(manifest);
      } catch (error) {
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          (error.code !== "ENOENT" && error.code !== "ENOTDIR")
        ) {
          manifests.add(manifest);
          ancestors.push(manifest);
        }
      }
      if (directory === "." || directory === "") break;
      directory = posix.dirname(directory);
    }
    priorities.push(ancestors);
  }
  const ordered = [
    ...new Set([...priorities.flatMap((paths) => paths.slice(0, 1)), ...priorities.flat(), ...[...manifests].sort()]),
  ];
  const packages: ProjectPackage[] = [];
  const failures = new Map<string, string>();
  for (let offset = 0; offset < Math.min(ordered.length, MAX_MANIFESTS); offset += 16) {
    const batch = await Promise.all(
      ordered.slice(offset, Math.min(offset + 16, MAX_MANIFESTS)).map(async (manifest) => {
        try {
          return { package: await readPackage(root, manifest) };
        } catch (error) {
          return { manifest, problem: error instanceof Error ? error.message : String(error) };
        }
      }),
    );
    for (const result of batch) {
      if (result.package) packages.push(result.package);
      else if (result.manifest && result.problem) failures.set(result.manifest, result.problem);
    }
  }
  if (!inventory.complete)
    warnings.push("File inventory is incomplete; undiscovered packages and consumers remain unknown.");
  if (ordered.length > MAX_MANIFESTS)
    warnings.push(`Manifest budget reached: ${MAX_MANIFESTS} of ${ordered.length} discovered manifests inspected.`);
  for (const [manifest, reason] of [...failures].slice(0, 16)) warnings.push(`${manifest}: ${reason}`);
  const byPath = new Map(packages.map((pkg) => [pkg.manifest, pkg]));
  const nearest = (file: string): string | undefined => {
    let directory = file.replace(/\/$/u, "");
    while (true) {
      const manifest = directory === "." || directory === "" ? "package.json" : `${directory}/package.json`;
      if (manifests.has(manifest)) return manifest;
      if (directory === "." || directory === "") return undefined;
      directory = posix.dirname(directory);
    }
  };
  const owners = validTargets.map((file) => {
    const manifest = nearest(file);
    return manifest && byPath.has(manifest)
      ? { file, manifest }
      : {
          file,
          reason: manifest
            ? (failures.get(manifest) ?? "Containing manifest was not observed within the budget.")
            : "No containing JS/TS package manifest was observed.",
        };
  });
  for (const path of inventory.files) {
    if (!/\.mdx?$/u.test(path) || !canonical(path)) continue;
    const manifest = nearest(path);
    const pkg = manifest ? byPath.get(manifest) : undefined;
    if (!pkg) continue;
    const local = path.slice(pkg.root ? pkg.root.length + 1 : 0);
    if (!["README.md", "AGENTS.md", "SHELRA.md"].includes(local) && !/^(?:docs|adr|adrs)\//u.test(local)) continue;
    if (pkg.documents.length >= 16) {
      pkg.documentsTruncated = true;
      continue;
    }
    try {
      const actual = await realpath(join(root, path));
      const rel = relative(root, actual);
      if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) || !(await stat(actual)).isFile()) continue;
      pkg.documents.push(path);
    } catch (error) {
      if (warnings.length < 32) warnings.push(`Document ${path} could not be observed: ${String(error)}`);
    }
  }
  const manifestComplete = inventory.complete && failures.size === 0 && ordered.length <= MAX_MANIFESTS;
  const complete = manifestComplete && validTargets.length === targets.length;
  const byName = new Map<string, string[]>();
  for (const pkg of packages) if (pkg.name) byName.set(pkg.name, [...(byName.get(pkg.name) ?? []), pkg.manifest]);
  const dependencies = packages.flatMap((pkg) =>
    pkg.dependencies.map((dependency): DeclaredPackageDependency => {
      // Name equality is a declared candidate relationship, never proof of the installed dependency.
      // npm aliases point at another package; don't falsely connect them to a local package with the alias name.
      const alias = dependency.version.startsWith("npm:");
      const matches = alias ? [] : (byName.get(dependency.name) ?? []);
      return {
        source: { manifest: pkg.manifest, fingerprint: pkg.fingerprint },
        name: dependency.name,
        version: dependency.version,
        kind: dependency.kind,
        resolution: alias
          ? "unresolved"
          : matches.length > 1
            ? "ambiguous"
            : matches.length === 1
              ? manifestComplete
                ? "name-match"
                : "unresolved"
              : "external-or-unobserved",
        manifests: matches,
      };
    }),
  );
  return {
    status: complete ? "complete" : "partial",
    coverage: {
      inventoryComplete: inventory.complete,
      manifestsDiscovered: ordered.length,
      manifestsRead: packages.length,
      limit: MAX_MANIFESTS,
    },
    packages,
    owners,
    dependencies,
    warnings,
  };
}

/** Valid JSON projection under a separate budget; truncation never upgrades incomplete structure. */
export function projectStructureContext(
  structure: ProjectStructure,
  maxChars = 2400,
): { text: string; truncated: boolean } {
  const selected = new Set(structure.owners.flatMap((owner) => (owner.manifest ? [owner.manifest] : [])));
  if (selected.size === 0 && structure.packages.some((pkg) => pkg.manifest === "package.json"))
    selected.add("package.json");
  const data = {
    status: structure.status,
    coverage: structure.coverage,
    truncated: false,
    owners: structure.owners.slice(0, 12),
    packages: structure.packages
      .filter((pkg) => selected.has(pkg.manifest))
      .map(({ manifest, fingerprint, name, scripts, documents, documentsTruncated }) => ({
        manifest,
        fingerprint,
        name,
        scripts,
        documents,
        documentsTruncated,
      })),
    declaredDependencies: structure.dependencies
      .filter((edge) => selected.has(edge.source.manifest) || edge.manifests.some((path) => selected.has(path)))
      .slice(0, 64),
    warnings: structure.warnings.slice(0, 16),
  };
  const header = "PROJECT PACKAGE STRUCTURE (manifest data; declared dependencies are not runtime call paths):\n";
  if (
    structure.owners.length > 12 ||
    structure.warnings.length > 16 ||
    structure.dependencies.filter(
      (edge) => selected.has(edge.source.manifest) || edge.manifests.some((path) => selected.has(path)),
    ).length > 64
  )
    data.truncated = true;
  const render = () => `${header}${JSON.stringify(data)}`;
  while (render().length > maxChars) {
    data.truncated = true;
    if (data.declaredDependencies.length > 0) data.declaredDependencies.pop();
    else if (data.packages.length > 0) data.packages.pop();
    else if (data.owners.length > 0) data.owners.pop();
    else if (data.warnings.length > 0) data.warnings.pop();
    else return { text: "[Project structure projection truncated]".slice(0, Math.max(0, maxChars)), truncated: true };
  }
  return { text: render(), truncated: data.truncated || data.packages.some((pkg) => pkg.documentsTruncated) };
}
