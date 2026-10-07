import type { DemoStep, DemoTurn } from "../ui-demo/scripted-provider";

/**
 * Deterministic load for the responsiveness harness (`scripts/perf/ui-stress.tsx`). The model is the
 * only scripted part; the tools run for real against the throw-away fixture.
 */

const PARAGRAPH =
  "The refresh path compares `expiresAt` with the current time, so the boundary instant decides whether a session counts as expired. ";

function markdownBlock(chars: number): string {
  const parts: string[] = [];
  let used = 0;
  let n = 0;
  while (used < chars) {
    n += 1;
    const chunk = `### Finding ${n}\n\n${PARAGRAPH}${PARAGRAPH}\n\n- first point about \`needsRefresh\` and \`isExpired\`\n- second point with **bold** text and a [link](https://example.com)\n\n\`\`\`ts\nexport function f${n}(session: Session, now = Date.now()): boolean {\n  return session.expiresAt - now < ${n * 1000};\n}\n\`\`\`\n\n`;
    parts.push(chunk);
    used += chunk.length;
  }
  return parts.join("");
}

function thought(chars: number): string {
  const base = "Compare the boundary cases first, then check what the tests assert about the rotated token. ";
  return base.repeat(Math.ceil(chars / base.length)).slice(0, chars);
}

export interface HeavyTurnOptions {
  /** Delay between streamed pieces in ms (the harness multiplies by its own speed). */
  pace?: number;
  reasoningChars?: number;
  answerChars?: number;
  reads?: number;
  greps?: number;
  /** Lines the large-output bash command prints. */
  outputLines?: number;
  /** Lines in the large file the turn writes (and so in the diff). */
  fileLines?: number;
  toolMs?: number;
  marker: string;
}

/** One request that streams a lot, calls many tools, prints a lot, and writes a big file. */
export function heavyTurn(options: HeavyTurnOptions): DemoTurn {
  const pace = options.pace ?? 4;
  const toolMs = options.toolMs ?? 10;
  const lines = options.outputLines ?? 4000;
  const fileLines = options.fileLines ?? 400;
  const bigFile = Array.from(
    { length: fileLines },
    (_, i) => `export const value${i} = ${i}; // generated line ${i} of the stress file`,
  ).join("\n");

  const first: DemoStep = [
    { think: thought(options.reasoningChars ?? 2400), pace },
    { say: markdownBlock(options.answerChars ?? 3600), pace },
  ];
  for (let i = 0; i < (options.reads ?? 10); i += 1) {
    first.push({ call: "read_file", input: { path: i % 2 === 0 ? "src/auth.ts" : "tests/auth.test.ts" }, ms: toolMs });
  }
  for (let i = 0; i < (options.greps ?? 6); i += 1) {
    first.push({ call: "grep", input: { pattern: "refreshSession|isExpired", include: "*.ts" }, ms: toolMs });
  }

  const second: DemoStep = [
    {
      call: "bash",
      input: { command: `bun -e "for (let i=0;i<${lines};i++) console.log('output line '+i+' '+'x'.repeat(90))"` },
      ms: toolMs,
    },
  ];

  const third: DemoStep = [
    { say: "Now the edits.", pace },
    { call: "write_file", input: { path: `src/generated-${options.marker}.ts`, content: bigFile }, ms: toolMs },
    {
      call: "edit_file",
      input: {
        path: `src/generated-${options.marker}.ts`,
        old_string: "export const value0 = 0;",
        new_string: "export const value0 = 1000;",
      },
      ms: toolMs,
    },
    // The project's own check passes, so the completion gate asks for nothing more and the script stays in step.
    { call: "bash", input: { command: "bun test" }, ms: toolMs },
  ];

  const fourth: DemoStep = [
    { think: thought(600), pace },
    { say: `${options.marker}: done. ${PARAGRAPH}`, pace },
  ];

  return [first, second, third, fourth];
}

/** A small, fast turn used to build up a long transcript before the measured one. */
export function lightTurn(i: number): DemoTurn {
  return [
    [
      { think: `Check item ${i}. `, pace: 0 },
      { say: `Item ${i}: looking at the module.\n\n- point one\n- point two with \`code\`\n`, pace: 0 },
      { call: "read_file", input: { path: "src/auth.ts" }, ms: 0 },
      { call: "grep", input: { pattern: "isExpired", include: "*.ts" }, ms: 0 },
    ],
    [{ say: `Item ${i} done.`, pace: 0 }],
  ];
}
