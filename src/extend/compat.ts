/**
 * Compatibility with what other coding agents leave in a repository: `.claude/agents`, `.claude/skills`,
 * `.agents/skills`, CLAUDE.md, AGENTS.md and the hooks in `.claude/settings.json`. Every item gets one of four
 * statuses, and the matrix is what `shelra extensions import` shows before it writes anything:
 *
 *   supported            used as it is
 *   translated           an equivalent Shelra field or name was used (the note says which)
 *   partial              usable, but something it asked for has no equivalent and was dropped (safely: narrower)
 *   rejected             not activated, because honoring it would widen a permission, skip an isolation it relied on,
 *                        or run code that has not passed the trust policy; the reason says what to do
 *
 * The originals are read-only: an import writes new files under `.shelra/` and never opens a source for writing.
 * Tool and model names are never translated into capabilities Shelra does not have: `opus` is not a Shelra model, so a
 * model line becomes "inherit" with a note, and a tool with no equivalent is dropped, not invented.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { AgentRecord } from "./agents";
import { boolOf, listOf, parseFrontmatter, stringOf, toolListOf } from "./frontmatter";
import { readTextIfExists } from "./store";

export type CompatStatus = "supported" | "translated" | "partial" | "rejected";

export interface CompatItem {
  kind: "agent" | "skill" | "hook" | "instructions" | "rule";
  name: string;
  path: string;
  status: CompatStatus;
  notes: string[];
  /** Whether `import --apply` would write a native copy. */
  importable: boolean;
}

const RANK: Record<CompatStatus, number> = { supported: 0, translated: 1, partial: 2, rejected: 3 };
export function worst(a: CompatStatus, b: CompatStatus): CompatStatus {
  return RANK[a] >= RANK[b] ? a : b;
}

/** Claude Code tool names and the Shelra tool each one maps to (null: no equivalent, dropped). */
export const CLAUDE_TOOL_MAP: Readonly<Record<string, string | null>> = {
  read: "read_file",
  grep: "grep",
  glob: "grep",
  edit: "edit_file",
  multiedit: "edit_file",
  write: "write_file",
  bash: "bash",
  powershell: "bash",
  webfetch: "open_web",
  websearch: "search_web",
  skill: "skill",
  lsp: "lsp",
  notebookedit: null,
  todowrite: null,
  task: null,
  agent: null,
  askuserquestion: null,
  exitplanmode: null,
  enterplanmode: null,
};

