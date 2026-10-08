import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryContextFor } from "../agent/prompts";
import { BashTool } from "../tools/bash";
import { createTools } from "../toolset/tools";
import { runMemoryCommand } from "./cli";
import { decideMemoryWrite } from "./gate";
import { HUMAN_TOPIC_LIMIT, HUMAN_TOPIC_MAX_BYTES, prepareHumanTopic } from "./human-files";
import { admitCandidates, extractUserDirectives } from "./reflection";
import { buildMemoryContext } from "./retrieval";
import {
  deleteMemoryEntry,
  deliverReminder,
  listMemoryRecords,
  loadMemoryRecords,
  memoryDir,
  memoryEntryPath,
  memoryIndexPath,
  projectMemoryScope,
  readActiveMemoryIndex,
  readMemoryEntry,
  readMemoryIndex,
  slugFromIndexFile,
  supersedeMemoryEntry,
  writeMemoryEntry,
} from "./store";
import type { MemoryWriteInput } from "./types";

let workspace: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "shelra-durable-human-"));
  vi.stubEnv("SHELRA_USER_MEMORY_ROOT", join(workspace, "user-home"));
});
afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function human(slug: string, hook: string): MemoryWriteInput {
  return { slug, title: hook, hook, type: "conventions", description: hook, body: `${hook}.`, source: "human" };
}

