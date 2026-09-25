import { describe, expect, it } from "vitest";
import type { HostStopStep } from "../providers/types";
import { createCircleDetector, FLIPS_TO_STOP, SAME_FAILURES_TO_STOP } from "./circles";

let ids = 0;
function step(toolName: string, input: Record<string, unknown>, output: unknown): HostStopStep {
  ids += 1;
  const toolCallId = `call-${ids}`;
  return { toolCalls: [{ toolCallId, toolName, input }], toolResults: [{ toolCallId, output }] };
}
const edit = (path: string, from: string, to: string, success = true) =>
  step("edit_file", { path, old_string: from, new_string: to }, { success, output: success ? "+1 -1" : "not found" });
const write = (path: string, content: string) => step("write_file", { path, content }, { success: true, output: "ok" });
const build = (error: string | null) =>
  step(
    "bash",
    { command: "npm run build" },
    error === null ? { success: true, output: "built" } : { success: false, output: "> tsc", error },
  );

/** Feeds the steps one at a time, the way stopWhen sees a growing round, and returns the first stop. */
function firstStop(watch: (steps: ReadonlyArray<HostStopStep>) => unknown, steps: HostStopStep[]) {
  for (let index = 1; index <= steps.length; index += 1) {
    const stop = watch(steps.slice(0, index));
    if (stop) return { at: index, stop };
  }
  return null;
}

const castle = " addToScene(parent: THREE.Group) {\n parent.add(this.mesh);\n }";
const castleWithLine = " addToScene(parent: THREE.Group) {\n parent.add(this.mesh);\n this.mesh.visible = true;\n }";

describe("the circle detector (audit gap #3, seen live 2026-09-25)", () => {
  it("stops edits that flip a file between the same two versions, whatever their whitespace", () => {
    const watch = createCircleDetector().round();
    const result = firstStop(watch, [
      edit("src/tracks/castle.ts", castle, castleWithLine),
      edit("src/tracks/castle.ts", castleWithLine.replaceAll(" ", "    "), castle),
      edit("src/tracks/castle.ts", castle, castleWithLine),
      edit("src/tracks/castle.ts", castleWithLine, castle),
    ]);

    expect(FLIPS_TO_STOP).toBe(2);
    expect(result?.at).toBe(3);
    expect(result?.stop).toMatchObject({ reason: "oscillating" });
    expect((result?.stop as { detail: string }).detail).toContain(
      "your edits to src/tracks/castle.ts went back and forth between the same two versions",
    );
    expect((result?.stop as { detail: string }).detail).toContain("2 of them undid the edit before");
  });

  it("lets a single undo, a debug line added and removed twice, and a failed edit go", () => {
    const watch = createCircleDetector().round();
    expect(
      firstStop(watch, [
        edit("a.ts", "x = 1", "x = 2"),
        edit("a.ts", "x = 2", "x = 1"),
        edit("a.ts", "run();", "console.log(1); run();"),
        edit("a.ts", "console.log(1); run();", "run();"),
        edit("a.ts", "run();", "console.log(state); run();"),
        edit("a.ts", "console.log(state); run();", "run();"),
        edit("a.ts", "x = 1", "x = 2", false),
      ]),
    ).toBeNull();
  });

  it("stops whole-file writes that go back to an earlier version twice", () => {
    const watch = createCircleDetector().round();
    const result = firstStop(watch, [
      write("index.html", "<p>A</p>"),
      write("index.html", "<p>B</p>"),
      write("index.html", "<p>A</p>"),
      write("index.html", "<p>B</p>"),
    ]);
    expect(result?.at).toBe(4);
    expect(result?.stop).toMatchObject({ reason: "oscillating" });
  });

  it("counts across the turn's rounds, not only within one", () => {
    const circles = createCircleDetector();
    expect(firstStop(circles.round(), [edit("b.ts", "let a", "const a"), edit("b.ts", "const a", "let a")])).toBeNull();
    expect(firstStop(circles.round(), [edit("b.ts", "let a", "const a")])?.stop).toMatchObject({
      reason: "oscillating",
    });
  });

  it("stops a check that fails the same way run after run while the files change", () => {
    const error = "src/tracks/beach.ts(100,22): error TS1005: ',' expected.";
    const watch = createCircleDetector().round();
    const steps = Array.from({ length: SAME_FAILURES_TO_STOP }, (_, index) => [
      edit("src/tracks/beach.ts", `v${index}`, `v${index + 1}`),
      build(error.replace("22", String(22 + index * 4))),
    ]).flat();
    const result = firstStop(watch, steps);

    expect(result?.at).toBe(steps.length);
    expect(result?.stop).toMatchObject({ reason: "plateau" });
    expect((result?.stop as { detail: string }).detail).toBe(
      `\`npm run build\` failed the same way ${SAME_FAILURES_TO_STOP} runs in a row while you changed files between them (${error.replace("22", String(22 + (SAME_FAILURES_TO_STOP - 1) * 4))})`,
    );
  });

  it("does not count reruns without a change, and starts over on a new failure or a pass", () => {
    const error = "src/a.ts(1,1): error TS1005: ';' expected.";
    const other = "src/b.ts(9,9): error TS2304: Cannot find name 'track'.";
    const watch = createCircleDetector().round();
    expect(
      firstStop(watch, [
        build(error),
        build(error),
        build(error),
        build(error),
        edit("a.ts", "a", "b"),
        build(error),
        edit("a.ts", "b", "c"),
        build(other),
        edit("a.ts", "c", "d"),
        build(other),
        edit("a.ts", "d", "e"),
        build(null),
        edit("a.ts", "e", "f"),
        build(other),
      ]),
    ).toBeNull();
  });
});
