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

describe("destructiveCommandReason on Windows' default shell and through wrappers", () => {
  // Review round 3 (2026-09-24): each of these deleted the victim folder with no question asked.
  it("sees a removal inside cmd /c, powershell -Command, bash -c, iex, a prefix command or xargs", () => {
    for (const command of [
      "cmd /c rd /s /q ..\\victim",
      'cmd /c "rmdir /s /q ..\\victim"',
      'powershell -NoProfile -Command "Remove-Item -Recurse -Force ..\\victim"',
      `pwsh -EncodedCommand ${Buffer.from("Remove-Item -Recurse -Force ..\\victim", "utf16le").toString("base64")}`,
      "bash -c 'rm -rf ../victim'",
      'iex "rm -rf ../victim"',
      "sudo -u root rm -rf ../victim",
      "env -u KEY FOO=1 rm -rf ../victim",
      "timeout -s KILL 60 rm -rf ../victim",
      "A=1 rm -rf ../victim",
      "ls .. | xargs rm -rf",
      "find .. -name victim | xargs -0 rm -rf",
    ]) {
      expect(reason(command), command).not.toBeNull();
    }
  });

  it("follows Push-Location, variables and ForEach-Object blocks to what they delete", () => {
    for (const command of [
      "Push-Location ..; Remove-Item victim -Recurse -Force; Pop-Location",
      "Remove-Item -Recurse -Force $env:TEMP\\victim",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell variable reference, not a template
      "rm -rf ${TMPDIR}/victim",
      'OUT=..; rm -rf "$OUT/victim"',
      '$d = "..\\victim"; Remove-Item $d -Recurse -Force',
      "Remove-Item -Recurse -Force $unknownFolder",
      "Get-ChildItem .. -Directory -Filter victim | ForEach-Object { Remove-Item $_.FullName -Recurse -Force }",
      "gci .. | %{ ri $_ -Recurse }",
      "Remove-Item -Path @('..\\victim') -Recurse",
      "cd $SOMEWHERE_UNSET && rm -rf build",
      "find .. -name '*.tmp' -delete",
      "find . -delete",
      "rm -rf .git",
      "git checkout -f",
      "git switch --discard-changes main",
    ]) {
      expect(reason(command), command).not.toBeNull();
    }
  });

  it("still leaves ordinary work inside the project alone", () => {
    for (const command of [
      "cmd /c rd /s /q dist",
      "bash -c 'rm -rf node_modules && bun install'",
      'OUT=dist; rm -rf "$OUT"',
      "Get-ChildItem src -Filter *.tmp | ForEach-Object { Remove-Item $_.FullName -Recurse }",
      "find . -name '*.tmp' -delete",
      "cd src && rm -rf .",
      "Push-Location src; Remove-Item build -Recurse -Force; Pop-Location",
      "sudo -u root ls",
      "git checkout -b feature",
      "Remove-Item -Recurse -Force $PWD\\dist",
    ]) {
      expect(reason(command), command).toBeNull();
    }
  });
});

