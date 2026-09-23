import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  activeDecisions,
  approveDecision,
  formatDecision,
  LEDGER_DIR,
  listDecisions,
  parseDecision,
  proposeDecision,
  rejectDecision,
} from "./store";

let workspace: string;
const day = new Date("2026-09-23T12:00:00Z");

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "shelra-ledger-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const english = {
  title: "Everything committed is English",
  rule: "Code, documentation, UI text and commit messages are written in English.",
  why: "The repository is public and its readers are international.",
  evidence: "CLAUDE.md, the owner's standing rules.",
  source: "user" as const,
};

describe("decision ledger", () => {
  it("records a proposal in the repository, and only the user's approval makes it a commitment", () => {
    const proposed = proposeDecision(workspace, { ...english, scope: ["src/**", "docs/**"] }, day);
    expect(proposed).toMatchObject({ ok: true, decision: { id: "D-0001", status: "proposed" } });
    if (!proposed.ok) return;
    expect(proposed.decision.file).toBe(`${LEDGER_DIR}/0001-everything-committed-is-english.md`);
    expect(existsSync(join(workspace, proposed.decision.file))).toBe(true);
    expect(activeDecisions(workspace)).toEqual([]);

    const approved = approveDecision(workspace, "d-0001", day);
    expect(approved).toMatchObject({ ok: true, decision: { status: "active", approved: "2026-09-23" } });
    expect(activeDecisions(workspace).map((decision) => decision.id)).toEqual(["D-0001"]);
    expect(approveDecision(workspace, "D-0001")).toMatchObject({ ok: false });
  });

  it("supersedes a decision without erasing it", () => {
    proposeDecision(workspace, english, day);
    approveDecision(workspace, "D-0001", day);
    const replacement = proposeDecision(
      workspace,
      { ...english, title: "Code is English, chat follows the user", supersedes: "D-0001" },
      day,
    );
    expect(replacement).toMatchObject({ ok: true, decision: { id: "D-0002", supersedes: "D-0001" } });
    approveDecision(workspace, "D-0002", day);

    const [first, second] = listDecisions(workspace);
    expect(first).toMatchObject({ id: "D-0001", status: "superseded", supersededBy: "D-0002" });
    expect(second).toMatchObject({ id: "D-0002", status: "active" });
    expect(proposeDecision(workspace, { ...english, title: "Other", supersedes: "D-0001" })).toMatchObject({
      ok: false,
    });
  });

  it("drops a rejected proposal and never numbers two decisions the same", () => {
    proposeDecision(workspace, english, day);
    const second = proposeDecision(workspace, { ...english, title: "Tests run with bun run test" }, day);
    expect(rejectDecision(workspace, "D-0002")).toMatchObject({ ok: true });
    expect(second.ok && existsSync(join(workspace, second.decision.file))).toBe(false);
    expect(proposeDecision(workspace, { ...english, title: "A third one" }, day)).toMatchObject({
      decision: { id: "D-0002" },
    });
  });

  it("refuses proposals that are not a clear, bounded rule inside the project", () => {
    expect(proposeDecision(workspace, { ...english, rule: " " })).toMatchObject({ ok: false });
    expect(proposeDecision(workspace, { ...english, title: "two\nlines" })).toMatchObject({ ok: false });
    expect(proposeDecision(workspace, { ...english, scope: ["../other/**"] })).toMatchObject({ ok: false });
    expect(proposeDecision(workspace, { ...english, scope: ["C:/elsewhere"] })).toMatchObject({ ok: false });
    expect(proposeDecision(workspace, { ...english, check: "bun test\nrm -rf ." })).toMatchObject({ ok: false });
    proposeDecision(workspace, english, day);
    expect(proposeDecision(workspace, { ...english, title: "everything committed is  English!" })).toMatchObject({
      ok: false,
      reason: expect.stringContaining("D-0001"),
    });
  });

  it("round-trips its file format and leaves foreign files in the folder alone", () => {
    const proposed = proposeDecision(
      workspace,
      { ...english, scope: ["src/**"], check: "bun run lint", source: "instructions" },
      day,
    );
    if (!proposed.ok) throw new Error(proposed.reason);
    const text = readFileSync(join(workspace, proposed.decision.file), "utf8");
    expect(parseDecision(text, "0001-everything-committed-is-english.md")).toEqual(proposed.decision);
    expect(formatDecision(proposed.decision)).toBe(text);

    mkdirSync(join(workspace, LEDGER_DIR), { recursive: true });
    writeFileSync(join(workspace, LEDGER_DIR, "0002-use-postgres.md"), "# Use Postgres\n\nStatus: accepted\n");
    writeFileSync(join(workspace, LEDGER_DIR, "README.md"), "Decisions of this project.\n");
    expect(listDecisions(workspace).map((decision) => decision.id)).toEqual(["D-0001"]);
  });
});