/** The matcher of a Claude hook ("Edit|Write") in Shelra's tool names, plus what could not be mapped. */
export function translateMatcher(matcher: string | undefined): { matcher: string | undefined; unmapped: string[] } {
  if (!matcher || matcher === "*") return { matcher: undefined, unmapped: [] };
  const unmapped: string[] = [];
  const parts = matcher
    .split(/[|,]/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const mapped = parts.flatMap((part) => {
    const key = part.toLowerCase();
    if (key in CLAUDE_TOOL_MAP) {
      const target = CLAUDE_TOOL_MAP[key];
      if (target) return [target];
      unmapped.push(part);
      return [];
    }
    unmapped.push(part);
    return [];
  });
  return { matcher: mapped.length > 0 ? [...new Set(mapped)].join("|") : undefined, unmapped };
}

type AgentCore = Omit<AgentRecord, "source" | "scope" | "origin" | "enabled" | "shadows" | "signature">;

export interface ClaudeAgentTranslation {
  agent: AgentCore;
  status: CompatStatus;
  notes: string[];
}

const BROADENING_MODES = new Set(["bypasspermissions", "acceptedits", "auto", "dontask"]);

/** Reads one `.claude/agents/<name>.md` into a Shelra agent; a definition that cannot be honored safely is `rejected`. */
export function translateClaudeAgent(
  path: string,
  text: string,
): { agent: AgentCore; status: CompatStatus; notes: string[] } | { rejectedFile: string } {
  const parsed = parseFrontmatter(text);
  if (!parsed.hasFrontmatter) return { rejectedFile: "no front matter" };
  const name = (stringOf(parsed.data.name) ?? basename(path, ".md")).trim();
  const description = (stringOf(parsed.data.description) ?? "").trim();
  if (!description) return { rejectedFile: "no description" };
  const notes: string[] = [];
  let status: CompatStatus = "supported";
  const bump = (next: CompatStatus, note: string) => {
    status = worst(status, next);
    notes.push(note);
  };
  const rejectReasons: string[] = [];
  const reject = (reason: string) => {
    rejectReasons.push(reason);
    bump("rejected", reason);
  };

  // tools: a list that maps to nothing must not turn into "inherit everything".
  const rawTools = toolListOf(parsed.data.tools);
  const tools: string[] = [];
  for (const entry of rawTools) {
    const scoped = /^([A-Za-z_]+)\((.*)\)$/u.exec(entry);
    const base = (scoped ? scoped[1] : entry) as string;
    const key = base.toLowerCase();
    if (key.startsWith("mcp__") || base.startsWith("mcp_")) {
      bump(
        "partial",
        `tool ${entry}: external tool names differ between agents; not carried over (add the Shelra tool name if you want it)`,
      );
      continue;
    }
    if (!(key in CLAUDE_TOOL_MAP)) {
      bump("partial", `tool ${entry}: no Shelra equivalent; dropped`);
      continue;
    }
    const target = CLAUDE_TOOL_MAP[key];
    if (!target) {
      bump("partial", `tool ${entry}: Shelra has no equivalent (agents cannot start agents here); dropped`);
      continue;
    }
    if (scoped) {
      bump(
        "partial",
        `tool ${entry}: a scoped rule cannot be enforced, so ${target} is not granted at all (narrower, never wider)`,
      );
      continue;
    }
    if (key === "glob")
      notes.push("tool Glob: mapped to grep (search by content) plus shell listing; there is no separate glob tool");
    else if (target !== key.replace(/s$/u, "")) notes.push(`tool ${entry}: translated to ${target}`);
    if (status === "supported") status = "translated";
    if (!tools.includes(target)) tools.push(target);
  }
  const toolsOut = rawTools.length > 0 && tools.length === 0 ? ["skills"] : tools;
  if (rawTools.length > 0 && tools.length === 0)
    bump(
      "partial",
      "none of its tools has a Shelra equivalent; it gets only the skill and extension readers, not the full tool set",
    );

  const disallowed: string[] = [];
  for (const entry of toolListOf(parsed.data.disallowedTools ?? parsed.data["disallowed-tools"])) {
    const scoped = /^([A-Za-z_]+)\((.*)\)$/u.exec(entry);
    const key = ((scoped ? scoped[1] : entry) as string).toLowerCase();
    if (scoped) {
      reject(
        `disallowedTools ${entry} is a scoped deny rule that cannot be enforced; ignoring it would widen what the agent may do`,
      );
      continue;
    }
    const target = CLAUDE_TOOL_MAP[key];
    if (target) disallowed.push(target);
    else notes.push(`disallowedTools ${entry}: nothing to remove here`);
  }

  const mode = (stringOf(parsed.data.permissionMode) ?? "default").toLowerCase();
  let readOnly = false;
  if (mode === "plan") {
    readOnly = true;
    bump("translated", "permissionMode plan: translated to access read-only");
  } else if (BROADENING_MODES.has(mode))
    reject(
      `permissionMode ${stringOf(parsed.data.permissionMode)} would let the agent act without the approvals Shelra requires`,
    );
  else if (mode !== "default")
    bump("partial", `permissionMode ${stringOf(parsed.data.permissionMode)}: unknown; the default (ask) applies`);

  const isolation = stringOf(parsed.data.isolation);
  if (isolation)
    reject(
      `isolation ${isolation} is not available: the agent would share the working tree it was written to be isolated from`,
    );
  if (parsed.data.mcpServers !== undefined)
    reject("mcpServers defines tool servers inside the agent; Shelra does not start servers from an agent file");
  if (parsed.data.hooks !== undefined)
    reject(
      "its hooks are part of what constrains it; import them with `shelra extensions import --hooks`, which asks for trust, before using the agent",
    );

  const model = stringOf(parsed.data.model)?.trim();
  if (model && model !== "inherit")
    bump("partial", `model ${model}: not a Shelra model id, so the session's model is used`);
  const maxTurns = Number(stringOf(parsed.data.maxTurns) ?? "");
  const ignored = ["memory", "background", "color", "effort", "initialPrompt", "omitClaudeMd", "experimental"].filter(
    (key) => parsed.data[key] !== undefined,
  );
  if (ignored.length > 0) bump("partial", `${ignored.join(", ")}: no effect in Shelra; ignored`);
  void boolOf;

  const agent: AgentCore = {
    name,
    description,
    instructions: parsed.body.trim() || `You are the agent "${name}".`,
    readOnly,
    tools: toolsOut,
    disallowedTools: disallowed,
    skills: listOf(parsed.data.skills),
    model: "inherit",
    ...(Number.isFinite(maxTurns) && maxTurns >= 1 && maxTurns <= 200 ? { maxSteps: Math.floor(maxTurns) } : {}),
    enabled: true,
    ...(rejectReasons.length > 0
      ? { rejected: `incompatible with Shelra's permission model: ${rejectReasons.join("; ")}` }
      : {}),
    diagnostics: [...parsed.problems, ...notes.map((note) => `compat: ${note}`)],
  } as AgentCore;
  if (Number.isFinite(maxTurns) && maxTurns >= 1) notes.push(`maxTurns ${maxTurns}: translated to max-steps`);
  return { agent, status, notes };
}

// --- The matrix over a whole repository -------------------------------------------------------------------------

function listDir(dir: string): string[] {
  try {
    return existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir).sort() : [];
  } catch {
    return [];
  }
}