describe("destructiveCommandReason, the review of its own round-3 rewrite", () => {
  const B = String.fromCharCode(92);

  it("flags removals behind control keywords, blocks, loops, xargs -I, positional powershell and computed variables", () => {
    for (const command of [
      `if (Test-Path ..${B}victim) { Remove-Item ..${B}victim -Recurse -Force }`,
      `try { Remove-Item ..${B}victim -Recurse -Force } catch {}`,
      `if (Test-Path x) { echo hi } else { Remove-Item ..${B}victim -Recurse -Force }`,
      "if [ -d ../victim ]; then rm -rf ../victim; fi",
      'for d in ../victim; do rm -rf "$d"; done',
      `foreach ($d in '..${B}victim') { Remove-Item $d -Recurse -Force }`,
      "find .. -name victim | xargs -I {} rm -rf {}",
      "ls .. | xargs -I% rm -rf %",
      `powershell "Remove-Item -Recurse -Force ..${B}victim"`,
      `powershell -NoProfile -ExecutionPolicy Bypass "Remove-Item -Recurse -Force ..${B}victim"`,
      "$d = Join-Path .. victim; Remove-Item $d -Recurse -Force",
      `$d = Resolve-Path ..${B}victim; Remove-Item $d -Recurse -Force`,
      `$d = "$PWD${B}..${B}victim"; Remove-Item $d -Recurse -Force`,
      "$d = $env:TEMP; Remove-Item $d -Recurse -Force",
      "$d = $HOME; Remove-Item $d -Recurse -Force",
      'D=$HOME; rm -rf "$D"',
      "Get-ChildItem .. | ForEach-Object { if ($_.Name -eq 'victim') { Remove-Item $_.FullName -Recurse -Force } }",
      "gci .. | ? { $_.Name -eq 'victim' } | % { ri $_ -Recurse }",
      'cmd /c "cd /d .. && rmdir /s /q shelra"',
      "find . | xargs rm -rf",
      "find . -print0 | xargs -0 rm -rf",
      "find . -name .git | xargs rm -rf",
      "find . ../other -name x | xargs rm -rf",
    ]) {
      expect(reason(command), command).not.toBeNull();
    }
  });

  it("leaves ordinary in-project work alone, the forms the rewrite began to refuse included", () => {
    for (const command of [
      "if (Test-Path dist) { Remove-Item dist -Recurse -Force }",
      "if [ -d dist ]; then rm -rf dist; fi",
      "$d = Join-Path $PWD dist; Remove-Item $d -Recurse -Force",
      '$d = "dist"; Remove-Item $d -Recurse -Force',
      "foreach ($d in 'dist','build') { Remove-Item $d -Recurse -Force }",
      'for d in dist build; do rm -rf "$d"; done',
      "find src -name '*.pyc' | xargs -I {} rm -rf {}",
      "find . -name __pycache__ -type d | xargs rm -rf",
      "find . -type d -name node_modules -prune | xargs rm -rf",
      "find . -name '*.pyc' -print0 | xargs -0 rm -rf",
      "find . -name node_modules -prune -exec rm -rf {} +",
      "Get-ChildItem src | Where-Object { $_.Name -like '*.tmp' } | ForEach-Object { Remove-Item $_.FullName -Recurse }",
      'cmd /c "cd /d frontend && rmdir /s /q node_modules"',
      'powershell -NoProfile "Get-ChildItem"',
      "powershell -File build.ps1",
      "try { bun test } catch { echo failed }",
      "rm -rf ./dist",
    ]) {
      expect(reason(command), command).toBeNull();
    }
  });
});

describe("destructiveCommandReason, stopping processes (audit gap #11, seen live 2026-09-25)", () => {
  const stops = (command: string, ownPids: number[] = []) => destructiveCommandReason(command, project, { ownPids });

  it("flags a process the session did not start, every process of a name, and one chosen at run time", () => {
    expect(stops("Stop-Process -Id 26008 -Force")).toContain(
      "stops process 26008, which this session did not start (it may be the person's own program",
    );
    expect(stops("taskkill /F /T /PID 7972")).toContain("stops process 7972");
    expect(stops("kill -9 27488")).toContain("stops process 27488");
    expect(stops("Stop-Process -Name node -Force")).toContain("stops every `node` process on this machine");
    expect(stops("taskkill /F /IM node.exe")).toContain("stops every `node.exe` process");
    expect(stops("pkill -f vite")).toContain("stops every `vite` process");
    expect(stops("Stop-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess -Force")).toContain(
      "stops a process chosen when the command runs",
    );
    expect(stops("Get-Process node | Stop-Process -Force")).toContain("stops a process chosen when the command runs");
    expect(stops("npm run build; Stop-Process -Id 26008")).toContain("stops process 26008");
  });

  it("lets the session stop its own processes, a job of the same line, and look at processes", () => {
    expect(stops("Stop-Process -Id 4242 -Force", [4242])).toBeNull();
    expect(stops("kill 4242 4343", [4242, 4343])).toBeNull();
    expect(stops("kill %1")).toBeNull();
    expect(stops("sleep 100 & kill $!")).toBeNull();
    expect(stops("Get-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess")).toBeNull();
    expect(stops('tasklist /FI "IMAGENAME eq node.exe"')).toBeNull();
  });
});
