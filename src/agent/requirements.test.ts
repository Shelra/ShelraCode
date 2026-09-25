import { describe, expect, it } from "vitest";
import { countStatedBehaviors, extractRequirements, isRequirementDense } from "./requirements";

describe("requirement extraction", () => {
  it("lists obligation-shaped sentences and skips process instructions", () => {
    const prompt =
      "Repair and complete migrateState in src/state.ts. Migrate version 1 state to version 2: trim userName into profile.name, move a valid theme into preferences.theme, use system for an absent or invalid theme, and preserve unrelated root metadata. Version 2 input must be returned as a deep-equal new value without mutation. Reject unsupported versions with an error. Do not modify tests. Run bun test before completing.";
    const requirements = extractRequirements(prompt);
    expect(requirements).toEqual([
      "Repair and complete migrateState in src/state.ts.",
      "Migrate version 1 state to version 2: trim userName into profile.name, move a valid theme into preferences.theme, use system for an absent or invalid theme, and preserve unrelated root metadata.",
      "Version 2 input must be returned as a deep-equal new value without mutation.",
      "Reject unsupported versions with an error.",
    ]);
    expect(isRequirementDense(prompt)).toBe(true);
  });

  it("counts enumerated behaviors inside one sentence", () => {
    const single =
      "The class must accept an injected clock, expire entries when now is greater than or equal to the expiry timestamp, make get and has remove stale entries, treat ttl 0 as immediately expired, allow overwriting a key with a new TTL, and keep delete idempotent.";
    expect(extractRequirements(single)).toHaveLength(1);
    expect(countStatedBehaviors(extractRequirements(single))).toBe(6);
    expect(isRequirementDense(single)).toBe(true);
  });

  it("treats a short single-behavior request as not dense", () => {
    expect(extractRequirements("Fix the typo in README.md.")).toEqual([]);
    expect(isRequirementDense("Rename foo to bar everywhere. Run the tests.")).toBe(false);
    expect(isRequirementDense("The parser must reject empty input.")).toBe(false);
  });

  it("reads Spanish requests too (audit 2026-09-23: this one used to extract nothing)", () => {
    const prompt =
      "Implementa slugify en src/slug.ts. Debe eliminar los espacios al inicio y al final, pasar las letras a minúsculas, reemplazar cada grupo de caracteres no alfanuméricos por un guion y quitar los guiones del principio y del final. No modifiques los tests. Ejecuta bun test antes de terminar.";
    const requirements = extractRequirements(prompt);
    expect(requirements).toEqual([
      "Implementa slugify en src/slug.ts.",
      "Debe eliminar los espacios al inicio y al final, pasar las letras a minúsculas, reemplazar cada grupo de caracteres no alfanuméricos por un guion y quitar los guiones del principio y del final.",
    ]);
    expect(countStatedBehaviors([requirements[1] as string])).toBe(4);
    expect(isRequirementDense(prompt)).toBe(true);
  });

  it("does not take Spanish working instructions for requirements", () => {
    expect(extractRequirements("Ejecuta los tests antes de terminar. No modifiques el README.")).toEqual([]);
    expect(isRequirementDense("El parser debe rechazar la entrada vacía.")).toBe(false);
  });

  it("caps and deduplicates", () => {
    const sentence = "The parser must reject empty input. ";
    expect(extractRequirements(sentence.repeat(5))).toHaveLength(1);
    const many = Array.from({ length: 50 }, (_, index) => `Rule ${index} must hold for input ${index}.`).join(" ");
    expect(extractRequirements(many)).toHaveLength(40);
  });

  it("reads each item of a listed feature set as a requirement, with the line that introduces it (seen live 2026-09-25)", () => {
    const request = [
      "Create a Mario Kart style 3D racing game in the browser with Three.js.",
      "Include:",
      "- Drifting",
      "- Item boxes",
      "* A lap counter",
      "1. Three tracks",
      "",
      "Controls must use the arrow keys, and Space must jump.",
      "Features:",
      "- Pause with Escape",
      "- run npm install first",
    ].join("\n");

    expect(extractRequirements(request)).toEqual([
      "Include: Drifting",
      "Include: Item boxes",
      "Include: A lap counter",
      "Include: Three tracks",
      "Controls must use the arrow keys, and Space must jump.",
      "Features: Pause with Escape",
    ]);
    expect(isRequirementDense(request)).toBe(true);
  });

  it("splits a very long statement at its commas instead of dropping it", () => {
    const features = Array.from({ length: 30 }, (_, index) => `feature number ${index} with its own behavior`).join(
      ", ",
    );
    const requirements = extractRequirements(`The game must include ${features}.`);
    expect(requirements.length).toBeGreaterThan(3);
    expect(requirements.every((requirement) => requirement.length <= 400)).toBe(true);
    expect(requirements.join(" ")).toContain("feature number 29");
  });
});
