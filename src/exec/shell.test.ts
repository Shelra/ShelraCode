import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildShellInvocation, translateForWindowsPowerShell } from "./shell";

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

function run(command: string): { code: number | null; stdout: string } {
  const invocation = buildShellInvocation(command, "powershell");
  const result = spawnSync(invocation.file, invocation.args, { encoding: "utf8" });
  return { code: result.status, stdout: (result.stdout ?? "").replace(/\r/g, "") };
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

  it("still exits with the command's own code", () => {
    expect(run('node -e "process.exit(7)"').code).toBe(7);
    expect(run("cmd /c exit 3").code).toBe(3);
    expect(run("Get-Item C:/shelra/definitely/not/here").code).toBe(1);
    expect(run("'ok'").code).toBe(0);
  });
});
