import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeProvider } from "../providers/fake";
import type { ProviderTextRequest, ProviderTextResult } from "../providers/types";
import {
  admitCandidates,
  deterministicFailureCandidates,
  extractUserDirectives,
  parseReflectionCandidates,
  reflectOnTurn,
  type TurnDigest,
  turnQualifiesForReflection,
} from "./reflection";
import { promoteProceduresToSkills, skillPathFor } from "./skills";
import {
  creditMemoryUse,
  listMemoryRecords,
  projectMemoryScope,
  readMemoryEntry,
  readMemoryHistory,
  readReflectionAudit,
  recordMemoryUse,
} from "./store";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "shelra-memory-reflection-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

class JsonProvider extends FakeProvider {
  requests: ProviderTextRequest[] = [];
  constructor(private readonly json: string) {
    super("unused");
  }
  override async generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
    this.requests.push(request);
    return { text: this.json, modelId: request.modelId, usage: { inputTokens: 500, outputTokens: 120 } };
  }
}

const digest: TurnDigest = {
  userMessage: "Make the config tests pass",
  assistantText: "Fixed: the tests need the preload script; ran bun test --preload ./test/setup.ts, 4 pass.",
  changedFiles: ["src/config.ts"],
  commands: [
    { command: "bun test", success: false, output: "error: Cannot find module ./fixtures" },
    { command: "bun test --preload ./test/setup.ts", success: true, output: "4 pass" },
  ],
  verified: true,
  toolCalls: 6,
};

