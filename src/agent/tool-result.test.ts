import { describe, expect, it } from "vitest";
import { toToolResult } from "./tool-result";

describe("provider tool result interpretation", () => {
  it("preserves MCP error status and the actual diagnostic", () => {
    expect(
      toToolResult({ isError: true, content: [{ type: "text", text: "Database connection refused" }] }),
    ).toMatchObject({ success: false, error: expect.stringContaining("connection refused") });
  });
  it("preserves valid structured data instead of reporting [object Object]", () => {
    expect(toToolResult({ count: 3, items: ["a", "b", "c"] })).toMatchObject({
      success: true,
      output: expect.stringContaining('"count":3'),
    });
  });
  it("does not interpret a malformed success field as a successful tool", () => {
    expect(toToolResult({ success: "false", output: "failed" }).success).toBe(false);
  });
});
