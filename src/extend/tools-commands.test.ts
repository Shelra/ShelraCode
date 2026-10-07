import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateHookCache, resolveHooks } from "../hooks/index";
import { getAgent, invalidateAgents } from "./agents";
import { expandSkillInvocation, runExtensionCommand, splitCommand } from "./commands";
import { approvePendingHooks } from "./hooks-admin";
import { invalidateSettingsCache } from "./settings";
import { getSkill, invalidateSkills } from "./skills";
import { createExtensionTools, type ExtensionToolContext } from "./tools";
import { invalidateTrustCache } from "./trust";

// Built at runtime so that no secret-shaped literal sits in the repository (push protection flags those).
const FAKE_KEY = ["sk", "or", "v1", "zyxwvutsrqponmlk".repeat(4)].join("-");

let scratch = "";
let project = "";
let home = "";
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "shelra-tools-"));
  project = join(scratch, "project");
  home = join(scratch, "home");
  mkdirSync(join(project, ".git"), { recursive: true });
  mkdirSync(join(home, ".shelra"), { recursive: true });
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  for (const reset of [
    invalidateAgents,
    invalidateSkills,
    invalidateSettingsCache,
    invalidateHookCache,
    invalidateTrustCache,
  ])
    reset();
});
afterEach(() => {
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

interface Recorded {
  skillLoads: Array<{ name: string; hash: string; invoker: string }>;
  changes: Array<{ kind: string; name: string; action: string }>;
}

function makeContext(overrides: Partial<ExtensionToolContext> = {}): { ctx: ExtensionToolContext; recorded: Recorded } {
  const recorded: Recorded = { skillLoads: [], changes: [] };
  const ctx: ExtensionToolContext = {
    root: () => project,
    cwd: () => project,
    sessionId: () => "session-test",
    request: () => "",
    onSkillLoaded: (event) => recorded.skillLoads.push(event),
    onChange: (event) => recorded.changes.push(event),
    loaded: new Map(),
    createdHooks: new Set(),
    ...overrides,
  };
  return { ctx, recorded };
}

type Result = { success: boolean; output: string; [key: string]: unknown };
const run = async (
  tools: ReturnType<typeof createExtensionTools>,
  name: string,
  input: Record<string, unknown>,
): Promise<Result> =>
  (await (tools[name] as unknown as { execute: (input: unknown, options: unknown) => Promise<Result> }).execute(
    input,
    {},
  )) as Result;
const json = (result: Result) => JSON.parse(result.output) as Record<string, unknown>;

const writeSkillFile = (name: string, extra = "", body = "# Steps\n\n1. Do it\n") => {
  const dir = join(project, ".shelra", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: A description of ${name} long enough to be useful for selection.\n${extra}---\n${body}`,
  );
  invalidateSkills();
};

describe("the skill tool", () => {
  it("loads a skill, tells the runtime, wraps it with its version and resources, and loads each version once per turn", async () => {
    writeSkillFile("deploy-notes");
    mkdirSync(join(project, ".shelra", "skills", "deploy-notes", "references"), { recursive: true });
    writeFileSync(join(project, ".shelra", "skills", "deploy-notes", "references", "guide.md"), "the guide text");
    const { ctx, recorded } = makeContext();
    const tools = createExtensionTools(ctx, { writable: false });
    const first = await run(tools, "skill", { name: "deploy-notes" });
    expect(first.success).toBe(true);
    expect(first.output).toContain('<skill_content name="deploy-notes" version="');
    expect(first.output).toContain("references/guide.md");
    expect(recorded.skillLoads).toHaveLength(1);
    const again = await run(tools, "skill", { name: "deploy-notes" });
    expect(again.output).toMatch(/already loaded in this turn/u);
    expect(recorded.skillLoads).toHaveLength(1);
    const resource = await run(tools, "skill", { name: "deploy-notes", resource: "references/guide.md" });
    expect(resource.output).toBe("the guide text");
    expect((await run(tools, "skill", { name: "deploy-notes", resource: "../../../../outside.txt" })).success).toBe(
      false,
    );
  });

  it("refuses an explicit-only skill the user did not name, and accepts it when they did", async () => {
    writeSkillFile("ship-it", "metadata:\n  shelra-invocation: explicit\n");
    let request = "please deploy";
    const { ctx } = makeContext({ request: () => request });
    const tools = createExtensionTools(ctx, { writable: false });
    expect((await run(tools, "skill", { name: "ship-it" })).output).toMatch(/only when the user names it/u);
    request = "run /ship-it now";
    expect((await run(tools, "skill", { name: "ship-it" })).success).toBe(true);
  });

  it("runs a skill that declares an agent through that agent, not in the conversation", async () => {
    writeSkillFile(
      "deep-dive",
      "metadata:\n  shelra-context: agent\n  shelra-agent: explore\n",
      "Investigate $ARGUMENTS thoroughly.\n",
    );
    let seen: { agent: string; prompt: string } | null = null;
    const { ctx } = makeContext({
      runTask: async (request) => {
        seen = { agent: String(request.agent), prompt: request.prompt };
        return { success: true, output: "agent result" };
      },
    });
    const result = await run(createExtensionTools(ctx, { writable: false }), "skill", {
      name: "deep-dive",
      arguments: "the build",
    });
    expect(seen).toEqual({ agent: "explore", prompt: expect.stringContaining("Investigate the build thoroughly.") });
    expect(result.output).toMatch(/ran in the "explore" agent/u);
    expect((result.skill as { ranInAgent?: string }).ranInAgent).toBe("explore");
  });

  it("a delegated agent's tool set has no way to write definitions", () => {
    const { ctx } = makeContext({ agentName: "reviewer" });
    expect(Object.keys(createExtensionTools(ctx, { writable: false }))).toEqual(["skill", "extensions"]);
  });
});

describe("the extensions tool", () => {
  it("lists, searches, inspects and diagnoses", async () => {
    writeSkillFile("frontend-performance");
    writeFileSync(join(project, "SHELRA.md"), "# Project\nUse bun.\n");
    const { ctx } = makeContext();
    const tools = createExtensionTools(ctx, { writable: false });
    expect((await run(tools, "extensions", { action: "list", kind: "skill" })).output).toContain(
      "frontend-performance",
    );
    expect((await run(tools, "extensions", { action: "search", query: "frontend performance" })).output).toContain(
      "frontend-performance",
    );
    expect(
      (await run(tools, "extensions", { action: "inspect", kind: "skill", name: "frontend-performance" })).output,
    ).toContain("file:");
    expect((await run(tools, "extensions", { action: "instructions" })).output).toContain(
      "SHELRA.md in the project root",
    );
    expect((await run(tools, "extensions", { action: "doctor" })).output).toContain("No errors found.");
    expect((await run(tools, "extensions", { action: "compat" })).output).toMatch(
      /SHELRA.md|Nothing from other agents/u,
    );
    expect((await run(tools, "extensions", { action: "inspect", kind: "skill" })).success).toBe(false);
  });
});

describe("extension_write: what a model may and may not do", () => {
  const tools = () => createExtensionTools(makeContext().ctx, { writable: true });

  it("creates, validates, updates, switches and deletes a skill, each with a verifiable result", async () => {
    const { ctx, recorded } = makeContext();
    const t = createExtensionTools(ctx, { writable: true });
    const created = json(
      await run(t, "extension_write", {
        kind: "skill",
        action: "create",
        name: "release-flow",
        description: "How to cut a release: bump, tag, publish, announce, in order.",
        instructions: "1. Bump\n2. Tag\n",
      }),
    );
    expect(created).toMatchObject({ ok: true, action: "created", active: true, registered: true });
    expect(created.path).toBeTruthy();
    expect(
      json(await run(t, "extension_write", { kind: "skill", action: "validate", name: "release-flow" })),
    ).toMatchObject({ ok: true });
    const updated = json(
      await run(t, "extension_write", {
        kind: "skill",
        action: "update",
        name: "release-flow",
        instructions: "1. Bump\n2. Tag\n3. Publish\n",
        expected_hash: created.hash,
      }),
    );
    expect(updated).toMatchObject({ ok: true, action: "updated" });
    expect(getSkill(project, "release-flow")?.dir).toContain("release-flow");
    const stale = await run(t, "extension_write", {
      kind: "skill",
      action: "update",
      name: "release-flow",
      instructions: "x\n",
      expected_hash: created.hash,
    });
    expect(stale.success).toBe(false);
    expect(json(stale)).toMatchObject({ conflict: true });
    const off = json(
      await run(t, "extension_write", { kind: "skill", action: "set_enabled", name: "release-flow", enabled: "off" }),
    );
    expect(off).toMatchObject({ ok: true, effective: "off" });
    expect(getSkill(project, "release-flow")?.enabled).toBe(false);
    expect(
      json(
        await run(t, "extension_write", { kind: "skill", action: "set_enabled", name: "release-flow", enabled: "on" }),
      ),
    ).toMatchObject({ ok: true, effective: "on" });
    const deleted = json(await run(t, "extension_write", { kind: "skill", action: "delete", name: "release-flow" }));
    expect(deleted).toMatchObject({ ok: true });
    expect(deleted.recoverableFrom).toBeTruthy();
    expect(recorded.changes.map((change) => change.action)).toEqual([
      "created",
      "updated",
      "set off",
      "set on",
      "deleted",
    ]);
  });

  it("cannot lift a restriction the person set in their own settings", async () => {
    writeSkillFile("guarded");
    writeFileSync(join(home, ".shelra", "user-settings.json"), JSON.stringify({ skillOverrides: { guarded: "off" } }));
    invalidateSettingsCache();
    invalidateSkills();
    const result = await run(tools(), "extension_write", {
      kind: "skill",
      action: "set_enabled",
      name: "guarded",
      enabled: "on",
    });
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/only the person can lift/u);
    expect(getSkill(project, "guarded")?.enabled).toBe(false);
  });

  it("creates an agent, refuses a malformed one, and an agent's own tools cannot write agents", async () => {
    const t = tools();
    const bad = await run(t, "extension_write", {
      kind: "agent",
      action: "create",
      name: "explore",
      description: "x",
      instructions: "y",
    });
    expect(bad.success).toBe(false);
    expect(json(bad).reason).toMatch(/built-in/u);
    const created = json(
      await run(t, "extension_write", {
        kind: "agent",
        action: "create",
        name: "qa",
        description: "Runs the tests and reports failures exactly.",
        instructions: "Run the tests.",
        tools: ["read", "shell"],
      }),
    );
    expect(created).toMatchObject({ ok: true, active: true });
    expect(getAgent(project, "qa")?.tools).toEqual(["read", "shell"]);
    const delegated = createExtensionTools(makeContext({ agentName: "qa" }).ctx, { writable: true });
    expect(
      (
        await run(delegated, "extension_write", {
          kind: "agent",
          action: "create",
          name: "other",
          description: "Another agent created by an agent.",
          instructions: "x",
        })
      ).success,
    ).toBe(false);
    expect(
      (await run(delegated, "extension_write", { kind: "instructions", action: "update", content: "x", section: "A" }))
        .success,
    ).toBe(false);
  });

  it("proposes a hook that stays inert until a person approves it, and cannot change or remove it afterwards", async () => {
    const { ctx } = makeContext();
    const t = createExtensionTools(ctx, { writable: true });
    const created = json(
      await run(t, "extension_write", {
        kind: "hook",
        action: "create",
        hook: {
          event: "PostToolUse",
          matcher: "edit_file|write_file",
          command: "echo validated",
          id: "validate-after-edit",
        },
      }),
    );
    expect(created).toMatchObject({ ok: true, id: "validate-after-edit", state: "pending" });
    expect(String(created.needsApproval)).toContain("shelra hooks approve");
    expect((created.notes as string[]).join(" ")).toMatch(/cannot prevent anything/u);
    expect(resolveHooks(project).hooks[0]?.state).toBe("pending");
    // The model may test the hook it just wrote; it may not switch it on.
    const tested = json(await run(t, "extension_write", { kind: "hook", action: "test", name: "validate-after-edit" }));
    expect(tested).toMatchObject({ ok: true, effect: "observed" });
    expect(
      (
        await run(t, "extension_write", {
          kind: "hook",
          action: "set_enabled",
          name: "validate-after-edit",
          enabled: "on",
        })
      ).success,
    ).toBe(false);
    // The person approves; now the model can no longer edit or delete it.
    approvePendingHooks(project, ["validate-after-edit"]);
    invalidateHookCache();
    expect(resolveHooks(project).hooks[0]?.state).toBe("active");
    const edit = await run(t, "extension_write", {
      kind: "hook",
      action: "update",
      name: "validate-after-edit",
      hook: { event: "PostToolUse", command: "echo harmless" },
    });
    expect(edit.success).toBe(false);
    expect(json(edit).reason).toMatch(/only the person can change an approved hook/u);
    const remove = await run(t, "extension_write", { kind: "hook", action: "delete", name: "validate-after-edit" });
    expect(remove.success).toBe(false);
    expect(resolveHooks(project).hooks[0]?.state).toBe("active");
  });

  it("will not run a hook that came from a repository file and was never approved", async () => {
    mkdirSync(join(project, ".shelra"), { recursive: true });
    writeFileSync(
      join(project, ".shelra", "settings.json"),
      JSON.stringify({
        hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "echo from-repo", id: "repo-hook" }] }] },
      }),
    );
    invalidateSettingsCache();
    invalidateHookCache();
    const result = await run(tools(), "extension_write", { kind: "hook", action: "test", name: "repo-hook" });
    expect(result.success).toBe(false);
    expect(json(result).reason).toMatch(/has not been approved/u);
  });

  it("rejects invalid hook definitions with the reason", async () => {
    const t = tools();
    for (const hook of [
      { event: "Nope", command: "x" },
      { event: "PreToolUse", command: "x", timeout: 99999 },
      { event: "PreToolUse", command: "x", async: true, failure_policy: "closed" },
      { event: "PreToolUse", command: " " },
    ]) {
      const result = await run(t, "extension_write", { kind: "hook", action: "create", hook });
      expect(result.success, JSON.stringify(hook)).toBe(false);
    }
  });

  it("updates SHELRA.md with a verified result, and refuses a secret", async () => {
    writeFileSync(join(project, "SHELRA.md"), "# Project\n");
    const t = tools();
    const result = json(
      await run(t, "extension_write", {
        kind: "instructions",
        action: "update",
        target: "project",
        section: "Conventions",
        content: "Use 2-space indentation.",
      }),
    );
    expect(result).toMatchObject({ ok: true, verified: true, changed: true });
    expect(readFileSync(join(project, "SHELRA.md"), "utf8")).toContain("Use 2-space indentation.");
    expect(
      (
        await run(t, "extension_write", {
          kind: "instructions",
          action: "update",
          section: "X",
          content: `key ${FAKE_KEY}`,
        })
      ).success,
    ).toBe(false);
  });
});

describe("commands a person types", () => {
  const context = () => ({ root: project, cwd: project });

  it("splits a command line honouring quotes", () => {
    expect(splitCommand('show "my skill" two')).toEqual(["show", "my skill", "two"]);
  });

  it("lists, shows, validates and switches skills, and promotes a candidate (only a person can)", async () => {
    writeSkillFile("alpha-skill");
    writeSkillFile("learned", "metadata:\n  shelra-status: candidate\n");
    expect((await runExtensionCommand(context(), "skills", [])).output).toContain("alpha-skill");
    expect((await runExtensionCommand(context(), "skills", ["show", "learned"])).output).toContain("status: candidate");
    expect((await runExtensionCommand(context(), "skills", ["validate", "alpha-skill"])).ok).toBe(true);
    expect(getSkill(project, "learned")?.invocation).toBe("explicit");
    const promoted = await runExtensionCommand(context(), "skills", ["promote", "learned"]);
    expect(promoted.ok).toBe(true);
    expect(getSkill(project, "learned")?.invocation).toBe("auto");
    expect(getSkill(project, "learned")?.status).toBe("validated");
    expect((await runExtensionCommand(context(), "skills", ["promote", "alpha-skill"])).ok).toBe(false);
    expect((await runExtensionCommand(context(), "skills", ["off", "alpha-skill"])).ok).toBe(true);
    expect(getSkill(project, "alpha-skill")?.enabled).toBe(false);
    expect((await runExtensionCommand(context(), "skills", ["search", "nothing-matches-this-at-all"])).output).toMatch(
      /No skill matches/u,
    );
    expect((await runExtensionCommand(context(), "skills", ["bogus"])).ok).toBe(false);
  });

  it("lists agents and their runs, and a person can switch one off", async () => {
    mkdirSync(join(project, ".shelra", "agents"), { recursive: true });
    writeFileSync(
      join(project, ".shelra", "agents", "auditor.md"),
      "---\nname: auditor\ndescription: Audits changes and reports problems found in them.\naccess: read-only\n---\nAudit.\n",
    );
    invalidateAgents();
    const list = await runExtensionCommand(context(), "agents", []);
    expect(list.output).toContain("auditor [project, shelra, read-only]");
    expect((await runExtensionCommand(context(), "agents", ["show", "auditor"])).output).toContain("access: read-only");
    expect((await runExtensionCommand(context(), "agents", ["off", "auditor"])).ok).toBe(true);
    expect(getAgent(project, "auditor")?.enabled).toBe(false);
    expect((await runExtensionCommand(context(), "agents", ["edit"])).openAgentEditor).toBe(true);
    expect((await runExtensionCommand(context(), "agents", ["runs"])).output).toMatch(
      /No delegated runs|Delegated runs/u,
    );
  });

  it("approves pending hooks by id, tests them, and removes them", async () => {
    mkdirSync(join(project, ".shelra"), { recursive: true });
    writeFileSync(
      join(project, ".shelra", "settings.json"),
      JSON.stringify({ hooks: { SessionEnd: [{ hooks: [{ type: "command", command: "echo bye", id: "bye" }] }] } }),
    );
    invalidateSettingsCache();
    invalidateHookCache();
    expect((await runExtensionCommand(context(), "hooks", [])).output).toContain("[pending]");
    expect((await runExtensionCommand(context(), "hooks", ["test", "bye"])).ok).toBe(false);
    expect((await runExtensionCommand(context(), "hooks", ["approve", "nope"])).ok).toBe(false);
    expect((await runExtensionCommand(context(), "hooks", ["approve", "bye"])).output).toContain("Approved 1 hook");
    const tested = await runExtensionCommand(context(), "hooks", ["test", "bye"]);
    expect(tested.ok).toBe(true);
    expect(JSON.parse(tested.output)).toMatchObject({ ok: true, effect: "observed" });
    expect((await runExtensionCommand(context(), "hooks", ["remove", "bye"])).ok).toBe(true);
    invalidateHookCache();
    expect(resolveHooks(project).hooks[0]?.state).toBe("pending");
  });

  it("shows the instructions in force and the doctor's findings", async () => {
    writeFileSync(join(project, "SHELRA.md"), "@missing-file.md\nBe brief.\n");
    const instructions = await runExtensionCommand(context(), "instructions", []);
    expect(instructions.output).toContain("SHELRA.md in the project root");
    expect(instructions.output).toContain("was not found");
    const doctor = await runExtensionCommand(context(), "doctor", []);
    expect(doctor.output).toContain("Instructions:");
  });

  it("runs `/<skill> args` as the user: explicit skills run, reserved names and unknown names do not", () => {
    writeSkillFile(
      "ship-it",
      "metadata:\n  shelra-invocation: explicit\n  shelra-arguments: target\n",
      "Ship to $target now.\n",
    );
    writeSkillFile("review", "", "A skill that shares its name with a built-in command.\n");
    const ok = expandSkillInvocation(context(), "/ship-it staging");
    expect(ok && "message" in ok && ok.message).toContain("Ship to staging now.");
    expect(ok && "message" in ok && ok.message.startsWith("/ship-it staging")).toBe(true);
    const missing = expandSkillInvocation(context(), "/ship-it");
    expect(missing && "error" in missing && missing.error).toMatch(/needs "target"/u);
    expect(expandSkillInvocation(context(), "/review")).toBeNull();
    expect(expandSkillInvocation(context(), "/no-such-skill")).toBeNull();
    expect(expandSkillInvocation(context(), "just text")).toBeNull();
  });

  it("imports other agents' configuration with --apply, leaves the originals alone, and proposes hooks as pending", async () => {
    mkdirSync(join(project, ".claude", "agents"), { recursive: true });
    writeFileSync(
      join(project, ".claude", "agents", "scout.md"),
      "---\nname: scout\ndescription: Scouts the codebase for the files a change touches.\ntools: Read, Grep\npermissionMode: plan\n---\nScout.\n",
    );
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(
      join(project, ".claude", "settings.json"),
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo guard" }] }] },
      }),
    );
    const dry = await runExtensionCommand(context(), "extensions", ["import"]);
    expect(dry.output).toContain("Would import");
    expect(getAgent(project, "scout")?.origin).toBe("claude");
    const applied = await runExtensionCommand(context(), "extensions", ["import", "--apply"]);
    expect(applied.output).toContain("imported agent scout");
    expect(applied.output).toMatch(/proposed hook .* \(pending/u);
    invalidateAgents();
    const native = getAgent(project, "scout");
    expect(native).toMatchObject({ origin: "shelra", readOnly: true, tools: ["read_file", "grep"] });
    expect(readFileSync(join(project, ".shelra", "agents", "scout.md"), "utf8")).toContain("provenance:");
    expect(readFileSync(join(project, ".claude", "agents", "scout.md"), "utf8")).toContain("permissionMode: plan");
    expect(resolveHooks(project).hooks.every((hook) => hook.state === "pending")).toBe(true);
  });
});

describe("scaffolds, export and import from any folder", () => {
  const context = () => ({ root: project, cwd: project });

  it("`/skills new` writes a valid skill from a name and a description, and refuses what is not one", async () => {
    const made = await runExtensionCommand(context(), "skills", [
      "new",
      "release-flow",
      "How to cut a release: bump, tag, publish, announce, in that order.",
    ]);
    expect(made.ok).toBe(true);
    expect(made.output).toContain("SKILL.md");
    expect(getSkill(project, "release-flow")?.description).toContain("bump, tag, publish");
    expect((await runExtensionCommand(context(), "skills", ["validate", "release-flow"])).ok).toBe(true);
    expect((await runExtensionCommand(context(), "skills", ["new", "Bad Name", "x"])).ok).toBe(false);
    expect((await runExtensionCommand(context(), "skills", ["new", "only-a-name"])).ok).toBe(false);
  });

  it("`/agents new` writes a read-only agent by default", async () => {
    const made = await runExtensionCommand(context(), "agents", [
      "new",
      "scout",
      "Reads the code base to find the files a change touches.",
    ]);
    expect(made.ok).toBe(true);
    expect(getAgent(project, "scout")).toMatchObject({ readOnly: true });
    expect(
      (await runExtensionCommand(context(), "agents", ["new", "explore", "taken name for a built-in agent"])).ok,
    ).toBe(false);
  });

  it("exports a skill with its resources to a folder, and imports it into another project", async () => {
    writeSkillFile("portable");
    mkdirSync(join(project, ".shelra", "skills", "portable", "scripts"), { recursive: true });
    writeFileSync(join(project, ".shelra", "skills", "portable", "scripts", "run.sh"), "echo hi\n");
    const target = join(scratch, "exported");
    const exported = await runExtensionCommand(context(), "skills", ["export", "portable", target]);
    expect(exported.ok).toBe(true);
    expect(readFileSync(join(target, "portable", "scripts", "run.sh"), "utf8")).toBe("echo hi\n");
    expect(readFileSync(join(target, "portable", "SKILL.md"), "utf8")).toContain("name: portable");

    const other = join(scratch, "other");
    mkdirSync(join(other, ".git"), { recursive: true });
    const imported = await runExtensionCommand({ root: other, cwd: other }, "skills", [
      "import",
      join(target, "portable"),
    ]);
    expect(imported.ok).toBe(true);
    expect(readFileSync(join(other, ".shelra", "skills", "portable", "scripts", "run.sh"), "utf8")).toBe("echo hi\n");
    expect(readFileSync(join(other, ".shelra", "skills", "portable", "SKILL.md"), "utf8")).toContain("imported from");
    // Never over an existing skill, and never something that is not a skill.
    expect(
      (await runExtensionCommand({ root: other, cwd: other }, "skills", ["import", join(target, "portable")])).ok,
    ).toBe(false);
    mkdirSync(join(scratch, "not-a-skill"), { recursive: true });
    writeFileSync(join(scratch, "not-a-skill", "README.md"), "x");
    expect(
      (await runExtensionCommand({ root: other, cwd: other }, "skills", ["import", join(scratch, "not-a-skill")])).ok,
    ).toBe(false);
  });

  it("exports an agent to a file", async () => {
    await runExtensionCommand(context(), "agents", [
      "new",
      "scout",
      "Reads the code base to find the files a change touches.",
    ]);
    const file = join(scratch, "scout.md");
    expect((await runExtensionCommand(context(), "agents", ["export", "scout", file])).ok).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("name: scout");
    expect((await runExtensionCommand(context(), "agents", ["export", "nope", file])).ok).toBe(false);
  });
});

describe("asFencedText", () => {
  it("keeps Windows paths and aligned lines intact, and cannot be closed early by text that has a code block", async () => {
    const { asFencedText } = await import("./commands");
    const path = String.raw`file: C:\Users\me\.shelra\x`;
    expect(asFencedText(`${path}\n  indented`)).toBe(`\`\`\`text\n${path}\n  indented\n\`\`\``);
    const inner = asFencedText("before\n```ts\ncode\n```\nafter\n");
    expect(inner.startsWith("````text\n")).toBe(true);
    expect(inner.endsWith("\n````")).toBe(true);
  });
});
