/**
 * The commands a person types, for the terminal UI (`/skills`, `/agents`, `/hooks`, `/instructions`, `/doctor`,
 * `/prompt`) and for the CLI (`shelra skills`, …): one implementation over the same services the model's tools use, so
 * what a person can do and what the model can do never drift apart. A person has more authority than a model in exactly
 * the places the services say so: approving a hook, lifting a restriction, promoting a candidate skill.
 *
 * A command returns text to show and, for `/<skill> args`, the message to send to the model; it never prints itself.
 */
import { resolveHooks } from "../hooks/config";
import { recentHookRuns } from "../hooks/index";
import {
  type AgentRecord,
  getAgent,
  listAgents,
  rejectedAgentFiles,
  validateAgentDefinition,
  writeAgent,
} from "./agents";
import { compatReport, importSkillFolder, translateClaudeAgent, translateClaudeHooks } from "./compat";
import { parseFrontmatter } from "./frontmatter";
import { approvePendingHooks, describeHooks, proposeHook, removeApprovedHook, testHook } from "./hooks-admin";
import { explainInstructions, loadInstructionSet, pathsMentionedIn } from "./instructions";
import { setOverride } from "./overrides";
import { exportAgent, exportSkill, importSkillFromFolder, scaffoldAgent, scaffoldSkill } from "./portability";
import { describeRun, listRuns } from "./runs";
import { readAllLayers } from "./settings";
import {
  getSkill,
  listSkills,
  loadSkill,
  missingRequirements,
  renderLoadedSkill,
  searchSkills,
  skillIndex,
  validateSkillDefinition,
  writeSkill,
} from "./skills";
import { readTextIfExists } from "./store";
import { describeSystemPrompt } from "./system-prompt";

export interface CommandContext {
  /** The session's root folder. */
  root: string;
  cwd: string;
  sessionId?: string;
  /** Names the terminal UI handles itself (`/models`, `/review`, …): a skill never takes one of these. */
  reservedNames?: ReadonlySet<string>;
}

export interface CommandResult {
  /** Text to show the person. */
  output: string;
  /** When set, send this to the model as the person's message (a skill invocation). */
  prompt?: string;
  /** The terminal UI should open its agent editor. */
  openAgentEditor?: boolean;
  ok: boolean;
}

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const done = (output: string, ok = true): CommandResult => ({ output, ok });

function skillLine(record: ReturnType<typeof listSkills>[number]): string {
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
  return `- ${record.name} [${flags}]\n    ${clip(record.description, 150)}`;
}

