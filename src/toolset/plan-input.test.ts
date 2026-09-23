import { describe, expect, it } from "vitest";
import { looseCriteriaList, looseStepList, looseStringList, parseLooseItems } from "./plan-input";

describe("loose plan list inputs", () => {
  it("parses <item> markup with ids, as qwen3-coder sends it", () => {
    const value =
      '<item id="AC1">The slugify function trims whitespace</item>\n<item id="AC2">It lowercases ASCII letters</item>';
    expect(parseLooseItems(value)).toEqual([
      { id: "AC1", text: "The slugify function trims whitespace" },
      { id: "AC2", text: "It lowercases ASCII letters" },
    ]);
    expect(looseCriteriaList(value)).toEqual([
      { id: "AC1", description: "The slugify function trims whitespace" },
      { id: "AC2", description: "It lowercases ASCII letters" },
    ]);
  });

  it("splits plain lines and strips bullets and numbering", () => {
    expect(looseStringList("- trim whitespace\n2. lowercase\n\nAC3: preserve digits")).toEqual([
      "trim whitespace",
      "lowercase",
      "preserve digits",
    ]);
    expect(looseStepList("Implement it\nRun the tests")).toEqual(["Implement it", "Run the tests"]);
  });

  it("reads a JSON array sent as a string, as openrouter/free sent it", () => {
    // Live 2026-09-23: the whole array became one criterion, "AC1: [{"description": ...".
    const criteria = JSON.stringify([
      { description: "Market size documented with sources", id: "AC1", verification: "Research file cites them" },
      { description: "Architecture and debt register", id: "AC2" },
      "Every claim checked against the code",
    ]);
    expect(looseCriteriaList(criteria)).toEqual([
      { id: "AC1", description: "Market size documented with sources", verification: "Research file cites them" },
      { id: "AC2", description: "Architecture and debt register" },
      "Every claim checked against the code",
    ]);
    expect(looseStepList(JSON.stringify([{ title: "Read the code", satisfies: ["AC2"] }, "Write the report"]))).toEqual(
      [{ title: "Read the code", satisfies: ["AC2"] }, "Write the report"],
    );
    expect(looseStringList('["trim whitespace", "lowercase"]')).toEqual(["trim whitespace", "lowercase"]);
    // Brackets that are not JSON stay lines.
    expect(looseStringList("[R1] trim whitespace\n[R2] lowercase")).toEqual(["[R1] trim whitespace", "[R2] lowercase"]);
  });

  it("passes arrays through untouched", () => {
    expect(looseStringList(["a", "b"])).toEqual(["a", "b"]);
    expect(looseStringList(undefined)).toEqual([]);
    const criteria = [{ id: "AC1", description: "x" }, "y"];
    expect(looseCriteriaList(criteria)).toEqual(criteria);
  });
});
