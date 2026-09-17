import { describe, expect, it } from "vitest";
import { translateForWindowsPowerShell } from "./shell";

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
