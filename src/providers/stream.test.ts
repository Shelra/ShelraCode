import { describe, expect, it } from "vitest";
import { normalizeProviderEvents } from "./stream";

async function collect(stream: AsyncIterable<unknown>) {
  const events = [];
  for await (const event of normalizeProviderEvents(stream)) events.push(event);
  return events;
}

describe("provider stream boundary", () => {
  it("normalizes text, reasoning, tools, approval, errors, and aborts", async () => {
    const events = await collect(
      (async function* () {
        yield { type: "text-delta", text: "hello" };
        yield { type: "reasoning-delta", text: "thinking" };
        yield { type: "tool-call", toolCallId: "call-1", toolName: "read_file", input: { path: "a.ts" } };
        yield {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "read_file",
          input: { path: "a.ts" },
          output: { success: true, output: "ok" },
        };
        yield {
          type: "tool-approval-request",
          approvalId: "approval-1",
          toolCall: { toolCallId: "call-2", toolName: "paid_request", input: { url: "https://example.test" } },
        };
        yield { type: "error", error: new Error("provider failure") };
        yield { type: "abort" };
      })(),
    );

    expect(events).toEqual([
      { type: "text-delta", text: "hello" },
      { type: "reasoning-delta", text: "thinking" },
      {
        type: "tool-call",
        toolCall: {
          id: "call-1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"a.ts"}' },
        },
      },
      {
        type: "tool-result",
        toolCall: {
          id: "call-1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"a.ts"}' },
        },
        output: { success: true, output: "ok" },
      },
      {
        type: "tool-approval-request",
        approvalId: "approval-1",
        toolCall: {
          id: "call-2",
          type: "function",
          function: { name: "paid_request", arguments: '{"url":"https://example.test"}' },
        },
      },
      { type: "error", error: expect.any(Error) },
      { type: "abort" },
    ]);
  });

  it("ignores malformed envelopes without leaking provider objects", async () => {
    const events = await collect(
      (async function* () {
        yield null;
        yield { type: "unrecognized", providerPayload: { secret: "hidden" } };
        yield { type: "tool-call", toolCallId: "call-1", toolName: "bad", input: undefined };
      })(),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "tool-call",
      toolCall: { id: "call-1", type: "function", function: { name: "bad", arguments: "{}" } },
    });
    expect(JSON.stringify(events)).not.toContain("providerPayload");
  });
});