function agentLine(record: AgentRecord): string {
  const flags = [
    record.scope,
    record.origin,
    record.readOnly ? "read-only" : "can edit",
    record.enabled ? null : "OFF",
    record.rejected ? "BLOCKED" : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `- ${record.name} [${flags}]\n    ${clip(record.description, 150)}${record.rejected ? `\n    blocked: ${record.rejected}` : ""}`;
}

// --- /skills ----------------------------------------------------------------------------------------------------

function skillsHelp(): string {
  return [
    "/skills                       list the skills available",
    "/skills search <words>        find a skill by name, description or task",
    "/skills show <name>            where it is, its version, arguments, dependencies and problems",
    "/skills validate <name>        check it against the open Agent Skills format",
    "/skills on|explicit|off <name> make it selectable, user-only, or hidden (in your local settings)",
    "/skills promote <name>         trust a candidate skill (one proposed from memory) for automatic use",
    '/skills new <name> "<description>"  start a skill (valid, registered, steps to fill in)',
    "/skills export <name> <folder>  copy a skill, with its resources, to a folder",
    "/skills import [<folder>]       copy a skill from a folder; with no folder, from .claude/skills",
    "/<skill> [arguments]           run a skill now",
  ].join("\n");
}

function skillsCommand(context: CommandContext, args: string[]): CommandResult {
  const [sub, ...rest] = args;
  const index = skillIndex(context.root, context.cwd);
  switch (sub) {
    case undefined:
    case "list": {
      const skills = listSkills(context.root, context.cwd);
      if (skills.length === 0)
        return done(
          [
            "No skills found.",
            'Ask Shelra to create one ("turn this procedure into a skill"), or add .shelra/skills/<name>/SKILL.md. Other agents\' folders are read too: .agents/skills, .claude/skills.',
            ...(index.rejected.length
              ? [
                  "",
                  `${index.rejected.length} file(s) were skipped:`,
                  ...index.rejected.map((entry) => `- ${entry.path}: ${entry.reason}`),
                ]
              : []),
          ].join("\n"),
        );
      return done(
        [
          `Skills (${skills.length}):`,
          ...skills.slice(0, 80).map(skillLine),
          ...(skills.length > 80 ? [`… ${skills.length - 80} more: /skills search <words>`] : []),
          ...(index.rejected.length ? ["", `${index.rejected.length} file(s) were skipped (/doctor says why).`] : []),
        ].join("\n"),
      );
    }
    case "search": {
      const query = rest.join(" ");
      if (!query) return done("Usage: /skills search <words>", false);
      const matches = searchSkills(index, query, 12);
      return done(
        matches.length
          ? [`Skills matching "${query}":`, ...matches.map((match) => skillLine(match.record))].join("\n")
          : `No skill matches "${query}".`,
      );
    }
    case "show": {
      const name = rest[0];
      const record = name ? getSkill(context.root, name, context.cwd) : undefined;
      if (!record) return done(`No skill named "${name ?? ""}".`, false);
      const missing = missingRequirements(record.requires);
      return done(
        [
          `${record.name} — ${record.description}`,
          `file: ${record.file}`,
          `scope: ${record.scope}; found in: ${record.origin === "shelra" ? ".shelra/skills" : record.origin === "agents" ? ".agents/skills" : ".claude/skills (read-only)"}`,
          `used by the agent: ${record.invocation === "auto" ? "yes, when it matches the task" : "only when you name it"}${record.enabled ? "" : " (currently OFF)"}`,
          `runs: ${record.context === "agent" ? `in the ${record.agent} agent` : "in the conversation"}`,
          ...(record.arguments.length
            ? [
                `arguments: ${record.arguments.map((entry) => (entry.required ? entry.name : `${entry.name}?`)).join(" ")}`,
              ]
            : []),
          ...(record.requires.length
            ? [
                `requires: ${record.requires.join(", ")}${missing.length ? `  (MISSING: ${missing.join(", ")})` : "  (all present)"}`,
              ]
            : []),
          ...(record.allowedTools.length
            ? [`declares allowed-tools: ${record.allowedTools.join(" ")}  (informational: never a grant)`]
            : []),
          ...(record.shadows.length ? [`shadows: ${record.shadows.join(", ")}`] : []),
          ...(record.provenance ? [`provenance: ${record.provenance}`] : []),
          ...(record.status ? [`status: ${record.status}`] : []),
          ...record.diagnostics,
        ].join("\n"),
      );
    }
    case "validate": {
      const name = rest[0];
      const record = name ? getSkill(context.root, name, context.cwd) : undefined;
      const text = record ? readTextIfExists(record.file) : null;
      if (!record || text === null) return done(`No skill named "${name ?? ""}".`, false);
      const parsed = parseFrontmatter(text);
      const issues = validateSkillDefinition({
        name: record.name,
        description: record.description,
        directoryName: name ?? "",
        body: parsed.body,
        data: parsed.data,
      });
      const errors = issues.filter((issue) => issue.severity === "error");
      return done(
        [
          errors.length === 0 ? `${record.name} is valid.` : `${record.name} has ${errors.length} error(s):`,
          ...issues.map((issue) => `- ${issue.severity}: ${issue.message}`),
          ...(missingRequirements(record.requires).length
            ? [`- missing dependencies: ${missingRequirements(record.requires).join(", ")}`]
            : []),
        ].join("\n"),
        errors.length === 0,
      );
    }
    case "on":
    case "off":
    case "explicit": {
      const name = rest[0];
      if (!name) return done(`Usage: /skills ${sub} <name>`, false);
      const outcome = setOverride(context.root, "skill", name, sub, "person");
      return outcome.ok
        ? done(
            `${name}: ${outcome.effective === "on" ? "selectable by the agent" : outcome.effective === "explicit" ? "runs only when you name it" : "hidden"}. Saved in ${outcome.file}; applies now.`,
          )
        : done(outcome.reason, false);
    }
    case "promote": {
      const name = rest[0];
      const record = name ? getSkill(context.root, name, context.cwd) : undefined;
      if (!record) return done(`No skill named "${name ?? ""}".`, false);
      if (record.status !== "candidate")
        return done(`${record.name} is not a candidate (status: ${record.status ?? "none"}).`, false);
      const outcome = writeSkill(context.root, {
        name: record.name,
        scope: record.scope,
        status: "validated",
        invocation: "auto",
      });
      return outcome.ok
        ? done(`${record.name} is validated and selectable by the agent. Version ${outcome.hash}.`)
        : done(outcome.reason, false);
    }
    case "new": {
      const [name, ...words] = rest;
      const description = words.join(" ").trim();
      if (!name || !description) return done('Usage: /skills new <name> "<what it does and when to use it>"', false);
      const made = scaffoldSkill(context.root, name, description);
      return made.ok ? done(made.message) : done(made.reason, false);
    }
    case "export": {
      const [name, target] = rest;
      if (!name || !target) return done("Usage: /skills export <name> <folder>", false);
      const exported = exportSkill(context.root, name, target);
      return exported.ok ? done(exported.message) : done(exported.reason, false);
    }
    case "import": {
      if (rest[0]) {
        const imported = importSkillFromFolder(context.root, rest[0], rest.includes("--user") ? "user" : "project");
        return imported.ok ? done(imported.message) : done(imported.reason, false);
      }
      const items = compatReport(context.root).filter((item) => item.kind === "skill" && item.importable);
      if (items.length === 0)
        return done(
          "Nothing to import: no skills in .claude/skills (the ones in .agents/skills are already read in place).",
        );
      const results = items.map((item) => importSkillFolder(context.root, item));
      return done(
        results
          .map((entry) =>
            entry.written.length
              ? `copied ${entry.item.name} → ${entry.written[0]}`
              : `skipped ${entry.item.name}: ${entry.skipped}`,
          )
          .join("\n"),
      );
    }
    case "help":
      return done(skillsHelp());
    default:
      return done(`Unknown /skills option "${sub}".\n${skillsHelp()}`, false);
  }
}

// --- /agents ----------------------------------------------------------------------------------------------------

function agentsHelp(): string {
  return [
    "/agents                       list the agents defined here and the recent runs",
    "/agents show <name>            instructions, tools, skills, limits and problems",
    "/agents validate <name>        check the definition",
    "/agents on|off <name>          make it available or not (in your local settings)",
    "/agents runs                   recent delegated runs: who, what, how it ended, what it changed",
    '/agents new <name> "<when>"   start a read-only agent',
    "/agents export <name> <file>   copy an agent definition to a file",
    "/agents edit                   open the editor for agents kept in user settings",
  ].join("\n");
}

async function agentsCommand(context: CommandContext, args: string[]): Promise<CommandResult> {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
    case "list": {
      const agents = listAgents(context.root);
      const runs = await listRuns(context.root, 5);
      return done(
        [
          "Built-in agents: general, explore (read-only), plan (read-only), vision, verify, ui-verify, computer.",
          agents.length
            ? `Defined here (${agents.length}):`
            : 'No agents defined here. Ask Shelra to create one ("create a reviewer agent that only reads"), or add .shelra/agents/<name>.md.',
          ...agents.map(agentLine),
          ...(rejectedAgentFiles(context.root).length
            ? [
                "",
                `${rejectedAgentFiles(context.root).length} file(s) in agent folders are not agents (/doctor says why).`,
              ]
            : []),
          ...(runs.length ? ["", "Recent runs:", ...runs.map((run) => `- ${describeRun(run)}`)] : []),
        ].join("\n"),
      );
    }
    case "show": {
      const record = rest[0] ? getAgent(context.root, rest[0]) : undefined;
      if (!record) return done(`No agent named "${rest[0] ?? ""}".`, false);
      return done(
        [
          `${record.name} — ${record.description}`,
          `file: ${record.source}`,
          `scope: ${record.scope}; from: ${record.origin}`,
          `access: ${record.readOnly ? "read-only (no file tools; the shell only reads)" : "can edit, within its tools"}`,
          `tools: ${record.tools.length ? record.tools.join(", ") : "inherited from the session"}${record.disallowedTools.length ? `; without ${record.disallowedTools.join(", ")}` : ""}`,
          `skills preloaded: ${record.skills.join(", ") || "none"}`,
          `model: ${record.model}${record.model !== "inherit" ? " (honored in Mixed mode; Free mode runs the session's model)" : ""}`,
          `limits: ${record.maxSteps ?? 120} steps${record.timeoutMinutes ? `, ${record.timeoutMinutes} min` : ""}`,
          ...(record.rejected ? [`BLOCKED: ${record.rejected}`] : []),
          ...(record.enabled ? [] : ["currently OFF"]),
          "",
          "Instructions:",
          record.instructions,
        ].join("\n"),
      );
    }
    case "validate": {
      const record = rest[0] ? getAgent(context.root, rest[0]) : undefined;
      if (!record) return done(`No agent named "${rest[0] ?? ""}".`, false);
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
        skillExists: (skill) => getSkill(context.root, skill) !== undefined,
      });
      const good = issues.every((issue) => issue.severity !== "error") && !record.rejected;
      return done(
        [
          good ? `${record.name} is valid and active.` : `${record.name} cannot run:`,
          ...issues.map((issue) => `- ${issue.severity}: ${issue.message}`),
          ...(record.rejected ? [`- blocked: ${record.rejected}`] : []),
        ].join("\n"),
        good,
      );
    }
    case "on":
    case "off": {
      const name = rest[0];
      if (!name) return done(`Usage: /agents ${sub} <name>`, false);
      const outcome = setOverride(context.root, "agent", name, sub, "person");
      return outcome.ok
        ? done(
            `${name} is ${outcome.effective === "off" ? "off" : "available"}. Saved in ${outcome.file}; applies now.`,
          )
        : done(outcome.reason, false);
    }
    case "runs": {
      const runs = await listRuns(context.root, 30);
      return done(
        runs.length
          ? ["Delegated runs (newest first):", ...runs.map((run) => `- ${describeRun(run)}`)].join("\n")
          : "No delegated runs recorded for this project.",
      );
    }
    case "new": {
      const [name, ...words] = rest;
      const description = words.join(" ").trim();
      if (!name || !description) return done('Usage: /agents new <name> "<when to use it>"', false);
      const made = scaffoldAgent(context.root, name, description);
      return made.ok ? done(made.message) : done(made.reason, false);
    }
    case "export": {
      const [name, file] = rest;
      if (!name || !file) return done("Usage: /agents export <name> <file>", false);
      const exported = exportAgent(context.root, name, file);
      return exported.ok ? done(exported.message) : done(exported.reason, false);
    }
    case "edit":
      return { output: "", ok: true, openAgentEditor: true };
    case "help":
      return done(agentsHelp());
    default:
      return done(`Unknown /agents option "${sub}".\n${agentsHelp()}`, false);
  }
}

