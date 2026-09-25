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

  it("keeps the file's indentation when the quote indents differently (the two-hour flip-flop, seen live 2026-09-25)", async () => {
    const castle = [
      "export class CastleTrack {",
      "    mesh: THREE.Group;",
      "",
      "    addToScene(parent: THREE.Group) {",
      "        parent.add(this.mesh);",
      "    }",
      "}",
      "",
    ];
    for (const ending of ["\n", "\r\n"]) {
      const dir = await tempDir();
      const file = path.join(dir, "castle.ts");
      const original = castle.join(ending);
      await writeFsFile(file, original, "utf-8");
      // The model's quote, as the trace shows it: one space per level and a trailing blank line.
      const quoted = " addToScene(parent: THREE.Group) {\n parent.add(this.mesh);\n }\n}\n\n";
      const added =
        " addToScene(parent: THREE.Group) {\n parent.add(this.mesh);\n this.mesh.visible = true;\n }\n}\n\n";

      const forward = await editFile("castle.ts", quoted, added, dir);

      expect(forward.output).toContain("matched with different whitespace");
      expect(await readFile(file, "utf-8")).toBe(
        [
          "export class CastleTrack {",
          "    mesh: THREE.Group;",
          "",
          "    addToScene(parent: THREE.Group) {",
          "        parent.add(this.mesh);",
          "        this.mesh.visible = true;",
          "    }",
          "}",
          "",
        ].join(ending),
      );
      // Its inverse, quoted the same way, restores the file byte for byte.
      await editFile("castle.ts", added, quoted, dir);
      expect(await readFile(file, "utf-8")).toBe(original);
    }
  });

  it("says an edit that only re-spaces the code changed nothing, instead of 'Edited +0 -0' (seen live 2026-09-25)", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "beach.ts");
    const original =
      "export class BeachTrack {\n    addToScene(parent: THREE.Group) {\n        parent.add(this.mesh);\n    }\n}\n";
    await writeFsFile(file, original, "utf-8");

    const loose = await editFile(
      "beach.ts",
      " addToScene(parent: THREE.Group) {\n parent.add(this.mesh);\n }\n}\n",
      "  addToScene(parent: THREE.Group) {\n    parent.add(this.mesh);\n  }\n}\n",
      dir,
    );
    const same = await editFile("beach.ts", "parent.add(this.mesh);", "parent.add(this.mesh);", dir);

    expect(loose.success).toBe(false);
    expect(loose.output).toContain(
      "No change to beach.ts: new_string differs from the matched text only in whitespace",
    );
    expect(same).toMatchObject({
      success: false,
      output: "No change to beach.ts: new_string is the same as old_string.",
    });
    expect(await readFile(file, "utf-8")).toBe(original);
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
