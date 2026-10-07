/**
 * The tools a model uses to work with its own extensions, over the same services the terminal commands use:
 *
 *   skill            load a skill's instructions (or a bundled file), the real operation behind "use the skill"
 *   extensions       read-only: list, search, inspect, doctor, instructions in force, hooks, agent runs, compat matrix
 *   extension_write  create, update, validate, switch on or off and delete skills, agents, hooks and instructions
 *
 * Every mutation answers with what changed, where, which version it now is and whether it is active, because "done"
 * is claimed only for what was written and read back. Nothing here can approve a hook, widen a permission or switch off
 * a control: those are the person's.
 */

import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { resolveHooks } from "../hooks/config";
import { recentHookRuns } from "../hooks/index";
import { redactSecrets } from "../memory/gate";
import type { TaskRequest, ToolResult } from "../types/index";
import {
  type AgentRecord,
  deleteAgent,
  getAgent,
  listAgents,
  rejectedAgentFiles,
  validateAgentDefinition,
  writeAgent,
} from "./agents";
import { compatReport } from "./compat";
import { parseFrontmatter } from "./frontmatter";
import { describeHooks, proposeHook, removePendingHook, testHook } from "./hooks-admin";
import { explainInstructions, loadInstructionSet, pathsMentionedIn, updateInstructions } from "./instructions";
import { setOverride } from "./overrides";
import { type AgentRunRecord, describeRun } from "./runs";
import { readAllLayers } from "./settings";
import {
  deleteSkill,
  getSkill,
  listSkills,
  loadSkill,
  missingRequirements,
  readSkillResource,
  renderLoadedSkill,
  type SkillRecord,
  searchSkills,
  skillIndex,
  validateSkillDefinition,
  writeSkill,
} from "./skills";
import { contentHash, readTextIfExists } from "./store";

export interface ExtensionToolContext {
  /** The session's root folder. */
  root: () => string;
  cwd: () => string;
  sessionId: () => string | undefined;
  /** The user's request of the current turn: what `explicit` skills are checked against. */
  request: () => string;
  /** Runs a delegated task; skills that run in an agent use it. */
  runTask?: (request: TaskRequest, signal?: AbortSignal) => Promise<ToolResult>;
  /** Tells the runtime a skill was loaded (the SkillActivated hook, the trace, the activity line). */
  onSkillLoaded?: (event: {
    name: string;
    hash: string;
    scope: string;
    invoker: "model" | "agent";
    reason: string;
  }) => void;
  /** Tells the runtime an extension was written (the ExtensionChanged hook, the trace). */
  onChange?: (event: { kind: string; name: string; action: string; path: string; hash: string }) => void;
  /** Skills already loaded this turn, by name → hash: a second load of the same version is a short note. */
  loaded: Map<string, string>;
  /** Hooks this session proposed, by fingerprint: the only pending hooks `test` will run. */
  createdHooks: Set<string>;
  listRuns?: () => Promise<AgentRunRecord[]>;
  /** The agent whose tool set this is, when a delegated agent is the caller: it can load skills but not write. */
  agentName?: string;
}

/** Whether the person's own words ask for something that holds across projects. */
export function asksForUserWideScope(request: string): boolean {
  return /\b(user[- ]?(wide|level|scope)|global (skills?|agents?|instructions?|rules?|definitions?)|(skills?|agents?|instructions?|rules?) (that (is|are) )?(available )?globally|(my )?personal (skills?|agents?|instructions?|rules?)|all (of )?(my )?projects|every project|across (all )?(my )?projects|any project|(skills?|agentes?|instrucciones|reglas) globales|todos (mis |los )?proyectos|cualquier proyecto|a nivel de usuario|para todos mis)\b/iu.test(
    request,
  );
}

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function ok(output: string, extra: Record<string, unknown> = {}): ToolResult & Record<string, unknown> {
  return { success: true, output, ...extra };
}
function fail(output: string, extra: Record<string, unknown> = {}): ToolResult & Record<string, unknown> {
  return { success: false, output, ...extra };
}

// --- Describing -------------------------------------------------------------------------------------------------

