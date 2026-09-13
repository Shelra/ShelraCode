import { describe, expect, it } from "vitest";
import { narrowCheckSpec, narrowCriteria, type RawCriterion } from "./prompts";

function raw(overrides: Partial<RawCriterion>): RawCriterion {
  return {
    id: "C1",
    description: "criterion",
    required: true,
    kind: "dom",
    ...overrides,
  };
}

describe("autonomy acceptance normalization", () => {
  it("turns pseudo-DOM console and external URL checks into host checks", () => {
    expect(
      narrowCheckSpec(raw({ description: "Loading must produce no console errors", selector: "console" })),
    ).toEqual({ kind: "no_console_errors" });
    expect(narrowCheckSpec(raw({ description: "No external URLs may be loaded", selector: "html, css, js" }))).toEqual({
      kind: "no_external_urls",
    });
  });

  it("turns responsive and live behavior descriptions into executable checks", () => {
    expect(
      narrowCheckSpec(
        raw({ description: "On a mobile viewport there must be no horizontal overflow", selector: "body" }),
      ),
    ).toEqual({ kind: "no_horizontal_overflow", viewport: "mobile" });

    const live = narrowCheckSpec(raw({ description: "The clock must update every second", selector: "#clock" }));
    expect(live).toMatchObject({ kind: "dom", assertion: { selector: "#clock", waitForChangeMs: 1_500 } });
  });

  it("represents CSS media rules and dark styling as browser expressions", () => {
    const media = narrowCheckSpec(
      raw({ description: "Include a media query for max-width: 600px", selector: "@media (max-width: 600px)" }),
    );
    expect(media).toMatchObject({ kind: "dom", assertion: { expression: expect.stringContaining("styleSheets") } });

    const dark = narrowCheckSpec(raw({ description: "The background color must be dark", selector: "body" }));
    expect(dark).toMatchObject({ kind: "dom", assertion: { expression: expect.stringContaining("backgroundColor") } });
  });

  it("does not confuse a viewport meta check with responsive overflow", () => {
    const viewport = narrowCheckSpec(
      raw({
        description: "The viewport meta tag enables responsive layout scaling",
        selector: "meta[name='viewport']",
      }),
    );
    expect(viewport).toMatchObject({ kind: "dom", assertion: { selector: "meta[name='viewport']" } });
  });

  it("makes model-invented display ids tolerant without weakening the behavior check", () => {
    const time = narrowCheckSpec(
      raw({
        description: "The time display initially shows HH:MM:SS",
        selector: "#clock-time",
      }),
    );
    expect(time).toMatchObject({
      kind: "dom",
      assertion: {
        selector: "#clock-time, #clock, #time, .clock, .time",
        expression: expect.stringContaining("querySelectorAll"),
        textContains: undefined,
      },
    });
  });

  it("checks dark CSS through the rendered result when a model emits a source pattern", () => {
    const dark = narrowCheckSpec(
      raw({
        kind: "file_contains",
        description: "styles.css defines a dark theme with a dark background",
        path: "styles.css",
        pattern: "background-color: #111",
      }),
    );
    expect(dark).toMatchObject({ kind: "dom", assertion: { selector: "body" } });
  });

  it("expands a model's directory-level file criterion into file checks", () => {
    const criteria = narrowCriteria([
      raw({
        kind: "file_exists",
        description: "The workspace must contain index.html, style.css, and script.js.",
        path: "C:\\workspace",
      }),
    ]);

    expect(criteria[0]?.check).toEqual({ kind: "files_exist", paths: ["index.html", "style.css", "script.js"] });
  });
});
