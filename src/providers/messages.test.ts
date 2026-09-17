import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  coerceObjectsForStringParameters,
  normalizeModelMessages,
  normalizeToolInput,
  repairToolInput,
  repairXmlItemArguments,
} from "./messages";

describe("provider tool-message normalization", () => {
  it("converts a raw shell command into an object argument", () => {
    expect(normalizeToolInput("bash", 'ls -la "D:/workspace"')).toEqual({
      command: 'ls -la "D:/workspace"',
    });
    expect(repairToolInput("bash", 'ls -la "D:/workspace"')).toBe('{"command":"ls -la \\"D:/workspace\\""}');
  });

  it("parses a JSON object without double-encoding it", () => {
    const input = '{"path":"src/index.ts"}';
    expect(normalizeToolInput("read_file", input)).toEqual({ path: "src/index.ts" });
    expect(repairToolInput("read_file", input)).toBeNull();
  });

  it("coerces a JSON-encoded scalar to the tool's primary string field", () => {
    expect(normalizeToolInput("bash", '"pwd"')).toEqual({ command: "pwd" });
    expect(repairToolInput("bash", '"pwd"')).toBe('{"command":"pwd"}');
  });

  it("repairs malformed assistant history before the next provider request", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: "pwd",
          },
        ],
      },
    ] as ModelMessage[];

    expect(normalizeModelMessages(messages)).toEqual([
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { command: "pwd" },
          },
        ],
      },
    ]);
  });
});

describe("XML item argument repair", () => {
  it("rebuilds arrays and objects that an upstream flattened into <item> markup", () => {
    // Verbatim shape from a live generate_plan call served for qwen3-coder (2026-09-17).
    const input = {
      title: "Complete migrateState",
      requirements: "\n<item>Trim userName into profile.name</item>\n<item>Reject unsupported versions</item>\n",
      steps:
        "\n<item>\n<title>Update migrateState</title>\n<description>Handle theme migration</description>\n<satisfies>\n<item>AC1</item>\n<item>AC2</item>\n</satisfies>\n</item>\n",
    };

    expect(repairXmlItemArguments(input)).toEqual({
      title: "Complete migrateState",
      requirements: ["Trim userName into profile.name", "Reject unsupported versions"],
      steps: [{ title: "Update migrateState", description: "Handle theme migration", satisfies: ["AC1", "AC2"] }],
    });
    expect(repairToolInput("generate_plan", JSON.stringify(input))).toBe(JSON.stringify(repairXmlItemArguments(input)));
  });

  it("leaves ordinary strings, HTML-looking content, and valid objects alone", () => {
    expect(repairXmlItemArguments({ command: "echo <item>" })).toBeNull();
    expect(repairXmlItemArguments({ content: "<div>hello</div><div>again</div>" })).toBeNull();
    expect(repairXmlItemArguments({ requirements: ["a", "b"] })).toBeNull();
    expect(repairToolInput("read_file", '{"path":"src/index.ts"}')).toBeNull();
  });
});

describe("object-for-string argument coercion", () => {
  const schema = {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
      lines: { type: "array", items: { type: "string" } },
      options: { type: "object" },
    },
  };

  it("serializes a JSON value handed to a string parameter and leaves everything else alone", () => {
    const repaired = coerceObjectsForStringParameters(
      { path: "schema/model.json", content: { User: { id: "string" } }, lines: ["a"], options: { x: 1 } },
      schema,
    );
    expect(repaired).toEqual({
      path: "schema/model.json",
      content: JSON.stringify({ User: { id: "string" } }, null, 2),
      lines: ["a"],
      options: { x: 1 },
    });
  });

  it("returns null when nothing needs coercion or the schema is unknown", () => {
    expect(coerceObjectsForStringParameters({ path: "a", content: "text" }, schema)).toBeNull();
    expect(coerceObjectsForStringParameters({ content: { a: 1 } }, undefined)).toBeNull();
  });
});
