import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ModelMessage, type ToolCallOptions, tool } from "ai";
import { afterAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ProviderEvent } from "../providers/types";
import { type OperationRecord, type OperationStore, ToolOperationJournal } from "./tool-operations";

const workspace = mkdtempSync(join(tmpdir(), "shelra-operation-journal-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));
const schema = z.object({ value: z.number(), secret: z.string().optional() });
const opts = (id: string): ToolCallOptions => ({ toolCallId: id, messages: [] });
const ack = (id: string): ModelMessage[] => [
  {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: id, toolName: "effect", output: { type: "json", value: {} } }],
  },
];

function fixture(execute: (input: z.infer<typeof schema>) => unknown, store?: OperationStore) {
  const uncertain = vi.fn();
  const journal = new ToolOperationJournal({ scope: "main", cwd: () => workspace, store, onUncertain: uncertain });
  const guarded = journal.wrap({ effect: tool({ inputSchema: schema, execute: async (input) => execute(input) }) });
  const call = async (id: string, input = { value: 1 }) => {
    schema.parse(input);
    return guarded.effect.execute?.(input, opts(id));
  };
  return { journal, guarded, call, uncertain };
}

function memoryStore() {
  const rows = new Map<string, OperationRecord>();
  const store: OperationStore = {
    pending: (scope) => [...rows.values()].filter((row) => row.scope === scope).map((row) => ({ ...row })),
    start: (row) => {
      rows.set(row.id, { ...row });
    },
    finish: (row) => {
      rows.set(row.id, { ...row });
    },
    acknowledge: (id) => {
      rows.delete(id);
    },
  };
  return { rows, store };
}

