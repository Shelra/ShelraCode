import { describe, expect, it } from "vitest";
import {
  describeDelegatedEvidence,
  describeVerificationEvidence,
  isVerificationCommand,
  maskedVerificationCommand,
} from "./verification-evidence";

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

  it("does not count a check whose exit code a later command replaces", () => {
    // Live 2026-09-23: the type-check failed in a clone without dependencies, and `head` exited 0.
    const piped = "cd D:/repo && bun run typecheck 2>&1 | head -50";
    expect(describeVerificationEvidence("bash", bash(piped))).toBeNull();
    expect(describeVerificationEvidence("bash", bash("bun test | Select-Object -Last 20"))).toBeNull();
    expect(describeVerificationEvidence("bash", bash("bun test; echo done"))).toBeNull();
    expect(describeVerificationEvidence("bash", bash("bun test || true"))).toBeNull();
    expect(describeVerificationEvidence("bash", bash("bun test\ngit status"))).toBeNull();
    expect(
      describeVerificationEvidence(
        "bash",
        bash("powershell -File C:\\Users\\me\\check_camera.ps1 | Out-String"),
        changed,
      ),
    ).toBeNull();
    expect(maskedVerificationCommand("bash", bash(piped))).toBe(piped);
    // Review round 3 (2026-09-24): a check sent to the background exits 0 whatever it finds.
    expect(describeVerificationEvidence("bash", bash("bun test & echo ok"))).toBeNull();
    expect(describeVerificationEvidence("bash", bash("bun test &"))).toBeNull();
    expect(maskedVerificationCommand("bash", bash("bun test & echo ok"))).toBe("bun test & echo ok");
    expect(maskedVerificationCommand("bash", bash("bun test &"))).toBe("bun test &");
  });

  it("counts a check whose exit code is the command's", () => {
    expect(describeVerificationEvidence("bash", bash("cd D:/repo && bun test"))).not.toBeNull();
    expect(describeVerificationEvidence("bash", bash("bun test 2>&1"))).not.toBeNull();
    expect(describeVerificationEvidence("bash", bash("bun test &> test.log"))).not.toBeNull();
    expect(describeVerificationEvidence("bash", bash("& bun test"))).not.toBeNull();
    expect(describeVerificationEvidence("bash", bash("bun run typecheck && bun run lint"))).not.toBeNull();
    expect(describeVerificationEvidence("bash", bash('echo "== tests =="; bun test'))).not.toBeNull();
    expect(describeVerificationEvidence("bash", bash('grep -c "a|b;c" notes.txt && bun test'))).not.toBeNull();
    expect(maskedVerificationCommand("bash", bash("bun test"))).toBeNull();
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

  it("decides on the program a command runs, not on words in its text (audit 2026-09-23)", () => {
    // Each of these passed the earlier word-matching gate.
    expect(describeVerificationEvidence("bash", bash('echo "all good, tsc passes"'))).toBeNull();
    expect(describeVerificationEvidence("bash", bash("echo see http://localhost:3000"))).toBeNull();
    expect(describeVerificationEvidence("bash", bash("cat README.md # vitest"))).toBeNull();
    expect(describeVerificationEvidence("bash", bash("Write-Output 'eslint clean'"))).toBeNull();
    expect(describeVerificationEvidence("bash", bash("tsc --version"))).toBeNull();
    expect(describeVerificationEvidence("bash", bash("npx tsc -v"))).toBeNull();
    expect(describeVerificationEvidence("bash", bash("bun --help"))).toBeNull();
    expect(describeVerificationEvidence("bash", bash("git status"))).toBeNull();
    expect(describeVerificationEvidence("bash", bash("bun run dev"))).toBeNull();
    expect(describeVerificationEvidence("bash", bash("bun install"))).toBeNull();
  });

  it("counts a request only against a server running on this machine", () => {
    expect(describeVerificationEvidence("bash", bash("curl https://example.com"))).toBeNull();
    expect(describeVerificationEvidence("bash", bash("Invoke-WebRequest https://api.github.com"))).toBeNull();
    expect(describeVerificationEvidence("bash", bash("curl -s http://localhost:3000/api/health"))).not.toBeNull();
    expect(describeVerificationEvidence("bash", bash("Invoke-WebRequest -Uri http://127.0.0.1:8080/"))).not.toBeNull();
    expect(describeVerificationEvidence("bash", bash("curl http://app.localhost:5173"))).not.toBeNull();
  });

  it("recognizes checks across ecosystems and through runners", () => {
    for (const command of [
      "npm test",
      "npm t",
      "pnpm lint",
      "yarn build",
      "bun run test:unit",
      "bun x vitest run",
      "bunx vitest run src/a.test.ts",
      "npx -y jest --ci",
      "python -m pytest -q",
      "py -m unittest",
      "uv run pytest",
      "go test ./...",
      "cargo clippy",
      "dotnet test",
      "make check",
      "node --test",
      "ruff check .",
      "ruff format --check .",
      "prettier --check src",
      "biome ci",
      "CI=1 bun test",
      "deno test",
    ]) {
      expect(isVerificationCommand(command), command).toBe(true);
    }
    for (const command of ["prettier --write src", "biome format --write .", "ruff format .", "black src"]) {
      expect(isVerificationCommand(command), command).toBe(false);
    }
  });
});

describe("describeDelegatedEvidence", () => {
  it("counts a delegation only when the sub-agent itself ran a check", () => {
    expect(describeDelegatedEvidence("verify", undefined)).toBeNull();
    expect(describeDelegatedEvidence("verify", [])).toBeNull();
    expect(describeDelegatedEvidence("verify", ["bash: bun test"])).toContain("bash: bun test");
  });
});
