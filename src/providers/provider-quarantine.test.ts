import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadQuarantinedProviders, QUARANTINE_TTL_MS, recordQuarantinedProvider } from "./provider-quarantine";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "shelra-quarantine-"));
  path = join(dir, "nested", "provider-quarantine.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("provider quarantine store", () => {
  it("remembers a quarantined upstream per model and expires it", () => {
    const now = Date.parse("2026-09-17T12:00:00.000Z");
    recordQuarantinedProvider({ model: "openrouter/qwen/x", provider: "Novita", reason: "empty step" }, { path, now });

    expect(loadQuarantinedProviders("openrouter/qwen/x", { path, now }).map((entry) => entry.provider)).toEqual([
      "Novita",
    ]);
    expect(loadQuarantinedProviders("openrouter/other", { path, now })).toEqual([]);
    expect(loadQuarantinedProviders("openrouter/qwen/x", { path, now: now + QUARANTINE_TTL_MS + 1 })).toEqual([]);
    expect(JSON.parse(readFileSync(path, "utf8")).entries).toHaveLength(1);
  });

  it("replaces an older entry for the same pair and drops expired ones on write", () => {
    const now = Date.parse("2026-09-17T12:00:00.000Z");
    recordQuarantinedProvider(
      { model: "m", provider: "Old", reason: "x", quarantinedAt: new Date(now - QUARANTINE_TTL_MS - 1).toISOString() },
      { path, now: now - QUARANTINE_TTL_MS - 1 },
    );
    recordQuarantinedProvider({ model: "m", provider: "Novita", reason: "first" }, { path, now });
    recordQuarantinedProvider({ model: "m", provider: "Novita", reason: "second" }, { path, now: now + 1000 });

    const entries = JSON.parse(readFileSync(path, "utf8")).entries as Array<{ provider: string; reason: string }>;
    expect(entries).toEqual([{ model: "m", provider: "Novita", reason: "second", quarantinedAt: expect.any(String) }]);
  });

  it("treats a corrupt store as empty instead of failing", () => {
    recordQuarantinedProvider({ model: "m", provider: "A", reason: "x" }, { path });
    rmSync(path);
    expect(loadQuarantinedProviders("m", { path })).toEqual([]);
  });
});
