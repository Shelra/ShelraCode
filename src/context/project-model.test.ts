import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileProjectStructure, projectStructureContext } from "./project-model";

let base: string;
let root: string;
let paths: Set<string>;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "shelra-package-model-"));
  root = join(base, "project");
  mkdirSync(root);
  paths = new Set();
});
afterEach(() => rmSync(base, { recursive: true, force: true }));
function put(path: string, value: string | object): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
  paths.add(path);
}
function model(targets: string[], complete = true, extra: string[] = []) {
  return compileProjectStructure(root, { files: [...paths, ...extra], complete }, targets);
}
function monorepo(): void {
  put("package.json", { name: "platform", workspaces: ["packages/*", "apps/*"] });
  put("packages/auth/package.json", { name: "@platform/auth", scripts: { test: "bun test" } });
  put("packages/billing/package.json", { name: "@platform/billing" });
  put("apps/web/package.json", {
    name: "web",
    dependencies: { "@platform/auth": "workspace:*" },
    devDependencies: { vitest: "^4" },
  });
  put("packages/auth/src/login.ts", "export const login = true;\n");
  put("packages/billing/src/invoice.ts", "export const amount = 20;\n");
  put("apps/web/src/index.ts", "export const web = true;\n");
  put("packages/auth/README.md", "# Authentication\n");
  put("packages/auth/AGENTS.md", "Follow authentication conventions.\n");
  put("packages/auth/docs/adr/001.md", "Why this authentication boundary exists.\n");
}

