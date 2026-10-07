import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAgent, invalidateAgents, resolveAgent } from "./agents";
import {
  compatReport,
  importSkillFolder,
  translateClaudeAgent,
  translateClaudeHooks,
  translateMatcher,
} from "./compat";
import { toolAllowed } from "./policy";
import { invalidateSettingsCache } from "./settings";
import { getSkill, invalidateSkills } from "./skills";

let scratch = "";
let project = "";
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "shelra-compat-"));
  project = join(scratch, "project");
  mkdirSync(join(project, ".git"), { recursive: true });
  mkdirSync(join(scratch, "home"), { recursive: true });
  process.env.HOME = join(scratch, "home");
  process.env.USERPROFILE = join(scratch, "home");
  invalidateAgents();
  invalidateSkills();
  invalidateSettingsCache();
});
afterEach(() => {
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  invalidateAgents();
  invalidateSkills();
  rmSync(scratch, { recursive: true, force: true });
});

const plant = (rel: string, text: string) => {
  const path = join(project, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  return path;
};

function treeHash(dir: string): string {
  const hash = createHash("sha256");
  const walk = (current: string) => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else hash.update(full.slice(dir.length)).update(readFileSync(full));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

describe("translateClaudeAgent", () => {
  const agent = (front: string) =>
    translateClaudeAgent(
      "/x/a.md",
      `---\nname: a\ndescription: A compatible agent description for the tests.\n${front}---\nbody\n`,
    );

  it("translates tool names, plan mode and maxTurns, and says what it did", () => {
    const result = agent("tools: Read, Grep, Bash\npermissionMode: plan\nmaxTurns: 12\nmodel: opus\ncolor: red\n");
    if ("rejectedFile" in result) throw new Error("unexpected");
    expect(result.agent.tools).toEqual(["read_file", "grep", "bash"]);
    expect(result.agent.readOnly).toBe(true);
    expect(result.agent.maxSteps).toBe(12);
    expect(result.agent.model).toBe("inherit");
    expect(result.status).toBe("partial");
    expect(result.notes.join(" | ")).toMatch(/opus.*not a Shelra model/u);
    expect(result.agent.rejected).toBeUndefined();
  });

  it("rejects what would widen permissions or drop an isolation or control the agent relied on", () => {
    for (const front of [
      "permissionMode: bypassPermissions\n",
      "permissionMode: acceptEdits\n",
      "isolation: worktree\n",
      "mcpServers:\n  - evil\n",
      "hooks:\n  PreToolUse:\n    - matcher: Bash\n",
      "disallowedTools: Bash(rm *)\n",
    ]) {
      const result = agent(front);
      if ("rejectedFile" in result) throw new Error("unexpected");
      expect(result.status, front).toBe("rejected");
      expect(result.agent.rejected, front).toMatch(/incompatible/u);
    }
  });

  it("never turns a tool list that maps to nothing into 'inherit everything'", () => {
    const result = agent("tools: Bash(git *), NotebookEdit, mcp__github__create_issue\n");
    if ("rejectedFile" in result) throw new Error("unexpected");
    expect(result.agent.tools).toEqual(["skills"]);
    expect(result.status).toBe("partial");
    const policyTools = result.agent.tools;
    expect(policyTools).not.toContain("bash");
  });

  it("drops scoped tools instead of granting the whole tool", () => {
    const result = agent("tools: Read, Edit(src/**)\n");
    if ("rejectedFile" in result) throw new Error("unexpected");
    expect(result.agent.tools).toEqual(["read_file"]);
  });

  it("rejects files without front matter or description", () => {
    expect(translateClaudeAgent("/x/n.md", "no front matter")).toEqual({ rejectedFile: "no front matter" });
    expect(translateClaudeAgent("/x/n.md", "---\nname: n\n---\nx")).toEqual({ rejectedFile: "no description" });
  });
});

describe("hooks translation", () => {
  it("maps tool matchers and keeps only command hooks on events Shelra fires", () => {
    const hooks = translateClaudeHooks(
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: "./check.sh", timeout: 30 }] }],
          PostToolUse: [
            {
              matcher: "Bash",
              hooks: [
                { type: "http", url: "http://x" },
                { type: "prompt", prompt: "decide" },
              ],
            },
          ],
          FileChanged: [{ hooks: [{ type: "command", command: "echo" }] }],
          Stop: [{ hooks: [{ type: "command", command: "echo $CLAUDE_PROJECT_DIR" }] }],
        },
      }),
    );
    const byKey = (event: string, command: string) =>
      hooks.find((hook) => hook.event === event && hook.command === command);
    expect(byKey("PreToolUse", "./check.sh")).toMatchObject({
      matcher: "edit_file|write_file",
      status: "translated",
      timeout: 30,
    });
    expect(hooks.filter((hook) => hook.event === "PostToolUse").every((hook) => hook.status === "rejected")).toBe(true);
    expect(byKey("FileChanged", "echo")?.status).toBe("rejected");
    expect(byKey("Stop", "echo $CLAUDE_PROJECT_DIR")?.status).toBe("partial");
    expect(translateMatcher("mcp__x__y")).toEqual({ matcher: undefined, unmapped: ["mcp__x__y"] });
  });

  it("returns nothing for settings it cannot read", () => {
    expect(translateClaudeHooks("not json")).toEqual([]);
    expect(translateClaudeHooks("{}")).toEqual([]);
  });
});

