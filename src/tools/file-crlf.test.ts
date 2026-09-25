import { mkdtemp, readFile, rm, writeFile as writeFsFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editFile } from "./file";

vi.mock("../lsp/runtime", () => ({
  summarizeDiagnostics: () => "",
  syncFileWithLsp: async () => [],
}));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "shelra-crlf-"));
  tempDirs.push(dir);
  return dir;
}

describe("editFile line endings", () => {
  it("matches an LF snippet against a CRLF file and keeps CRLF", async () => {
    const dir = await tempDir();
    await writeFsFile(path.join(dir, "a.ts"), "export function f() {\r\n  return 1;\r\n}\r\n", "utf-8");
    const result = await editFile(
      "a.ts",
      "export function f() {\n  return 1;\n}",
      "export function f() {\n  return 2;\n}",
      dir,
    );
    expect(result.success).toBe(true);
    expect(await readFile(path.join(dir, "a.ts"), "utf-8")).toBe("export function f() {\r\n  return 2;\r\n}\r\n");
  });

  it("leaves LF files alone and does not expand $ patterns in the replacement", async () => {
    const dir = await tempDir();
    await writeFsFile(path.join(dir, "b.ts"), "const a = 1;\nconst b = 2;\n", "utf-8");
    const result = await editFile("b.ts", "const b = 2;", "const b = `$& $1`;", dir);
    expect(result.success).toBe(true);
    expect(await readFile(path.join(dir, "b.ts"), "utf-8")).toBe("const a = 1;\nconst b = `$& $1`;\n");
  });

  it("still reports a snippet that is missing under either ending", async () => {
    const dir = await tempDir();
    await writeFsFile(path.join(dir, "c.ts"), "x\r\ny\r\n", "utf-8");
    const result = await editFile("c.ts", "z", "w", dir);
    expect(result.success).toBe(false);
    expect(result.output).toContain("old_string not found");
  });
});

describe("editFile when the quote is not exact (seen live 2026-09-25)", () => {
  it("applies a unique match that differs only in whitespace, and says so", async () => {
    const dir = await tempDir();
    await writeFsFile(
      path.join(dir, "game.js"),
      "function jump(p){ if(p.grounded){p.vy=-5.35;p.grounded=false} }\n",
      "utf-8",
    );
    const result = await editFile(
      "game.js",
      "if(p.grounded){p.vy=-5.35;p.grounded=false}  }",
      "if(p.grounded){p.vy=-6.5;p.grounded=false} }",
      dir,
    );
    expect(result.success).toBe(true);
    expect(result.output).toContain("matched with different whitespace");
    expect(await readFile(path.join(dir, "game.js"), "utf-8")).toBe(
      "function jump(p){ if(p.grounded){p.vy=-6.5;p.grounded=false} }\n",
    );
  });

  it("refuses a loose match found in several places", async () => {
    const dir = await tempDir();
    await writeFsFile(path.join(dir, "a.js"), "let  total = 0;\nlet total  = 0;\n", "utf-8");
    const result = await editFile("a.js", "let total = 0;", "let total = 1;", dir);
    expect(result.success).toBe(false);
    expect(result.output).toContain("matches 2 places when whitespace is ignored");
  });

  it("shows the closest lines when the quote is wrong, so one retry can fix it", async () => {
    const dir = await tempDir();
    await writeFsFile(
      path.join(dir, "index.html"),
      "<body>\n<script>\nctx.fillText(stateMessage[mode][2],W/2,180);if(mode==='ready'){drawBitmap(W/2-9,196,marioSmall)}\n</script>\n",
      "utf-8",
    );
    const result = await editFile(
      "index.html",
      "...stateMessage[mode][2],W/2,180);if(mode==='ready'){drawBitmap(W/2-9,196,marioSmall,palettes.mario)}",
      "x",
      dir,
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("The closest text is at line 3:");
    expect(result.output).toContain("ctx.fillText(stateMessage[mode][2]");
  });
});
