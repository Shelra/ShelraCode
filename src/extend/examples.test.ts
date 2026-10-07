import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  awaitBackgroundHooks,
  clearHookRunLog,
  executeEventHooks,
  invalidateHookCache,
  recentHookRuns,
  resolveHooks,
} from "../hooks/index";
import { getAgent, invalidateAgents, resolveAgent } from "./agents";
import { runExtensionCommand } from "./commands";
import { approvePendingHooks } from "./hooks-admin";
import { loadInstructionSet } from "./instructions";
import { toolAllowed } from "./policy";
import { invalidateSettingsCache } from "./settings";
import { getSkill, invalidateSkills, loadSkill, readSkillResource, selectSkills, skillIndex } from "./skills";
import { invalidateTrustCache } from "./trust";

/** The examples shipped in docs/examples/extensions are the real thing: this loads them through the real registries. */
const EXAMPLES = join(__dirname, "..", "..", "docs", "examples", "extensions");

let scratch = "";
let project = "";
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "shelra-examples-"));
  project = join(scratch, "project");
  mkdirSync(join(project, ".git"), { recursive: true });
  mkdirSync(join(scratch, "home"), { recursive: true });
  process.env.HOME = join(scratch, "home");
  process.env.USERPROFILE = join(scratch, "home");
  cpSync(join(EXAMPLES, "SHELRA.md"), join(project, "SHELRA.md"));
  cpSync(join(EXAMPLES, "skills"), join(project, ".shelra", "skills"), { recursive: true });
  cpSync(join(EXAMPLES, "agents"), join(project, ".shelra", "agents"), { recursive: true });
  cpSync(join(EXAMPLES, "rules"), join(project, ".shelra", "rules"), { recursive: true });
  cpSync(join(EXAMPLES, "hooks", "settings.json"), join(project, ".shelra", "settings.json"));
  for (const reset of [
    invalidateAgents,
    invalidateSkills,
    invalidateSettingsCache,
    invalidateHookCache,
    invalidateTrustCache,
    clearHookRunLog,
  ])
    reset();
});
afterEach(() => {
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("the shipped examples", () => {
  it("the skill is valid, selectable for the task it describes, loadable, and its resource is readable", () => {
    const validated = skillIndex(project).records.get("frontend-performance");
    expect(validated?.diagnostics.filter((note) => note.startsWith("error:"))).toEqual([]);
    expect(selectSkills(skillIndex(project), "the interface lags and scrolling stutters")[0]?.record.name).toBe(
      "frontend-performance",
    );
    expect(selectSkills(skillIndex(project), "rename a variable in the parser")).toEqual([]);
    const loaded = loadSkill(project, "frontend-performance", { invoker: "model" });
    expect(loaded.ok && loaded.instructions).toContain("Measure before changing anything");
    expect(loaded.ok && loaded.warnings).toEqual([]);
    const record = getSkill(project, "frontend-performance");
    expect(record && readSkillResource(record, "references/measuring.md")).toMatchObject({ ok: true });
  });

  it("the agent is valid, read-only, and gets the skill preloaded", () => {
    expect(getAgent(project, "performance-investigator")).toMatchObject({
      readOnly: true,
      maxSteps: 40,
      timeoutMinutes: 15,
    });
    const resolved = resolveAgent(project, "performance-investigator", "run-example");
    if (!resolved.ok) throw new Error(resolved.reason);
    expect(resolved.agent.preloaded.map((skill) => skill.name)).toEqual(["frontend-performance"]);
    expect(resolved.agent.instructions).toContain("Verified facts");
    expect(toolAllowed(resolved.agent.policy, "read_file")).toBe(true);
    expect(toolAllowed(resolved.agent.policy, "write_file")).toBe(false);
  });

  it("the instructions load, and the rule applies only to the files it names", () => {
    const quiet = loadInstructionSet(project, { paths: ["src/agent/agent.ts"] });
    expect(quiet.text).toContain("Install: `bun install`");
    expect(quiet.text).not.toContain("Colors only through `theme.ts`");
    const ui = loadInstructionSet(project, { paths: ["src/ui/app.tsx"] });
    expect(ui.text).toContain("Colors only through `theme.ts`");
  });

  it("the hooks are proposals until approved; then the lockfile guard blocks before the edit and the logger only observes", async () => {
    const pending = resolveHooks(project).hooks;
    expect(pending.map((hook) => `${hook.id}:${hook.state}`).sort()).toEqual([
      "log-edits:pending",
      "protect-lockfiles:pending",
    ]);
    const input = (path: string) => ({
      hook_event_name: "PreToolUse" as const,
      tool_name: "write_file",
      tool_input: { path },
      cwd: project,
    });
    expect((await executeEventHooks(input("bun.lock"), project)).blocked).toBe(false);
    approvePendingHooks(project);
    invalidateHookCache();
    expect((await executeEventHooks(input("bun.lock"), project)).blocked).toBe(true);
    expect((await executeEventHooks(input("package-lock.json"), project)).blocked).toBe(true);
    expect((await executeEventHooks(input("src/index.ts"), project)).blocked).toBe(false);
    await executeEventHooks(
      {
        hook_event_name: "PostToolUse",
        tool_name: "write_file",
        tool_input: { path: "a.ts" },
        tool_output: {},
        cwd: project,
      },
      project,
    );
    await awaitBackgroundHooks(5_000);
    const log = recentHookRuns();
    expect(log.find((run) => run.hookId === "protect-lockfiles" && run.effect === "prevented")).toBeDefined();
    expect(log.find((run) => run.hookId === "log-edits")).toMatchObject({ effect: "observed" });
  });

  it("the doctor finds nothing wrong with them", async () => {
    const doctor = await runExtensionCommand({ root: project, cwd: project }, "doctor", []);
    expect(doctor.output).toContain("No errors found.");
  });
});
