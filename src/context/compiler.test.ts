import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { classifyTurn, compileContextPacket } from "./compiler";

describe("host context compiler", () => {
  it("keeps ordinary conversation tool-free", () => {
    expect(classifyTurn("What is a closure?")).toEqual({
      kind: "conversation",
      toolPolicy: "none",
      reason: "no repository or mutation signal",
    });
  });

  it("compiles bounded repository evidence and ranks objective paths", () => {
    const root = mkdtempSync(join(tmpdir(), "shelra-context-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "package.json"), '{"name":"fixture"}');
    writeFileSync(join(root, "src", "parser.ts"), "export function parse() {}\n");
    writeFileSync(join(root, "src", "other.ts"), "export function other() {}\n");
    const packet = compileContextPacket(root, "Fix parser.ts in the repository", 3_000);

    expect(packet.classification.kind).toBe("coding");
    expect(packet.classification.toolPolicy).toBe("mutate");
    expect(packet.files).toContain("src/parser.ts");
    expect(packet.promptAppendix).toContain("package.json");
    expect(packet.promptAppendix.length).toBeLessThanOrEqual(3_000 + 30);
  });

  it.each([
    "revisa el proyecto",
    "analiza el repositorio",
    "lee los archivos de la carpeta src",
  ])("classifies Spanish repository requests as read-only work: %s", (prompt) => {
    expect(classifyTurn(prompt)).toMatchObject({ kind: "repository", toolPolicy: "read" });
  });

  it("marks a broad review as host-evidence-only and keeps explicit file reads tool-enabled", () => {
    expect(classifyTurn("revisa el proyecto")).toMatchObject({ hostEvidenceOnly: true });
    expect(classifyTurn("lee package.json y src/index.ts")).not.toHaveProperty("hostEvidenceOnly");
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