describe("manifest project structure", () => {
  it("identifies closest package boundaries and declared consumers with source fingerprints", async () => {
    monorepo();
    const result = await model([
      "packages/auth/src/login.ts",
      "packages/billing/src/invoice.ts",
      "apps/web/src/index.ts",
    ]);
    expect(result.status).toBe("complete");
    expect(result.owners.map((owner) => owner.manifest)).toEqual([
      "packages/auth/package.json",
      "packages/billing/package.json",
      "apps/web/package.json",
    ]);
    expect(result.dependencies).toContainEqual(
      expect.objectContaining({
        name: "@platform/auth",
        resolution: "name-match",
        manifests: ["packages/auth/package.json"],
        source: { manifest: "apps/web/package.json", fingerprint: expect.stringMatching(/^sha256:/u) },
      }),
    );
    expect(
      result.dependencies.some(
        (edge) => edge.source.manifest === "packages/billing/package.json" && edge.name === "@platform/auth",
      ),
    ).toBe(false);
    expect(result.packages.find((pkg) => pkg.name === "@platform/auth")?.documents).toEqual([
      "packages/auth/README.md",
      "packages/auth/AGENTS.md",
      "packages/auth/docs/adr/001.md",
    ]);
    const projected = projectStructureContext(result);
    expect(projected.text).toContain("packages/auth/package.json");
    expect(projected.text).toContain("packages/auth/README.md");
    expect(projected.text).toContain("bun test");
    expect(projected.text).toContain("not runtime call paths");
  });

  it("keeps duplicate package names ambiguous rather than selecting the first path", async () => {
    monorepo();
    put("packages/auth-legacy/package.json", { name: "@platform/auth" });
    const result = await model(["apps/web/src/index.ts"]);
    expect(result.dependencies.find((edge) => edge.name === "@platform/auth")).toMatchObject({
      resolution: "ambiguous",
      manifests: expect.arrayContaining(["packages/auth/package.json", "packages/auth-legacy/package.json"]),
    });
  });

  it("does not assign a distant root package when the closest manifest is invalid", async () => {
    monorepo();
    put("packages/auth/package.json", "{ invalid json }");
    const result = await model(["packages/auth/src/login.ts"]);
    expect(result.status).toBe("partial");
    expect(result.owners[0]).toMatchObject({ file: "packages/auth/src/login.ts", reason: expect.any(String) });
    expect(result.owners[0].manifest).toBeUndefined();
    expect(result.warnings.join("\n")).toContain("packages/auth/package.json");
  });

  it("prioritizes a target's manifest beyond the general package budget", async () => {
    put("package.json", { name: "root" });
    for (let index = 0; index < 270; index += 1)
      put(`packages/p${String(index).padStart(3, "0")}/package.json`, { name: `p${index}` });
    put("packages/z-target/package.json", { name: "target" });
    put("packages/z-target/src/index.ts", "export const target = 1;\n");
    const result = await model(["packages/z-target/src/index.ts"]);
    expect(result.status).toBe("partial");
    expect(result.owners[0].manifest).toBe("packages/z-target/package.json");
    expect(result.coverage.manifestsRead).toBe(256);
    expect(result.warnings.join("\n")).toContain("Manifest budget reached");
  });

  it("discovers the named file's ancestor manifest even when the inventory missed it", async () => {
    monorepo();
    paths.delete("packages/auth/package.json");
    const result = await model(["packages/auth/src/login.ts"], false);
    expect(result.status).toBe("partial");
    expect(result.owners[0].manifest).toBe("packages/auth/package.json");
    expect(result.dependencies.find((edge) => edge.name === "@platform/auth")?.resolution).toBe("unresolved");
  });

  it("reads changed manifests afresh and does not reuse the old dependency or fingerprint", async () => {
    monorepo();
    const before = await model(["apps/web/src/index.ts"]);
    const original = before.packages.find((pkg) => pkg.manifest === "apps/web/package.json");
    put("apps/web/package.json", { name: "web-v2", dependencies: { "@platform/billing": "workspace:*" } });
    const after = await model(["apps/web/src/index.ts"]);
    expect(after.packages.find((pkg) => pkg.manifest === "apps/web/package.json")?.fingerprint).not.toBe(
      original?.fingerprint,
    );
    expect(after.dependencies.map((edge) => edge.name)).toEqual(["@platform/billing"]);
  });

  it("rejects an external junction manifest without reading it as a project package", async () => {
    put("package.json", { name: "root" });
    const external = join(base, "external");
    mkdirSync(external);
    writeFileSync(join(external, "package.json"), '{"name":"external-secret"}');
    symlinkSync(external, join(root, "linked"), "junction");
    paths.add("linked/package.json");
    const result = await model(["linked/source.ts"]);
    expect(result.status).toBe("partial");
    expect(result.packages.some((pkg) => pkg.name === "external-secret")).toBe(false);
    expect(result.owners[0].manifest).toBeUndefined();
    expect(result.warnings.join("\n")).toContain("outside the workspace");
  });

  it("does not connect an npm alias to a local package with the alias name", async () => {
    monorepo();
    put("apps/web/package.json", { name: "web", dependencies: { "@platform/auth": "npm:unrelated-package@^1" } });
    const result = await model(["apps/web/src/index.ts"]);
    expect(result.dependencies[0]).toMatchObject({
      resolution: "unresolved",
      manifests: [],
      version: "npm:unrelated-package@^1",
    });
  });

  it("keeps ownership unknown when the closest manifest exceeds the reading budget", async () => {
    monorepo();
    put("packages/auth/package.json", { name: "@platform/auth", description: "x".repeat(70 * 1024) });
    const result = await model(["packages/auth/src/login.ts"]);
    expect(result.status).toBe("partial");
    expect(result.owners[0].manifest).toBeUndefined();
    expect(result.owners[0].reason).toContain("bounded regular file");
  });

  it("reports the target budget instead of presenting a partial owner list as complete", async () => {
    monorepo();
    const targets = Array.from({ length: 13 }, (_, index) => `packages/auth/src/file-${index}.ts`);
    const result = await model(targets);
    expect(result.status).toBe("partial");
    expect(result.owners).toHaveLength(12);
    expect(result.warnings.join("\n")).toContain("Target budget reached: 12 of 13");
  });

  it("bounds a synthetic 100,000-path projection without requiring source bodies", async () => {
    monorepo();
    const synthetic = Array.from({ length: 100_000 }, (_, index) => `packages/auth/src/virtual-${index}.ts`);
    const result = await model(["packages/auth/src/login.ts"], true, synthetic);
    expect(result.coverage.manifestsRead).toBe(4);
    const projected = projectStructureContext(result, 700);
    expect(projected.text.length).toBeLessThanOrEqual(700);
    expect(projected.truncated).toBe(true);
    const data = JSON.parse(projected.text.slice(projected.text.indexOf("\n") + 1));
    expect(data.truncated).toBe(true);
    expect(readFileSync(join(root, "packages/auth/src/login.ts"), "utf8")).toContain("login");
  });

  it("omits deleted documentation and explicitly marks a bounded documentation list", async () => {
    monorepo();
    put("packages/auth/docs/deleted.md", "old document");
    rmSync(join(root, "packages/auth/docs/deleted.md"));
    for (let index = 0; index < 20; index += 1) put(`packages/auth/docs/d${index}.md`, "details");
    const result = await model(["packages/auth/src/login.ts"]);
    const auth = result.packages.find((pkg) => pkg.name === "@platform/auth");
    expect(auth?.documents).not.toContain("packages/auth/docs/deleted.md");
    expect(auth?.documents.length).toBe(16);
    expect(auth?.documentsTruncated).toBe(true);
    expect(projectStructureContext(result).truncated).toBe(true);
  });
});