describe("scenario L: import compatible configuration and diagnose the rest without touching the originals", () => {
  beforeEach(() => {
    plant(
      ".claude/agents/reviewer.md",
      "---\nname: reviewer\ndescription: Reviews code changes for problems before merge.\ntools: Read, Grep\npermissionMode: plan\n---\nReview.\n",
    );
    plant(
      ".claude/agents/yolo.md",
      "---\nname: yolo\ndescription: An agent that skips every approval it would be asked for.\npermissionMode: bypassPermissions\n---\nDo anything.\n",
    );
    plant(
      ".claude/skills/pdf-tools/SKILL.md",
      "---\nname: pdf-tools\ndescription: Extract text and tables from PDF files and merge documents.\nallowed-tools: Bash(pdftotext *)\n---\n# PDF\nRun pdftotext.\n",
    );
    plant(".claude/skills/pdf-tools/scripts/extract.sh", "echo extract\n");
    plant(
      ".agents/skills/shared-skill/SKILL.md",
      "---\nname: shared-skill\ndescription: A cross-client skill that every agent can read directly.\n---\nbody\n",
    );
    plant(
      ".claude/settings.json",
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] }] },
      }),
    );
    plant("CLAUDE.md", "# For Claude\n");
    plant("AGENTS.md", "# For everyone\n");
  });

  it("reports a status and the reasons for each item", () => {
    const report = compatReport(project);
    const find = (kind: string, name: string) => report.find((item) => item.kind === kind && item.name === name);
    expect(find("agent", "reviewer")).toMatchObject({ status: "translated", importable: true });
    expect(find("agent", "yolo")).toMatchObject({ status: "rejected", importable: false });
    expect(find("agent", "yolo")?.notes.join(" ")).toMatch(/approvals/u);
    expect(find("skill", "pdf-tools")?.status).toBe("partial");
    expect(find("skill", "shared-skill")).toMatchObject({ status: "supported", importable: false });
    expect(find("hook", "PreToolUse:bash")).toMatchObject({ status: "translated", importable: true });
    expect(find("hook", "PreToolUse:bash")?.notes.join(" ")).toMatch(/trust/u);
    expect(find("instructions", "CLAUDE.md")).toBeDefined();
  });

  it("uses compatible agents and skills in place, blocks the incompatible one, and loads nothing twice", () => {
    expect(getAgent(project, "reviewer")).toMatchObject({
      origin: "claude",
      readOnly: true,
      tools: ["read_file", "grep"],
    });
    const reviewer = resolveAgent(project, "reviewer", "r");
    if (!reviewer.ok) throw new Error(reviewer.reason);
    expect(toolAllowed(reviewer.agent.policy, "write_file")).toBe(false);
    const yolo = resolveAgent(project, "yolo", "r");
    expect(yolo.ok).toBe(false);
    expect(yolo.ok ? "" : yolo.reason).toMatch(/permission model/u);
    expect(getSkill(project, "pdf-tools")?.origin).toBe("claude");
    expect(getSkill(project, "shared-skill")?.origin).toBe("agents");
  });

  it("imports a skill folder into .shelra/skills with resources, and never alters the original", () => {
    const before = treeHash(join(project, ".claude"));
    const item = compatReport(project).find((entry) => entry.kind === "skill" && entry.name === "pdf-tools");
    if (!item) throw new Error("missing");
    const result = importSkillFolder(project, item);
    expect(result.written).toHaveLength(1);
    expect(readFileSync(join(project, ".shelra", "skills", "pdf-tools", "scripts", "extract.sh"), "utf8")).toContain(
      "extract",
    );
    expect(treeHash(join(project, ".claude"))).toBe(before);
    invalidateSkills();
    // The native copy shadows the compat original: one skill, loaded once.
    expect(getSkill(project, "pdf-tools")?.origin).toBe("shelra");
    expect(importSkillFolder(project, item).skipped).toMatch(/already exists/u);
  });
});
