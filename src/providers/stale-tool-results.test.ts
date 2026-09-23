import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { clearStaleToolResults, type ToolResultClearing } from "./stale-tool-results";

function step(id: string, toolName: string, size: number): ModelMessage[] {
  return [
    {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: id, toolName, input: { path: `${id}.ts` } }],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: id,
          toolName,
          output: { type: "json", value: { success: true, output: "x".repeat(size) } },
        },
      ],
    },
  ];
}

function history(steps: Array<[string, number]>): ModelMessage[] {
  return [
    { role: "user", content: "Audit the project" },
    ...steps.flatMap(([toolName, size], index) => step(`call-${index + 1}`, toolName, size)),
  ];
}

/** The text the model receives for each tool result, in order. */
function resultTexts(messages: readonly ModelMessage[]): string[] {
  return messages.flatMap((message) =>
    message.role === "tool"
      ? message.content.flatMap((part) =>
          part.type === "tool-result" ? [part.output.type === "text" ? part.output.value : "whole"] : [],
        )
      : [],
  );
}

describe("clearing stale tool results", () => {
  it("sends a short history unchanged", () => {
    const messages = history([
      ["read_file", 20_000],
      ["read_file", 20_000],
      ["read_file", 20_000],
      ["read_file", 20_000],
    ]);
    const state: ToolResultClearing = { boundary: 0 };
    expect(clearStaleToolResults(messages, state)).toBe(messages);
    expect(state.boundary).toBe(0);
  });

  it("clears results older than the model's last three steps once the history is long", () => {
    const messages = history(Array.from({ length: 8 }, (): [string, number] => ["read_file", 30_000]));
    const sent = clearStaleToolResults(messages, { boundary: 0 });

    const texts = resultTexts(sent);
    expect(texts.slice(5)).toEqual(["whole", "whole", "whole"]);
    for (const text of texts.slice(0, 5)) {
      expect(text).toContain("Cleared from this request");
      expect(text).toContain("read_file returned about 30K characters");
    }
    // The calls stay, so the model still knows what it asked for, and each result keeps its call id.
    expect(sent.filter((message) => message.role === "assistant")).toEqual(
      messages.filter((message) => message.role === "assistant"),
    );
    const ids = sent.flatMap((message) =>
      message.role === "tool"
        ? message.content.map((part) => (part.type === "tool-result" ? part.toolCallId : ""))
        : [],
    );
    expect(ids).toEqual(Array.from({ length: 8 }, (_, index) => `call-${index + 1}`));
    // The session's own history is not touched.
    expect(resultTexts(messages).every((text) => text === "whole")).toBe(true);
  });

  it("never clears the plan, a sub-agent's findings or a small result", () => {
    const messages = history([
      ["generate_plan", 30_000],
      ["task", 30_000],
      ["bash", 800],
      ["read_file", 30_000],
      ["read_file", 30_000],
      ["read_file", 30_000],
      ["read_file", 30_000],
      ["read_file", 30_000],
      ["read_file", 30_000],
    ]);
    const texts = resultTexts(clearStaleToolResults(messages, { boundary: 0 }));
    expect(texts.slice(0, 3)).toEqual(["whole", "whole", "whole"]);
    expect(texts.slice(3, 6).every((text) => text.includes("Cleared from this request"))).toBe(true);
    expect(texts.slice(6)).toEqual(["whole", "whole", "whole"]);
  });

  it("keeps what the model has not seen yet, however long the history", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Read everything" },
      {
        role: "assistant",
        content: Array.from({ length: 8 }, (_, index) => ({
          type: "tool-call" as const,
          toolCallId: `read-${index}`,
          toolName: "read_file",
          input: { path: `${index}.ts` },
        })),
      },
      {
        role: "tool",
        content: Array.from({ length: 8 }, (_, index) => ({
          type: "tool-result" as const,
          toolCallId: `read-${index}`,
          toolName: "read_file",
          output: { type: "text" as const, value: "y".repeat(30_000) },
        })),
      },
    ];
    expect(clearStaleToolResults(messages, { boundary: 0 })).toBe(messages);
  });

  it("sends the messages unchanged when it cannot measure them", () => {
    const messages = history(Array.from({ length: 8 }, (): [string, number] => ["read_file", 30_000]));
    const odd: ModelMessage = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-odd",
          toolName: "read_file",
          output: { type: "json", value: { size: 10n } as never },
        },
      ],
    };
    const withOdd = [...messages.slice(0, 3), odd, ...messages.slice(3)];
    expect(clearStaleToolResults(withOdd, { boundary: 0 })).toBe(withOdd);
  });

  it("keeps the cleared part of the request stable until enough new text builds up", () => {
    const state: ToolResultClearing = { boundary: 0 };
    const sizes = [50_000, 50_000, 50_000, 50_000, 50_000, 30_000, 50_000, 50_000];
    const messages = history(sizes.map((size): [string, number] => ["read_file", size]));
    const first = clearStaleToolResults(messages, state);
    const boundary = state.boundary;
    expect(boundary).toBeGreaterThan(0);

    // One more step keeps the request long, but the step that leaves the recent window holds 30K,
    // less than a clearing's minimum: clearing it would move the cached prefix for little.
    const next = clearStaleToolResults([...messages, ...step("call-9", "read_file", 50_000)], state);
    expect(state.boundary).toBe(boundary);
    expect(next.slice(0, boundary)).toEqual(first.slice(0, boundary));
    expect(resultTexts(next).slice(5)).toEqual(["whole", "whole", "whole", "whole"]);
  });
});
