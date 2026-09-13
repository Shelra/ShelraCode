import { describe, expect, it } from "vitest";
import { FakeProvider } from "./fake";

describe("FakeProvider", () => {
  it("produces deterministic normalized events without network access", async () => {
    const provider = new FakeProvider("hello");
    const stream = provider.stream({ modelId: "test", system: "", messages: [], tools: {}, maxSteps: 1 });
    const events = [];
    for await (const event of stream.events) events.push(event);
    expect(events).toEqual([{ type: "text-delta", text: "hello" }]);
    await expect(stream.response).resolves.toEqual({
      messages: [{ role: "assistant", content: "hello" }],
    });
  });
});