describe("host operations that outlive a model step", () => {
  it.each(["one", "another"])("does not execute an orphan twice when the retry uses ID %s", async (nextId) => {
    const execute = vi.fn(() => ({ success: true, output: "accepted" }));
    const { journal, call } = fixture(execute);
    journal.beginRound();
    const original = await call("one");
    const messages = journal.recover([]);
    expect(messages).toHaveLength(2);
    expect(JSON.stringify(messages)).toContain("accepted");
    journal.beginRound();
    expect(await call(nextId)).toBe(original);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(journal.isReplay(nextId)).toBe(true);
  });

  it("permits an intentional repetition after a healthy acknowledged step", async () => {
    const execute = vi.fn(() => ({ success: true, output: "accepted" }));
    const { journal, call } = fixture(execute);
    await call("one");
    journal.acknowledge(ack("one"));
    expect(journal.recover(ack("one"))).toHaveLength(1);
    await call("two");
    expect(execute).toHaveBeenCalledTimes(2);
    expect(journal.isReplay("two")).toBe(false);
  });

  it("protects a transparent adapter retry even before the agent sees an interruption", async () => {
    const execute = vi.fn(() => ({ success: true, output: "accepted" }));
    const { call } = fixture(execute);
    await call("one");
    await call("regenerated-id");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("acknowledges actual SDK history before an intentional later invocation", async () => {
    const execute = vi.fn(() => ({ success: true, output: "accepted" }));
    const { guarded } = fixture(execute);
    await guarded.effect.execute?.(schema.parse({ value: 1 }), opts("one"));
    await guarded.effect.execute?.(schema.parse({ value: 1 }), { toolCallId: "two", messages: ack("one") });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("keeps distinct slots in an explicit tool batch and recovers each original result", async () => {
    let count = 0;
    const { guarded, journal } = fixture(() => ({ success: true, output: String(++count) }));
    const batch = (ids: string[]): ModelMessage[] => [
      {
        role: "assistant",
        content: ids.map((toolCallId) => ({
          type: "tool-call" as const,
          toolCallId,
          toolName: "effect",
          input: { value: 1 },
        })),
      },
    ];
    const first = ["one", "two"];
    for (const id of first)
      await guarded.effect.execute?.(schema.parse({ value: 1 }), { toolCallId: id, messages: batch(first) });
    expect(count).toBe(2);
    journal.recover([]);
    const retry = ["new-one", "new-two"];
    for (let index = 0; index < retry.length; index += 1) {
      expect(
        await guarded.effect.execute?.(schema.parse({ value: 1 }), {
          toolCallId: retry[index],
          messages: batch(retry),
        }),
      ).toMatchObject({ success: true, output: String(index + 1) });
    }
    expect(count).toBe(2);
  });

  it("keeps a post-effect throw uncertain even after the model acknowledges its refusal", async () => {
    let effects = 0;
    const { journal, call, uncertain } = fixture(() => {
      effects += 1;
      throw new Error("lost response");
    });
    await call("one");
    journal.recover([]);
    expect(await call("two")).toMatchObject({ success: false, refused: "blocked" });
    journal.acknowledge(ack("two"));
    await call("three");
    expect(effects).toBe(1);
    expect(uncertain).toHaveBeenCalled();
  });

  it("does not infer absence of effects from a failed result in an interrupted round", async () => {
    const execute = vi.fn(() => ({ success: false, output: "process exited 1 after sending" }));
    const { journal, call } = fixture(execute);
    await call("one");
    journal.recover([]);
    expect(await call("two")).toMatchObject({ success: false, output: expect.stringContaining("uncertain") });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not freeze an ordinary reported failure whose step was acknowledged", async () => {
    const execute = vi.fn(() => ({ success: false, output: "a failing test" }));
    const { journal, call } = fixture(execute);
    await call("one");
    journal.acknowledge(ack("one"));
    await call("two");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("allows distinct operations while a confirmed orphan is retained", async () => {
    const execute = vi.fn(() => ({ success: true, output: "accepted" }));
    const { journal, call } = fixture(execute);
    await call("one");
    journal.recover([]);
    await call("two", { value: 2 });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("preserves the exact MCP result in memory", async () => {
    const output = {
      content: [{ type: "image", data: "fixture", mimeType: "image/png" }],
      structuredContent: { id: 42 },
    };
    const { journal, call } = fixture(() => output);
    await call("one");
    const messages = journal.recover([]);
    expect(JSON.stringify(messages)).toContain('"structuredContent":{"id":42}');
    expect(await call("two")).toBe(output);
  });

  it("persists intention before calling and never puts input/output secrets in its record", async () => {
    const { rows, store } = memoryStore();
    const { guarded } = fixture(() => {
      expect([...rows.values()][0]?.state).toBe("started");
      return { success: true, output: "fixture-sensitive-result" };
    }, store);
    const input = schema.parse({ value: 1, secret: "fixture-sensitive-input" });
    await guarded.effect.execute?.(input, opts("one"));
    expect([...rows.values()][0]?.state).toBe("confirmed");
    expect(JSON.stringify([...rows.values()])).not.toContain("fixture-sensitive");
  });

  it("refuses execution when intention cannot be persisted", async () => {
    const execute = vi.fn();
    const { store } = memoryStore();
    store.start = () => {
      throw new Error("disk unavailable");
    };
    const { call, uncertain } = fixture(execute, store);
    expect(await call("one")).toMatchObject({ success: false, refused: "blocked" });
    expect(execute).not.toHaveBeenCalled();
    expect(uncertain).toHaveBeenCalled();
  });

  it("recovers a persisted started receipt as uncertain without executing again", async () => {
    const { rows, store } = memoryStore();
    const execute = vi.fn(() => ({ success: true, output: "accepted" }));
    const first = fixture(execute, store);
    await first.call("one");
    for (const row of rows.values()) row.state = "started";
    const second = fixture(execute, store);
    expect(await second.call("two")).toMatchObject({ success: false, output: expect.stringContaining("uncertain") });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not execute an in-flight operation again while recovering its stream", async () => {
    let finish: (output: unknown) => void = () => {};
    const execute = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { journal, call } = fixture(execute);
    const first = call("one");
    journal.recover([]);
    expect(await call("two")).toMatchObject({ success: false, refused: "blocked" });
    expect(execute).toHaveBeenCalledTimes(1);
    finish({ success: true, output: "accepted" });
    await first;
    expect(await call("three")).toMatchObject({ success: true, output: "accepted" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("surfaces a host result before a stream error and deduplicates SDK reports", async () => {
    const { journal, call } = fixture(() => ({ success: true, output: "accepted" }));
    const stream = (async function* (): AsyncGenerator<ProviderEvent> {
      await call("one");
      yield {
        type: "tool-result",
        toolCall: { id: "one", type: "function", function: { name: "effect", arguments: '{"value":1}' } },
        output: { success: true },
      };
      yield { type: "error", error: new Error("connection lost") };
    })();
    const events: ProviderEvent[] = [];
    for await (const event of journal.observe(stream)) events.push(event);
    expect(events.map((event) => event.type)).toEqual(["tool-call", "tool-result", "error"]);
    expect(events[1]).toMatchObject({ output: { success: true, output: "accepted" } });
  });

  it("surfaces the host result even when the stream iterator throws", async () => {
    const { journal, call } = fixture(() => ({ success: true, output: "accepted" }));
    const stream = (async function* (): AsyncGenerator<ProviderEvent> {
      await call("one");
      yield {
        type: "tool-call",
        toolCall: { id: "one", type: "function", function: { name: "effect", arguments: '{"value":1}' } },
      };
      throw new Error("lost iterator");
    })();
    const events: ProviderEvent[] = [];
    await expect(
      (async () => {
        for await (const event of journal.observe(stream)) events.push(event);
      })(),
    ).rejects.toThrow("lost iterator");
    expect(events.map((event) => event.type)).toEqual(["tool-call", "tool-result"]);
  });
});
