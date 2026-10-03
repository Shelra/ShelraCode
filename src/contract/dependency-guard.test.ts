import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addedDependencies, declaredDependencies, dependencyRule, requestAddsDependency } from "./dependency-guard";

const dirs: string[] = [];
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "shelra-deps-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the dependency guard", () => {
  it("reads what each kind of manifest declares, and names what a turn added", () => {
    const root = project({
      "package.json": JSON.stringify({ dependencies: { hono: "4" }, devDependencies: { vitest: "3" } }),
      "requirements.txt": "# app\nrequests==2.31\nflask[async]>=3 ; python_version>'3.9'\n-r dev.txt\n",
      "pyproject.toml":
        '[project]\nname = "x"\ndependencies = ["httpx>=0.27", "rich"]\n[tool.poetry.dependencies]\npython = "^3.12"\npydantic = "^2"\n',
      "Cargo.toml": '[package]\nname = "x"\n[dependencies]\nserde = "1"\n[dev-dependencies]\ninsta = "1"\n',
      "go.mod": "module x\n\nrequire (\n\tgithub.com/spf13/cobra v1.8.0\n)\nrequire golang.org/x/text v0.14.0\n",
    });
    const before = declaredDependencies(root);
    expect([...(before.get("package.json") ?? [])]).toEqual(["hono", "vitest"]);
    expect([...(before.get("requirements.txt") ?? [])]).toEqual(["requests", "flask"]);
    expect([...(before.get("pyproject.toml") ?? [])].sort()).toEqual(["httpx", "pydantic", "rich"]);
    expect([...(before.get("Cargo.toml") ?? [])]).toEqual(["serde", "insta"]);
    expect([...(before.get("go.mod") ?? [])]).toEqual(["github.com/spf13/cobra", "golang.org/x/text"]);

    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { hono: "4", papaparse: "5" }, devDependencies: { vitest: "3" } }),
    );
    expect(addedDependencies(before, declaredDependencies(root))).toEqual(["papaparse"]);
    expect(addedDependencies(before, before)).toEqual([]);
  });

  it("recognizes the rules that forbid new dependencies, in English and Spanish, and nothing else", () => {
    for (const rule of [
      "From now on this project stays dependency-free: package.json lists no dependencies of any kind.",
      "Never add another dependency without asking me first",
      "No new dependencies.",
      "Do not install third-party packages",
      "Este proyecto va sin dependencias nuevas",
      "Nunca añadas una dependencia sin preguntarme",
    ]) {
      expect(dependencyRule([rule]), rule).not.toBeNull();
    }
    for (const other of [
      "Always store money as integer cents",
      "No dependencies needed for this script, it is plain TypeScript",
      "Update the dependency list in the README",
    ]) {
      expect(dependencyRule([other]), other).toBeNull();
    }
  });

  it("takes only an instruction to add a package as permission, never a suggestion that names it", () => {
    expect(requestAddsDependency("Install date-fns and use its formatDistance.", "date-fns")).toBe(true);
    expect(requestAddsDependency("Add papaparse as a dependency for the export.", "papaparse")).toBe(true);
    expect(requestAddsDependency("Run `bun add papaparse` and export the loans.", "papaparse")).toBe(true);
    expect(requestAddsDependency("Instala la librería zod para validar.", "zod")).toBe(true);
    expect(requestAddsDependency("Titles can contain commas; papaparse's unparse makes this easy.", "papaparse")).toBe(
      false,
    );
    expect(requestAddsDependency("date-fns has a formatDistance that does this well.", "date-fns")).toBe(false);
    expect(requestAddsDependency("Install date-fns.", "date")).toBe(false);
  });
});