export interface HookTranslation {
  event: string;
  matcher?: string;
  command: string;
  timeout?: number;
  status: CompatStatus;
  notes: string[];
}

const SHELRA_HOOK_EVENTS = new Set([
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "UserPromptSubmit",
  "SessionStart",
  "SessionEnd",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "PreCompact",
  "PostCompact",
  "Notification",
  "InstructionsLoaded",
  "CwdChanged",
]);

/** Reads the `hooks` object of a `.claude/settings.json`; only command hooks on events Shelra fires can be carried. */
export function translateClaudeHooks(settingsText: string): HookTranslation[] {
  let root: unknown;
  try {
    root = JSON.parse(settingsText);
  } catch {
    return [];
  }
  const hooks = (root as { hooks?: Record<string, unknown> } | null)?.hooks;
  if (!hooks || typeof hooks !== "object") return [];
  const out: HookTranslation[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups as Array<{ matcher?: string; hooks?: Array<Record<string, unknown>> }>) {
      const translated = translateMatcher(group.matcher);
      for (const hook of group.hooks ?? []) {
        const notes: string[] = [];
        let status: CompatStatus = "supported";
        if (!SHELRA_HOOK_EVENTS.has(event)) {
          out.push({
            event,
            command: String(hook.command ?? ""),
            status: "rejected",
            notes: [`event ${event} is not fired by Shelra`],
          });
          continue;
        }
        if (hook.type !== "command" && hook.type !== undefined) {
          out.push({
            event,
            command: String(hook.command ?? hook.url ?? hook.prompt ?? ""),
            status: "rejected",
            notes: [`hook type ${String(hook.type)} is not supported (only command hooks run, and only after trust)`],
          });
          continue;
        }
        if (typeof hook.command !== "string" || !hook.command.trim()) {
          out.push({ event, command: "", status: "rejected", notes: ["no command"] });
          continue;
        }
        if (group.matcher && group.matcher !== "*" && translated.unmapped.length > 0) {
          if (!translated.matcher) {
            out.push({
              event,
              command: hook.command,
              status: "rejected",
              notes: [
                `matcher ${group.matcher} names no tool Shelra has, so the hook would fire on everything or nothing; not imported`,
              ],
            });
            continue;
          }
          status = worst(status, "partial");
          notes.push(`matcher: ${translated.unmapped.join(", ")} has no Shelra tool and was dropped from the matcher`);
        } else if (group.matcher && group.matcher !== "*" && translated.matcher !== group.matcher) {
          status = worst(status, "translated");
          notes.push(`matcher translated to ${translated.matcher}`);
        }
        if (/\$\{?CLAUDE_[A-Z_]+/u.test(hook.command)) {
          status = worst(status, "partial");
          notes.push("the command uses CLAUDE_* variables, which Shelra does not set; it may not work as written");
        }
        const timeout = typeof hook.timeout === "number" ? hook.timeout : undefined;
        out.push({
          event,
          ...(translated.matcher ? { matcher: translated.matcher } : {}),
          command: hook.command,
          ...(timeout ? { timeout } : {}),
          status,
          notes,
        });
      }
    }
  }
  return out;
}

