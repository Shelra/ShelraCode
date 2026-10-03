import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { destructiveCommandReason } from "../security/destructive";
import { BashTool } from "./bash";
import { normalizationNote, normalizeForPowerShell } from "./powershell-normalize";

const SCRIPTS = "C:\\Temp\\shelra-scripts";
const onWindows = (command: string) => normalizeForPowerShell(command, { platform: "win32", scriptDir: SCRIPTS });
const ENCODING = "$OutputEncoding = [System.Text.UTF8Encoding]::new($false);";

describe("normalizeForPowerShell rewrites what Windows PowerShell cannot run", () => {
  // Shapes from free-model `bash` calls that failed on 2026-10-03, and their neighbours.
  it.each([
    ["cd src && bun test", "cd src; if ($?) { bun test }"],
    ["bun run build && bun test && echo done", "bun run build; if ($?) { bun test; if ($?) { echo done } }"],
    [
      'node --check app.js || echo "failed"',
      'node --check app.js; if (-not $?) { $global:LASTEXITCODE = $null; echo "failed" }',
    ],
    ["git status 2>/dev/null", "git status 2>$null"],
    ["bun test >/dev/null", "bun test >$null"],
    ["bun test > /dev/null 2>&1", "bun test >$null 2>&1"],
    ["npm ci &>/dev/null", "npm ci *>$null"],
    ["ls -la", "Get-ChildItem -Force"],
    ["ls -al src", "Get-ChildItem -Force src"],
    ["ls -a", "Get-ChildItem -Force"],
    ["ls -l", "Get-ChildItem"],
    ["ls -la 2>/dev/null", "Get-ChildItem -Force 2>$null"],
    ["ls -la | Select-Object -First 3", "Get-ChildItem -Force | Select-Object -First 3"],
    ["rm -rf dist", "if (Test-Path dist) { Remove-Item -Recurse -Force dist }"],
    [
      "rm -rf dist coverage",
      "if (Test-Path dist) { Remove-Item -Recurse -Force dist }; if (Test-Path coverage) { Remove-Item -Recurse -Force coverage }",
    ],
    ["rm -f out.log", "if (Test-Path out.log) { Remove-Item -Force out.log }"],
    ["rm -rR old", "Remove-Item -Recurse old"],
    [
      "rm -rf node_modules && bun install",
      "if (Test-Path node_modules) { Remove-Item -Recurse -Force node_modules }; if ($?) { bun install }",
    ],
    ["del /s /q build", "Remove-Item -Recurse -Force build"],
    ["rmdir /s /q build\\cache", "Remove-Item -Recurse -Force build\\cache"],
    ["rd /S /Q dist", "Remove-Item -Recurse -Force dist"],
    ["del /q out.txt", "Remove-Item -Force out.txt"],
    ["which node", "(Get-Command node).Source"],
    ["export NODE_ENV=test", '$env:NODE_ENV = "test"'],
    ["export A=1 B='two words'", '$env:A = "1"; $env:B = "two words"'],
    ["export NODE_ENV=test && bun test", '$env:NODE_ENV = "test"; if ($?) { bun test }'],
    ["NODE_ENV=production bun run build", '$env:NODE_ENV = "production"; bun run build'],
    ["CI=1 DEBUG=0 bun test && echo ok", '$env:CI = "1"; $env:DEBUG = "0"; bun test; if ($?) { echo ok }'],
    ["FORCE=1 rm -rf dist", '$env:FORCE = "1"; if (Test-Path dist) { Remove-Item -Recurse -Force dist }'],
  ])("%j", (input, expected) => {
    const result = onWindows(input);
    expect(result.command).toBe(expected);
    expect(result.changes.length).toBeGreaterThan(0);
  });

  it("says what changed, so the model sees the PowerShell form", () => {
    const result = onWindows("ls -la && rm -rf dist 2>/dev/null");
    expect(normalizationNote(result)).toBe(
      "Shelra ran this as Windows PowerShell: `ls -la` became `Get-ChildItem -Force`; `2>/dev/null` became `2>$null`; `rm -rf dist 2>$null` became `if (Test-Path dist) { Remove-Item -Recurse -Force dist 2>$n…`; `&&` became `; if ($?) { … }`.",
    );
    expect(normalizationNote(onWindows("bun test"))).toBeNull();
  });
});