// --- /hooks -----------------------------------------------------------------------------------------------------

function hooksHelp(): string {
  return [
    "/hooks                        every hook, its state and whether it can prevent anything",
    "/hooks approve <id…|all>      approve hooks defined in the project's files (they never run before)",
    "/hooks remove <id>             remove an approved hook",
    "/hooks test <id>               run one hook once on a sample event",
    "/hooks runs                    what hooks ran, how long they took and what they did",
  ].join("\n");
}

async function hooksCommand(context: CommandContext, args: string[]): Promise<CommandResult> {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
    case "list":
      return done(describeHooks(context.cwd));
    case "approve": {
      const pending = resolveHooks(context.cwd).hooks.filter((hook) => hook.state === "pending");
      if (pending.length === 0) return done("No hooks are waiting for approval.");
      const ids = rest.length === 0 || rest[0] === "all" ? undefined : rest;
      const chosen = ids ? pending.filter((hook) => ids.includes(hook.id)) : pending;
      if (chosen.length === 0)
        return done(
          `None of ${ids?.join(", ")} is pending. Pending: ${pending.map((hook) => hook.id).join(", ")}`,
          false,
        );
      const approved = approvePendingHooks(context.cwd, ids);
      return done(
        [
          `Approved ${approved.length} hook(s). They run from now on, exactly as written:`,
          ...approved.map(
            (hook) =>
              `- ${hook.id} (${hook.event}${hook.matcher ? `:${hook.matcher}` : ""}): ${clip(hook.hook.command, 120)}`,
          ),
        ].join("\n"),
      );
    }
    case "remove": {
      const id = rest[0];
      if (!id) return done("Usage: /hooks remove <id>", false);
      const removed = removeApprovedHook(context.cwd, id);
      return removed > 0
        ? done(
            `Removed the approved hook "${id}". (If the settings file still defines it, it is pending again; delete it there too.)`,
          )
        : done(`No approved hook "${id}".`, false);
    }
    case "test": {
      const id = rest[0];
      if (!id) return done("Usage: /hooks test <id>", false);
      const report = await testHook(context.cwd, id);
      return done(JSON.stringify(report, null, 2), report.ok);
    }
    case "runs": {
      const runs = recentHookRuns(30);
      return done(
        runs.length
          ? [
              "Hook runs (newest last):",
              ...runs.map(
                (run) =>
                  `- ${run.at.slice(11, 19)} ${run.event} ${run.hookId} [${run.source}] → ${run.effect} (${run.outcome}, ${run.durationMs} ms)${run.reason ? ` — ${run.reason}` : ""}`,
              ),
            ].join("\n")
          : "No hook has run in this process yet.",
      );
    }
    case "help":
      return done(hooksHelp());
    default:
      return done(`Unknown /hooks option "${sub}".\n${hooksHelp()}`, false);
  }
}

