import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  appendEpisode,
  didWork,
  episodeFrom,
  episodeLessons,
  failuresOf,
  MAX_ATTEMPTS,
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

describe("what episodes keep (review round 2)", () => {
  it("keeps no secret, no home folder and no attached file on disk", () => {
    const scope = projectMemoryScope(scratch("shelra-episodes-secrets-"));
    const home = homedir();
    const leaky = digest({
      userMessage: `<attached_files>\n<file path="${home}/app/.env">\nSTRIPE_SECRET_KEY=sk_live_51HxAbCdEfGhIjKlMn\n</file>\n</attached_files>\n\nwhy does deploy fail?`,
      commands: [
        {
          command: "cat .env",
          success: true,
          output: [
            "STRIPE_SECRET_KEY=sk_live_51HxAbCdEfGhIjKlMnOp",
            "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
            "DB_PASSWORD=hunter2",
            "DATABASE_URL=postgres://app:s3cretpass@db.internal:5432/app",
            "-----BEGIN RSA PRIVATE KEY-----",
            "MIIEowIBAAKCAQEA",
            "-----END RSA PRIVATE KEY-----",
            "JWT=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
          ].join("\n"),
        },
        { command: `node ${home}/app/connect.js`, success: false, output: "DB_PASSWORD=hunter2 rejected" },
        { command: "bun test", success: true, output: "4 pass" },
      ],
    });
    appendEpisode(scope, episodeFrom(leaky, "limited"));
    queuePendingReflection(scope, leaky, "limited");
    const dir = join(scope.workspace, ".shelra", "memory");
    const written = [
      readFileSync(join(dir, "episodes.jsonl"), "utf8"),
      readFileSync(join(dir, "pending-reflections.jsonl"), "utf8"),
    ].join("\n");
    for (const secret of [
      "sk_live_51Hx",
      "AKIAIOSFODNN7EXAMPLE",
      "hunter2",
      "s3cretpass",
      "MIIEowIBAAKCAQEA",
      "eyJhbGciOi",
    ]) {
      expect(written, secret).not.toContain(secret);
    }
    expect(written).not.toContain(JSON.stringify(home).slice(1, -1));
    expect(readEpisodes(scope)[0]?.request).toBe("why does deploy fail?");
    // The folder keeps itself out of version control.
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain("*");
  });

  it("names an error exit, and drops a reflection that failed too often", () => {
    expect(turnOutcome("[Error — The API key was rejected]", true)).toBe("error");
    const scope = projectMemoryScope(scratch("shelra-episodes-attempts-"));
    expect(queuePendingReflection(scope, digest(), "limited", 2)).toBe(true);
    expect(takePendingReflection(scope)?.attempts).toBe(2);
    expect(queuePendingReflection(scope, digest(), "limited", MAX_ATTEMPTS)).toBe(false);
    expect(pendingReflectionCount(scope)).toBe(0);
  });
});