describe("automatic memory capture", () => {
  it("captures explicit user directives deterministically as human-sourced preferences", () => {
    const candidates = extractUserDirectives(
      "Fix the tests. Always run the linter before committing. Never mind the old script.",
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ type: "preference", source: "human", confidence: 1 });
    expect(candidates[0]?.hook).toBe("Always run the linter before committing");
    expect(extractUserDirectives("I always wondered why this fails")).toEqual([]);
    // A task-local constraint is not a standing rule.
    expect(extractUserDirectives("Implement slugify. Do not modify tests. Run bun test before completing.")).toEqual(
      [],
    );
  });

  it("takes neither a list's lead-in nor a spec's own preferences as standing rules", () => {
    // Seen live 2026-09-24 with a game spec.
    const spec = [
      "# GAME CHALLENGE",
      "## Camera",
      "Prefer a slight horizontal look-ahead.",
      "Prefer implementing the core engine yourself so that this challenge tests your ability to reason about:",
      "- physics",
      "Always keep the frame rate above 30.",
    ].join("\n");
    expect(extractUserDirectives(spec).map((candidate) => candidate.hook)).toEqual([
      "Always keep the frame rate above 30",
    ]);
    expect(extractUserDirectives("Prefer tabs over spaces in this repo.").map((candidate) => candidate.hook)).toEqual([
      "Prefer tabs over spaces in this repo",
    ]);
  });

  it("captures corrections and facts in the user's words, and keeps what a dot inside a name holds", () => {
    const captured = (message: string) =>
      extractUserDirectives(message).map((candidate) => [candidate.hook, candidate.tags?.includes("correction")]);
    expect(captured("No, we use bun test here.")).toEqual([["We use bun test here", true]]);
    expect(captured("We don't use npm anymore.")).toEqual([["We don't use npm anymore", true]]);
    expect(captured("Use bun instead of npm.")).toEqual([["Use bun instead of npm", true]]);
    expect(captured("Remember that the API lives in src/api.")).toEqual([["The API lives in src/api", false]]);
    expect(captured("Always use Node 20.11 for builds. Thanks")).toEqual([["Always use Node 20.11 for builds", false]]);
    expect(captured("Ya no usamos Firebase, ahora es Supabase.")).toEqual([
      ["Ya no usamos Firebase, ahora es Supabase", true],
    ]);
    // Ordinary replies and questions state nothing lasting.
    expect(captured("No problem, it is fine.")).toEqual([]);
    expect(captured("Actually, it is late.")).toEqual([]);
    expect(captured("Should we always use yarn?")).toEqual([]);
  });

  it("sends a preference about how Shelra talks to this person to the user-wide store", () => {
    const [spanish] = extractUserDirectives("Always answer in Spanish.");
    expect(spanish?.tags).toContain("user-wide");
    const [lint] = extractUserDirectives("Always run the linter before committing.");
    expect(lint?.tags).not.toContain("user-wide");
  });

  it("keeps each distinct rule the user states, however alike their wording", () => {
    const scope = projectMemoryScope(workspace);
    for (const rule of ["Always write tests first.", "Always write docs first.", "Never touch the generated folder."]) {
      admitCandidates(scope, extractUserDirectives(rule));
    }
    expect(
      listMemoryRecords(scope)
        .map((record) => record.index.hook)
        .sort(),
    ).toEqual(["Always write docs first", "Always write tests first", "Never touch the generated folder"]);
    // The same statement said again is still one entry.
    admitCandidates(scope, extractUserDirectives("Always write tests first!"));
    expect(listMemoryRecords(scope)).toHaveLength(3);
  });

  it("records a failed-then-recovered command deterministically when the model extracts nothing", async () => {
    const provider = new JsonProvider('{"memories":[]}');
    const scope = projectMemoryScope(workspace);
    const report = await reflectOnTurn({ scope, provider, modelId: "m", digest });

    expect(provider.requests).toHaveLength(1);
    expect(report.written).toHaveLength(1);
    const stored = readMemoryEntry(scope, report.written[0] as string).entry;
    expect(stored?.frontmatter.metadata).toMatchObject({ type: "failure", source: "observed" });
    expect(stored?.body).toContain("bun test --preload ./test/setup.ts");
    expect(deterministicFailureCandidates({ ...digest, commands: [] })).toEqual([]);
  });

  it("retries once on a malformed reply and keeps an audit trail", async () => {
    class FlakyProvider extends JsonProvider {
      calls = 0;
      override async generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
        this.calls += 1;
        if (this.calls === 1) return { text: "Sure! Here are the memories: [not json", modelId: request.modelId };
        return super.generateText(request);
      }
    }
    const provider = new FlakyProvider(
      JSON.stringify({
        memories: [
          {
            type: "procedure",
            slug: "preload-tests",
            title: "Preload tests",
            hook: "run tests with the preload script",
            description: "d",
            body: "Run `bun test --preload ./test/setup.ts` before anything else in this repository.",
            confidence: 0.8,
          },
        ],
      }),
    );
    const scope = projectMemoryScope(workspace);
    const report = await reflectOnTurn({ scope, provider, modelId: "m", digest });
    expect(provider.calls).toBe(2);
    expect(report.written).toContain("preload-tests");
    const audit = readReflectionAudit(scope);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ qualified: true, written: expect.arrayContaining(["preload-tests"]) });
  });

  it("only reflects on turns that taught something", () => {
    expect(turnQualifiesForReflection(digest).qualified).toBe(true);
    expect(turnQualifiesForReflection({ ...digest, changedFiles: [], commands: [], toolCalls: 1 }).qualified).toBe(
      false,
    );
  });

  it("learns from a turn that ended unverified, but never above a confirmed fact (audit doc 15, M4)", async () => {
    const unverified: TurnDigest = {
      userMessage: "Make the parser accept trailing commas",
      assistantText:
        "Changed the tokenizer. [Not verified — `bun run test` fails on the final code, after 3 automatic request(s).]",
      changedFiles: ["src/tokenizer.ts"],
      commands: [{ command: "bun run test", success: false, output: "(fail) parser > trailing comma" }],
      verified: false,
      endedUnverified: true,
      toolCalls: 3,
    };
    expect(turnQualifiesForReflection(unverified)).toEqual({
      qualified: true,
      reason: "a change whose checks still fail",
    });
    expect(turnQualifiesForReflection({ ...unverified, endedUnverified: false }).qualified).toBe(false);

    const provider = new JsonProvider(
      JSON.stringify({
        memories: [
          {
            type: "known-problems",
            slug: "trailing-comma-tokenizer",
            title: "Trailing commas break the tokenizer",
            hook: "the tokenizer rejects trailing commas; changing the comma rule alone did not fix it",
            description: "d",
            body: "`bun run test` fails at parser > trailing comma; editing the comma rule in src/tokenizer.ts alone did not fix it.",
            confidence: 0.9,
            tags: ["parser"],
          },
        ],
      }),
    );
    const scope = projectMemoryScope(workspace);
    const report = await reflectOnTurn({ scope, provider, modelId: "m", digest: unverified });

    expect(provider.requests[0]?.prompt).toContain("OUTCOME: the turn ended unverified");
    expect(report.written).toEqual(["trailing-comma-tokenizer"]);
    expect(readMemoryEntry(scope, "trailing-comma-tokenizer").entry?.frontmatter.metadata).toMatchObject({
      confidence: 0.4,
      tags: ["parser", "unverified"],
    });
  });

  it("parses tolerant JSON and drops malformed items", () => {
    const text =
      'Here you go:\n```json\n{"memories":[{"type":"testing","slug":"Preload Flag","title":"Tests need preload","hook":"bun test needs --preload","description":"d","body":"Run `bun test --preload ./test/setup.ts` or fixtures fail.","confidence":0.9,"relatedFiles":["test/setup.ts"]},{"type":"bogus","body":"x"},{"type":"failure","body":""}]}\n```';
    const candidates = parseReflectionCandidates(text);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      slug: "preload-flag",
      type: "testing",
      source: "inference",
      confidence: 0.9,
    });
    expect(parseReflectionCandidates("no json here")).toEqual([]);
  });

  it("runs the bounded model call, gates the candidates, and writes the admitted ones", async () => {
    const provider = new JsonProvider(
      JSON.stringify({
        memories: [
          {
            type: "testing",
            slug: "bun-test-preload",
            title: "Tests need the preload script",
            hook: "bun test needs --preload ./test/setup.ts or fixtures fail",
            description: "preload required",
            body: "Run `bun test --preload ./test/setup.ts`; without it fixture imports fail with ENOENT.",
            confidence: 0.85,
            relatedFiles: ["test/setup.ts"],
          },
          {
            type: "conventions",
            slug: "leak",
            title: "token",
            hook: "api key",
            description: "d",
            body: "api_key=sk-abcdefghijklmnopqrstuvwxyz0123456789 for the staging server",
          },
        ],
      }),
    );
    const scope = projectMemoryScope(workspace);
    const report = await reflectOnTurn({ scope, provider, modelId: "m", digest });

    expect(report.qualified).toBe(true);
    expect(provider.requests[0]?.system).toContain("Return ONLY a JSON object");
    expect(provider.requests[0]?.prompt).toContain("FAILED: error: Cannot find module");
    expect(report.written).toEqual(["bun-test-preload"]);
    expect(report.decisions).toEqual([
      { slug: "bun-test-preload", action: "create", reason: "novel" },
      expect.objectContaining({ slug: "leak", action: "reject" }),
    ]);
    const stored = readMemoryEntry(scope, "bun-test-preload").entry;
    expect(stored?.frontmatter.metadata).toMatchObject({
      source: "inference",
      confidence: 0.85,
      relatedFiles: ["test/setup.ts"],
      revision: 1,
    });
    expect(readMemoryHistory(scope).map((event) => event.event)).toEqual(["created"]);
  });

  it("skips the model call for a turn with nothing to learn", async () => {
    const provider = new JsonProvider('{"memories":[]}');
    const report = await reflectOnTurn({
      scope: projectMemoryScope(workspace),
      provider,
      modelId: "m",
      digest: { ...digest, changedFiles: [], commands: [], toolCalls: 2 },
    });
    expect(report.qualified).toBe(false);
    expect(provider.requests).toHaveLength(0);
  });

  it("promotes a procedure to a project skill once it was part of two passing turns, not for being retrieved", () => {
    const scope = projectMemoryScope(workspace);
    admitCandidates(scope, [
      {
        slug: "regenerate-api-client",
        title: "Regenerate the API client",
        hook: "After editing openapi.yaml run bun run codegen then bun test",
        type: "procedure",
        description: "Codegen procedure",
        body: "1. Edit openapi.yaml\n2. Run `bun run codegen` (writes src/generated/)\n3. Run `bun test` — the generated client is checked in, so commit it too.",
        source: "observed",
        confidence: 0.9,
      },
    ]);
    const before = promoteProceduresToSkills(scope, workspace, listMemoryRecords(scope));
    expect(before.promoted).toEqual([]);
    // Retrieved twice, helped nobody yet (audit doc 15, M3): no skill.
    recordMemoryUse(scope, ["regenerate-api-client"]);
    recordMemoryUse(scope, ["regenerate-api-client"]);
    expect(promoteProceduresToSkills(scope, workspace, listMemoryRecords(scope)).promoted).toEqual([]);
    creditMemoryUse(scope, ["regenerate-api-client"], 1);
    creditMemoryUse(scope, ["regenerate-api-client"], 1);
    const after = promoteProceduresToSkills(scope, workspace, listMemoryRecords(scope));
    expect(after.promoted).toEqual(["regenerate-api-client"]);
    const skill = readFileSync(skillPathFor(workspace, "regenerate-api-client"), "utf8");
    expect(skill).toContain("name: regenerate-api-client");
    expect(skill).toContain("bun run codegen");
    expect(promoteProceduresToSkills(scope, workspace, listMemoryRecords(scope)).promoted).toEqual([]);
    expect(readMemoryHistory(scope).some((event) => event.event === "promoted")).toBe(true);
  });
});