// --- /instructions, /doctor, /prompt ----------------------------------------------------------------------------

function instructionsCommand(context: CommandContext, args: string[]): CommandResult {
  const paths = args.length > 0 ? args : [];
  const set = loadInstructionSet(context.cwd, { paths: paths.flatMap(pathsMentionedIn).concat(paths) });
  const lines = [explainInstructions(set)];
  const layers = readAllLayers(context.root);
  const excludes = [layers.local, layers.user].flatMap((layer) =>
    Array.isArray(layer.data.instructionExcludes) ? layer.data.instructionExcludes : [],
  );
  if (excludes.length) lines.push(`Excluded by settings: ${excludes.join(", ")}`);
  lines.push("", describeSystemPrompt(context.cwd));
  lines.push(
    "",
    'Edits apply from the next turn. Ask Shelra to update SHELRA.md ("add this convention"), or edit the files above.',
  );
  return done(lines.join("\n"));
}

function doctorCommand(context: CommandContext): CommandResult {
  const lines: string[] = [];
  let problems = 0;
  const index = skillIndex(context.root, context.cwd);
  const skills = [...index.records.values()];
  lines.push(
    `Skills: ${skills.length} registered (${skills.filter((skill) => skill.invocation === "auto" && skill.enabled).length} used automatically), ${index.rejected.length} skipped.`,
  );
  for (const rejected of index.rejected) {
    lines.push(`  ✗ ${rejected.path}: ${rejected.reason}`);
    problems++;
  }
  for (const skill of skills) {
    for (const error of skill.diagnostics.filter((entry) => entry.startsWith("error:"))) {
      lines.push(`  ✗ ${skill.name}: ${error.slice(7)}`);
      problems++;
    }
    const missing = missingRequirements(skill.requires);
    if (missing.length) lines.push(`  ! ${skill.name}: missing ${missing.join(", ")}`);
    if (!skill.trusted)
      lines.push(`  ! ${skill.name}: unreviewed (${skill.flags.join(", ") || "from outside the project"})`);
  }
  const agents = listAgents(context.root);
  lines.push(`Agents: ${agents.length} defined.`);
  for (const agent of agents) {
    if (agent.rejected) {
      lines.push(`  ✗ ${agent.name}: ${agent.rejected}`);
      problems++;
    }
    for (const skill of agent.skills)
      if (!getSkill(context.root, skill)) lines.push(`  ! ${agent.name}: skill "${skill}" does not exist`);
  }
  const hooks = resolveHooks(context.cwd);
  const pending = hooks.hooks.filter((hook) => hook.state === "pending");
  lines.push(
    `Hooks: ${hooks.hooks.length} defined${pending.length ? `, ${pending.length} waiting for your approval (/hooks)` : ""}.`,
  );
  for (const problem of hooks.problems) {
    lines.push(`  ✗ (${problem.source}) ${problem.message}`);
    problems++;
  }
  const set = loadInstructionSet(context.cwd);
  lines.push(`Instructions: ${set.sources.filter((source) => source.applied).length} source(s), version ${set.hash}.`);
  for (const diagnostic of set.diagnostics.filter((entry) => entry.severity !== "info")) {
    lines.push(`  ${diagnostic.severity === "error" ? "✗" : "!"} ${diagnostic.message}`);
    if (diagnostic.severity === "error") problems++;
  }
  const compat = compatReport(context.root).filter((item) => item.status === "rejected");
  for (const item of compat)
    lines.push(`  ! ${item.kind} ${item.name} from another agent cannot be used: ${item.notes.join("; ")}`);
  lines.push("", problems === 0 ? "No errors found." : `${problems} error(s) need fixing.`);
  return done(lines.join("\n"), problems === 0);
}

