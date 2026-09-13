import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { normalizeModelMessages, normalizeToolInput, repairToolInput } from "./messages";

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
