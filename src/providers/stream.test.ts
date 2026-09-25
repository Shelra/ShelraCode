import { describe, expect, it } from "vitest";
import {
  createStallDetector,
  isProviderStreamIdleError,
  isRepeatingToolLoop,
  normalizeProviderEvents,
  STALL_WINDOW,
  withIdleWatchdog,
} from "./stream";

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

describe("idle watchdog", () => {
  it("cuts a silent stream after the idle budget and emits one error part", async () => {
    const controller = new AbortController();
    async function* silent() {
      yield { type: "text-delta", text: "hi" };
      await new Promise(() => undefined);
    }
    const parts: unknown[] = [];
    for await (const part of withIdleWatchdog(silent(), 30, controller)) parts.push(part);
    expect(parts).toHaveLength(2);
    expect((parts[1] as { type: string }).type).toBe("error");
    expect(isProviderStreamIdleError((parts[1] as { error: unknown }).error)).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });

  it("passes a live stream through untouched", async () => {
    const controller = new AbortController();
    async function* live() {
      yield 1;
      yield 2;
    }
    const parts: unknown[] = [];
    for await (const part of withIdleWatchdog(live(), 30, controller)) parts.push(part);
    expect(parts).toEqual([1, 2]);
    expect(controller.signal.aborted).toBe(false);
  });

  it("is a passthrough when the budget is zero", async () => {
    const controller = new AbortController();
    async function* live() {
      yield "only";
    }
    const parts: unknown[] = [];
    for await (const part of withIdleWatchdog(live(), 0, controller)) parts.push(part);
    expect(parts).toEqual(["only"]);
  });
});

describe("repeating tool loop", () => {
  const step = (name: string, input: unknown, output: unknown) => ({
    toolCalls: [{ toolName: name, input }],
    toolResults: [{ output }],
  });

  it("stops six consecutive steps that only repeat earlier calls with identical results", () => {
    const work = [
      step("read_file", { path: "src/slug.ts" }, "stub"),
      step("write_file", { path: "src/slug.ts", content: "impl" }, "ok"),
      step("bash", { command: "bun test" }, "1 pass"),
      step("bash", { command: "ls" }, "slug.ts"),
    ];
    const churn = Array.from({ length: 6 }, (_, index) =>
      index % 2 === 0 ? step("bash", { command: "bun test" }, "1 pass") : step("bash", { command: "ls" }, "slug.ts"),
    );
    expect(isRepeatingToolLoop([...work, ...churn.slice(0, 5)])).toBe(false);
    expect(isRepeatingToolLoop([...work, ...churn])).toBe(true);
  });

  it("never stops steps that call something new or see a new result", () => {
    const steps = [
      step("bash", { command: "bun test" }, "1 fail"),
      ...Array.from({ length: 6 }, (_, index) => step("bash", { command: "bun test" }, `attempt ${index}`)),
    ];
    expect(isRepeatingToolLoop(steps)).toBe(false);
    const withNewCall = [
      ...Array.from({ length: 7 }, () => step("bash", { command: "bun test" }, "1 pass")),
      step("edit_file", { path: "a" }, "ok"),
    ];
    expect(isRepeatingToolLoop(withNewCall.slice(0, 7))).toBe(true);
    expect(isRepeatingToolLoop(withNewCall)).toBe(false);
  });

  it("ignores text-only steps", () => {
    const steps = Array.from({ length: 8 }, () => ({ toolCalls: [], toolResults: [] }));
    expect(isRepeatingToolLoop(steps)).toBe(false);
  });
});