function describeSkill(record: SkillRecord, detail = false): string {
  const flags = [
    record.scope,
    record.origin,
    record.invocation === "explicit" ? "explicit-only" : "auto",
    record.enabled ? null : "OFF",
    record.status === "candidate" ? "candidate" : null,
    record.trusted ? null : "unreviewed",
  ]
    .filter(Boolean)
    .join(", ");
  const head = `- ${record.name} [${flags}]: ${clip(record.description, detail ? 400 : 140)}`;
  if (!detail) return head;
  const lines = [
    head,
    `    file: ${record.file}`,
    `    version marker: ${record.signature}${record.version ? `, version ${record.version}` : ""}`,
  ];
  if (record.arguments.length)
    lines.push(
      `    arguments: ${record.arguments.map((entry) => (entry.required ? entry.name : `${entry.name}?`)).join(" ")}`,
    );
  if (record.requires.length)
    lines.push(
      `    requires: ${record.requires.join(", ")}${missingRequirements(record.requires).length ? ` (missing: ${missingRequirements(record.requires).join(", ")})` : ""}`,
    );
  if (record.context === "agent") lines.push(`    runs in agent: ${record.agent}`);
  if (record.allowedTools.length)
    lines.push(`    declares allowed-tools: ${record.allowedTools.join(" ")} (informational: not a grant)`);
  if (record.override) lines.push(`    override: ${record.override.value} (from ${record.override.from} settings)`);
  if (record.shadows.length) lines.push(`    shadows: ${record.shadows.join(", ")}`);
  if (record.provenance) lines.push(`    provenance: ${record.provenance}`);
  for (const note of record.diagnostics) lines.push(`    ${note}`);
  return lines.join("\n");
}

function describeAgent(record: AgentRecord, detail = false): string {
  const flags = [
    record.scope,
    record.origin,
    record.readOnly ? "read-only" : "can edit",
    record.enabled ? null : "OFF",
    record.rejected ? "BLOCKED" : null,
  ]
    .filter(Boolean)
    .join(", ");
  const head = `- ${record.name} [${flags}]: ${clip(record.description, detail ? 400 : 140)}`;
  if (!detail) return head;
  const lines = [
    head,
    `    file: ${record.source}`,
    `    tools: ${record.tools.length ? record.tools.join(", ") : "inherited from the session"}${record.disallowedTools.length ? `; without ${record.disallowedTools.join(", ")}` : ""}`,
    `    skills: ${record.skills.join(", ") || "none"}`,
    `    model: ${record.model}`,
  ];
  if (record.maxSteps) lines.push(`    max steps: ${record.maxSteps}`);
  if (record.timeoutMinutes) lines.push(`    timeout: ${record.timeoutMinutes} min`);
  if (record.rejected) lines.push(`    blocked: ${record.rejected}`);
  if (record.shadows.length) lines.push(`    shadows: ${record.shadows.join(", ")}`);
  for (const note of record.diagnostics) lines.push(`    ${note}`);
  return lines.join("\n");
}

