import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateSettingsCache } from "./settings";
import { listSkills } from "./skills";
import {
  applySystemPromptCustomization,
  describeSystemPrompt,
  resolveSystemPrompt,
  setSessionPromptFlags,
  writeProfile,
} from "./system-prompt";

// Built at runtime so that no secret-shaped literal sits in the repository (push protection flags those).
const FAKE_KEY = ["sk", "or", "v1", "zyxwvutsrqponmlk".repeat(4)].join("-");

let scratch = "";
let project = "";
let home = "";
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "shelra-prompt-"));
  project = join(scratch, "project");
  home = join(scratch, "home");
  mkdirSync(join(project, ".git"), { recursive: true });
  mkdirSync(join(home, ".shelra"), { recursive: true });
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  setSessionPromptFlags(null);
  invalidateSettingsCache();
});
afterEach(() => {
  setSessionPromptFlags(null);
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  invalidateSettingsCache();
  rmSync(scratch, { recursive: true, force: true });
});

const BASE =
  "You are ShelraCode, a coding agent.\n\nENVIRONMENT:\nshell facts\n\nSTANDARDS:\n- Never claim a result you did not observe.";

describe("applySystemPromptCustomization", () => {
  it("appends without touching the base", () => {
    const resolved = { appended: "Always answer in French.", role: null, sources: [], problems: [] };
    const text = applySystemPromptCustomization(BASE, resolved);
    expect(text.startsWith(BASE)).toBe(true);
    expect(text).toContain("ADDITIONAL INSTRUCTIONS");
    expect(text).toContain("Always answer in French.");
  });

  it("replaces only the opening role paragraph and keeps the operating rules", () => {
    const text = applySystemPromptCustomization(BASE, {
      appended: null,
      role: "You are a careful reviewer.",
      sources: [],
      problems: [],
    });
    expect(text.startsWith("You are a careful reviewer.")).toBe(true);
    expect(text).not.toContain("You are ShelraCode");
    expect(text).toContain("ENVIRONMENT:");
    expect(text).toContain("STANDARDS:");
    expect(text).toContain("Never claim a result you did not observe.");
  });

  it("is a no-op when nothing is customized", () => {
    expect(applySystemPromptCustomization(BASE, { appended: null, role: null, sources: [], problems: [] })).toBe(BASE);
  });
});

