import { describe, expect, it } from "vitest";
import { foldText, isFollowUp, previousRequestWeight, searchTerms } from "./terms";

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

  it("does not fold everyday words onto coding terms, and meets singular with plural (review round 2)", () => {
    expect(searchTerms("no estoy seguro de que funcione")).not.toContain("security");
    expect(searchTerms("ayúdame con la programación del módulo de pagos")).not.toContain("schedule");
    expect(searchTerms("sobre el tema de la autenticación")).not.toContain("theme");
    expect(searchTerms("página de registro de usuarios")).not.toContain("log");
    expect(searchTerms("reporte de ingresos mensuales")).not.toContain("login");
    expect(searchTerms("rerun the failing tests")).not.toContain("backfill");
    expect(searchTerms("news feed")).toContain("news");
    for (const [one, many] of [
      ["warning", "warnings"],
      ["mapping", "mappings"],
      ["alias", "aliases"],
      ["commit", "committing"],
    ]) {
      expect(searchTerms(many), many).toEqual(searchTerms(one ?? ""));
    }
  });

  it("carries the previous request for a follow-up, part of it for a qualified one, none for a new request", () => {
    expect(previousRequestWeight("sí, hazlo")).toBe(0.8);
    expect(previousRequestWeight("go ahead and fix it")).toBe(0.8);
    expect(previousRequestWeight("ok, now in prod")).toBe(0.4);
    expect(previousRequestWeight("rebuild it from scratch then")).toBe(0.4);
    expect(previousRequestWeight("fix the login bug")).toBe(0);
    expect(previousRequestWeight("run the tests")).toBe(0);
    expect(isFollowUp("dale, sigue")).toBe(true);
  });

  it("drops the words of a bare follow-up", () => {
    expect(searchTerms("sí, hazlo")).toEqual([]);
    expect(searchTerms("ok, do it now please")).toEqual([]);
  });
});
