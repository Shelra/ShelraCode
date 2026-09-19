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

  it("passes arrays through untouched", () => {
    expect(looseStringList(["a", "b"])).toEqual(["a", "b"]);
    expect(looseStringList(undefined)).toEqual([]);
    const criteria = [{ id: "AC1", description: "x" }, "y"];
    expect(looseCriteriaList(criteria)).toEqual(criteria);
  });
});
