import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SCOPED, scopedCheck } from "./scope";

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "shelra-scope-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

describe("a check scoped to what a turn changed", () => {
  it("narrows Go's whole-module commands, and a make target in a Go module, to the changed packages", () => {
    const root = project({ "go.mod": "module x\n", "lib/auth/auth.go": "", "main.go": "" });
    const changed = ["lib/auth/auth.go", "lib/auth/auth_test.go", "main.go", "vendor/a/a.go", "lib/x/testdata/t.go"];
    expect(scopedCheck({ kind: "test", command: "go test ./...", source: "go.mod" }, changed, root)).toEqual({
      kind: "test",
      command: "go test . ./lib/auth",
      source: `go.mod, ${SCOPED}`,
    });
    expect(scopedCheck({ kind: "test", command: "make test", source: "Makefile test" }, changed, root)?.command).toBe(
      "go test . ./lib/auth",
    );
    expect(scopedCheck({ kind: "lint", command: "make lint", source: "Makefile lint" }, changed, root)?.command).toBe(
      "go vet . ./lib/auth",
    );
    expect(
      scopedCheck({ kind: "typecheck", command: "go build ./...", source: "go.mod" }, changed, root)?.command,
    ).toBe("go build . ./lib/auth");
    expect(scopedCheck({ kind: "test", command: "go test ./...", source: "go.mod" }, ["README.md"], root)).toBeNull();
    expect(scopedCheck({ kind: "build", command: "go build ./...", source: "go.mod" }, changed, root)).toBeNull();
  });

  it("runs the pytest files named for the changed modules, and the changed tests", () => {
    const root = project({
      "pyproject.toml": "[tool.pytest.ini_options]\n",
      "app/config.py": "",
      "tests/unit/test_config.py": "",
      "tests/test_other.py": "",
      "tests/test_new.py": "",
      "node_modules/x/test_config.py": "",
    });
    const check = { kind: "test" as const, command: "python -m pytest", source: "pytest configuration" };
    expect(scopedCheck(check, ["app/config.py", "tests/test_new.py"], root)?.command).toBe(
      "python -m pytest tests/test_new.py tests/unit/test_config.py",
    );
    expect(scopedCheck(check, ["app/unknown.py"], root)).toBeNull();
  });

  it("lets Jest and Vitest find the tests related to the changed files, with the project's package manager", () => {
    const root = project({ "src/a.ts": "", "src/b.tsx": "" });
    expect(
      scopedCheck(
        { kind: "test", command: "yarn test", source: "package.json scripts.test", runs: "jest" },
        ["src/a.ts", "README.md"],
        root,
      )?.command,
    ).toBe("yarn jest --findRelatedTests src/a.ts");
    expect(
      scopedCheck(
        { kind: "test", command: "npm run test", source: "package.json scripts.test", runs: "vitest run" },
        ["src/a.ts", "src/b.tsx"],
        root,
      )?.command,
    ).toBe("npx vitest related --run src/a.ts src/b.tsx");
    expect(
      scopedCheck({ kind: "test", command: "npm run test", source: "package.json", runs: "mocha" }, ["src/a.ts"], root),
    ).toBeNull();
  });
});