describe("stalled generation", () => {
  const step = (name: string, input: unknown, output: unknown) => ({
    toolCalls: [{ toolName: name, input }],
    toolResults: [{ output }],
  });
  const line = "check('shrink + invincibility', hurtOk ? +hurtOk.invincible.toFixed(2) : null);";
  /** The first step reads the line; each later one prints another piece of it, as a different command. */
  const slices = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      step(
        "bash",
        { command: `node -e "slice(${index * 7}, ${index * 7 + 9})"` },
        { success: true, output: line.slice(index * 7, index * 7 + 9) },
      ),
    );

  it(`stops after ${STALL_WINDOW} steps that only looked and found nothing new`, () => {
    const steps = [step("read_file", { path: "audit.cjs" }, line), ...slices(STALL_WINDOW)];
    expect(createStallDetector()(steps.slice(0, STALL_WINDOW))).toBe(false);
    expect(createStallDetector()(steps)).toBe(true);
    // The repeat check sees a different call every time.
    expect(isRepeatingToolLoop(steps)).toBe(false);
  });

  it("keeps state between calls, as the SDK asks once per step", () => {
    const steps = [step("read_file", { path: "audit.cjs" }, line), ...slices(STALL_WINDOW)];
    const detect = createStallDetector();
    const verdicts = steps.map((_, index) => detect(steps.slice(0, index + 1)));
    expect(verdicts.indexOf(true)).toBe(STALL_WINDOW);
  });

  it("never stops across a step that changed something", () => {
    const steps = [
      step("read_file", { path: "audit.cjs" }, line),
      ...slices(STALL_WINDOW - 1),
      step("edit_file", { path: "audit.cjs" }, { success: true, output: "Edited audit.cjs (+1 -1)" }),
      ...slices(STALL_WINDOW - 1),
    ];
    expect(createStallDetector()(steps)).toBe(false);
  });

  it("counts a result with a word it had not seen as progress, and a changed number or its own label as nothing new", () => {
    const run = (output: string) => step("bash", { command: "bun test --label 'suite progress'" }, output);
    const numbersOnly = [
      run("12 failed, 3 passed"),
      ...Array.from({ length: STALL_WINDOW }, (_, index) => run(`${11 - index} failed suite progress in ${index}ms`)),
    ];
    expect(createStallDetector()(numbersOnly)).toBe(true);
    const newWord = [...numbersOnly.slice(0, -1), run("TypeError: cannot read invincible of undefined")];
    expect(createStallDetector()(newWord)).toBe(false);
  });

  it("ignores text-only steps and never counts tools outside the observing set as looking", () => {
    const plans = Array.from({ length: STALL_WINDOW + 2 }, () => step("update_plan_step", { index: 0 }, "ok"));
    expect(createStallDetector()(plans)).toBe(false);
    const talk = Array.from({ length: STALL_WINDOW + 2 }, () => ({ toolCalls: [], toolResults: [] }));
    expect(createStallDetector()(talk)).toBe(false);
  });
});

describe("tool errors", () => {
  it("turns a tool that threw into a failed result instead of a call that never finishes", async () => {
    async function* raw() {
      yield {
        type: "tool-error",
        toolCallId: "call-9",
        toolName: "grep",
        input: {},
        error: new Error("spawn rg ENOENT"),
      };
    }
    const events: unknown[] = [];
    for await (const event of normalizeProviderEvents(raw())) events.push(event);
    expect(events).toEqual([
      {
        type: "tool-result",
        toolCall: { id: "call-9", type: "function", function: { name: "grep", arguments: "{}" } },
        output: { success: false, output: "grep failed: spawn rg ENOENT", error: "grep failed: spawn rg ENOENT" },
      },
    ]);
  });
});

describe("a tool call being written (seen live 2026-09-25)", () => {
  it("reports which file the model is writing and how much has arrived, every 2 KB, not per fragment", async () => {
    async function* raw() {
      yield { type: "tool-input-start", id: "call-1", toolName: "write_file" };
      yield { type: "tool-input-delta", id: "call-1", delta: '{"path":"index.html","content":"' };
      for (let index = 0; index < 50; index += 1)
        yield { type: "tool-input-delta", id: "call-1", delta: "x".repeat(100) };
      yield { type: "tool-input-end", id: "call-1" };
    }
    const events: unknown[] = [];
    for await (const event of normalizeProviderEvents(raw())) events.push(event);
    expect(events[0]).toEqual({ type: "tool-input", id: "call-1", toolName: "write_file", chars: 0 });
    expect(events.slice(1)).toEqual([
      { type: "tool-input", id: "call-1", toolName: "write_file", path: "index.html", chars: 2_132 },
      { type: "tool-input", id: "call-1", toolName: "write_file", path: "index.html", chars: 4_232 },
    ]);
  });
});
