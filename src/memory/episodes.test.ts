import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  appendEpisode,
  didWork,
  episodeFrom,
  episodeLessons,
  failuresOf,
  pendingReflectionCount,
  queuePendingReflection,
  readEpisodes,
  takePendingReflection,
  turnOutcome,
} from "./episodes";
import type { TurnDigest } from "./reflection";
import { projectMemoryScope } from "./store";

/** Temp folders this file made; removed when it ends, so test stores do not pile up (doc 18 §2.3). */
const made: string[] = [];
function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const digest = (overrides: Partial<TurnDigest> = {}): TurnDigest => ({
  userMessage: "Build the platformer",
  assistantText: "Wrote the engine.",
  changedFiles: ["js/game.js"],
  commands: [
    { command: "cd D:\\games\\my game && node -e x", success: false, output: "A positional parameter cannot be found" },
    { command: 'Set-Location "D:\\games\\my game"', success: true, output: "" },
  ],
  verified: false,
  toolCalls: 12,
  ...overrides,
});

describe("episodes (doc 18 §4.2)", () => {
  it("names a turn's outcome from its closing note", () => {
    expect(turnOutcome("[Limited — OpenRouter's free models …]", false)).toBe("limited");
    expect(turnOutcome("[Paused — No model answered …]", false)).toBe("paused");
    expect(turnOutcome("[Not verified — `bun test` fails on the final code]", false)).toBe("unverified");
    expect(turnOutcome("[Stopped — blocked on a missing key]", false)).toBe("stopped");
    expect(turnOutcome("[Checked by Shelra on the final code: `bun test` passed]", true)).toBe("verified");
    expect(turnOutcome(undefined, true)).toBe("verified");
    expect(turnOutcome(undefined, false)).toBe("answered");
  });

  it("keeps each failure with the command that got past it", () => {
    expect(failuresOf(digest())).toEqual([
      {
        command: "cd D:\\games\\my game && node -e x",
        error: "A positional parameter cannot be found",
        fixedBy: 'Set-Location "D:\\games\\my game"',
      },
    ]);
    expect(didWork(digest({ toolCalls: 0, changedFiles: [], commands: [] }))).toBe(false);
  });

  it("records episodes and never keeps a key in them", () => {
    const scope = projectMemoryScope(scratch("shelra-episodes-"));
    appendEpisode(
      scope,
      episodeFrom(digest({ userMessage: "use sk-or-v1-0123456789abcdef0123456789abcdef here" }), "limited"),
    );
    const [episode] = readEpisodes(scope);
    expect(episode?.outcome).toBe("limited");
    expect(episode?.files).toEqual(["js/game.js"]);
    expect(episode?.request).not.toContain("0123456789abcdef0123456789abcdef");
  });

  it("queues a reflection no model could run, oldest first, until one runs", () => {
    const scope = projectMemoryScope(scratch("shelra-pending-"));
    queuePendingReflection(scope, digest({ userMessage: "first" }), "limited");
    queuePendingReflection(scope, digest({ userMessage: "second" }), "paused");
    expect(pendingReflectionCount(scope)).toBe(2);
    expect(takePendingReflection(scope)?.digest.userMessage).toBe("first");
    expect(takePendingReflection(scope)?.outcome).toBe("paused");
    expect(takePendingReflection(scope)).toBeNull();
  });
});

describe("episode lessons (doc 18 §4.3)", () => {
  const episode = (request: string, extra: Partial<ReturnType<typeof episodeFrom>> = {}) => ({
    ...episodeFrom(digest({ userMessage: request }), "limited"),
    ...extra,
  });

  it("turns the most similar past attempt into a lesson with what failed and what worked", () => {
    const lessons = episodeLessons(
      [
        episode("Add a dark mode toggle to the settings page", { failures: [], files: ["src/settings.tsx"] }),
        episode("Build the platformer game level loader"),
      ],
      { text: "the platformer level loader crashes on level 2" },
    );
    expect(lessons).toHaveLength(1);
    expect(lessons[0]?.line).toContain('"Build the platformer game level loader"');
    expect(lessons[0]?.line).toContain("failed (A positional parameter cannot be found)");
    expect(lessons[0]?.line).toContain('worked: `Set-Location "D:\\games\\my game"`');
  });

  it("shows nothing for a request no past attempt resembles, and reads a follow-up with the request before it", () => {
    const past = [episode("Build the platformer game level loader")];
    expect(episodeLessons(past, { text: "write a haiku about autumn" })).toEqual([]);
    expect(episodeLessons(past, { text: "dale", previous: "fix the platformer level loader" })).toHaveLength(1);
  });

  it("counts attempts at the same request once, newest first", () => {
    const lessons = episodeLessons(
      [
        episode("Build the platformer game level loader", { at: "2026-09-20T10:00:00.000Z" }),
        episode("Build the platformer game level loader", { at: "2026-09-21T10:00:00.000Z", outcome: "paused" }),
      ],
      { text: "platformer level loader" },
    );
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toMatchObject({ attempts: 2, outcome: "paused", at: "2026-09-21T10:00:00.000Z" });
  });
});
