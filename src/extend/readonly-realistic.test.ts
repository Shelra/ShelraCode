import { describe, expect, it } from "vitest";
import { classifyReadOnlyShell } from "./readonly-shell";

/**
 * What real models type to look around a project, on Windows (PowerShell) and POSIX shells. A read-only agent that
 * refuses all of it is not read-only, it is useless: every line here must be allowed.
 */
const EXPLORING = [
  "Get-ChildItem -Force",
  "Get-ChildItem src -Recurse -Name",
  "Get-ChildItem -Recurse -Filter *.ts | Measure-Object",
  "Get-ChildItem | Sort-Object Length -Descending | Select-Object -First 5",
  "Get-ChildItem -Recurse | Where-Object Name -like '*.md'",
  "Get-Content README.md -TotalCount 5",
  "Get-Content package.json | Select-Object -First 20",
  'Select-String -Path src*.ts -Pattern "TODO"',
  "Test-Path package.json",
  "Get-Location",
  "dir /b",
  "type README.md",
  "git status --short",
  "git log --oneline -10",
  "git log -3 --format=%s",
  "git diff --stat --no-ext-diff --no-textconv",
  "git branch --show-current",
  "git rev-parse HEAD",
  "git ls-files | head -50",
  "ls -la src",
  'rg -n "foo" src -g "*.ts"',
  'grep -rn "foo" src --include="*.ts"',
  'find . -name "*.ts" -not -path "./node_modules/*"',
  "wc -l src/*.ts",
  "head -n 20 package.json",
  "tail -n 5 CHANGELOG.md",
  "cat package.json | jq .name",
  "tree -L 2",
  "cd src && ls && cd ..",
  "git show --no-textconv --stat HEAD",
  "Get-ChildItem -Directory | Select-Object -ExpandProperty Name",
  "git log --oneline | wc -l",
  "ls -R src 2>/dev/null | head -40",
  "sed -n '1,40p' src/index.ts",
];

describe("read-only: the commands used to explore a project are allowed", () => {
  for (const command of EXPLORING) {
    it(command, () => {
      expect(classifyReadOnlyShell(command), classifyReadOnlyShell(command).reason).toMatchObject({ allowed: true });
    });
  }
});
