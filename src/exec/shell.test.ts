import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildShellInvocation, normalizeShellErrorLine, translateForWindowsPowerShell } from "./shell";

describe("translateForWindowsPowerShell", () => {
  it("rewrites a top-level && chain into a $?-guarded sequence", () => {
    expect(translateForWindowsPowerShell("cd src && bun test")).toBe("cd src; if ($?) { bun test }");
    expect(translateForWindowsPowerShell("a && b && c")).toBe("a; if ($?) { b; if ($?) { c } }");
  });

  it("leaves commands without a chain untouched", () => {
    expect(translateForWindowsPowerShell("bun test")).toBe("bun test");
    expect(translateForWindowsPowerShell("Get-ChildItem -Force")).toBe("Get-ChildItem -Force");
  });

  it("does not split inside quotes or escaped characters", () => {
    expect(translateForWindowsPowerShell('echo "a && b"')).toBe('echo "a && b"');
    expect(translateForWindowsPowerShell("echo 'x && y' && ls")).toBe("echo 'x && y'; if ($?) { ls }");
    expect(translateForWindowsPowerShell("echo `&& && ls")).toBe("echo `&&; if ($?) { ls }");
  });

  it("refuses shapes it cannot translate safely", () => {
    expect(translateForWindowsPowerShell("a || b && c")).toBe("a || b && c");
    expect(translateForWindowsPowerShell("a && ")).toBe("a && ");
    expect(translateForWindowsPowerShell('echo "unterminated && b')).toBe('echo "unterminated && b');
  });
});

describe("normalizeShellErrorLine", () => {
  it("keeps the text of an error record", () => {
    const line =
      '<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><S S="Error">Get-Item : Cannot find path_x000D__x000A_</S></Objs>';
    expect(normalizeShellErrorLine(line)).toBe("Get-Item : Cannot find path");
  });

  it("drops the information record Write-Host adds after printing on stdout", () => {
    // Shape recorded 2026-09-22 from `Write-Host "hi from host"` through the real invocation.
    const line = [
      '<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="information" RefId="0">',
      '<TN RefId="0"><T>System.Management.Automation.InformationRecord</T><T>System.Object</T></TN>',
      '<ToString>hi from host</ToString><Props><Obj N="MessageData" RefId="1"><ToString>hi from host</ToString>',
      '<Props><S N="Message">hi from host</S><B N="NoNewLine">false</B><S N="ForegroundColor">DarkYellow</S>',
      '<S N="BackgroundColor">DarkMagenta</S></Props></Obj><S N="Source">C:/Users/me/count.ps1</S>',
      '<Obj N="Tags" RefId="2"><LST><S>PSHOST</S></LST></Obj><S N="User">HOST/me</S><S N="Computer">host</S>',
      "</Props></Obj></Objs>",
    ].join("");
    expect(normalizeShellErrorLine(line)).toBeNull();
  });
});

function run(command: string): { code: number | null; stdout: string; stderr: string } {
  const invocation = buildShellInvocation(command, "powershell");
  const result = spawnSync(invocation.file, invocation.args, { encoding: "utf8" });
  const stderr = (result.stderr ?? "")
    .split("\n")
    .map((line) => normalizeShellErrorLine(line))
    .filter((line): line is string => line !== null && line.trim() !== "");
  return { code: result.status, stdout: (result.stdout ?? "").replace(/\r/g, ""), stderr: stderr.join("\n") };
}

// Each case starts a real PowerShell, which takes a second or more under a busy test run.
describe.skipIf(process.platform !== "win32")("Windows PowerShell invocation", { timeout: 60_000 }, () => {
  it("prints objects PowerShell formats as a table", () => {
    // Table output is held back while column widths are computed; ending the script with
    // `exit` used to drop it, so `Get-Process` "succeeded" with nothing printed.
    const { code, stdout } = run("Get-Process -Id $PID | Select-Object ProcessName, Id");
    expect(code).toBe(0);
    expect(stdout).toContain("ProcessName");
    expect(stdout).toMatch(/powershell|pwsh/i);
  });

  it("prints Write-Host once, on stdout, with nothing left on stderr", () => {
    const { code, stdout, stderr } = run('Write-Host "Running processes: 307"');
    expect(code).toBe(0);
    expect(stdout).toBe("Running processes: 307\n");
    expect(stderr).toBe("");
  });

  it("still exits with the command's own code", () => {
    expect(run('node -e "process.exit(7)"').code).toBe(7);
    expect(run("cmd /c exit 3").code).toBe(3);
    expect(run("Get-Item C:/shelra/definitely/not/here").code).toBe(1);
    expect(run("'ok'").code).toBe(0);
  });
});
