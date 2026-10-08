import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectStaleness } from "./retrieval";
import {
  listMemoryRecords,
  projectMemoryScope,
  readMemoryEntry,
  recordMemoryCommandEvidence,
  writeMemoryEntry,
} from "./store";

let workspace: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "shelra-memory-command-evidence-"));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(workspace, { recursive: true, force: true });
});

describe("command execution does not confirm arbitrary knowledge", () => {
  it("does not carry a previous content confirmation onto a rewritten claim", () => {
    const scope = projectMemoryScope(workspace);
    const input = {
      slug: "database-owner",
      title: "Database owner",
      hook: "Auth owns identity data",
      type: "architecture" as const,
      source: "inference" as const,
      description: "An architectural claim",
      body: "Auth owns identity data in its database. Run `bun run typecheck`.",
    };
    expect(writeMemoryEntry(scope, { ...input, confirmed: true }).ok).toBe(true);
    expect(readMemoryEntry(scope, input.slug).entry?.frontmatter.metadata.lastConfirmed).toBeDefined();
    expect(recordMemoryCommandEvidence(scope, ["bun run typecheck"])).toEqual([input.slug]);
    expect(readMemoryEntry(scope, input.slug).entry?.frontmatter.metadata.lastPassedCommand).toBe("bun run typecheck");
    expect(
      writeMemoryEntry(scope, {
        ...input,
        hook: "Billing owns identity data",
        body: "Billing owns identity data in its database.",
      }).ok,
    ).toBe(true);
    expect(readMemoryEntry(scope, input.slug).entry?.frontmatter.metadata.lastConfirmed).toBeUndefined();
    expect(readMemoryEntry(scope, input.slug).entry?.frontmatter.metadata.lastPassedCommand).toBeUndefined();
    expect(readMemoryEntry(scope, input.slug).entry?.frontmatter.metadata.commandObservedAt).toBeUndefined();
  });
  it("keeps a changed storage claim stale even after a real typecheck passes", () => {
    const scope = projectMemoryScope(workspace);
    const file = join(workspace, "database.ts");
    writeFileSync(file, 'export const databaseDriver = "postgresql";\n');
    const compiler = resolve("node_modules/typescript/bin/tsc").replaceAll("\\", "/");
    writeFileSync(
      join(workspace, "package.json"),
      JSON.stringify({ scripts: { typecheck: `node "${compiler}" --project .` } }),
    );
    writeFileSync(
      join(workspace, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: true, types: [] }, files: ["database.ts"] }),
    );
    expect(
      writeMemoryEntry(scope, {
        slug: "storage-driver",
        title: "Storage driver",
        hook: "The storage driver is PostgreSQL",
        type: "architecture",
        description: "Observed initial configuration",
        source: "observed",
        confirmed: true,
        relatedFiles: ["database.ts"],
        body: "The storage driver is PostgreSQL. Validate types with `bun run typecheck`.",
      }).ok,
    ).toBe(true);
    const initial = readMemoryEntry(scope, "storage-driver").entry?.frontmatter.metadata.lastConfirmed;
    const changed = new Date(Date.now() + 30_000);
    writeFileSync(file, 'export const databaseDriver = "cockroachdb";\n');
    utimesSync(file, changed, changed);
    const result = execFileSync("bun", ["run", "typecheck"], {
      cwd: workspace,
      encoding: "utf8",
      windowsHide: true,
      timeout: 20_000,
      env: {
        ...process.env,
        HOME: workspace,
        USERPROFILE: workspace,
        SHELRA_TRACE: "off",
        SHELRA_DIAGNOSTICS_LOG: "off",
      },
    });
    expect(result).toBe("");
    vi.useFakeTimers();
    vi.setSystemTime(new Date(changed.getTime() + 30_000));
    expect(recordMemoryCommandEvidence(scope, ["bun run typecheck"])).toEqual(["storage-driver"]);
    const record = listMemoryRecords(scope).find((item) => item.slug === "storage-driver");
    expect(record).toBeDefined();
    expect(record?.entry.frontmatter.metadata.lastConfirmed).toBe(initial);
    expect(record?.entry.frontmatter.metadata.lastPassedCommand).toBe("bun run typecheck");
    expect(record?.entry.frontmatter.metadata.recalls).toHaveLength(1);
    expect(readMemoryEntry(scope, "storage-driver").entry?.frontmatter.metadata.commandObservedAt).toBe(
      new Date().toISOString(),
    );
    if (record) expect(detectStaleness(workspace, record).stale).toBe(true);
  });

  it("does not certify a new inference merely because it was persisted", () => {
    const scope = projectMemoryScope(workspace);
    expect(
      writeMemoryEntry(scope, {
        slug: "possible-owner",
        title: "Possible ownership",
        hook: "Billing might own the invoice queue",
        type: "architecture",
        source: "inference",
        description: "A proposal without evidence",
        body: "Billing might own the invoice queue; inspect its callers to confirm.",
      }).ok,
    ).toBe(true);
    expect(readMemoryEntry(scope, "possible-owner").entry?.frontmatter.metadata.lastConfirmed).toBeUndefined();
  });

  it("does not refresh an unconfirmed claim when its prose is edited after a source change", () => {
    const scope = projectMemoryScope(workspace);
    mkdirSync(join(workspace, "src"));
    const file = join(workspace, "src", "owner.ts");
    writeFileSync(file, 'export const owner = "billing";\n');
    const input = {
      slug: "invoice-owner",
      title: "Invoice owner",
      hook: "Billing owns invoices",
      type: "architecture" as const,
      source: "inference" as const,
      relatedFiles: ["src/owner.ts"],
      description: "Unconfirmed ownership",
      body: "Billing owns invoices and processes their queue.",
    };
    expect(writeMemoryEntry(scope, { ...input, confirmed: false }).ok).toBe(true);
    const origin = readMemoryEntry(scope, input.slug).entry?.frontmatter.metadata.created;
    const changed = new Date(Date.now() + 30_000);
    writeFileSync(file, 'export const owner = "ledger";\n');
    utimesSync(file, changed, changed);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(changed.getTime() + 30_000));
    expect(writeMemoryEntry(scope, { ...input, body: `${input.body} This wording is clearer.` }).ok).toBe(true);
    const record = listMemoryRecords(scope)[0];
    expect(record?.entry.frontmatter.metadata.created).toBe(origin);
    expect(record?.entry.frontmatter.metadata.lastConfirmed).toBeUndefined();
    if (record) expect(detectStaleness(workspace, record).stale).toBe(true);
  });
});
