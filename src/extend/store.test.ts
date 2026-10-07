import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contentHash, listVersions, removeDefinition, writeDefinition } from "./store";

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "shelra-store-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("writeDefinition", () => {
  it("creates, reads back, snapshots the previous version and reports every hash", () => {
    const scopeDir = scratch();
    const path = join(scopeDir, "skills", "demo", "SKILL.md");
    const created = writeDefinition({ path, content: "one\n", kind: "skill", name: "demo", scopeDir });
    expect(created).toMatchObject({ ok: true, created: true, changed: true, previousHash: null, snapshot: null });
    const updated = writeDefinition({ path, content: "two\n", kind: "skill", name: "demo", scopeDir });
    expect(updated.ok && updated.created).toBe(false);
    if (!updated.ok) throw new Error("expected ok");
    expect(updated.previousHash).toBe(contentHash("one\n"));
    expect(readFileSync(path, "utf8")).toBe("two\n");
    expect(updated.snapshot && readFileSync(updated.snapshot, "utf8")).toBe("one\n");
    expect(listVersions(scopeDir, "skill", "demo")).toHaveLength(1);
  });

  it("writes nothing when the content is identical", () => {
    const scopeDir = scratch();
    const path = join(scopeDir, "a.md");
    writeDefinition({ path, content: "same", kind: "rule", name: "a", scopeDir });
    const again = writeDefinition({ path, content: "same", kind: "rule", name: "a", scopeDir });
    expect(again).toMatchObject({ ok: true, changed: false, snapshot: null });
    expect(listVersions(scopeDir, "rule", "a")).toHaveLength(0);
  });

  it("refuses a write based on a stale read instead of losing someone else's change", () => {
    const scopeDir = scratch();
    const path = join(scopeDir, "agents", "qa.md");
    writeDefinition({ path, content: "v1", kind: "agent", name: "qa", scopeDir });
    writeDefinition({ path, content: "v2 (another session)", kind: "agent", name: "qa", scopeDir });
    const stale = writeDefinition({
      path,
      content: "v1 edited",
      kind: "agent",
      name: "qa",
      scopeDir,
      expectedHash: contentHash("v1"),
    });
    expect(stale).toMatchObject({ ok: false, conflict: true, currentHash: contentHash("v2 (another session)") });
    expect(readFileSync(path, "utf8")).toBe("v2 (another session)");
  });

  it("keeps only the requested number of versions and leaves no temporary files", () => {
    const scopeDir = scratch();
    const path = join(scopeDir, "x.md");
    for (let i = 0; i < 6; i++)
      writeDefinition({ path, content: `v${i}`, kind: "rule", name: "x", scopeDir, keepVersions: 3 });
    expect(listVersions(scopeDir, "rule", "x")).toHaveLength(3);
    expect(readdirSync(scopeDir).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  });

  it("serializes concurrent writers so none is lost or torn", async () => {
    const scopeDir = scratch();
    const path = join(scopeDir, "c.md");
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        Promise.resolve().then(() =>
          writeDefinition({ path, content: `writer-${i}`, kind: "rule", name: "c", scopeDir }),
        ),
      ),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(readFileSync(path, "utf8")).toMatch(/^writer-\d+$/u);
  });

  it("removes a definition but keeps its last version for recovery", () => {
    const scopeDir = scratch();
    const path = join(scopeDir, "s", "SKILL.md");
    writeDefinition({ path, content: "keep me", kind: "skill", name: "s", scopeDir });
    const removed = removeDefinition({ path, kind: "skill", name: "s", scopeDir });
    expect(removed.ok).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(readFileSync(listVersions(scopeDir, "skill", "s")[0] as string, "utf8")).toBe("keep me");
  });
});
