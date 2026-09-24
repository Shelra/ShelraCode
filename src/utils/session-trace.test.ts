import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatTraceEvent, listTraces, readTrace, redact, startTurnTrace, traceDir } from "./session-trace";

const previous = process.env.SHELRA_TRACE;
const dirs: string[] = [];

afterEach(() => {
  if (previous === undefined) delete process.env.SHELRA_TRACE;
  else process.env.SHELRA_TRACE = previous;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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
