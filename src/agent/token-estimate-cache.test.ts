import type { ModelMessage } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateConversationTokens, estimateMessageTokens } from "./compaction";

const toolMessage = (id: number, size: number): ModelMessage => ({
  role: "tool",
  content: [
    {
      type: "tool-result",
      toolCallId: `call_${id}`,
      toolName: "read_file",
      output: { type: "json", value: { success: true, output: "x".repeat(size), id } },
    },
  ],
});

describe("message token estimates", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sizes a long conversation once, however often the meter redraws", () => {
    const messages = Array.from({ length: 200 }, (_, i) => toolMessage(i, 5_000));
    const stringify = vi.spyOn(JSON, "stringify");

    const first = estimateConversationTokens("system", messages);
    const serialised = stringify.mock.calls.length;
    expect(serialised).toBeGreaterThan(0);

    stringify.mockClear();
    for (let redraw = 0; redraw < 50; redraw += 1) {
      expect(estimateConversationTokens("system", messages)).toBe(first);
    }
    expect(stringify).not.toHaveBeenCalled();
  });

  it("counts only the new message when the conversation grows", () => {
    const messages = Array.from({ length: 50 }, (_, i) => toolMessage(i, 2_000));
    const before = estimateConversationTokens("s", messages);
    const added = toolMessage(999, 4_000);
    const after = estimateConversationTokens("s", [...messages, added]);
    expect(after).toBe(before + estimateMessageTokens(added));
  });

  it("sizes a message again when its content is replaced", () => {
    const original = toolMessage(1, 400);
    const small = estimateMessageTokens(original);
    const replaced = { ...original, content: toolMessage(1, 40_000).content } as ModelMessage;
    expect(estimateMessageTokens(replaced)).toBeGreaterThan(small);
    // The same object with a new content reference is a different message to the estimate.
    const mutated = toolMessage(2, 400);
    const before = estimateMessageTokens(mutated);
    (mutated as { content: unknown }).content = toolMessage(2, 40_000).content;
    expect(estimateMessageTokens(mutated)).toBeGreaterThan(before);
  });

  it("includes the system prompt and the text being streamed, which change between redraws", () => {
    const messages = [toolMessage(1, 400)];
    const base = estimateConversationTokens("abcd".repeat(100), messages);
    expect(estimateConversationTokens("abcd".repeat(100), messages, "x".repeat(400))).toBe(base + 100);
  });
});
