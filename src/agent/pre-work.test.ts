import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { failureQuery } from "../research/pre-task";
import { diagnosisChecks, diagnosisOutput, diagnosisReason, wantsDiagnosis } from "./pre-work";

describe("the project's state before the work (owner, 2026-09-25)", () => {
  it("is checked when the request asks to check, fix, continue or test, not for new work or an approval", () => {
    expect(
      wantsDiagnosis(
        "continuemos el proyecto verifica que todo funcione correcto, arregla lo necesario y deja el localhost activo",
      ),
    ).toBe(true);
    expect(wantsDiagnosis("The game crashes when I press Enter, fix it")).toBe(true);
    expect(wantsDiagnosis("Run the tests and make them pass")).toBe(true);
    expect(wantsDiagnosis("Create a snake game in one index.html")).toBe(false);
    expect(wantsDiagnosis("Add a dark mode toggle to the header")).toBe(false);
    expect(wantsDiagnosis("sí, continúa")).toBe(false);
    expect(wantsDiagnosis("hola")).toBe(false);
  });

  it("does not run the project's checks for a request that only reviews, explains or improves something", () => {
    // Everyday words of feature requests started minutes of test runs before the model had read anything.
    for (const request of [
      "vamos a revisar la seccion cuando en el comando abre modelos el filtro de busqueda entre proveedores",
      "revisa el componente de la barra lateral y proponme mejoras",
      "explain how the search works and check what the picker shows",
      "the test names in this file are unclear, improve the wording",
      "add a function that validates the email",
      "continue with the onboarding screen",
      "por que el agente usa tantas funciones de busqueda",
      "las pruebas de usuario salieron bien, resume los resultados",
      "error handling for the upload form: design it",
    ]) {
      expect(wantsDiagnosis(request), request).toBe(false);
    }
  });

  it("does run them when something is broken, when a repair is asked for, or when the checks are asked for", () => {
    for (const request of [
      "arregla el filtro de busqueda de modelos",
      "el build no compila, corrigelo",
      "fix the failing tests",
      "the picker is broken after the last change",
      "run the tests and tell me what fails",
      "corre los tests y dime que falla",
      "ejecuta todas las pruebas",
      "the app doesn't work when I press Enter",
      "debug the crash on startup",
      "continuemos el proyecto verifica que todo funcione correcto, arregla lo necesario y deja el localhost activo",
    ]) {
      expect(wantsDiagnosis(request), request).toBe(true);
    }
  });

  it("says which words of the request asked for it, so a check never starts without a reason", () => {
    expect(diagnosisReason("please fix the login page")).toBe("fix");
    expect(diagnosisReason("corre los tests ahora")).toBe("corre los tests");
    expect(diagnosisReason("revisa la seccion de modelos")).toBeNull();
    expect(diagnosisReason("hola")).toBeNull();
  });

  it("runs the cheap checks before the whole test suite", () => {
    const dir = mkdtempSync(join(tmpdir(), "shelra-prework-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run", lint: "biome check", typecheck: "tsc --noEmit" } }),
    );
    expect(diagnosisChecks(dir).map((check) => check.kind)).toEqual(["typecheck", "lint", "test"]);
  });

  it("reads a failing check as the model would read its own run", () => {
    const output = diagnosisOutput("npm run build", false, "src/tracks/beach.ts(100,22): error TS1005: ',' expected.");
    expect(output).toContain("[Shelra ran `npm run build` before the task began, on the project as you found it]");
    expect(output).toContain("It fails:");
    expect(output).toContain("TS1005");
    expect(diagnosisOutput("bun test", true, "3 pass")).toContain("It passes.");
  });

  it("searches the error a check reports, from its code on, with the program that printed it", () => {
    expect(
      failureQuery(
        "> kart@1.0.0 build\n> tsc && esbuild src/index.ts\n\nsrc/tracks/beach.ts(100,22): error TS1005: ',' expected.",
      ),
    ).toBe("tsc error TS1005: ',' expected.");
    expect(failureQuery("everything is fine")).toBeNull();
  });
});
