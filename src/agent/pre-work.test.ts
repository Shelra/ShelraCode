import { describe, expect, it } from "vitest";
import { failureQuery } from "../research/pre-task";
import { diagnosisOutput, wantsDiagnosis } from "./pre-work";

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