describe("normalizeForPowerShell leaves valid PowerShell, and anything it cannot read for certain, as written", () => {
  it.each([
    "bun test",
    "Get-ChildItem -Force",
    "Get-ChildItem src | Select-Object Name; git status",
    '$env:NODE_ENV = "test"; bun test',
    "cat README.md",
    "ls",
    "ls src",
    // -LiteralPath and -Hidden in PowerShell: these run.
    "ls -l src",
    "ls -h",
    "rm file.txt",
    "rm -r dist",
    "Remove-Item -Recurse -Force dist",
    'Write-Output "git log --oneline && echo done"',
    "echo 'rm -rf / && ls -la'",
    'Write-Output "2>/dev/null"',
    // Here-strings are PowerShell's own.
    '$s = @"\nls -la && echo x\n"@\nWrite-Output $s',
    "@'\nrm -rf dist\n'@ | Set-Content notes.txt",
    // Inline scripts PowerShell already hands over intact: no double quote inside.
    'node -e "console.log(process.cwd())"',
    "node -e 'console.log(1)'",
    "node -e \"\nconst fs = require('fs');\nconsole.log(fs.existsSync('package.json'))\n\"",
    // A \" inside single quotes was written for PowerShell 5.1's quirk, which turns it back into ".
    'node -e \'const {x}=require(\\"path\\"); console.log(\\"ok\\")\'',
    // An inline script that expands a variable or holds a backtick: which text was meant depends on the shell.
    'node -e "console.log(\\"$HOME\\")"',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a JavaScript template literal inside the shell command
    'node -e "const x = 1; console.log(`${x}`, \\"a\\")"',
    // Piped input is the script's stdin.
    'Get-Content data.json | node -e "console.log(\\"x\\")"',
    // A chain mixing && and || has no faithful rewrite.
    "a || b && c",
    // An assignment cannot take part in a pipeline.
    "echo x | NODE_ENV=test bun test",
    "export PATH=$PATH:/opt/bin",
    // Inside a block it is PowerShell code already.
    "if (Test-Path dist) { rm -rf dist }",
    "del /s *.log",
    "rm -rf $dir",
    // A subexpression in a string may hold quotes of its own: not read.
    'Write-Output "Count: $($items.Count)" && ls -la',
  ])("%j", (input) => {
    expect(onWindows(input)).toEqual({ command: input, changes: [], files: [] });
  });

  it("is a no-op on every other platform", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const command = "ls -la && rm -rf dist 2>/dev/null; node -e 'console.log(\"x\")'";
      expect(normalizeForPowerShell(command, { platform, scriptDir: SCRIPTS })).toEqual({
        command,
        changes: [],
        files: [],
      });
    }
    expect(new BashTool(os.tmpdir(), { platform: "linux" }).normalizeCommand("ls -la && rm -rf x").command).toBe(
      "ls -la && rm -rf x",
    );
  });

  it("does not rewrite inside the Shuru sandbox, which runs sh", () => {
    const bash = new BashTool(os.tmpdir(), { platform: "win32", sandboxMode: "shuru" });
    expect(bash.normalizeCommand("ls -la").command).toBe("ls -la");
  });
});

describe("inline scripts with double quotes inside move to a UTF-8 file read on stdin", () => {
  it("bun -e with sh-escaped quotes over several lines (the 2026-10-03 failures)", () => {
    const command =
      'bun -e "\nconst pkg = JSON.parse(require(\'fs\').readFileSync(\\"package.json\\", \'utf8\'));\nconsole.log(pkg.name, \\"ñandú ✓\\")\n"';
    const result = onWindows(command);
    expect(result.files).toHaveLength(1);
    const file = result.files[0] as { path: string; content: string };
    expect(file.path).toMatch(/^C:\\Temp\\shelra-scripts\\[0-9a-f]{16}\.ts$/u);
    expect(file.content).toBe(
      "\nconst pkg = JSON.parse(require('fs').readFileSync(\"package.json\", 'utf8'));\nconsole.log(pkg.name, \"ñandú ✓\")\n",
    );
    expect(result.command).toBe(`${ENCODING} Get-Content -LiteralPath '${file.path}' -Raw -Encoding UTF8 | bun run -`);
    expect(normalizationNote(result)).toContain(`was saved as UTF-8 to ${file.path} and piped to \`bun run -\``);
  });

  it.each([
    ["node -e 'console.log(\"hi\")'", 'console.log("hi")', "node -"],
    ['node -e "console.log(""hi"")"', 'console.log("hi")', "node -"],
    ['node -e "console.log(`"hi`")"', 'console.log("hi")', "node -"],
    [
      'python -c "import json; print(json.dumps({\\"a\\": 1}))" extra',
      'import json; print(json.dumps({"a": 1}))',
      "python - extra",
    ],
    [
      'node --input-type=module -e "import fs from \\"node:fs\\"; console.log(1)"',
      'import fs from "node:fs"; console.log(1)',
      "node --input-type=module -",
    ],
    ['py -3 -c "print(\\"x\\")"', 'print("x")', "py -3 -"],
  ])("%j", (input, content, run) => {
    const result = onWindows(input);
    expect(result.files.map((file) => file.content)).toEqual([content]);
    expect(result.command).toBe(
      `${ENCODING} Get-Content -LiteralPath '${result.files[0]?.path}' -Raw -Encoding UTF8 | ${run}`,
    );
  });

  it("inside a chain, with the rest of the chain rewritten too", () => {
    const result = onWindows('cd app && node -e "console.log(\\"x\\")" && ls -la');
    const file = result.files[0]?.path;
    expect(result.command).toBe(
      `cd app; if ($?) { ${ENCODING} Get-Content -LiteralPath '${file}' -Raw -Encoding UTF8 | node -; if ($?) { Get-ChildItem -Force } }`,
    );
  });

  it("names the same file for the same script", () => {
    const first = onWindows("node -e 'console.log(\"a\")'").files[0]?.path;
    expect(onWindows("node -e 'console.log(\"a\")'").files[0]?.path).toBe(first);
    expect(onWindows("node -e 'console.log(\"b\")'").files[0]?.path).not.toBe(first);
  });
});