// --- Other agents' configuration ---------------------------------------------------------------------------------

/**
 * `shelra extensions compat` shows what other agents left in the project and what Shelra can do with each item;
 * `import --apply` writes native copies under `.shelra/` (agents translated with their provenance, skills copied, hooks
 * proposed as pending). The originals are only ever read.
 */
function compatCommand(context: CommandContext, args: string[]): CommandResult {
  const items = compatReport(context.root);
  const apply = args.includes("--apply");
  const wantsImport = args[0] === "import";
  const lines: string[] = [];
  if (items.length === 0)
    return done(
      "Nothing from other agents was found (.claude/agents, .claude/skills, .claude/settings.json, CLAUDE.md, …).",
    );
  lines.push(
    wantsImport
      ? apply
        ? "Importing (originals are not changed):"
        : "Would import (nothing written; add --apply):"
      : "Other agents' configuration in this project:",
  );
  for (const item of items) {
    lines.push(`- [${item.status}] ${item.kind} ${item.name}`);
    for (const note of item.notes) lines.push(`    ${note}`);
  }
  if (wantsImport && apply) {
    lines.push("");
    for (const item of items.filter((entry) => entry.importable)) {
      if (item.kind === "skill") {
        const result = importSkillFolder(context.root, item);
        lines.push(
          result.written.length
            ? `copied skill ${item.name} → ${result.written[0]}`
            : `skipped skill ${item.name}: ${result.skipped}`,
        );
      } else if (item.kind === "agent") {
        const translated = translateClaudeAgent(item.path, readTextIfExists(item.path) ?? "");
        if ("rejectedFile" in translated) continue;
        if (getAgent(context.root, translated.agent.name)?.origin === "shelra") {
          lines.push(`skipped agent ${item.name}: a native agent with that name exists`);
          continue;
        }
        const written = writeAgent(context.root, {
          name: translated.agent.name,
          description: translated.agent.description,
          instructions: translated.agent.instructions,
          access: translated.agent.readOnly ? "read-only" : "standard",
          ...(translated.agent.tools.length ? { tools: translated.agent.tools } : {}),
          ...(translated.agent.disallowedTools.length ? { disallowedTools: translated.agent.disallowedTools } : {}),
          ...(translated.agent.skills.length ? { skills: translated.agent.skills } : {}),
          ...(translated.agent.maxSteps ? { maxSteps: translated.agent.maxSteps } : {}),
          provenance: `imported from ${item.path} (${translated.status})`,
        });
        lines.push(
          written.ok
            ? `imported agent ${item.name} → ${written.path}`
            : `could not import agent ${item.name}: ${written.reason}`,
        );
      } else if (item.kind === "hook") {
        const settings = readTextIfExists(item.path);
        for (const hook of settings ? translateClaudeHooks(settings) : []) {
          if (hook.status === "rejected") continue;
          if (`${hook.event}${hook.matcher ? `:${hook.matcher}` : ""}` !== item.name) continue;
          const proposed = proposeHook(context.cwd, {
            event: hook.event,
            ...(hook.matcher ? { matcher: hook.matcher } : {}),
            command: hook.command,
            ...(hook.timeout ? { timeout: hook.timeout } : {}),
            description: "imported from .claude/settings.json",
          });
          lines.push(
            proposed.ok
              ? `proposed hook ${proposed.id} (pending: approve with /hooks approve ${proposed.id})`
              : `could not import hook ${item.name}: ${proposed.reason}`,
          );
        }
      }
    }
  }
  return done(lines.join("\n"));
}

