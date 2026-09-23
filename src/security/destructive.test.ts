import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { destructiveCommandReason } from "./destructive";

const project = join(tmpdir(), "shelra-destructive-project");
const reason = (command: string) => destructiveCommandReason(command, project);

describe("destructiveCommandReason", () => {
  it("flags the owner's list: force-push, reset --hard, clean -fdx, deletion outside the project", () => {
    expect(reason("git push --force origin main")).toContain("force-push");
    expect(reason("git push -f")).toContain("force-push");
    expect(reason("git push origin +main")).toContain("force-push");
    expect(reason("git reset --hard HEAD~1")).toContain("uncommitted changes");
    expect(reason("git clean -fdx")).toContain("untracked");
    expect(reason("rm -rf /")).toContain("root of a drive");
    expect(reason("rm -rf ~")).toContain("home folder");
    expect(reason("rm -rf ../other-repo")).toContain("outside the project");
    expect(reason("rm -rf .")).toContain("everything in the project");
    expect(reason(`rm -rf ${project}`)).toContain("the whole project");
  });

  it("flags Windows deletion, disks, shutdown and the registry", () => {
    expect(reason("Remove-Item -Recurse -Force C:\\Users")).toContain("outside the project");
    expect(reason("Remove-Item C:\\ -Recurse")).toContain("root of a drive");
    expect(reason("rd /s /q C:\\Windows")).toContain("outside the project");
    expect(reason("Format-Volume -DriveLetter D")).toContain("disk");
    expect(reason("format D:")).toContain("disk");
    expect(reason("shutdown /s /t 0")).toContain("shuts down");
    expect(reason("Restart-Computer -Force")).toContain("restarts");
    expect(reason("reg delete HKCU\\Software\\App /f")).toContain("registry");
    expect(reason("Remove-Item HKLM:\\SOFTWARE\\App -Recurse")).toContain("registry");
  });

  it("flags discarding work and rewriting history", () => {
    expect(reason("git checkout -- src/app.ts")).toContain("discards");
    expect(reason("git restore src/app.ts")).toContain("discards");
    expect(reason("git branch -D feature")).toContain("branch");
    expect(reason("git stash drop")).toContain("stashed");
    expect(reason("git filter-repo --path secret.txt --invert-paths")).toContain("history");
  });

  it("finds the destructive part of a chained command", () => {
    expect(reason("bun test && git push --force")).toContain("force-push");
    expect(reason("cd .. ; rm -rf shelra")).not.toBeNull();
  });

  it("leaves ordinary development commands alone", () => {
    for (const command of [
      "rm -rf node_modules",
      "rm -rf dist build",
      "rm -r src/generated",
      "rm file.txt",
      "Remove-Item -Recurse -Force node_modules",
      "Remove-Item .\\dist -Recurse",
      "git push origin main",
      "git status",
      "git restore --staged src/app.ts",
      "git reset HEAD src/app.ts",
      "git clean -n",
      "git checkout main",
      "git branch -d merged",
      "bun test",
      "del notes.txt",
    ]) {
      expect(reason(command), command).toBeNull();
    }
  });
});