function doctor(ctx: ExtensionToolContext): string {
  const root = ctx.root();
  const lines: string[] = [];
  const index = skillIndex(root, ctx.cwd());
  const skills = [...index.records.values()];
  lines.push(
    `Skills: ${skills.length} registered (${skills.filter((skill) => skill.invocation === "auto" && skill.enabled).length} selectable by the agent), ${index.rejected.length} unreadable, ${index.scanned} folders read.`,
  );
  for (const rejected of index.rejected) lines.push(`  ✗ ${rejected.path}: ${rejected.reason}`);
  for (const skill of skills) {
    const missing = missingRequirements(skill.requires);
    const errors = skill.diagnostics.filter((entry) => entry.startsWith("error:"));
    if (missing.length) lines.push(`  ! ${skill.name}: missing dependencies ${missing.join(", ")}`);
    for (const error of errors) lines.push(`  ✗ ${skill.name}: ${error.slice(7)}`);
    if (skill.shadows.length)
      lines.push(`  i ${skill.name} shadows ${skill.shadows.length} lower-precedence copy(ies)`);
    if (!skill.trusted)
      lines.push(`  ! ${skill.name}: unreviewed (${skill.flags.join(", ") || "outside the project"})`);
  }
  const agents = listAgents(root);
  lines.push(
    `Agents: ${agents.length} defined (${agents.filter((agent) => agent.readOnly).length} read-only), ${rejectedAgentFiles(root).length} files that are not agents.`,
  );
  for (const agent of agents) {
    if (agent.rejected) lines.push(`  ✗ ${agent.name}: ${agent.rejected}`);
    for (const skill of agent.skills)
      if (!getSkill(root, skill)) lines.push(`  ! ${agent.name}: skill "${skill}" does not exist`);
  }
  const hooks = resolveHooks(ctx.cwd());
  lines.push(
    `Hooks: ${hooks.hooks.length} defined; ${hooks.hooks.filter((hook) => hook.state === "pending").length} waiting for your approval, ${hooks.hooks.filter((hook) => hook.state === "modified").length} approved snapshots that differ from their file.`,
  );
  for (const problem of hooks.problems) lines.push(`  ✗ (${problem.source}) ${problem.message}`);
  const set = loadInstructionSet(ctx.cwd(), { paths: pathsMentionedIn(ctx.request()) });
  lines.push(
    `Instructions: ${set.sources.filter((source) => source.applied).length} source(s) in force, version ${set.hash}.`,
  );
  for (const diagnostic of set.diagnostics)
    if (diagnostic.severity !== "info")
      lines.push(`  ${diagnostic.severity === "error" ? "✗" : "!"} ${diagnostic.message}`);
  const layers = readAllLayers(root);
  for (const layer of ["project", "local", "user"] as const)
    if (layers[layer].error) lines.push(`Settings: ✗ ${layers[layer].path}: ${layers[layer].error}`);
  const total = lines.filter((line) => line.startsWith("  ✗")).length;
  lines.push("", total === 0 ? "No errors found." : `${total} error(s) above need fixing.`);
  return lines.join("\n");
}

// --- The read-only inspector -------------------------------------------------------------------------------------

const KINDS = ["skill", "agent", "hook", "instructions", "all"] as const;