// --- Entry points -----------------------------------------------------------------------------------------------

/** Command names the terminal UI owns: a skill invoked as `/name` never shadows one of these. */
export const RESERVED_SLASH_NAMES: ReadonlySet<string> = new Set([
  "models",
  "model",
  "mode",
  "config",
  "settings",
  "setup",
  "keys",
  "providers",
  "free",
  "mixed",
  "paid",
  "plan",
  "diff",
  "checks",
  "context",
  "status",
  "help",
  "verify",
  "review",
  "memory",
  "skills",
  "skill",
  "agents",
  "agent",
  "tasks",
  "delegations",
  "effort",
  "reasoning",
  "new",
  "resume",
  "sessions",
  "history",
  "chats",
  "import",
  "migrate",
  "claude",
  "codex",
  "commit-push",
  "commit-pr",
  "btw",
  "recaps",
  "recap",
  "summary",
  "theme",
  "appearance",
  "sandbox",
  "mcp",
  "schedule",
  "wallet",
  "remote-control",
  "login",
  "account",
  "whoami",
  "logout",
  "signout",
  "update",
  "exit",
  "clear",
  "hooks",
  "hook",
  "instructions",
  "rules",
  "doctor",
  "prompt",
]);

export const EXTENSION_COMMANDS = [
  "skills",
  "agents",
  "hooks",
  "instructions",
  "doctor",
  "prompt",
  "extensions",
] as const;

