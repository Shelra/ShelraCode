import { describe, expect, it } from "vitest";
import { formatDecisionsForPrompt } from "./prompt";
import type { Decision } from "./types";

function decision(index: number, overrides: Partial<Decision> = {}): Decision {
  const id = `D-${String(index).padStart(4, "0")}`;
  return {
    id,
    title: `Decision number ${index} about module ${index}`,
    status: "active",
    source: "user",
    rule: `Module ${index} follows rule ${index}.`,
    why: `Reason ${index}`,
    scope: [],
    proposed: "2026-03-01",
    approved: "2026-03-01",
    file: `docs/decisions/${String(index).padStart(4, "0")}-x.md`,
    ...overrides,
  };
}

describe("the decisions section of the prompt", () => {
  it("lists the newest decisions when there are more than fit, not the oldest (doc 20, TEST P4)", () => {
    const text = formatDecisionsForPrompt(Array.from({ length: 40 }, (_, index) => decision(index + 1)));
    const listed = [...text.matchAll(/^- (D-\d{4})/gmu)].map((match) => match[1]);
    expect(listed).toHaveLength(30);
    expect(listed[0]).toBe("D-0040");
    expect(listed).not.toContain("D-0001");
    expect(text).toContain("… and 10 more in docs/decisions.");
  });

  it("puts the decisions a request is about first, with why they were taken", () => {
    const storage = decision(2, {
      title: "Storage uses DuckDB",
      rule: "All ledger data is stored in DuckDB.",
      why: "The tax summary over ten years needs columnar queries.",
    });
    const text = formatDecisionsForPrompt([decision(1), storage, decision(3)], {
      request: "Why did we choose DuckDB for storage?",
    });
    const lines = text.split("\n");
    expect(lines[1]).toBe(
      "- D-0002 Storage uses DuckDB: All ledger data is stored in DuckDB. Why: The tax summary over ten years needs columnar queries.",
    );
    expect(text).not.toContain("Reason 1");
  });

  it("names the decisions that were replaced, so an obsolete one is not followed", () => {
    const old = decision(1, { title: "Storage uses SQLite", status: "superseded", supersededBy: "D-0002" });
    const current = decision(2, { title: "Storage uses DuckDB", supersedes: "D-0001" });
    const text = formatDecisionsForPrompt([old, current]);
    expect(text).toContain("No longer in force (replaced; do not follow them");
    expect(text).toContain('D-0001 "Storage uses SQLite" → replaced by D-0002');
    expect(text).not.toMatch(/^- D-0001/mu);
  });

  it("keeps why a replaced decision had been taken when the request is about it (doc 21 §9.3, K6)", () => {
    const old = decision(1, {
      title: "Storage uses SQLite",
      rule: "Ledger data is stored in SQLite.",
      status: "superseded",
      supersededBy: "D-0002",
      why: "JSON files had to be loaded whole. Rejected: Postgres (needs a server, breaks offline use).",
    });
    const current = decision(2, { title: "Storage uses DuckDB", supersedes: "D-0001" });
    expect(
      formatDecisionsForPrompt([old, current], {
        request: "Which storage engine does it use now, why, and what did it use before?",
      }),
    ).toContain(
      'D-0001 "Storage uses SQLite" → replaced by D-0002 (it had been taken because: JSON files had to be loaded whole. Rejected: Postgres (needs a server, breaks offline use).)',
    );
    expect(formatDecisionsForPrompt([old, current], { request: "Add a CSV export." })).not.toContain("Postgres");
  });

  it("is empty for a project with no decisions", () => {
    expect(formatDecisionsForPrompt([])).toBe("");
  });
});
