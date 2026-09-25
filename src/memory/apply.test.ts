import { describe, expect, it } from "vitest";
import { commandsIn, unappliedMemories } from "./apply";
import type { MemoryRecord, MemoryType } from "./types";

function record(slug: string, type: MemoryType, hook: string, body: string): MemoryRecord {
  return {
    slug,
    index: { title: slug, file: `${slug}.md`, hook },
    entry: {
      frontmatter: { name: slug, description: slug, metadata: { type, modified: "2026-09-25T00:00:00.000Z" } },
      body,
    },
  } as MemoryRecord;
}

describe("memory a turn was given and did not apply (doc 18 §4.2b)", () => {
  it("reads the commands of shell blocks and inline spans, not file names or words", () => {
    expect(
      commandsIn(
        "Run `bun run gen` after edits; see `src/generated/messages.ts`.\n```bash\n# regenerate\n$ bun run scripts/build-messages.ts\n```",
      ),
    ).toEqual(["bun run scripts/build-messages.ts", "bun run gen"]);
    expect(commandsIn("Use `camelCase` names and keep `README.md` short.")).toEqual([]);
  });

  it("names a how-to entry the turn was given and never ran (the memory suite case)", () => {
    const catalog = record(
      "generate-message-catalog",
      "build",
      "Run scripts/build-messages.ts to create src/generated/messages.ts before using t()",
      "```bash\nbun run scripts/build-messages.ts\n```",
    );
    expect(unappliedMemories([catalog], ["generate-message-catalog"], ["bun test"])).toEqual([
      {
        slug: "generate-message-catalog",
        title: "generate-message-catalog",
        commands: ["bun run scripts/build-messages.ts"],
      },
    ]);
    // Run through the package script of the same name, it counts.
    expect(
      unappliedMemories([catalog], ["generate-message-catalog"], ["bun run build:messages"], {
        "build:messages": "bun run scripts/build-messages.ts",
      }),
    ).toEqual([]);
  });

  it("counts any one command an entry names, and ignores entries not given, failure lessons and plain facts", () => {
    const tests = record("bun-test-command", "conventions", "Use `bun test` (not `bun run test`)", "Run `bun test`.");
    const failure = record("failure-bun-test", "failure", "`bun test` failed; it passed after `bun install`", "x");
    const fact = record("clock", "important-codepaths", "The clock ticks from `setInterval`", "`node clock.js`");
    expect(unappliedMemories([tests], ["bun-test-command"], ["bun test --watch=false"])).toEqual([]);
    expect(unappliedMemories([tests], [], [])).toEqual([]);
    expect(unappliedMemories([failure, fact], ["failure-bun-test", "clock"], [])).toEqual([]);
  });
});