/** Splits `/skills show foo` into its words, honouring quotes. */
export function splitCommand(text: string): string[] {
  const words: string[] = [];
  for (const match of text.trim().matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/gu))
    words.push((match[1] ?? match[2] ?? match[3]) as string);
  return words;
}

/** Runs one extension command. `name` is the command without its slash. Never throws. */
export async function runExtensionCommand(
  context: CommandContext,
  name: string,
  args: string[],
): Promise<CommandResult> {
  try {
    switch (name) {
      case "skills":
      case "skill":
        return skillsCommand(context, args);
      case "agents":
      case "agent":
        return await agentsCommand(context, args);
      case "hooks":
      case "hook":
        return await hooksCommand(context, args);
      case "instructions":
      case "rules":
        return instructionsCommand(context, args);
      case "doctor":
        return doctorCommand(context);
      case "prompt":
        return done(describeSystemPrompt(context.cwd));
      case "extensions":
        return compatCommand(context, args);
      default:
        return done(`Unknown command ${name}`, false);
    }
  } catch (error) {
    return done(`The command failed: ${error instanceof Error ? error.message : String(error)}`, false);
  }
}

/**
 * `/<skill> arguments` typed by the person: the skill, loaded on their say-so (so an explicit-only skill runs), as the
 * message the model receives. Returns null when the text is not an invocation of a skill.
 */
export function expandSkillInvocation(
  context: CommandContext,
  text: string,
): { message: string; notice: string; name: string; hash: string } | { error: string; name: string } | null {
  const match = /^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/u.exec(text.trim());
  if (!match) return null;
  const name = match[1] as string;
  if ((context.reservedNames ?? RESERVED_SLASH_NAMES).has(name)) return null;
  const record = getSkill(context.root, name, context.cwd);
  if (!record) return null;
  const loaded = loadSkill(
    context.root,
    name,
    {
      invoker: "user",
      request: text,
      ...(match[2] ? { arguments: match[2].trim() } : {}),
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    },
    context.cwd,
  );
  if (!loaded.ok) return { error: loaded.reason, name };
  const body = renderLoadedSkill(loaded);
  const lead =
    loaded.record.context === "agent"
      ? `The user ran the skill "${name}" and it is meant to run in the "${loaded.record.agent ?? "general"}" agent: delegate its procedure with the task tool (agent "${loaded.record.agent ?? "general"}", the instructions below as the prompt), then check what comes back.`
      : `The user ran the skill "${name}" on purpose. Follow its instructions below for this request.`;
  return {
    message: `${text.trim()}\n\n${lead}\n\n${body}`,
    notice: `Skill ${name} loaded (version ${loaded.hash}, invoked by you)`,
    name,
    hash: loaded.hash,
  };
}

/**
 * The text of a command as the terminal log should draw it: in a code block, because the log renders Markdown, which
 * would eat the backslashes of a Windows path (`C:\Users\x\.shelra` loses its `\.`) and re-flow aligned lines. The fence
 * is longer than any run of backticks inside the text, so text that contains a code block cannot close it early.
 */
export function asFencedText(output: string): string {
  const longest = Math.max(2, ...[...output.matchAll(/`+/gu)].map((match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${output.replace(/\s+$/u, "")}\n${fence}`;
}
