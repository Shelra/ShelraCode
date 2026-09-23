import { describe, expect, it } from "vitest";
import { describeVerificationEvidence } from "./verification-evidence";

const bash = (command: string) => JSON.stringify({ command });
const changed = ["C:\\Users\\me\\check_camera.ps1", "C:\\Users\\me\\report.py", "D:/repo/src/app.ts"];

describe("describeVerificationEvidence", () => {
  it("counts a project's real checks", () => {
    expect(describeVerificationEvidence("bash", bash("bun test"))).toBe("bash: bun test");
    expect(describeVerificationEvidence("bash", bash("npx tsc --noEmit"))).toContain("tsc");
  });

  it("counts running a script the turn just changed", () => {
    // The live case: a diagnostic helper written outside any project, then run.
    expect(
      describeVerificationEvidence(
        "bash",
        bash("powershell -ExecutionPolicy Bypass -File C:\\Users\\me\\check_camera.ps1"),
        changed,
      ),
    ).toBe("bash: ran the changed file check_camera.ps1");
    expect(describeVerificationEvidence("bash", bash("& 'C:\\Users\\me\\check_camera.ps1'"), changed)).not.toBeNull();
    expect(describeVerificationEvidence("bash", bash(".\\check_camera.ps1"), changed)).not.toBeNull();
    expect(describeVerificationEvidence("bash", bash("python -u report.py --dry-run"), changed)).not.toBeNull();
    expect(describeVerificationEvidence("bash", bash("cd D:/repo; bun src/app.ts"), changed)).not.toBeNull();
  });

  it("does not count reading a changed file back", () => {
    expect(
      describeVerificationEvidence("bash", bash("Get-Content C:\\Users\\me\\check_camera.ps1"), changed),
    ).toBeNull();
    expect(describeVerificationEvidence("bash", bash("cat report.py"), changed)).toBeNull();
    expect(describeVerificationEvidence("bash", bash("Select-String -Path report.py -Pattern x"), changed)).toBeNull();
  });

  it("does not count running a file the turn did not change", () => {
    expect(describeVerificationEvidence("bash", bash("python other.py"), changed)).toBeNull();
    expect(describeVerificationEvidence("bash", bash("python report.py"), [])).toBeNull();
  });
});
