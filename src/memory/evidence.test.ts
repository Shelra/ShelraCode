import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkEvidence, claimsLiveState, evidenceLine, normalizeQuote, quoteFound, unsafeProcedure } from "./evidence";

const dirs: string[] = [];
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "shelra-evidence-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "due.ts"), "export {};\n");
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const USER = [
  "That's not what I meant: the report must group the totals by client, never by month. Fix it.",
  "Nada puede salir de la máquina del usuario: ni sincronización ni telemetría.",
];

describe("quotes of the user", () => {
  it("count when they appear word for word, whatever the case, accents, curly quotes or edge punctuation", () => {
    expect(quoteFound("the report must group the totals by client, never by month", USER)).toBe(true);
    expect(quoteFound("“The report must group the totals by client”", USER)).toBe(true);
    expect(quoteFound("nada puede salir de la maquina del usuario", USER)).toBe(true);
    expect(normalizeQuote("  «Hola, Mundo!»  ")).toBe("hola, mundo");
  });

  it("do not count when paraphrased, translated, or too short to state anything", () => {
    expect(quoteFound("the report groups totals per client", USER)).toBe(false);
    expect(quoteFound("nothing may leave the user's machine", USER)).toBe(false);
    expect(quoteFound("Fix it", USER)).toBe(false);
    expect(quoteFound("by client", USER)).toBe(false);
  });

  it("need three content words and at most 300 characters, and never come from pasted code or quoted lines", () => {
    const said = [
      "yes, do it for me now please",
      "Use this:\n```ts\nconst storage = 'never send data to the cloud';\n```\n> nothing may leave the machine, says the old doc\nOk.",
      `${"a long pasted paragraph about the importer ".repeat(10)}`,
    ];
    expect(quoteFound("yes, do it for me now please", said)).toBe(false);
    expect(quoteFound("never send data to the cloud", said)).toBe(false);
    expect(quoteFound("nothing may leave the machine", said)).toBe(false);
    expect(quoteFound(said[2] ?? "", said)).toBe(false);
  });
});

describe("evidence a record points to", () => {
  it("earns human for a found quote and inference for one that is not found", () => {
    const context = { userTexts: USER, commands: [], workspace: workspace() };
    expect(checkEvidence({ type: "quote", ref: "group the totals by client, never by month" }, context)).toMatchObject({
      verified: true,
      source: "human",
    });
    expect(checkEvidence({ type: "quote", ref: "always group by month" }, context)).toMatchObject({
      verified: false,
      source: "inference",
    });
  });

  it("earns observed for a command this turn ran, with its result, and nothing for one it did not run", () => {
    const context = {
      userTexts: [],
      commands: [
        { command: "bun test", success: false },
        { command: "cd app; bun run gen", success: true },
      ],
      workspace: workspace(),
    };
    const gen = checkEvidence({ type: "command", ref: "`bun run gen`" }, context);
    expect(gen).toMatchObject({ verified: true, source: "observed", passed: true });
    expect(evidenceLine(gen)).toBe("command: `bun run gen` (passed)");
    expect(checkEvidence({ type: "command", ref: "bun test" }, context)).toMatchObject({ passed: false });
    expect(checkEvidence({ type: "command", ref: "npm run build" }, context)).toMatchObject({
      verified: false,
      source: "inference",
    });
  });

  it("checks that a file exists inside the workspace, but keeps the claim an inference", () => {
    const dir = workspace();
    const context = { userTexts: [], commands: [], workspace: dir };
    expect(checkEvidence({ type: "file", ref: "src/due.ts" }, context)).toMatchObject({
      verified: true,
      source: "inference",
    });
    expect(checkEvidence({ type: "file", ref: "src/missing.ts" }, context).verified).toBe(false);
    expect(checkEvidence({ type: "file", ref: "../outside.ts" }, context).verified).toBe(false);
    expect(evidenceLine(checkEvidence({ type: "file", ref: "src/missing.ts" }, context))).toBe(
      "file: src/missing.ts (not found)",
    );
  });

  it("treats a missing or unknown claim as no evidence", () => {
    const context = { userTexts: USER, commands: [], workspace: workspace() };
    expect(checkEvidence(undefined, context)).toMatchObject({ kind: "none", source: "inference" });
    expect(checkEvidence({ type: "vibes", ref: "trust me" }, context)).toMatchObject({ kind: "none" });
  });
});

describe("what must never become durable", () => {
  it("refuses claims about what is running right now", () => {
    expect(claimsLiveState("The development server is running and serving the game at http://localhost:8080.")).toBe(
      true,
    );
    expect(claimsLiveState("The API is currently listening on port 3000")).toBe(true);
    expect(claimsLiveState("El servidor está corriendo en el puerto 8080")).toBe(true);
    expect(claimsLiveState("Start the dev server with `bun run dev`; it serves on port 8080")).toBe(false);
  });

  it("refuses procedures that kill a process by its number or run a destructive command", () => {
    const dir = workspace();
    expect(unsafeProcedure("```powershell\nStop-Process -Id 7972 -Force\n```", dir)).toBe(
      "it kills a process by its number",
    );
    expect(unsafeProcedure("Run `taskkill /PID 1234 /F` first", dir)).toBe("it kills a process by its number");
    expect(unsafeProcedure("Reset with `git reset --hard origin/main`", dir)).toMatch(/destructive/u);
    expect(unsafeProcedure("Run `bun run gen` then `bun test`", dir)).toBeNull();
  });
});
