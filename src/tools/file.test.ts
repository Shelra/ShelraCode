import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { mkdtemp, readFile, rm, writeFile as writeFsFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteFile, editFile, writeFile } from "./file";

const summarizeDiagnosticsMock = vi.fn<(diagnostics: unknown) => string>(() => "1 LSP issue · 1 error");
const syncFileWithLspMock = vi.fn<
  (
    cwd: string,
    filePath: string,
    content: string,
    save: boolean,
    waitForDiagnostics: boolean,
  ) => Promise<
    Array<{
      filePath: string;
      serverId: string;
      diagnostics: Array<{
        message: string;
        severity: number;
        range: {
          start: { line: number; character: number };
          end: { line: number; character: number };
        };
      }>;
    }>
  >
>(async () => [
  {
    filePath: "/tmp/demo.ts",
    serverId: "typescript",
    diagnostics: [
      {
        message: "Type error",
        severity: 1,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
      },
    ],
  },
]);

vi.mock("../lsp/runtime", () => ({
  summarizeDiagnostics: (diagnostics: unknown) => summarizeDiagnosticsMock(diagnostics),
  syncFileWithLsp: (cwd: string, filePath: string, content: string, save: boolean, waitForDiagnostics: boolean) =>
    syncFileWithLspMock(cwd, filePath, content, save, waitForDiagnostics),
}));

const tempDirs: string[] = [];

afterEach(async () => {
  summarizeDiagnosticsMock.mockClear();
  syncFileWithLspMock.mockClear();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("file tool LSP integration", () => {
  it("includes diagnostics metadata when writing a file", async () => {
    const cwd = await createTempDir();
    const result = await writeFile("demo.ts", "const answer = 42;\n", cwd);

    expect(result.success).toBe(true);
    expect(result.output).toContain("1 LSP issue");
    expect(result.lspDiagnostics).toHaveLength(1);
    expect(syncFileWithLspMock).toHaveBeenCalledWith(
      cwd,
      path.join(cwd, "demo.ts"),
      "const answer = 42;\n",
      true,
      true,
    );
  });

  it("syncs edited file contents through the LSP runtime", async () => {
    const cwd = await createTempDir();
    const filePath = path.join(cwd, "demo.ts");
    await writeFsFile(filePath, "const answer = 41;\n", "utf8");

    const result = await editFile("demo.ts", "41", "42", cwd);
    const content = await readFile(filePath, "utf8");

    expect(result.success).toBe(true);
    expect(content).toContain("42");
    expect(syncFileWithLspMock).toHaveBeenCalledWith(cwd, filePath, "const answer = 42;\n", true, true);
  });
});

describe("deleteFile", () => {
  it("removes the file and returns a full-removal diff", async () => {
    const cwd = await createTempDir();
    const filePath = path.join(cwd, "demo.ts");
    await writeFsFile(filePath, "const answer = 42;\nconst other = 1;\n", "utf8");

    const result = await deleteFile("demo.ts", cwd);

    expect(result.success).toBe(true);
    expect(result.output).toContain("Deleted demo.ts");
    expect(existsSync(filePath)).toBe(false);
    expect(result.diff?.additions).toBe(0);
    expect(result.diff?.removals).toBe(2);
    expect(result.diff?.patch).toContain("-const answer = 42;");
  });

  it("fails cleanly when the file does not exist", async () => {
    const cwd = await createTempDir();
    const result = await deleteFile("missing.ts", cwd);

    expect(result.success).toBe(false);
    expect(result.output).toContain("File not found");
    expect(result.diff).toBeUndefined();
  });
});

const UTF8_BOM = [0xef, 0xbb, 0xbf];
/** Asks Windows PowerShell 5.1 whether it read `ñ` in the script as one character (UTF-8) or two (ANSI). */
const PROBE = 'if ("ñ".Length -eq 1) { "utf8" } else { "ansi" }\n';

describe("PowerShell scripts with non-ASCII text are written as UTF-8 with a byte-order mark", () => {
  it("write_file adds the mark, and the diff does not count it", async () => {
    const cwd = await createTempDir();
    await writeFile("check.ps1", 'Write-Output "Listo ✓"\n', cwd);
    const bytes = await readFile(path.join(cwd, "check.ps1"));
    expect([...bytes.subarray(0, 3)]).toEqual(UTF8_BOM);
    expect(bytes.subarray(3).toString("utf8")).toBe('Write-Output "Listo ✓"\n');

    const rewrite = await writeFile("check.ps1", 'Write-Output "Hecho ✓"\n', cwd);
    expect(rewrite.diff).toMatchObject({ additions: 1, removals: 1 });
    expect([...(await readFile(path.join(cwd, "check.ps1"))).subarray(0, 3)]).toEqual(UTF8_BOM);
  });

  it("edit_file adds it when an edit brings non-ASCII text, and keeps one already there", async () => {
    const cwd = await createTempDir();
    const file = path.join(cwd, "tools.psm1");
    await writeFsFile(file, 'function Say { "done" }\n', "utf8");
    await editFile("tools.psm1", '"done"', '"listo ✓"', cwd);
    expect([...(await readFile(file)).subarray(0, 3)]).toEqual(UTF8_BOM);
    await editFile("tools.psm1", '"listo ✓"', '"hecho ✓"', cwd);
    const bytes = await readFile(file);
    expect([...bytes.subarray(0, 3)]).toEqual(UTF8_BOM);
    expect(bytes.subarray(3).toString("utf8")).toBe('function Say { "hecho ✓" }\n');
  });

  it("leaves ASCII-only scripts and every other file as given", async () => {
    const cwd = await createTempDir();
    await writeFile("plain.ps1", 'Write-Output "ok"\n', cwd);
    await writeFile("notes.md", "Listo ✓\n", cwd);
    expect([...(await readFile(path.join(cwd, "plain.ps1"))).subarray(0, 3)]).not.toEqual(UTF8_BOM);
    expect((await readFile(path.join(cwd, "notes.md"))).toString("utf8")).toBe("Listo ✓\n");
  });

  it.skipIf(process.platform !== "win32")(
    "so Windows PowerShell 5.1 reads the script as UTF-8, which it does not without the mark",
    async () => {
      const cwd = await createTempDir();
      await writeFile("probe.ps1", PROBE, cwd);
      await writeFsFile(path.join(cwd, "probe-no-bom.ps1"), PROBE, "utf8");
      const run = (name: string) =>
        execFileSync(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(cwd, name)],
          { encoding: "utf8" },
        ).trim();
      expect(run("probe.ps1")).toBe("utf8");
      expect(run("probe-no-bom.ps1")).toBe("ansi");
    },
    30_000,
  );
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "shelra-file-tools-"));
  tempDirs.push(dir);
  return dir;
}