/** Inspects a repository for what other agents left in it, without writing anything. */
export function compatReport(root: string): CompatItem[] {
  const items: CompatItem[] = [];
  const base = resolve(root);
  for (const file of listDir(join(base, ".claude", "agents")).filter((entry) => entry.endsWith(".md"))) {
    const path = join(base, ".claude", "agents", file);
    const text = readTextIfExists(path) ?? "";
    const result = translateClaudeAgent(path, text);
    if ("rejectedFile" in result)
      items.push({
        kind: "agent",
        name: basename(file, ".md"),
        path,
        status: "rejected",
        notes: [result.rejectedFile],
        importable: false,
      });
    else
      items.push({
        kind: "agent",
        name: result.agent.name,
        path,
        status: result.status,
        notes: result.notes,
        importable: result.status !== "rejected",
      });
  }
  for (const [folder, origin] of [
    [".claude/skills", "claude"],
    [".agents/skills", "agents"],
  ] as const) {
    for (const entry of listDir(join(base, folder))) {
      const file = join(base, folder, entry, "SKILL.md");
      const text = readTextIfExists(file);
      if (text === null) continue;
      const parsed = parseFrontmatter(text);
      const notes: string[] = [];
      let status: CompatStatus = "supported";
      if (!parsed.hasFrontmatter || !stringOf(parsed.data.description)) {
        items.push({
          kind: "skill",
          name: entry,
          path: file,
          status: "rejected",
          notes: ["no front matter or no description"],
          importable: false,
        });
        continue;
      }
      if (parsed.data["allowed-tools"] !== undefined) {
        status = worst(status, "partial");
        notes.push("allowed-tools is recorded but never a grant in Shelra");
      }
      if (
        parsed.data["disable-model-invocation"] !== undefined ||
        parsed.data["user-invocable"] !== undefined ||
        parsed.data.context !== undefined ||
        parsed.data.arguments !== undefined
      ) {
        status = worst(status, "translated");
        notes.push("invocation, argument and context fields are read and mapped to Shelra's");
      }
      if (/!`[^`]+`/u.test(parsed.body) || /^```!/mu.test(parsed.body)) {
        status = worst(status, "partial");
        notes.push(
          "inline shell injection (!`command`) is not executed; the text is left as written, which the agent should run itself if needed",
        );
      }
      if (/\$\{CLAUDE_[A-Z_]+\}/u.test(parsed.body)) {
        status = worst(status, "partial");
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the text names the placeholder literally
        notes.push("CLAUDE_* variables are not substituted (use ${SHELRA_SKILL_DIR}, ${SHELRA_PROJECT_DIR})");
      }
      items.push({
        kind: "skill",
        name: stringOf(parsed.data.name) ?? entry,
        path: file,
        status,
        notes:
          origin === "agents"
            ? [...notes, "read directly from .agents/skills (the cross-client folder)"]
            : [...notes, "read directly from .claude/skills; import copies it into .shelra/skills"],
        importable: origin === "claude",
      });
    }
  }
  const settings = readTextIfExists(join(base, ".claude", "settings.json"));
  if (settings) {
    for (const hook of translateClaudeHooks(settings)) {
      items.push({
        kind: "hook",
        name: `${hook.event}${hook.matcher ? `:${hook.matcher}` : ""}`,
        path: join(base, ".claude", "settings.json"),
        status: hook.status,
        notes: [
          ...hook.notes,
          ...(hook.status === "rejected" ? [] : ["imported disabled; it runs only after you review and trust it"]),
        ],
        importable: hook.status !== "rejected",
      });
    }
  }
  for (const file of ["CLAUDE.md", "AGENTS.md", "SHELRA.md"]) {
    const path = join(base, file);
    if (!existsSync(path)) continue;
    items.push({
      kind: "instructions",
      name: file,
      path,
      status: "supported",
      notes:
        file === "CLAUDE.md"
          ? [
              "loaded only when the folder has neither SHELRA.md nor AGENTS.md; `@path` imports are followed within the project",
            ]
          : file === "AGENTS.md"
            ? ["loaded as the cross-agent brief"]
            : ["canonical instructions"],
      importable: false,
    });
  }
  for (const file of listDir(join(base, ".claude", "rules")).filter((entry) => entry.endsWith(".md"))) {
    const path = join(base, ".claude", "rules", file);
    const parsed = parseFrontmatter(readTextIfExists(path) ?? "");
    items.push({
      kind: "rule",
      name: file,
      path,
      status: parsed.data.paths !== undefined ? "translated" : "supported",
      notes: ["read as a path-scoped rule"],
      importable: true,
    });
  }
  return items;
}

export interface ImportOutcome {
  item: CompatItem;
  written: string[];
  skipped?: string;
}

/**
 * Copies importable skills into `.shelra/skills` (whole folder, resources included). Agents, hooks and rules are
 * written by their own modules, which validate and version them; this function only does the skill copy and reports.
 */
export function importSkillFolder(root: string, item: CompatItem): ImportOutcome {
  const name = basename(resolve(item.path, ".."));
  const target = join(resolve(root), ".shelra", "skills", name);
  if (existsSync(target)) return { item, written: [], skipped: `${target} already exists; not overwritten` };
  try {
    mkdirSync(join(resolve(root), ".shelra", "skills"), { recursive: true });
    cpSync(resolve(item.path, ".."), target, { recursive: true, errorOnExist: true });
    return { item, written: [join(target, "SKILL.md")] };
  } catch (error) {
    return { item, written: [], skipped: error instanceof Error ? error.message : String(error) };
  }
}
