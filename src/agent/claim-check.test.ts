import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeUnbackedClaims, unbackedClaims } from "./claim-check";

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "shelra-claims-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src", "slug.ts"), "export {};\n");
  return root;
}

describe("claims in the final answer", () => {
  it("finds a command the answer says it ran that the turn never ran", () => {
    const claims = unbackedClaims({
      answer: "I implemented slugify. I ran `npm test` and all 12 tests pass. You can also run `npm run lint`.",
      workspace: workspace(),
      changedFiles: ["src/slug.ts"],
      commandsRun: ["bun run typecheck"],
    });
    expect(claims.commands).toEqual(["npm test"]);
    expect(describeUnbackedClaims(claims)).toBe(
      "[Shelra checked the answer: it says it ran `npm test`, which this turn never ran.]",
    );
  });

  it("accepts a run of the same command with arguments, and the host's own runs", () => {
    const claims = unbackedClaims({
      answer: "Ejecuté `bun test` y pasan todos. I re-ran `go test ./lib/auth` after the fix.",
      workspace: workspace(),
      changedFiles: [],
      commandsRun: ["bun test src/slug.test.ts", "go test ./lib/auth"],
    });
    expect(claims).toEqual({ commands: [], files: [] });
  });

  it("finds a file the answer says it wrote that is not there, and leaves removed files alone", () => {
    const root = workspace();
    const claims = unbackedClaims({
      answer: [
        "Created `src/slugify.test.ts` with six cases.",
        "Updated `src/slug.ts`.",
        "Removed `src/old.ts`.",
        "Creé `docs/SLUG.md`.",
      ].join("\n"),
      workspace: root,
      changedFiles: ["src/slug.ts"],
      commandsRun: [],
    });
    expect(claims.files).toEqual(["src/slugify.test.ts", "docs/SLUG.md"]);
  });

  it("says nothing about advice, code blocks or names that are not paths", () => {
    const claims = unbackedClaims({
      answer: [
        "Run `npm test` to check it yourself.",
        "```sh\nI ran `rm -rf /`\n```",
        "I updated the `slugify` function and the `README` section.",
      ].join("\n"),
      workspace: workspace(),
      changedFiles: [],
      commandsRun: [],
    });
    expect(claims).toEqual({ commands: [], files: [] });
    expect(describeUnbackedClaims(claims)).toBeNull();
  });
});
