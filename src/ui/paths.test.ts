import { describe, expect, it } from "vitest";
import { compactCwd, projectName } from "./paths";

describe("compactCwd", () => {
  it("replaces the home directory with ~", () => {
    expect(compactCwd("C:\\Users\\dev\\code\\api", 40, "C:\\Users\\dev")).toBe("~\\code\\api");
  });

  it("drops the middle instead of wrapping, keeping the project folder", () => {
    const long =
      "C:\\Users\\Javie\\AppData\\Local\\Temp\\claude\\D--PROYECTS-shelra\\scratchpad\\cap\\fixture-fix-auth-120";
    const shown = compactCwd(long, 44, "C:\\Users\\Javie");
    expect(shown.length).toBeLessThanOrEqual(44);
    expect(shown.endsWith("fixture-fix-auth-120")).toBe(true);
    expect(shown).toContain("…");
  });

  it("uses the separator of the path it was given", () => {
    const shown = compactCwd("/home/dev/projects/acme/packages/api/src", 24, "/home/dev");
    expect(shown.length).toBeLessThanOrEqual(24);
    expect(shown).toContain("/…/");
  });

  it("leaves a short path alone", () => {
    expect(compactCwd("D:\\PROYECTS\\shelra", 40, "C:\\Users\\dev")).toBe("D:\\PROYECTS\\shelra");
  });
});

describe("projectName", () => {
  it("returns the last path segment", () => {
    expect(projectName("D:\\PROYECTS\\shelra\\")).toBe("shelra");
    expect(projectName("/home/dev/acme-api")).toBe("acme-api");
  });
});
