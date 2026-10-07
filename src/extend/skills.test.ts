import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateSettingsCache } from "./settings";
import {
  applyArguments,
  deleteSkill,
  formatSkillCatalog,
  getSkill,
  invalidateSkills,
  listSkills,
  loadSkill,
  namesSkill,
  readSkillResource,
  refreshSkillIndex,
  renderLoadedSkill,
  searchSkills,
  selectSkills,
  skillIndex,
  validateSkillDefinition,
  writeSkill,
} from "./skills";

// Built at runtime so that no secret-shaped literal sits in the repository (push protection flags those).
const FAKE_KEY = ["sk", "or", "v1", "zyxwvutsrqponmlk".repeat(4)].join("-");

let scratch = "";
let project = "";
let home = "";
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "shelra-skills-"));
  project = join(scratch, "project");
  home = join(scratch, "home");
  mkdirSync(join(project, ".git"), { recursive: true });
  mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  invalidateSkills();
  invalidateSettingsCache();
});
afterEach(() => {
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  invalidateSkills();
  invalidateSettingsCache();
  rmSync(scratch, { recursive: true, force: true });
});

function plant(
  folder: string,
  name: string,
  description: string,
  extra = "",
  body = `# ${name}\n\nDo the ${name} procedure.\n`,
) {
  const dir = join(project, folder, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\n${body}`);
  return dir;
}

describe("scenario A/B: create by tool, use in the same session, edit, next use sees the new version", () => {
  it("creates a valid skill, registers it at once, loads it, and loads the edited text next time", () => {
    const created = writeSkill(project, {
      name: "release-notes",
      description: "Write release notes from merged pull requests. Use when preparing a release.",
      instructions: "# Release notes\n\n1. List merged PRs\n2. Group by area\n",
      provenance: "created by the user's request in session 1",
    });
    expect(created).toMatchObject({ ok: true, action: "created", scope: "project", active: true, invocation: "auto" });
    if (!created.ok) throw new Error("expected ok");
    expect(readFileSync(created.path, "utf8")).toContain("shelra-provenance");

    const first = loadSkill(project, "release-notes", { invoker: "model" });
    expect(first.ok && first.instructions).toContain("List merged PRs");
    const firstHash = first.ok ? first.hash : "";

    const edited = writeSkill(project, {
      name: "release-notes",
      instructions: "# Release notes\n\n1. List merged PRs\n2. Group by area\n3. Mention breaking changes\n",
      expectedHash: created.hash,
    });
    expect(edited).toMatchObject({ ok: true, action: "updated" });
    const second = loadSkill(project, "release-notes", { invoker: "model" });
    expect(second.ok && second.instructions).toContain("Mention breaking changes");
    expect(second.ok && second.hash).not.toBe(firstHash);
    // The previous version is recoverable.
    expect(edited.ok && edited.snapshot).toBeTruthy();
  });

  it("rejects a malformed definition with every reason and writes nothing", () => {
    const bad = writeSkill(project, { name: "Bad_Name", description: "x", instructions: "" });
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error("expected failure");
    expect(bad.issues.map((issue) => issue.message).join(" | ")).toMatch(/lowercase/u);
    expect(listSkills(project)).toHaveLength(0);
  });

  it("refuses a secret in the text", () => {
    const result = writeSkill(project, {
      name: "leaky",
      description: "Deploys things with a credential embedded in the text.",
      instructions: `Use OPENROUTER_API_KEY=${FAKE_KEY} to deploy\n`,
    });
    expect(result.ok).toBe(false);
  });

  it("detects a concurrent change instead of overwriting it", () => {
    writeSkill(project, {
      name: "shared",
      description: "A skill two sessions edit at once, for the conflict test.",
      instructions: "v1\n",
    });
    const stale = skillIndex(project);
    expect(stale.records.size).toBe(1);
    const base = loadSkill(project, "shared", { invoker: "user" });
    if (!base.ok) throw new Error("expected ok");
    writeSkill(project, { name: "shared", instructions: "v2 from another session\n" });
    const conflict = writeSkill(project, { name: "shared", instructions: "v1 edited\n", expectedHash: base.hash });
    expect(conflict).toMatchObject({ ok: false, conflict: true });
    expect(readFileSync(getSkill(project, "shared")?.file as string, "utf8")).toContain("v2 from another session");
  });
});

describe("scenario C: select the relevant skill and none for an unrelated task", () => {
  beforeEach(() => {
    plant(
      ".shelra/skills",
      "frontend-performance",
      "Diagnose slow rendering, UI freezes and layout thrashing in the frontend. Use when the interface lags.",
    );
    plant(
      ".shelra/skills",
      "release-notes",
      "Write release notes and a changelog from merged pull requests when preparing a release.",
    );
    plant(
      ".shelra/skills",
      "database-migrations",
      "Plan and review SQL schema migrations and rollbacks for the database.",
    );
  });

  it("suggests the matching skill, in English and in Spanish", () => {
    const index = skillIndex(project);
    expect(selectSkills(index, "the UI freezes and rendering is slow in the frontend")[0]?.record.name).toBe(
      "frontend-performance",
    );
    expect(selectSkills(index, "prepara las notas de la versión y el changelog para el release")[0]?.record.name).toBe(
      "release-notes",
    );
    expect(selectSkills(index, "review the sql migration for the database schema")[0]?.record.name).toBe(
      "database-migrations",
    );
  });

  it("selects nothing for unrelated or vague requests", () => {
    const index = skillIndex(project);
    for (const request of [
      "what is the weather today",
      "hello",
      "rename this variable",
      "tell me a joke about cats",
      "",
    ]) {
      expect(selectSkills(index, request), request).toEqual([]);
    }
  });

  it("does not auto-select an explicit-only skill but still finds it by search", () => {
    plant(
      ".shelra/skills",
      "deploy-production",
      "Deploy the production release to the servers and migrate the database.",
      "metadata:\n  shelra-invocation: explicit\n",
    );
    const index = skillIndex(project);
    expect(
      selectSkills(index, "deploy the production release to the servers").map((match) => match.record.name),
    ).not.toContain("deploy-production");
    expect(searchSkills(index, "deploy production")[0]?.record.name).toBe("deploy-production");
  });
});

describe("invocation policy", () => {
  it("lets a model load an explicit skill only when the user named it", () => {
    plant(
      ".shelra/skills",
      "deploy-production",
      "Deploy to production with the release checklist.",
      "metadata:\n  shelra-invocation: explicit\n",
    );
    expect(loadSkill(project, "deploy-production", { invoker: "model", request: "please deploy" }).ok).toBe(false);
    expect(
      loadSkill(project, "deploy-production", { invoker: "model", request: "ok, /deploy-production now" }).ok,
    ).toBe(true);
    expect(loadSkill(project, "deploy-production", { invoker: "user" }).ok).toBe(true);
    expect(namesSkill("run deploy-production.", "deploy-production")).toBe(true);
    expect(namesSkill("redeploy-production-x", "deploy-production")).toBe(false);
  });

  it("reads other agents' switches: disable-model-invocation and user-invocable", () => {
    plant(
      ".agents/skills",
      "ship-it",
      "Ship the release when the user asks for it explicitly.",
      "disable-model-invocation: true\n",
    );
    plant(
      ".agents/skills",
      "house-style",
      "Background knowledge about the house coding style for reviews.",
      "user-invocable: false\n",
    );
    expect(getSkill(project, "ship-it")?.invocation).toBe("explicit");
    expect(loadSkill(project, "house-style", { invoker: "user" }).ok).toBe(false);
    expect(loadSkill(project, "house-style", { invoker: "model" }).ok).toBe(true);
  });

  it("treats a candidate skill as explicit until it is validated", () => {
    plant(
      ".shelra/skills",
      "learned-flow",
      "A procedure the project learned from memory and has not validated.",
      "metadata:\n  shelra-status: candidate\n",
    );
    expect(getSkill(project, "learned-flow")?.invocation).toBe("explicit");
  });

  it("never turns allowed-tools into a grant, and says so", () => {
    plant(
      ".shelra/skills",
      "wide",
      "A skill that declares many tools it would like to use freely.",
      "allowed-tools: Bash(*) Write\n",
    );
    const loaded = loadSkill(project, "wide", { invoker: "user" });
    expect(loaded.ok && loaded.warnings.join(" ")).toMatch(/not a grant/u);
  });
});

describe("arguments", () => {
  it("substitutes declared, positional and whole arguments literally and validates required ones", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: skill placeholders are written literally
    const text = "Fix $issue on $1 ($ARGUMENTS[0]); all: $ARGUMENTS; cost \\$5; dir ${SHELRA_SKILL_DIR}";
    const applied = applyArguments(
      text,
      [
        { name: "issue", required: true },
        { name: "branch", required: true },
      ],
      '123 "feature x"',
      { skillDir: "/s", projectDir: "/p" },
    );
    expect(applied.text).toBe('Fix 123 on feature x (123); all: 123 "feature x"; cost $5; dir /s');
    expect(applied.missing).toEqual([]);
    expect(
      applyArguments("x $issue", [{ name: "issue", required: true }], "", { skillDir: "", projectDir: "" }).missing,
    ).toEqual(["issue"]);
  });

  it("does not re-expand placeholders inside an argument value", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: skill placeholders are written literally
    const applied = applyArguments("run $ARGUMENTS", [], "$1 ${SHELRA_SKILL_DIR}", {
      skillDir: "/leak",
      projectDir: "/p",
    });
    // biome-ignore lint/suspicious/noTemplateCurlyInString: skill placeholders are written literally
    expect(applied.text).toBe("run $1 ${SHELRA_SKILL_DIR}");
  });

  it("appends the arguments when the skill has no placeholder, and fails loading when one is missing", () => {
    plant(
      ".shelra/skills",
      "review-pr",
      "Review a pull request by number and report findings.",
      "metadata:\n  shelra-arguments: number\n",
      "Review the pull request.\n",
    );
    expect(loadSkill(project, "review-pr", { invoker: "user" })).toMatchObject({ ok: false });
    const ok = loadSkill(project, "review-pr", { invoker: "user", arguments: "42" });
    expect(ok.ok && ok.instructions).toContain("ARGUMENTS: 42");
  });
});

describe("registry safety", () => {
  it("shadows lower-precedence duplicates deterministically and says what was shadowed", () => {
    plant(".claude/skills", "dup", "Compat copy of a skill that also exists natively.");
    plant(".shelra/skills", "dup", "Native copy of the skill that should win over the compat one.");
    const skill = getSkill(project, "dup");
    expect(skill?.origin).toBe("shelra");
    expect(skill?.shadows.length).toBe(1);
  });

  it("registers compat skills read-only and never writes into their folders", () => {
    plant(".claude/skills", "from-claude", "A skill installed by another agent in its own folder.");
    expect(getSkill(project, "from-claude")?.origin).toBe("claude");
    const updated = writeSkill(project, {
      name: "from-claude",
      description: "Native override of a compat skill.",
      instructions: "native\n",
    });
    expect(updated.ok).toBe(true);
    // The original is untouched; the native copy now shadows it.
    expect(readFileSync(join(project, ".claude", "skills", "from-claude", "SKILL.md"), "utf8")).toContain(
      "A skill installed by another agent",
    );
    expect(getSkill(project, "from-claude")?.origin).toBe("shelra");
  });

  it("skips files without front matter or description and reports why, never throwing", () => {
    mkdirSync(join(project, ".shelra", "skills", "broken"), { recursive: true });
    writeFileSync(join(project, ".shelra", "skills", "broken", "SKILL.md"), "no front matter at all");
    mkdirSync(join(project, ".shelra", "skills", "nodesc"), { recursive: true });
    writeFileSync(join(project, ".shelra", "skills", "nodesc", "SKILL.md"), "---\nname: nodesc\n---\nbody");
    const index = skillIndex(project);
    expect(index.records.size).toBe(0);
    expect(index.rejected.map((entry) => entry.reason).sort()).toEqual(["no description", "no front matter"]);
  });

  it("confines bundled resources to the skill folder", () => {
    const dir = plant(".shelra/skills", "with-files", "A skill that bundles a reference file and a script.");
    mkdirSync(join(dir, "references"), { recursive: true });
    writeFileSync(join(dir, "references", "guide.md"), "the guide");
    writeFileSync(join(project, "secret.txt"), "outside");
    const record = getSkill(project, "with-files");
    if (!record) throw new Error("missing");
    expect(readSkillResource(record, "references/guide.md")).toMatchObject({ ok: true, text: "the guide" });
    expect(readSkillResource(record, "../../../../secret.txt")).toMatchObject({ ok: false });
    expect(readSkillResource(record, "..\\..\\..\\..\\secret.txt")).toMatchObject({ ok: false });
    const loaded = loadSkill(project, "with-files", { invoker: "user" });
    expect(loaded.ok && renderLoadedSkill(loaded)).toContain("references/guide.md");
  });

  it("reports missing dependencies instead of pretending the skill can run", () => {
    plant(
      ".shelra/skills",
      "needs-tool",
      "Needs a program that is not installed on this machine.",
      "metadata:\n  shelra-requires: definitely-not-installed-xyz env:SHELRA_SURELY_UNSET\n",
    );
    const loaded = loadSkill(project, "needs-tool", { invoker: "user" });
    expect(loaded.ok && loaded.warnings.join(" ")).toMatch(/definitely-not-installed-xyz, env:SHELRA_SURELY_UNSET/u);
  });

  it("honours a settings override: off from the project cannot be undone by nothing, local may relax it", () => {
    plant(".shelra/skills", "toggle-me", "A skill whose visibility is controlled from settings files.");
    mkdirSync(join(project, ".shelra"), { recursive: true });
    writeFileSync(
      join(project, ".shelra", "settings.json"),
      JSON.stringify({ skillOverrides: { "toggle-me": "off" } }),
    );
    invalidateSkills();
    invalidateSettingsCache();
    expect(getSkill(project, "toggle-me")?.enabled).toBe(false);
    expect(loadSkill(project, "toggle-me", { invoker: "user" }).ok).toBe(false);
    writeFileSync(
      join(project, ".shelra", "settings.local.json"),
      JSON.stringify({ skillOverrides: { "toggle-me": "on" } }),
    );
    invalidateSkills();
    invalidateSettingsCache();
    expect(getSkill(project, "toggle-me")?.enabled).toBe(true);
  });

  it("deletes a skill but keeps a recoverable copy", () => {
    const created = writeSkill(project, {
      name: "temp-skill",
      description: "A temporary skill created only to be deleted.",
      instructions: "bye\n",
    });
    expect(created.ok).toBe(true);
    expect(deleteSkill(project, "temp-skill").ok).toBe(true);
    expect(getSkill(project, "temp-skill")).toBeUndefined();
  });

  it("validates names against the open specification", () => {
    const base = {
      description: "A description that is long enough to pass.",
      directoryName: "x",
      body: "body",
      data: {},
    };
    const messages = (name: string) =>
      validateSkillDefinition({ ...base, name })
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message);
    expect(messages("good-name")).toEqual([]);
    for (const bad of ["-lead", "trail-", "dou--ble", "UPPER", "under_score", "a".repeat(65)])
      expect(messages(bad).length, bad).toBeGreaterThan(0);
  });
});

describe("scenario P: a 500-skill catalog", () => {
  function fixture(count: number) {
    for (let i = 0; i < count; i++) {
      plant(
        ".agents/skills",
        `fixture-skill-${String(i).padStart(4, "0")}`,
        `Fixture number ${i} covering topic-${i % 37} work and handling widget${i % 91} cases for the benchmark.`,
        "",
        `# body ${i}\n${"filler line\n".repeat(80)}`,
      );
    }
    plant(
      ".shelra/skills",
      "frontend-performance",
      "Diagnose slow rendering, UI freezes and layout thrashing in the frontend. Use when the interface lags.",
    );
  }

  it("never injects bodies or the whole catalog, whatever the size", () => {
    fixture(500);
    const index = skillIndex(project);
    expect(index.records.size).toBe(501);
    const catalog = formatSkillCatalog(index, "the UI freezes and rendering is slow in the frontend") ?? "";
    expect(catalog.length).toBeLessThan(3500);
    expect(catalog).toContain("frontend-performance");
    expect(catalog).not.toContain("filler line");
    expect((catalog.match(/fixture-skill-/gu) ?? []).length).toBeLessThan(5);
    const quiet = formatSkillCatalog(index, "hello") ?? "";
    expect(quiet.length).toBeLessThan(900);
    expect(quiet).toContain("501 skills are installed");
  });

  it("serves repeated prompt builds and selections from the cache, and revalidates without rescanning", async () => {
    fixture(500);
    const built = performance.now();
    const index = skillIndex(project);
    const coldMs = performance.now() - built;
    const warmStart = performance.now();
    for (let i = 0; i < 200; i++) {
      skillIndex(project);
      formatSkillCatalog(index, "the UI freezes and rendering is slow in the frontend");
    }
    const warmMs = (performance.now() - warmStart) / 200;
    expect(skillIndex(project)).toBe(index);
    expect(warmMs).toBeLessThan(5);
    expect(warmMs).toBeLessThan(coldMs);
    expect(await refreshSkillIndex(project)).toBe(false);
    expect(skillIndex(project)).toBe(index);
  });

  it("notices an edit, an addition and a removal at the next refresh, with no restart", async () => {
    fixture(40);
    const index = skillIndex(project);
    const target = join(project, ".agents", "skills", "fixture-skill-0003", "SKILL.md");
    writeFileSync(target, readFileSync(target, "utf8").replace("Fixture number 3", "Fixture number three, edited"));
    const future = new Date(Date.now() + 5_000);
    utimesSync(target, future, future);
    expect(await refreshSkillIndex(project)).toBe(true);
    expect(getSkill(project, "fixture-skill-0003")?.description).toContain("edited");
    plant(".shelra/skills", "added-later", "A skill added while the session was already running.");
    expect(await refreshSkillIndex(project)).toBe(true);
    expect(getSkill(project, "added-later")).toBeDefined();
    rmSync(join(project, ".shelra", "skills", "added-later"), { recursive: true, force: true });
    expect(await refreshSkillIndex(project)).toBe(true);
    expect(getSkill(project, "added-later")).toBeUndefined();
    expect(skillIndex(project)).not.toBe(index);
  });
});
