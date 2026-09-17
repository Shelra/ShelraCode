import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { classifyTurn, compileContextPacket } from "./compiler";

describe("host context compiler", () => {
  it("classifies without ever carrying a tool policy", () => {
    expect(classifyTurn("What is a closure?")).toEqual({
      kind: "conversation",
      reason: "no repository or mutation signal",
    });
    expect(classifyTurn("Fix parser.ts in the repository")).toEqual({
      kind: "coding",
      reason: "mutation request with repository scope",
    });
    for (const prompt of ["Make the tests pass", "git status", "Why does the login page crash?"]) {
      // These read as "conversation" to a keyword heuristic; the classification is informational
      // only and must never be able to remove tools from the turn.
      expect(classifyTurn(prompt)).not.toHaveProperty("toolPolicy");
    }
  });

  it("compiles bounded repository evidence and ranks objective paths", () => {
    const root = mkdtempSync(join(tmpdir(), "shelra-context-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), '{"name":"fixture"}');
    writeFileSync(join(root, "src", "parser.ts"), "export function parse() {}\n");
    writeFileSync(join(root, "src", "other.ts"), "export function other() {}\n");
    const packet = compileContextPacket(root, "Fix parser.ts in the repository", 3_000);

    expect(packet.classification.kind).toBe("coding");
    expect(packet.files).toContain("src/parser.ts");
    expect(packet.promptAppendix).toContain("package.json");
    expect(packet.promptAppendix.length).toBeLessThanOrEqual(3_000 + 30);
  });

  it.each([
    "revisa el proyecto",
    "analiza el repositorio",
    "lee los archivos de la carpeta src",
  ])("classifies Spanish repository requests as repository turns: %s", (prompt) => {
    expect(classifyTurn(prompt)).toMatchObject({ kind: "repository" });
  });

  it("does not inject README or instruction files as evidence, only the manifest", () => {
    const root = mkdtempSync(join(tmpdir(), "shelra-context-manifest-"));
    writeFileSync(join(root, "package.json"), '{"name":"fixture","scripts":{"test":"bun test"}}');
    writeFileSync(join(root, "README.md"), "README BODY SHOULD NOT BE INJECTED");
    writeFileSync(join(root, "AGENTS.md"), "AGENTS BODY SHOULD NOT BE INJECTED");

    const packet = compileContextPacket(root, "revisa el proyecto");

    expect(packet.files).toEqual(expect.arrayContaining(["package.json", "README.md", "AGENTS.md"]));
    expect(packet.promptAppendix).toContain('"test":"bun test"');
    expect(packet.promptAppendix).not.toContain("README BODY");
    expect(packet.promptAppendix).not.toContain("AGENTS BODY");
  });

  it("terminates on a directory symlink cycle", () => {
    const root = mkdtempSync(join(tmpdir(), "shelra-context-cycle-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), '{"name":"cycle"}');
    writeFileSync(join(root, "src", "index.ts"), "export const a = 1;\n");
    // `loop` points back at the directory that contains it.
    symlinkSync(root, join(root, "src", "loop"), "junction");

    const packet = compileContextPacket(root, "revisa el proyecto");

    expect(packet.files).toContain("package.json");
  });

  it("prioritizes target manifests and ignores a nested reference checkout", () => {
    const root = mkdtempSync(join(tmpdir(), "shelra-context-root-"));
    mkdirSync(join(root, "ShelraCode", "src"), { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), '{"name":"target"}');
    writeFileSync(join(root, "README.md"), "target readme");
    writeFileSync(join(root, "ShelraCode", "src", "reference.ts"), "reference");
    writeFileSync(join(root, "src", "index.ts"), "target");

    const packet = compileContextPacket(root, "revisa el proyecto");

    expect(packet.files).toContain("package.json");
    expect(packet.files).toContain("README.md");
    expect(packet.files.some((file) => file.startsWith("ShelraCode/"))).toBe(false);
    expect(packet.promptAppendix).toContain(`Workspace root: ${root}`);
  });
});
