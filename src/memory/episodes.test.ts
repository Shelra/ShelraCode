import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendEpisode,
  didWork,
  episodeFrom,
  failuresOf,
  pendingReflectionCount,
  queuePendingReflection,
  readEpisodes,
  takePendingReflection,
  turnOutcome,
} from "./episodes";
import type { TurnDigest } from "./reflection";
import { projectMemoryScope } from "./store";

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
    const scope = projectMemoryScope(mkdtempSync(join(tmpdir(), "shelra-episodes-")));
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
    const scope = projectMemoryScope(mkdtempSync(join(tmpdir(), "shelra-pending-")));
    queuePendingReflection(scope, digest({ userMessage: "first" }), "limited");
    queuePendingReflection(scope, digest({ userMessage: "second" }), "paused");
    expect(pendingReflectionCount(scope)).toBe(2);
    expect(takePendingReflection(scope)?.digest.userMessage).toBe("first");
    expect(takePendingReflection(scope)?.outcome).toBe("paused");
    expect(takePendingReflection(scope)).toBeNull();
  });
});