describe("human knowledge survives context budgets", () => {
  it("rejects a new topic at the explicit canonical-file capacity", () => {
    const scope = projectMemoryScope(workspace);
    const directory = join(memoryDir(scope), "human");
    mkdirSync(directory, { recursive: true });
    for (let index = 0; index < HUMAN_TOPIC_LIMIT; index++) writeFileSync(join(directory, `topic-${index}.md`), "");
    expect(() => prepareHumanTopic(memoryDir(scope), "overflow.md", 100)).toThrow(`capacity is ${HUMAN_TOPIC_LIMIT}`);
    expect(existsSync(join(directory, "overflow.md"))).toBe(false);
    // Revising a topic already occupying a slot needs no additional capacity.
    expect(prepareHumanTopic(memoryDir(scope), "topic-0.md", 100)).toBe(join(directory, "topic-0.md"));
  }, 30_000);
  it("keeps Markdown links usable and resolves their physical path to the logical memory slug", () => {
    const scope = projectMemoryScope(workspace);
    expect(writeMemoryEntry(scope, human("ownership", "Identity records belong to Auth")).ok).toBe(true);
    const pointer = readMemoryIndex(scope).entries[0];
    expect(pointer).toBeDefined();
    expect(existsSync(join(memoryDir(scope), pointer?.file ?? "missing"))).toBe(true);
    expect(slugFromIndexFile(pointer?.file ?? "missing")).toBe("ownership");
  });

  it("keeps retired human decisions visible through the actual CLI service", () => {
    const scope = projectMemoryScope(workspace);
    expect(writeMemoryEntry(scope, human("auth-first", "Auth uses PostgreSQL")).ok).toBe(true);
    expect(writeMemoryEntry(scope, human("auth-current", "Auth uses CockroachDB")).ok).toBe(true);
    expect(supersedeMemoryEntry(scope, "auth-first", "auth-current")).toBe(true);
    const result = runMemoryCommand(workspace, "list", undefined, { all: true });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("auth-first");
    expect(result.output).toContain("superseded");
    expect(result.output).toContain("auth-current");
  });
  it("captures eight distinct rules from one request", () => {
    const statements = [
      "Always check queue ordering before deploying workers",
      "Never persist personal identifiers in application logs",
      "Always document rejected alternatives in architectural decisions",
      "Never mutate billing invoices through frontend storage",
      "Always preserve database ownership inside service boundaries",
      "Never install dependencies without a declared package requirement",
      "Always validate migrations against existing tenant data",
      "Never replace a domain invariant with a compatibility fallback",
    ];
    const candidates = extractUserDirectives(`${statements.join(".\n")}.`);
    expect(candidates.map((item) => item.hook)).toEqual(statements);
    const result = admitCandidates(projectMemoryScope(workspace), candidates);
    expect(result.written).toHaveLength(8);
    expect(
      listMemoryRecords(projectMemoryScope(workspace))
        .map((record) => record.index.hook)
        .sort(),
    ).toEqual([...statements].sort());
  });

  it("keeps different statements whose generated name has the same prefix", () => {
    const prefix = "Always preserve database ownership and architectural boundaries when changing";
    const candidates = extractUserDirectives(`${prefix} billing invoices.\n${prefix} authentication sessions.`);
    expect(candidates).toHaveLength(2);
    const result = admitCandidates(projectMemoryScope(workspace), candidates);
    expect(new Set(result.written).size).toBe(2);
    expect(listMemoryRecords(projectMemoryScope(workspace))).toHaveLength(2);
  });

  it.each([45, 500])("persists %i human facts while keeping the short index and prompt bounded", (count) => {
    const scope = projectMemoryScope(workspace);
    const statements = Array.from({ length: count }, (_, index) => `We use ledger${index} for domain${index}`);
    const candidates = extractUserDirectives(`${statements.join(".\n")}.`);
    expect(candidates).toHaveLength(count);
    const result = admitCandidates(scope, candidates);
    expect(result.written).toHaveLength(count);
    const records = listMemoryRecords(scope);
    expect(records).toHaveLength(count);
    expect(new Set(records.map((record) => record.index.hook))).toEqual(new Set(statements));
    expect(readMemoryIndex(scope).entries.length).toBeLessThanOrEqual(200);
    const context = buildMemoryContext(
      records,
      { text: `Investigate ledger${count - 1} for domain${count - 1}` },
      workspace,
    );
    expect(context.text).toContain(`ledger${count - 1}`);
    expect(context.text.length).toBeLessThan(9_000);
    expect(context.rules?.length).toBeLessThan(count);
  }, 30_000);

  it("recovers committed human topics in a new Bun process with no short index", () => {
    const scope = projectMemoryScope(workspace);
    expect(writeMemoryEntry(scope, human("auth-data", "Auth owns identity records in PostgreSQL")).ok).toBe(true);
    rmSync(memoryIndexPath(scope));
    const script = `import { loadMemoryRecords, projectMemoryScope } from ${JSON.stringify(pathToFileURL(resolve("src/memory/store.ts")).href)};
      const loaded = loadMemoryRecords(projectMemoryScope(${JSON.stringify(workspace)}));
      console.log(JSON.stringify({ complete: loaded.complete, hooks: loaded.records.map(r => r.index.hook) }));`;
    const output = execFileSync("bun", ["--eval", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20_000,
      env: {
        ...process.env,
        HOME: workspace,
        USERPROFILE: workspace,
        SHELRA_DIAGNOSTICS_LOG: "off",
        SHELRA_TRACE: "off",
      },
    });
    expect(JSON.parse(output)).toEqual({ complete: true, hooks: ["Auth owns identity records in PostgreSQL"] });
    expect(memoryContextFor(workspace, "investigate authentication").text).toContain(
      "Auth owns identity records in PostgreSQL",
    );
  });

  it("distinguishes a committed human topic from a failed short-index projection", () => {
    const scope = projectMemoryScope(workspace);
    mkdirSync(memoryIndexPath(scope), { recursive: true });
    const result = writeMemoryEntry(
      scope,
      human("billing-policy", "Billing rejects invoices without tenant ownership"),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projected).toBe(false);
      expect(result.projectionWarning).toContain("unavailable");
    }
    expect(readMemoryEntry(scope, "billing-policy").entry?.body).toContain("Billing rejects invoices");
    const loaded = loadMemoryRecords(scope);
    expect(loaded.records).toHaveLength(1);
    expect(loaded.complete).toBe(false);
    expect(memoryContextFor(workspace, "continue").text).toContain("MEMORY COVERAGE PARTIAL");
  });

  it("never resurrects superseded topics from a stale projection or an unindexed folder", () => {
    const scope = projectMemoryScope(workspace);
    expect(writeMemoryEntry(scope, human("auth-v1", "Auth uses PostgreSQL for identity storage")).ok).toBe(true);
    const staleProjection = readFileSync(memoryIndexPath(scope), "utf8");
    expect(writeMemoryEntry(scope, human("auth-v2", "Auth uses CockroachDB for identity storage")).ok).toBe(true);
    expect(supersedeMemoryEntry(scope, "auth-v1", "auth-v2")).toBe(true);
    writeFileSync(memoryIndexPath(scope), staleProjection);
    expect(listMemoryRecords(scope).map((record) => record.slug)).toEqual(["auth-v2"]);
    expect(readMemoryEntry(scope, "auth-v1").entry?.frontmatter.metadata.status).toBe("superseded");
    rmSync(memoryIndexPath(scope));
    expect(listMemoryRecords(scope).map((record) => record.slug)).toEqual(["auth-v2"]);
  });

  it("deletes both canonical and legacy copies without resurrecting the legacy source", () => {
    const scope = projectMemoryScope(workspace);
    const input = human("storage-policy", "Storage encrypts every tenant archive");
    expect(writeMemoryEntry(scope, { ...input, source: "inference" }).ok).toBe(true);
    const legacy = memoryEntryPath(scope, input.slug);
    expect(writeMemoryEntry(scope, input).ok).toBe(true);
    expect(memoryEntryPath(scope, input.slug)).not.toBe(legacy);
    expect(deleteMemoryEntry(scope, input.slug).ok).toBe(true);
    expect(readMemoryEntry(scope, input.slug).exists).toBe(false);
    expect(listMemoryRecords(scope)).toEqual([]);
  });

  it("does not retrieve a delivered reminder after its projection is removed", () => {
    const scope = projectMemoryScope(workspace);
    const input = extractUserDirectives("Remind me to review migration rollback when we touch billing")[0];
    expect(input).toBeDefined();
    expect(writeMemoryEntry(scope, input as MemoryWriteInput).ok).toBe(true);
    rmSync(memoryIndexPath(scope));
    expect(deliverReminder(scope, input?.slug ?? "missing", "delivered")).toBe(true);
    expect(listMemoryRecords(scope)).toEqual([]);
  });

  it("reports corrupt self-indexing topics instead of claiming an empty memory store", async () => {
    const scope = projectMemoryScope(workspace);
    mkdirSync(join(workspace, ".shelra", "memory", "human"), { recursive: true });
    writeFileSync(join(workspace, ".shelra", "memory", "human", "corrupt.md"), "broken metadata");
    const loaded = loadMemoryRecords(scope);
    expect(loaded.complete).toBe(false);
    expect(loaded.warnings.join(" ")).toContain("corrupt.md");
    expect(memoryContextFor(workspace, "continue").text).toContain("MEMORY COVERAGE PARTIAL");
    const tools = createTools(new BashTool(workspace), {} as never, "agent") as Record<
      string,
      { execute: (input: unknown, context?: unknown) => Promise<unknown> }
    >;
    const result = (await tools.memory_list.execute({}, {})) as { success: boolean; output: string };
    expect(result.success).toBe(false);
    expect(result.output).toContain("coverage partial");
    expect(result.output).not.toContain("No project memory saved yet");
  });

  it("refuses an external human-directory junction before reading or writing", () => {
    const scope = projectMemoryScope(workspace);
    const outside = mkdtempSync(join(tmpdir(), "shelra-human-outside-"));
    try {
      mkdirSync(join(workspace, ".shelra", "memory"), { recursive: true });
      symlinkSync(
        outside,
        join(workspace, ".shelra", "memory", "human"),
        process.platform === "win32" ? "junction" : "dir",
      );
      writeFileSync(join(outside, "forbidden.md"), "Unrelated external data must remain unchanged");
      expect(() =>
        writeMemoryEntry(scope, human("forbidden", "A statement must remain inside its memory scope")),
      ).toThrow("regular directory");
      expect(() => deleteMemoryEntry(scope, "forbidden")).toThrow("regular directory");
      expect(readFileSync(join(outside, "forbidden.md"), "utf8")).toBe("Unrelated external data must remain unchanged");
      expect(loadMemoryRecords(scope).complete).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refuses oversized human topics before committing them", () => {
    const scope = projectMemoryScope(workspace);
    expect(() =>
      writeMemoryEntry(scope, { ...human("too-big", "Oversized statement"), body: "a".repeat(HUMAN_TOPIC_MAX_BYTES) }),
    ).toThrow("exceeds");
    expect(readMemoryEntry(scope, "too-big").exists).toBe(false);
    expect(readMemoryIndex(scope).entries).toEqual([]);
  });

  it("paginates all 205 topics, including ones absent from the short index", async () => {
    const scope = projectMemoryScope(workspace);
    for (let index = 0; index < 205; index++)
      expect(writeMemoryEntry(scope, human(`topic-${index}`, `Domain${index} owns ledger${index}`)).ok).toBe(true);
    expect(readActiveMemoryIndex(scope).entries).toHaveLength(205);
    const tools = createTools(new BashTool(workspace), {} as never, "agent") as Record<
      string,
      { execute: (input: unknown, context?: unknown) => Promise<unknown> }
    >;
    const all: string[] = [];
    for (const offset of [0, 100, 200]) {
      const page = (await tools.memory_list.execute({ offset, limit: 100 }, {})) as {
        success: boolean;
        output: string;
      };
      expect(page.success).toBe(true);
      expect(page.output).toContain("of 205");
      all.push(...page.output.split("\n").filter((line) => line.startsWith("- ")));
    }
    expect(new Set(all).size).toBe(205);
    expect(all).toHaveLength(205);
    const read = (await tools.memory_read.execute({ slug: "topic-204" }, {})) as { success: boolean; output: string };
    expect(read.success).toBe(true);
    expect(read.output).toContain("Domain204 owns ledger204");
    const learned = {
      slug: "replica-failure",
      title: "Replica failure recovery",
      hook: "A quorum detects an unavailable replica",
      type: "conventions" as const,
      description: "A learned engineering fact",
      source: "inference" as const,
      body: "A quorum detects an unavailable replica through the coordinator heartbeat and reassigns its shard lease.",
    };
    expect(decideMemoryWrite(learned, listMemoryRecords(scope)).action).toBe("create");
    expect(writeMemoryEntry(scope, learned).ok).toBe(true);
    expect(readMemoryIndex(scope).entries).toHaveLength(200);
    expect(listMemoryRecords(scope)).toHaveLength(206);
    expect(
      listMemoryRecords(scope).filter((record) => record.entry.frontmatter.metadata.source === "human"),
    ).toHaveLength(205);
  }, 20_000);

  it("refuses a stale non-human write when the human source appeared after admission", () => {
    const scope = projectMemoryScope(workspace);
    const input = human("auth-store", "Auth owns identity state inside the identity service");
    const proposal = {
      ...input,
      source: "inference" as const,
      body: "Frontend state owns identity records independently.",
    };
    expect(decideMemoryWrite(proposal, []).action).toBe("create");
    expect(writeMemoryEntry(scope, input).ok).toBe(true);
    const before = readMemoryEntry(scope, input.slug).entry;
    expect(() => writeMemoryEntry(scope, proposal)).toThrow("non-human write");
    expect(readMemoryEntry(scope, input.slug).entry).toEqual(before);
  });
});