describe("the destructive-command guard still sees a rewritten deletion", () => {
  const cwd = path.join(os.tmpdir(), "shelra-guard-project");

  it.each([
    ["rm -rf /", "if (Test-Path /) { Remove-Item -Recurse -Force / }"],
    ["rm -rf ~", "if (Test-Path ~) { Remove-Item -Recurse -Force ~ }"],
    ["del /s /q C:\\", "Remove-Item -Recurse -Force C:\\"],
    ["rmdir /s /q ..", "Remove-Item -Recurse -Force .."],
    ["cd src && rm -rf ../..", "cd src; if ($?) { if (Test-Path ../..) { Remove-Item -Recurse -Force ../.. } }"],
    ["HOME=x rm -rf .git", '$env:HOME = "x"; if (Test-Path .git) { Remove-Item -Recurse -Force .git }'],
  ])("%j runs as %j, which is refused as before", (written, runs) => {
    expect(onWindows(written).command).toBe(runs);
    expect(destructiveCommandReason(written, cwd)).not.toBeNull();
    expect(destructiveCommandReason(runs, cwd)).not.toBeNull();
  });

  it("leaves a deletion inside the project unguarded in both forms", () => {
    expect(destructiveCommandReason("rm -rf dist", cwd)).toBeNull();
    expect(destructiveCommandReason(onWindows("rm -rf dist").command, cwd)).toBeNull();
  });
});

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shelra-ps-normalize-"));
  made.push(dir);
  return dir;
}

// Each case starts a real Windows PowerShell.
describe.skipIf(process.platform !== "win32")("the bash tool on Windows", { timeout: 60_000 }, () => {
  it("runs `ls -la` as Get-ChildItem -Force and says so", async () => {
    const dir = project();
    fs.writeFileSync(path.join(dir, ".hidden-config"), "x");
    const bash = new BashTool(dir);
    const result = await bash.execute("ls -la");
    expect(result.success).toBe(true);
    expect(result.output).toContain(".hidden-config");
    expect(result.output).toContain("[Shelra ran this as Windows PowerShell: `ls -la` became `Get-ChildItem -Force`.]");
    await bash.cleanup();
  });

  it("runs an inline script with quotes and non-ASCII text, its imports resolved from the working folder", async () => {
    const dir = project();
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "answer.ts"), "export const answer = 41 + 1;\n");
    fs.writeFileSync(path.join(dir, "src", "cjs.cjs"), "module.exports = { seven: 7 };\n");
    const bash = new BashTool(dir);

    const viaBun = await bash.execute(
      'bun -e "import { answer } from \\"./src/answer\\";\nconsole.log(\\"answer=\\" + answer, \\"ñandú ✓\\")"',
    );
    expect(viaBun.success).toBe(true);
    expect(viaBun.output).toContain("answer=42 ñandú ✓");
    expect(viaBun.output).toContain("piped to `bun run -`");

    const viaNode = await bash.execute(
      'node -e \'const { seven } = require("./src/cjs.cjs"); console.log("seven=" + seven)\'',
    );
    expect(viaNode.success).toBe(true);
    expect(viaNode.output).toContain("seven=7");

    const scripts = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(`shelra-scripts-${process.pid}-`));
    expect(scripts.length).toBeGreaterThan(0);
    await bash.cleanup();
  });

  it("runs `rm -rf <dir> && …` as Remove-Item, chained", async () => {
    const dir = project();
    fs.mkdirSync(path.join(dir, "dist", "nested"), { recursive: true });
    fs.writeFileSync(path.join(dir, "dist", "nested", "a.js"), "x");
    const bash = new BashTool(dir);
    const result = await bash.execute("rm -rf dist && echo removed");
    expect(result.success).toBe(true);
    expect(result.output).toContain("removed");
    expect(fs.existsSync(path.join(dir, "dist"))).toBe(false);
    await bash.cleanup();
  });

  it("goes on after `rm -rf` of a folder that is not there, as `rm -f` does", async () => {
    const dir = project();
    const bash = new BashTool(dir);
    const result = await bash.execute("rm -rf dist && echo built");
    expect(result.success).toBe(true);
    expect(result.output).toContain("built");
    await bash.cleanup();
  });
});