export function createExtensionTools(ctx: ExtensionToolContext, options: { writable: boolean }): ToolSet {
  const tools: ToolSet = {};

  tools.skill = tool({
    description:
      "Load a skill: reusable instructions for a kind of task. Call it when the task matches a skill's description (the SKILLS list in your instructions, or `extensions` search), then follow the text it returns; loading does not complete the procedure. Pass `arguments` when the skill declares them. Pass `resource` to read a file bundled with the skill (scripts/, references/, assets/). A skill that runs only on request cannot be loaded unless the user named it.",
    inputSchema: z.object({
      name: z.string().describe("The skill's exact name"),
      arguments: z.string().optional().describe("Arguments for the skill, space separated; quote values with spaces"),
      resource: z.string().optional().describe("A path inside the skill's folder to read instead of its instructions"),
    }),
    execute: async ({ name, arguments: args, resource }, { abortSignal }) => {
      const root = ctx.root();
      if (resource) {
        const record = getSkill(root, name, ctx.cwd());
        if (!record) return fail(`No skill named "${name}".`);
        const read = readSkillResource(record, resource);
        return read.ok
          ? ok(`${read.text}${read.truncated ? "\n[truncated: read the file with read_file for the rest]" : ""}`)
          : fail(`Could not read ${resource} from skill "${name}": ${read.reason}`);
      }
      const loaded = loadSkill(
        root,
        name,
        {
          invoker: "model",
          request: ctx.request(),
          ...(args ? { arguments: args } : {}),
          ...(ctx.sessionId() ? { sessionId: ctx.sessionId() as string } : {}),
        },
        ctx.cwd(),
      );
      if (!loaded.ok) return fail(loaded.reason);
      const key = `${loaded.record.name}\u0000${args ?? ""}`;
      if (ctx.loaded.get(key) === loaded.hash) {
        return ok(
          `Skill "${loaded.record.name}" (version ${loaded.hash}) is already loaded in this turn with the same arguments; its instructions are above.`,
          { skill: { name: loaded.record.name, hash: loaded.hash, alreadyLoaded: true } },
        );
      }
      ctx.loaded.set(key, loaded.hash);
      ctx.onSkillLoaded?.({
        name: loaded.record.name,
        hash: loaded.hash,
        scope: loaded.record.scope,
        invoker: ctx.agentName ? "agent" : "model",
        reason: `requested by the model${args ? ` with arguments: ${clip(args, 80)}` : ""}`,
      });
      if (loaded.record.context === "agent" && ctx.runTask && !ctx.agentName) {
        const agent = loaded.record.agent ?? "general";
        const result = await ctx.runTask(
          { agent, description: `Skill: ${loaded.record.name}`, prompt: loaded.instructions },
          abortSignal,
        );
        return {
          ...result,
          output: `Skill "${loaded.record.name}" ran in the "${agent}" agent (it did not enter this conversation):\n\n${result.output}`,
          skill: { name: loaded.record.name, hash: loaded.hash, ranInAgent: agent },
        };
      }
      return ok(renderLoadedSkill(loaded), {
        skill: { name: loaded.record.name, hash: loaded.hash, scope: loaded.record.scope },
      });
    },
  });

  tools.extensions = tool({
    description:
      "Inspect what this project has: skills, agents, hooks and the instructions in force. action: list (kind), search (query), inspect (kind + name), instructions (what is active and where each part comes from), hooks, runs (recent delegated agents and hook executions), doctor (problems and missing dependencies), compat (what other agents' config in this repo can be used).",
    inputSchema: z.object({
      action: z.enum(["list", "search", "inspect", "instructions", "hooks", "runs", "doctor", "compat"]),
      kind: z.enum(KINDS).optional().describe("skill, agent, hook, instructions or all (default all)"),
      name: z.string().optional(),
      query: z.string().optional(),
    }),
    execute: async ({ action, kind, name, query }) => {
      const root = ctx.root();
      const which = kind ?? "all";
      switch (action) {
        case "list": {
          const parts: string[] = [];
          if (which === "skill" || which === "all") {
            const skills = listSkills(root, ctx.cwd());
            parts.push(
              `Skills (${skills.length}):`,
              ...(skills.length ? skills.slice(0, 60).map((skill) => describeSkill(skill)) : ["  none"]),
              ...(skills.length > 60 ? [`  … and ${skills.length - 60} more; use action search`] : []),
            );
          }
          if (which === "agent" || which === "all") {
            const agents = listAgents(root);
            parts.push(
              `Agents (${agents.length}) — built-in: general, explore, plan, vision, verify, computer:`,
              ...(agents.length ? agents.map((agent) => describeAgent(agent)) : ["  no custom agents"]),
            );
          }
          if (which === "hook" || which === "all") parts.push(describeHooks(ctx.cwd()));
          if (which === "instructions" || which === "all")
            parts.push(explainInstructions(loadInstructionSet(ctx.cwd(), { paths: pathsMentionedIn(ctx.request()) })));
          return ok(parts.join("\n\n"));
        }
        case "search": {
          if (!query?.trim()) return fail("search needs a query");
          const skills = searchSkills(skillIndex(root, ctx.cwd()), query, 10);
          const agents = listAgents(root).filter((agent) =>
            `${agent.name} ${agent.description}`.toLowerCase().includes(query.toLowerCase().split(/\s+/u)[0] ?? ""),
          );
          const lines = [
            `Skills matching "${query}":`,
            ...(skills.length
              ? skills.map((match) => `${describeSkill(match.record)}  (matched: ${match.matched.join(", ")})`)
              : ["  none"]),
            `Agents matching "${query}":`,
            ...(agents.length ? agents.map((agent) => describeAgent(agent)) : ["  none"]),
          ];
          return ok(lines.join("\n"));
        }
        case "inspect": {
          if (!name) return fail("inspect needs a name");
          if (which === "agent") {
            const agent = getAgent(root, name);
            return agent ? ok(describeAgent(agent, true)) : fail(`No agent named "${name}".`);
          }
          if (which === "hook") {
            const hook = resolveHooks(ctx.cwd()).hooks.find((entry) => entry.id === name);
            return hook
              ? ok(
                  JSON.stringify(
                    {
                      ...hook,
                      hook: {
                        ...hook.hook,
                        command: redactSecrets(hook.hook.command).slice(0, 300),
                        ...(hook.hook.args
                          ? { args: hook.hook.args.map((arg) => redactSecrets(arg).slice(0, 120)) }
                          : {}),
                      },
                    },
                    null,
                    2,
                  ),
                )
              : fail(`No hook named "${name}".`);
          }
          const skill = getSkill(root, name, ctx.cwd());
          return skill ? ok(describeSkill(skill, true)) : fail(`No skill named "${name}".`);
        }
        case "instructions":
          return ok(explainInstructions(loadInstructionSet(ctx.cwd(), { paths: pathsMentionedIn(ctx.request()) })));
        case "hooks":
          return ok(describeHooks(ctx.cwd()));
        case "runs": {
          const runs = ctx.listRuns ? await ctx.listRuns() : [];
          const hookRuns = recentHookRuns(15);
          return ok(
            [
              `Agent runs (${runs.length}):`,
              ...(runs.length ? runs.slice(0, 15).map((run) => `- ${describeRun(run)}`) : ["  none"]),
              "",
              `Hook runs (${hookRuns.length}, newest last):`,
              ...hookRuns.map(
                (run) =>
                  `- ${run.at.slice(11, 19)} ${run.event} ${run.hookId} → ${run.effect} (${run.outcome}, ${run.durationMs} ms)${run.reason ? ` — ${run.reason}` : ""}`,
              ),
            ].join("\n"),
          );
        }
        case "doctor":
          return ok(doctor(ctx));
        case "compat": {
          const items = compatReport(root);
          return ok(
            items.length
              ? [
                  "Other agents' configuration in this project:",
                  ...items.map(
                    (item) =>
                      `- [${item.status}] ${item.kind} ${item.name} (${item.path})${item.notes.length ? `\n    ${item.notes.join("\n    ")}` : ""}`,
                  ),
                ].join("\n")
              : "Nothing from other agents was found (.claude/agents, .claude/skills, CLAUDE.md, …).",
          );
        }
      }
    },
  });

  if (!options.writable) return tools;

  // --- Mutations --------------------------------------------------------------------------------------------------

  const hookSchema = z.object({
    event: z.string().describe("PreToolUse, PostToolUse, UserPromptSubmit, Stop, SessionStart, SessionEnd, …"),
    matcher: z.string().optional().describe("Tool names for tool events: bash, edit_file|write_file, or a regex"),
    command: z.string().describe("Program, or a shell command line when args is not given"),
    args: z.array(z.string()).optional().describe("Arguments (runs without a shell)"),
    timeout: z.number().optional().describe("Seconds, default 30"),
    id: z.string().optional(),
    description: z.string().optional(),
    failure_policy: z.enum(["open", "closed"]).optional().describe("closed blocks the action when the hook fails"),
    async: z.boolean().optional(),
  });

  tools.extension_write = tool({
    description:
      "Create, change or switch skills, agents, hooks and instructions, durably. Each result says what was written, where, its version and whether it is active: read it before telling the user it is done. skill and agent: create, update, validate, set_enabled, delete. hook: create (a proposal that runs only after the person approves it), update or delete (while pending), test. instructions: update SHELRA.md. You cannot approve a hook or change an approved one.",
    inputSchema: z.object({
      kind: z.enum(["skill", "agent", "hook", "instructions"]),
      action: z.enum(["create", "update", "validate", "set_enabled", "delete", "test"]),
      name: z.string().optional().describe("Skill, agent or hook id"),
      scope: z.enum(["project", "user"]).optional().describe("Default project"),
      description: z.string().optional().describe("What it does and when to use it (how it gets selected)"),
      instructions: z.string().optional().describe("Skill body or agent system prompt"),
      invocation: z
        .enum(["auto", "explicit"])
        .optional()
        .describe("Skill: auto unless the user wants it run-on-request only"),
      arguments: z.array(z.string()).optional().describe("Skill argument names, name? if optional"),
      requires: z.array(z.string()).optional().describe("Programs the skill needs"),
      context: z.enum(["inline", "agent"]).optional().describe("Skill: add to the conversation, or run in `agent`"),
      agent: z.string().optional(),
      access: z.enum(["read-only", "standard"]).optional().describe("Agent"),
      tools: z.array(z.string()).optional().describe("Agent: read, write, shell, web, memory, skills, or tool names"),
      disallowed_tools: z.array(z.string()).optional(),
      skills: z.array(z.string()).optional().describe("Agent: skills preloaded"),
      model: z.string().optional().describe("Agent: inherit, or a model id (Mixed mode only)"),
      max_steps: z.number().optional(),
      timeout_minutes: z.number().optional(),
      result_format: z.string().optional(),
      enabled: z.enum(["on", "explicit", "off"]).optional(),
      hook: hookSchema.optional(),
      layer: z.enum(["project", "local"]).optional().describe("Hook file; default project"),
      target: z.string().optional().describe("Instructions: project, local, user, or rule:<file name>"),
      section: z.string().optional(),
      content: z.string().optional(),
      mode: z.enum(["append_section", "replace_section", "replace_file"]).optional(),
      paths: z.array(z.string()).optional().describe("Rule: globs it applies to"),
      expected_hash: z.string().optional().describe("Version you last read; refused if the file moved on"),
    }),
    execute: async (input) => {
      const root = ctx.root();
      const changed = (kind: string, name: string, action: string, path: string, hash: string) =>
        ctx.onChange?.({ kind, name, action, path, hash });
      const report = (value: Record<string, unknown>, success: boolean) =>
        success ? ok(JSON.stringify(value, null, 2), value) : fail(JSON.stringify(value, null, 2), value);
      const name = input.name?.trim() ?? "";
      // A user-wide skill, agent or instruction file applies in every project the person works on, so a model working
      // in one repository (which may be hostile, or may have fed it instructions) writes there only when the person's own
      // request asks for that scope. Anything else stays in this project.
      const wantsUserScope = input.kind === "instructions" ? input.target === "user" : input.scope === "user";
      if (
        wantsUserScope &&
        input.action !== "validate" &&
        input.action !== "test" &&
        !asksForUserWideScope(ctx.request())
      ) {
        return fail(
          'A user-wide definition would apply in every project the person works on. Create it in this project instead (leave `scope` out), or, if they really want it everywhere, ask them to say so (for example: "for all my projects", "user-wide").',
        );
      }
      const switchTo = (kind: "skill" | "agent", target: string): ToolResult => {
        if (!input.enabled) return fail("set_enabled needs `enabled`: on, explicit or off");
        const outcome = setOverride(root, kind, target, input.enabled, "model");
        if (outcome.ok) changed(kind, target, `set ${input.enabled}`, outcome.file, outcome.hash);
        return report(outcome as unknown as Record<string, unknown>, outcome.ok);
      };

      // --- skills
      if (input.kind === "skill") {
        if (!name) return fail("a skill needs a name");
        if (input.action === "validate") {
          const record = getSkill(root, name, ctx.cwd());
          const text = record ? readTextIfExists(record.file) : null;
          if (!record || text === null) return fail(`No skill named "${name}".`);
          const parsed = parseFrontmatter(text);
          const issues = validateSkillDefinition({
            name: record.name,
            description: record.description,
            directoryName: name,
            body: parsed.body,
            data: parsed.data,
          });
          const missing = missingRequirements(record.requires);
          return report(
            {
              ok: issues.every((issue) => issue.severity !== "error"),
              name,
              path: record.file,
              hash: contentHash(text),
              issues,
              missingDependencies: missing,
              active: record.enabled,
            },
            issues.every((issue) => issue.severity !== "error"),
          );
        }
        if (input.action === "set_enabled") return switchTo("skill", name);
        if (input.action === "delete") {
          const result = deleteSkill(root, name, input.scope ?? "project", input.expected_hash);
          if (result.ok) changed("skill", name, "deleted", result.path, "");
          return report(
            result.ok
              ? { ok: true, name, deleted: result.path, recoverableFrom: result.snapshot }
              : { ok: false, reason: result.reason, conflict: result.conflict },
            result.ok,
          );
        }
        if (input.action === "create" || input.action === "update") {
          const outcome = writeSkill(root, {
            name,
            ...(input.scope ? { scope: input.scope } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
            ...(input.invocation ? { invocation: input.invocation } : {}),
            ...(input.arguments ? { arguments: input.arguments } : {}),
            ...(input.requires ? { requires: input.requires } : {}),
            ...(input.context ? { context: input.context } : {}),
            ...(input.agent ? { agent: input.agent } : {}),
            ...(input.expected_hash ? { expectedHash: input.expected_hash } : {}),
            ...(input.action === "create"
              ? { provenance: `created in session ${ctx.sessionId() ?? "unknown"} at ${new Date().toISOString()}` }
              : {}),
          });
          if (!outcome.ok)
            return report(
              {
                ok: false,
                reason: outcome.reason,
                issues: outcome.issues,
                conflict: outcome.conflict,
                currentHash: outcome.currentHash,
              },
              false,
            );
          if (outcome.action !== "unchanged") changed("skill", name, outcome.action, outcome.path, outcome.hash);
          const check = getSkill(root, name, ctx.cwd());
          return report(
            {
              ...outcome,
              registered: check?.file === outcome.path,
              appliesFrom:
                "the next time the skill is loaded (the skill tool reads the file each time, so there is nothing to restart)",
            },
            true,
          );
        }
        return fail(`action ${input.action} does not apply to a skill`);
      }

      // --- agents
      if (input.kind === "agent") {
        if (ctx.agentName)
          return fail("a delegated agent cannot create or change agents; report the need to the orchestrator");
        if (!name) return fail("an agent needs a name");
        if (input.action === "validate") {
          const record = getAgent(root, name);
          if (!record) return fail(`No agent named "${name}".`);
          const issues = validateAgentDefinition({
            name: record.name,
            description: record.description,
            instructions: record.instructions,
            ...(record.readOnly ? { access: "read-only" } : {}),
            tools: record.tools,
            disallowedTools: record.disallowedTools,
            skills: record.skills,
            model: record.model,
            ...(record.maxSteps ? { maxSteps: record.maxSteps } : {}),
            ...(record.timeoutMinutes ? { timeoutMinutes: record.timeoutMinutes } : {}),
            skillExists: (skill) => getSkill(root, skill) !== undefined,
          });
          const good = issues.every((issue) => issue.severity !== "error") && !record.rejected;
          return report(
            {
              ok: good,
              name,
              path: record.source,
              issues,
              ...(record.rejected ? { blocked: record.rejected } : {}),
              active: record.enabled && !record.rejected,
            },
            good,
          );
        }
        if (input.action === "set_enabled") return switchTo("agent", name);
        if (input.action === "delete") {
          const result = deleteAgent(root, name, input.scope ?? "project", input.expected_hash);
          if (result.ok) changed("agent", name, "deleted", result.path, "");
          return report(
            result.ok
              ? { ok: true, name, deleted: result.path, recoverableFrom: result.snapshot }
              : { ok: false, reason: result.reason, conflict: result.conflict },
            result.ok,
          );
        }
        if (input.action === "create" || input.action === "update") {
          const outcome = writeAgent(root, {
            name,
            ...(input.scope ? { scope: input.scope } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
            ...(input.access ? { access: input.access } : {}),
            ...(input.tools ? { tools: input.tools } : {}),
            ...(input.disallowed_tools ? { disallowedTools: input.disallowed_tools } : {}),
            ...(input.skills ? { skills: input.skills } : {}),
            ...(input.model !== undefined ? { model: input.model } : {}),
            ...(input.max_steps !== undefined ? { maxSteps: input.max_steps } : {}),
            ...(input.timeout_minutes !== undefined ? { timeoutMinutes: input.timeout_minutes } : {}),
            ...(input.result_format !== undefined ? { resultFormat: input.result_format } : {}),
            ...(input.expected_hash ? { expectedHash: input.expected_hash } : {}),
          });
          if (!outcome.ok)
            return report(
              {
                ok: false,
                reason: outcome.reason,
                issues: outcome.issues,
                conflict: outcome.conflict,
                currentHash: outcome.currentHash,
              },
              false,
            );
          if (outcome.action !== "unchanged") changed("agent", name, outcome.action, outcome.path, outcome.hash);
          return report({ ...outcome, usage: `task({ agent: "${name}", description, prompt })` }, true);
        }
        return fail(`action ${input.action} does not apply to an agent`);
      }

      // --- hooks
      if (input.kind === "hook") {
        if (ctx.agentName) return fail("a delegated agent cannot create or change hooks");
        if (input.action === "test") {
          if (!name) return fail("test needs the hook's id");
          const result = await testHook(ctx.cwd(), name, { createdHere: ctx.createdHooks });
          return report({ ...result }, result.ok);
        }
        if (input.action === "delete") {
          if (!name) return fail("delete needs the hook's id");
          const result = removePendingHook(ctx.cwd(), name, input.layer ?? "project");
          if (result.ok) changed("hook", name, "removed", result.path, result.hash);
          return report({ ...result }, result.ok);
        }
        if (input.action === "set_enabled" || input.action === "validate")
          return fail(
            "hooks are switched on by the person's approval (`shelra hooks approve`), and cannot be turned off by a model; to remove a pending hook use action delete",
          );
        if (!input.hook) return fail("a hook needs the `hook` object (event, command, …)");
        const result = proposeHook(
          ctx.cwd(),
          {
            event: input.hook.event,
            ...(input.hook.matcher ? { matcher: input.hook.matcher } : {}),
            command: input.hook.command,
            ...(input.hook.args ? { args: input.hook.args } : {}),
            ...(input.hook.timeout ? { timeout: input.hook.timeout } : {}),
            ...((input.hook.id ?? input.name) ? { id: (input.hook.id ?? input.name) as string } : {}),
            ...(input.hook.description ? { description: input.hook.description } : {}),
            ...(input.hook.failure_policy ? { failurePolicy: input.hook.failure_policy } : {}),
            ...(input.hook.async ? { async: true } : {}),
          },
          {
            ...(input.layer ? { layer: input.layer } : {}),
            ...(input.action === "update" && name ? { replaceId: name } : {}),
            ...(input.expected_hash ? { expectedHash: input.expected_hash } : {}),
          },
        );
        if (result.ok) {
          ctx.createdHooks.add(result.fingerprint);
          changed("hook", result.id, input.action === "update" ? "updated" : "created", result.path, result.hash);
        }
        return report({ ...result }, result.ok);
      }

      // --- instructions
      if (ctx.agentName) return fail("a delegated agent cannot change instructions");
      if (input.action !== "update" && input.action !== "create") return fail("instructions support action update");
      if (!input.content?.trim()) return fail("update needs `content`");
      const mode = input.mode ?? "append_section";
      const target = (input.target ?? "project").trim();
      const ruleName = /^rule[:/]\s*(.+)$/iu.exec(target)?.[1]?.trim();
      if (!ruleName && target !== "project" && target !== "local" && target !== "user") {
        return fail('`target` is project, local, user, or "rule:<file name>"');
      }
      const result = updateInstructions(ctx.cwd(), {
        target: ruleName ? { rule: ruleName } : (target as "project" | "local" | "user"),
        content: input.content,
        mode,
        ...(input.section ? { section: input.section } : {}),
        ...(input.paths ? { paths: input.paths } : {}),
        ...(input.expected_hash ? { expectedHash: input.expected_hash } : {}),
      });
      if (result.ok && result.changed) changed("instructions", target, "updated", result.path, result.hash);
      return report({ ...result }, result.ok);
    },
  });

  return tools;
}
