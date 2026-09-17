import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatMemoryForChat } from "./report";
import { appendReflectionAudit, projectMemoryScope, recordMemoryUse, writeMemoryEntry } from "./store";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "shelra-memory-report-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("memory report", () => {
  it("explains an empty store", () => {
    const text = formatMemoryForChat(workspace);
    expect(text).toContain("No project memory saved yet.");
    expect(text).toContain(".shelra/memory/");
  });

  it("lists entries by type with provenance, usage, timeline, and the last capture", () => {
    const scope = projectMemoryScope(workspace);
    writeMemoryEntry(scope, {
      slug: "schema-generation",
      title: "Schema generation",
      hook: "run bun run prepare:schema before tests",
      type: "procedure",
      description: "codegen step",
      body: "Run `bun run prepare:schema` to regenerate src/generated/schema.ts after editing schema/model.json.",
      source: "observed",
      confidence: 0.9,
    });
    recordMemoryUse(scope, ["schema-generation"]);
    appendReflectionAudit(scope, {
      at: "2026-09-17T22:24:54.000Z",
      qualified: true,
      reason: "verified change",
      candidates: 1,
      decisions: [{ slug: "schema-generation", action: "create", reason: "novel" }],
      written: ["schema-generation"],
    });

    const text = formatMemoryForChat(workspace);
    expect(text).toContain("Project memory (1 entry)");
    expect(text).toContain("procedure:");
    expect(text).toContain("- Schema generation (schema-generation) — run bun run prepare:schema before tests");
    expect(text).toContain("observed · 90% · used 1x");
    expect(text).toContain("Recent changes:");
    expect(text).toContain("created schema-generation");
    expect(text).toContain(
      "Last automatic capture (2026-09-17 22:24): verified change; decisions: schema-generation:create",
    );
  });
});
