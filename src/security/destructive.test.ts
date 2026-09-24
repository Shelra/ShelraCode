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

describe("destructiveCommandReason, the forms that used to slip through", () => {
  it("sees through git's global options, root globs, home spellings, cd forms, pipes and a lone &", () => {
    for (const command of [
      "rm -rf ./*",
      "Remove-Item -Recurse -Force .\\*",
      "Remove-Item -Recurse -Force ..\\x",
      "git -C .. clean -fdx",
      "git -c core.pager=cat reset --hard",
      "git --git-dir=.git clean -f",
      "git --no-pager reset --hard HEAD~1",
      "bun test & rm -rf ../x",
      "cd ~ && rm -rf x",
      "cd $HOME; rm -rf x",
      "cd && rm -rf x",
      "cd -- .. && rm -rf shelra",
      "cd -P .. && rm -rf shelra",
      "gci .. | ri -Recurse -Force",
      "Get-ChildItem .. | Where-Object { $_.Name -like '*' } | Remove-Item -Recurse -Force",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell variable reference, not a template
      "rm -rf ${HOME}/x",
      "Remove-Item -Recurse:$true -Force ..",
      "git branch -df feature",
      "git branch -d -f feature",
      "Remove-Item -Path Registry::HKEY_LOCAL_MACHINE\\Software\\Foo -Recurse",
    ]) {
      expect(reason(command), command).not.toBeNull();
    }
  });

  it("still leaves work inside the project alone", () => {
    for (const command of [
      "rm -rf src/generated/*",
      "git -c core.pager=cat log --oneline",
      "cd -- src && rm -rf build",
      "gci src -Filter *.tmp | ri -Recurse",
      "bun test 2>&1 | tee test.log",
      "bun run build &> build.log",
    ]) {
      expect(reason(command), command).toBeNull();
    }
  });
});
