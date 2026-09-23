import { testRender } from "@opentui/react/test-utils";
import { act, useState } from "react";
import { describe, expect, it } from "vitest";
import { usePacedText } from "./reveal";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Each test streams its own words, so one test's progress can never pass for another's. */
const words = (word: string, count: number) => `${word} `.repeat(count);

describe("usePacedText", () => {
  it("keeps revealing while a model streams faster than a tick", async () => {
    let push = (_text: string) => {};
    let shown = 0;
    function Live() {
      const [target, setTarget] = useState("");
      push = setTarget;
      shown = usePacedText(target, { reduced: false, live: true }).length;
      return <text>{`shown ${shown}`}</text>;
    }
    const screen = await testRender(<Live />, { width: 40, height: 3 });
    const text = words("fast", 120);
    // A delta every 15 ms, half a tick: the timer used to restart on each one and never fire.
    for (let i = 1; i <= 40; i++) {
      await act(async () => push(text.slice(0, i * 10)));
      await sleep(15);
    }
    const whileStreaming = shown;
    screen.renderer.destroy();
    expect(whileStreaming).toBeGreaterThan(30);
  });

  it("carries the streamed progress into the log instead of jumping to the end", async () => {
    let stream = (_text: string) => {};
    let flush = () => {};
    let liveShown = 0;
    const logFirstRender: number[] = [];
    function LiveView({ content }: { content: string }) {
      liveShown = usePacedText(content, { reduced: false, live: true }).length;
      return <text>{`live ${liveShown}`}</text>;
    }
    function LogAnswer({ content }: { content: string }) {
      const visible = usePacedText(content, { reduced: false, resume: true });
      const [first] = useState(() => {
        logFirstRender.push(visible.length);
        return visible.length;
      });
      return <text>{`log ${first}`}</text>;
    }
    // The order of App's flushPendingAssistantMessage: append the answer to the log, then clear the stream.
    function Harness() {
      const [log, setLog] = useState<string[]>([]);
      const [streaming, setStreaming] = useState("");
      stream = setStreaming;
      flush = () => {
        setLog((previous) => [...previous, streaming]);
        setStreaming("");
      };
      return (
        <box flexDirection="column">
          {log.map((answer) => (
            <LogAnswer key={answer} content={answer} />
          ))}
          {streaming ? <LiveView content={streaming} /> : null}
        </box>
      );
    }
    const screen = await testRender(<Harness />, { width: 40, height: 6 });
    const answer = words("carry", 100);
    await act(async () => stream(answer));
    await sleep(300);
    await act(async () => {});
    const beforeFlush = liveShown;
    await act(async () => flush());
    screen.renderer.destroy();
    expect(beforeFlush).toBeGreaterThan(0);
    expect(beforeFlush).toBeLessThan(answer.length);
    expect(logFirstRender).toHaveLength(1);
    // Within a tick of where the stream was, and nowhere near the end.
    expect(logFirstRender[0]).toBeGreaterThanOrEqual(beforeFlush);
    expect(logFirstRender[0]).toBeLessThan(beforeFlush + 20);
  });

  it("does not give one answer the progress of a stream that was cut short", async () => {
    let stream = (_text: string) => {};
    let showAnswer = (_text: string) => {};
    const firstRender: number[] = [];
    function LiveView({ content }: { content: string }) {
      return <text>{usePacedText(content, { reduced: false, live: true })}</text>;
    }
    function LogAnswer({ content }: { content: string }) {
      const visible = usePacedText(content, { reduced: false, resume: true });
      useState(() => firstRender.push(visible.length));
      return <text>{visible}</text>;
    }
    function Harness() {
      const [streaming, setStreaming] = useState("");
      const [answer, setAnswer] = useState("");
      stream = setStreaming;
      showAnswer = setAnswer;
      return (
        <box flexDirection="column">
          {answer ? <LogAnswer content={answer} /> : null}
          {streaming ? <LiveView content={streaming} /> : null}
        </box>
      );
    }
    const screen = await testRender(<Harness />, { width: 40, height: 6 });
    // A stream that stops before anything was revealed (Esc), then an unrelated answer, as on a resumed session.
    await act(async () => stream(words("cut", 50)));
    await act(async () => stream(""));
    const other = words("other", 40);
    await act(async () => showAnswer(other));
    screen.renderer.destroy();
    expect(firstRender).toEqual([other.length]);
  });
});
