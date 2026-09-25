import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatTraceEvent,
  listTraces,
  newTraceEvents,
  readTrace,
  recordUiEvent,
  redact,
  startTurnTrace,
  traceDir,
} from "./session-trace";

const previous = { trace: process.env.SHELRA_TRACE, dir: process.env.SHELRA_TRACE_DIR };
const dirs: string[] = [];

afterEach(() => {
  if (previous.trace === undefined) delete process.env.SHELRA_TRACE;
  else process.env.SHELRA_TRACE = previous.trace;
  if (previous.dir === undefined) delete process.env.SHELRA_TRACE_DIR;
  else process.env.SHELRA_TRACE_DIR = previous.dir;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A verbose trace in a temp folder, as `SHELRA_TRACE=verbose SHELRA_TRACE_DIR=<dir>` sets it. */
function verboseHere(): string {
  const dir = mkdtempSync(join(tmpdir(), "shelra-trace-"));
  dirs.push(dir);
  process.env.SHELRA_TRACE = "verbose";
  process.env.SHELRA_TRACE_DIR = dir;
  return dir;
}

function traceHere(): string {
  const dir = mkdtempSync(join(tmpdir(), "shelra-trace-"));
  dirs.push(dir);
  process.env.SHELRA_TRACE = dir;
  return dir;
}

const call = (id: string, name: string, args: Record<string, unknown>) => ({
  id,
  type: "function" as const,
  function: { name, arguments: JSON.stringify(args) },
});

describe("session trace", () => {
  it("records a turn as it went: request, models, notices, tools, text and verdict", () => {
    const dir = traceHere();
    const trace = startTurnTrace({
      sessionId: "abc123",
      cwd: "/work/game",
      model: "openrouter/vendor/chosen",
      mode: "agent",
      request: "Build the game here.",
      outsideProject: false,
    });
    trace.chunk({ type: "model", modelId: "openrouter/vendor/chosen" });
    trace.chunk({
      type: "content",
      content:
        "\n\n[openrouter/vendor/chosen is not answering (no response within the time limit); continuing with openrouter/auto (paid).]\n\n",
    });
    trace.chunk({ type: "model", modelId: "openrouter/auto", servedModelId: "openrouter/vendor-x/picked" });
    trace.chunk({ type: "content", content: "Writing the game." });
    const write = call("t1", "write_file", { path: "index.html", content: "<canvas>" });
    trace.chunk({ type: "tool_calls", toolCalls: [write] });
    trace.chunk({ type: "tool_result", toolCall: write, toolResult: { success: true, output: "Created index.html" } });
    trace.chunk({ type: "content", content: "\n\n[Not verified — no check ran after the last change.]" });
    trace.end();

    const [file] = listTraces(dir);
    expect(file?.session).toBe("abc123");
    const events = readTrace(file?.path ?? "");
    expect(events.map((event) => event.kind)).toEqual([
      "turn",
      "model",
      "notice",
      "model",
      "text",
      "tool",
      "result",
      "notice",
      "end",
    ]);
    expect(events[0]).toMatchObject({ cwd: "/work/game", request: "Build the game here.", outsideProject: false });
    expect(events[3]).toMatchObject({ model: "openrouter/auto", served: "openrouter/vendor-x/picked" });
    expect(events.at(-1)).toMatchObject({
      tools: 1,
      failedTools: 0,
      verdict: "[Not verified — no check ran after the last change.]",
    });
    expect(formatTraceEvent(events[3] as never)).toContain("model   openrouter/auto → openrouter/vendor-x/picked");
    expect(formatTraceEvent(events[6] as never)).toContain("ok    write_file Created index.html");
  });

  it("ends a turn cancelled after its checks passed as cancelled, not checked (seen live 2026-09-25)", () => {
    const dir = traceHere();
    const trace = startTurnTrace({ sessionId: "cancel1", cwd: "/w", model: "m", mode: "agent", request: "Build it." });
    trace.chunk({ type: "content", content: "\n\n[Checked by Shelra on the final code: `bun test` passed]" });
    trace.chunk({ type: "content", content: "\n\n[Cancelled]" });
    trace.end();

    const events = readTrace(listTraces(dir)[0]?.path ?? "");
    expect(events.at(-1)).toMatchObject({ verdict: "[Cancelled]" });
  });

  it("records a verdict that lists its criteria over several lines as the turn's verdict (seen live 2026-09-25)", () => {
    const dir = traceHere();
    const trace = startTurnTrace({ sessionId: "multi1", cwd: "/w", model: "m", mode: "agent", request: "Build it." });
    trace.chunk({
      type: "content",
      content: "\n\n[Model connection interrupted (no response within the time limit); retrying in 2s.]\n\n",
    });
    trace.chunk({
      type: "content",
      content:
        "Done.\n\n[Not verified — No verification action was observed for 2 acceptance criteria after 3 automatic request(s). Run the relevant checks yourself.\n- AC1: Game renders (verify: run it)\n- AC2: Kart steers (verify: run it)]",
    });
    trace.end();

    const events = readTrace(listTraces(dir)[0]?.path ?? "");
    expect(events.at(-1)).toMatchObject({
      verdict: expect.stringMatching(
        /^\[Not verified — No verification action[\s\S]*- AC2: Kart steers \(verify: run it\)\]$/u,
      ),
    });
    expect(events.filter((event) => event.kind === "notice")).toHaveLength(2);
  });

  it("records what memory a turn was given and why (doc 18 §4.5)", () => {
    const dir = traceHere();
    const trace = startTurnTrace({ sessionId: "mem1", cwd: "/work", model: "m", mode: "agent", request: "fix login" });
    trace.observe(undefined).onMemoryRecall?.({
      rules: ["user-rule-never-touch-generated"],
      entries: [
        { slug: "login-flaky-test", tier: "knowledge", score: 0.61, reasons: ["terms: login, test", "observed 90%"] },
        { slug: "session-cookie", tier: "pointer", score: 0.2, reasons: ["terms: login"] },
      ],
      chars: 1_840,
      timestamp: Date.now(),
    });
    trace.end();

    const recall = readTrace(listTraces(dir)[0]?.path ?? "").find((event) => event.kind === "recall");
    expect(recall).toMatchObject({ rules: ["user-rule-never-touch-generated"], chars: 1_840 });
    expect(formatTraceEvent(recall as never)).toContain(
      "recall  1 rules · 1 entries · 1 listed · 1840 chars · login-flaky-test (terms: login, test)",
    );
  });

  it("never writes a key, and is off when SHELRA_TRACE=off", () => {
    const dir = traceHere();
    const trace = startTurnTrace({
      sessionId: "keys",
      cwd: "/w",
      model: "m",
      mode: "agent",
      request: "use sk-or-v1-0123456789abcdef0123456789abcdef and Bearer abcdefghijklmnopqrstuvwxyz",
    });
    trace.end();
    const text = JSON.stringify(readTrace(listTraces(dir)[0]?.path ?? ""));
    expect(text).not.toContain("0123456789abcdef0123456789abcdef");
    expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(redact("gsk_ABCDEFGHIJKLMNOPQRSTUV")).toBe("***");

    process.env.SHELRA_TRACE = "off";
    expect(traceDir()).toBeNull();
    const off = startTurnTrace({ sessionId: "off", cwd: "/w", model: "m", mode: "agent", request: "x" });
    off.chunk({ type: "content", content: "text" });
    off.end();
    expect(listTraces(dir).map((entry) => entry.session)).toEqual(["keys"]);
  });
});

describe("verbose session trace (SHELRA_TRACE=verbose)", () => {
  it("records the stream as it arrives, each step with its tokens, the stages, tool timings and memory", () => {
    const dir = verboseHere();
    const trace = startTurnTrace({ sessionId: "live", cwd: "/w", model: "m", mode: "agent", request: "Go." });
    const seen: string[] = [];
    const observer = trace.observe({ onStatus: (info) => seen.push(info.detail) });
    observer.onStatus?.({ stage: "model", detail: "Waiting for m", timestamp: 1 });
    observer.onStepStart?.({ stepNumber: 1, timestamp: 1 });
    trace.chunk({ type: "reasoning", content: "I should read the file first. ".repeat(20) });
    trace.chunk({ type: "content", content: "Reading it." });
    const read = call("r1", "read_file", { path: "a.ts" });
    observer.onToolStart?.({ toolCall: read, timestamp: 1 });
    trace.chunk({ type: "tool_calls", toolCalls: [read] });
    trace.chunk({ type: "tool_result", toolCall: read, toolResult: { success: true, output: "export {}" } });
    observer.onStepFinish?.({
      stepNumber: 1,
      timestamp: 2,
      finishReason: "tool-calls",
      usage: { inputTokens: 1200, outputTokens: 80 },
    });
    observer.onMemory?.({ qualified: false, reason: "nothing changed", written: [], decisions: [], timestamp: 3 });
    trace.end();

    expect(seen).toEqual(["Waiting for m"]);
    const events = readTrace(listTraces(dir)[0]?.path ?? "");
    expect(events.map((event) => event.kind)).toEqual([
      "turn",
      "status",
      "step",
      "thinking",
      "text",
      "tool",
      "result",
      "step",
      "memory",
      "end",
    ]);
    expect(events.find((event) => event.kind === "result")).toHaveProperty("durationMs");
    const finished = events.filter((event) => event.kind === "step").at(-1);
    expect(formatTraceEvent(finished as never)).toContain("step 1 done  tool-calls · 1200 in / 80 out");
  });

  it("records what the user does in the UI only in verbose traces", () => {
    const dir = verboseHere();
    recordUiEvent("ui-session", "mode", { to: "mixed" });
    process.env.SHELRA_TRACE = dir;
    delete process.env.SHELRA_TRACE_DIR;
    recordUiEvent("ui-session", "cancel", { key: "esc" });
    const events = readTrace(listTraces(dir)[0]?.path ?? "");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "ui", action: "mode", to: "mixed" });
    expect(formatTraceEvent(events[0] as never, false, true)).toContain("[ui-sessi] ");
  });

  it("watches every session, reading only what each appended, and waits for a line still being written", () => {
    const dir = verboseHere();
    const seen = new Map<string, number>();
    recordUiEvent("first", "mode", { to: "free" });
    expect(newTraceEvents(seen, dir).map((event) => event.session)).toEqual(["first"]);
    expect(newTraceEvents(seen, dir)).toEqual([]);
    recordUiEvent("second", "cancel", {});
    // Events from two files are ordered by time; two written in the same millisecond have no order to keep.
    const written = Date.now();
    while (Date.now() === written) {
      // wait for the next millisecond
    }
    recordUiEvent("first", "model", { model: "m2" });
    expect(newTraceEvents(seen, dir).map((event) => `${event.session}:${String(event.action)}`)).toEqual([
      "second:cancel",
      "first:model",
    ]);
    appendFileSync(join(dir, "first.jsonl"), '{"time":"2026-09-24T23:00:00.000Z","session":"first","kind":"ui"');
    expect(newTraceEvents(seen, dir)).toEqual([]);
    appendFileSync(join(dir, "first.jsonl"), ',"action":"late"}\n');
    expect(newTraceEvents(seen, dir).map((event) => event.action)).toEqual(["late"]);
  });
});
