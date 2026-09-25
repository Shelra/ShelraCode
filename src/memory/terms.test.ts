import { describe, expect, it } from "vitest";
import { foldText, searchTerms } from "./terms";

describe("memory search terms (doc 18 R3)", () => {
  it("keeps Spanish words whole and folds their accents", () => {
    expect(foldText("configuración del módulo")).toBe("configuracion del modulo");
    expect(searchTerms("configuración del módulo")).toEqual(["config", "modulo"]);
  });

  it("brings a Spanish request and an English entry to the same terms", () => {
    expect(searchTerms("las pruebas de configuración fallan")).toEqual(["test", "config", "fail"]);
    expect(searchTerms("the configuration tests fail")).toEqual(["config", "test", "fail"]);
    expect(searchTerms("migrar la base de datos")).toEqual(["migration", "database"]);
    expect(searchTerms("database migrations")).toEqual(["database", "migration"]);
  });

  it("keeps paths, identifiers and versions whole", () => {
    expect(searchTerms("revisa src/api/users.ts")).toEqual(["review", "src/api/users.ts", "users.ts", "users"]);
    expect(searchTerms("load_config reads HOST")).toEqual(["load_config", "load", "config", "read", "host"]);
    expect(searchTerms("Node 20.11 only")).toContain("20.11");
  });

  it("folds plurals and verb forms the lexicon does not list, the same on both sides", () => {
    expect(searchTerms("invoices totals")).toEqual(searchTerms("invoice total"));
    expect(searchTerms("rendering")).toEqual(searchTerms("rendered"));
  });

  it("drops the words of a bare follow-up", () => {
    expect(searchTerms("sí, hazlo")).toEqual([]);
    expect(searchTerms("ok, do it now please")).toEqual([]);
  });
});