describe("resolveSystemPrompt: layers, files, profiles and flags", () => {
  it("adds text from the user, project and local settings in that order, then the command line", () => {
    writeFileSync(join(home, ".shelra", "user-settings.json"), JSON.stringify({ systemPrompt: { append: "USER" } }));
    mkdirSync(join(project, ".shelra"), { recursive: true });
    writeFileSync(join(project, ".shelra", "settings.json"), JSON.stringify({ systemPrompt: { append: "PROJECT" } }));
    writeFileSync(
      join(project, ".shelra", "settings.local.json"),
      JSON.stringify({ systemPrompt: { append: "LOCAL" } }),
    );
    setSessionPromptFlags({ append: "FLAG" });
    const resolved = resolveSystemPrompt(project);
    expect(resolved.appended).toBe("USER\n\nPROJECT\n\nLOCAL\n\nFLAG");
    expect(resolved.sources.map((source) => source.label)).toEqual([
      "user settings (append)",
      "project settings (append)",
      "local settings (append)",
      "--append-system-prompt",
    ]);
    expect(resolved.sources.every((source) => /^[0-9a-f]{12}$/u.test(source.hash))).toBe(true);
  });

  it("reads a file at each call, so an edit applies from the next turn, and reports a missing file", () => {
    const file = join(scratch, "extra.md");
    writeFileSync(file, "first version");
    setSessionPromptFlags({ appendFile: file });
    expect(resolveSystemPrompt(project).appended).toBe("first version");
    writeFileSync(file, "second version");
    expect(resolveSystemPrompt(project).appended).toBe("second version");
    setSessionPromptFlags({ appendFile: join(scratch, "missing.md"), file: join(scratch, "also-missing.md") });
    const missing = resolveSystemPrompt(project);
    expect(missing.appended).toBeNull();
    expect(missing.problems.join(" ")).toMatch(/does not exist/u);
  });

  it("the most specific replacement role wins, and the command line beats settings", () => {
    mkdirSync(join(project, ".shelra"), { recursive: true });
    writeFileSync(join(project, "role.md"), "You are the project's role.");
    writeFileSync(join(project, ".shelra", "settings.json"), JSON.stringify({ systemPrompt: { file: "role.md" } }));
    expect(resolveSystemPrompt(project).role).toBe("You are the project's role.");
    const flagFile = join(scratch, "flag-role.md");
    writeFileSync(flagFile, "You are the flag's role.");
    setSessionPromptFlags({ file: flagFile });
    expect(resolveSystemPrompt(project).role).toBe("You are the flag's role.");
  });

  it("writes, selects and edits a named profile, keeping the previous version", () => {
    const first = writeProfile(project, { name: "terse", text: "Answer in at most three sentences.", mode: "append" });
    expect(first).toMatchObject({ ok: true, created: true });
    setSessionPromptFlags({ profile: "terse" });
    expect(resolveSystemPrompt(project).appended).toBe("Answer in at most three sentences.");
    const second = writeProfile(project, { name: "terse", text: "Answer in one sentence.", mode: "append" });
    expect(second.ok && second.snapshot).toBeTruthy();
    expect(resolveSystemPrompt(project).appended).toBe("Answer in one sentence.");
    writeProfile(project, { name: "persona", text: "You are a security reviewer.", mode: "replace" });
    setSessionPromptFlags({ profile: "persona" });
    expect(resolveSystemPrompt(project).role).toBe("You are a security reviewer.");
    setSessionPromptFlags({ profile: "nope" });
    expect(resolveSystemPrompt(project).problems.join(" ")).toMatch(/was not found/u);
    expect(writeProfile(project, { name: "Bad Name", text: "x", mode: "append" }).ok).toBe(false);
    expect(
      writeProfile(project, {
        name: "leaky",
        text: `key ${FAKE_KEY}`,
        mode: "append",
      }).ok,
    ).toBe(false);
  });

  it("explains what is in force, and what a replacement does and does not change", () => {
    expect(describeSystemPrompt(project)).toMatch(/Shelra's own/u);
    setSessionPromptFlags({ append: "x", file: join(scratch, "r.md") });
    writeFileSync(join(scratch, "r.md"), "You are X.");
    const text = describeSystemPrompt(project);
    expect(text).toContain("REPLACES the role paragraph");
    expect(text).toContain("everything the host enforces");
    expect(readFileSync(join(scratch, "r.md"), "utf8")).toBe("You are X.");
  });
});

describe("a skill promoted from memory is a candidate until a person validates it", () => {
  it("lands in .shelra/skills as explicit-only with its provenance", async () => {
    const { projectMemoryScope, writeMemoryEntry, listMemoryRecords, creditMemoryUse } = await import(
      "../memory/store"
    );
    const { proposeProceduresAsSkills, approveSkillProposal, skillPathFor } = await import("../memory/skills");
    const scope = projectMemoryScope(project);
    writeMemoryEntry(scope, {
      slug: "regenerate-client",
      title: "Regenerate the API client",
      hook: "after editing openapi.yaml run bun run codegen then bun test",
      type: "procedure",
      description: "Codegen",
      body: "1. Edit openapi.yaml\n2. Run `bun run codegen` (writes src/generated/)\n3. Run `bun test` and commit the generated client.",
      source: "observed",
      confidence: 0.9,
    });
    creditMemoryUse(scope, ["regenerate-client"], 1);
    creditMemoryUse(scope, ["regenerate-client"], 1);
    expect(proposeProceduresAsSkills(scope, project, listMemoryRecords(scope)).proposed).toEqual(["regenerate-client"]);
    const result = approveSkillProposal(scope, project, "regenerate-client");
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/candidate/u);
    expect(skillPathFor(project, "regenerate-client")).toContain(join(".shelra", "skills"));
    const skill = listSkills(project).find((entry) => entry.name === "regenerate-client");
    expect(skill).toMatchObject({ status: "candidate", invocation: "explicit", origin: "shelra" });
    expect(skill?.provenance).toContain("promoted from project memory");
  });
});
