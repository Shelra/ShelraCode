/**
 * What one streaming tick costs while an answer grows: the cost of showing 50 more characters of an answer that
 * is already N characters long (JS parse, React update and the terminal frame).
 *
 *   bun run scripts/perf/markdown-cost.tsx
 */
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot } from "@opentui/react";
import { act, createElement, useState } from "react";
import { splitFences } from "../../src/ui/code-highlight";
import { Markdown } from "../../src/ui/markdown";
import { parseBlocks } from "../../src/ui/markdown-blocks";
import { resolveTheme } from "../../src/ui/theme";

const t = resolveTheme();
const PARAGRAPH =
  "The refresh path compares `expiresAt` with the current time, so the **boundary** instant decides whether a session counts as expired. ";
function answer(chars: number): string {
  const parts: string[] = [];
  let n = 0;
  let used = 0;
  while (used < chars) {
    n += 1;
    const chunk = `### Finding ${n}\n\n${PARAGRAPH}${PARAGRAPH}\n\n- first point about \`needsRefresh\` and \`isExpired\`\n- second point with **bold** text and a [link](https://example.com)\n\n\`\`\`ts\nexport function f${n}(session: Session, now = Date.now()): boolean {\n  return session.expiresAt - now < ${n * 1000};\n}\n\`\`\`\n\n`;
    parts.push(chunk);
    used += chunk.length;
  }
  return parts.join("").slice(0, chars);
}

const ENV = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
ENV.IS_REACT_ACT_ENVIRONMENT = false;
const setup = await createTestRenderer({ width: 120, height: 40 });
let setText: (s: string) => void = () => {};
function Host({ initial }: { initial: string }) {
  const [text, set] = useState(initial);
  setText = set;
  return createElement(
    "box",
    { flexDirection: "column" },
    createElement(Markdown, { content: text, t, streaming: true }),
  );
}

const rows: Record<string, unknown>[] = [];
for (const size of [2_000, 8_000, 32_000]) {
  const base = answer(size);
  const root = createRoot(setup.renderer);
  root.render(createElement(Host, { initial: base }));
  await new Promise((r) => setTimeout(r, 50));
  await setup.renderOnce();
  // JS-only parse of the whole text, as every tick does.
  let started = performance.now();
  for (let i = 0; i < 20; i += 1) splitFences(base).flatMap((s) => (s.kind === "code" ? [] : parseBlocks(s.text)));
  const parseMs = (performance.now() - started) / 20;

  const ticks: number[] = [];
  const frames: number[] = [];
  let text = base;
  for (let i = 0; i < 20; i += 1) {
    text += " and a few more words of the answer";
    started = performance.now();
    setText(text);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 0));
    ticks.push(performance.now() - started);
    started = performance.now();
    await setup.renderOnce();
    frames.push(performance.now() - started);
  }
  const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  rows.push({ chars: size, parseMs: Math.round(parseMs * 10) / 10, updateMs: avg(ticks), frameMs: avg(frames) });
  root.unmount();
  await new Promise((r) => setTimeout(r, 20));
}
console.log(JSON.stringify(rows, null, 2));
setup.renderer.destroy();
process.exit(0);
