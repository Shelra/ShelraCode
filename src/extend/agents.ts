/**
 * The agent registry: specialists defined as files (`.shelra/agents/<name>.md`, `~/.shelra/agents/<name>.md`), read from
 * Claude Code's `.claude/agents/` through the compat adapter, and the older `subAgents` list in user-settings. An agent
 * is not a renamed assistant: it is an instruction text plus a tool policy, a skill list and limits, resolved once into
 * a snapshot when it is launched. Editing a definition affects the next launch, never one already running.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { containsSecret } from "../memory/gate";
import { getProductUserDir } from "../product/identity";
import { loadValidSubAgents } from "../utils/settings";
import { translateClaudeAgent } from "./compat";
import {
  boolOf,
  type FrontmatterValue,
  listOf,
  parseFrontmatter,
  serializeFrontmatter,
  stringOf,
  toolListOf,
} from "./frontmatter";
import { type AgentToolPolicy, expandToolNames, makePolicy, TOOL_GROUPS } from "./policy";
import { type AgentOverride, effectiveOverride, readAllLayers, type SettingsLayer } from "./settings";
import { getSkill, loadSkill, type SkillRecord } from "./skills";
import { readTextIfExists, removeDefinition, writeDefinition } from "./store";

export type AgentOrigin = "shelra" | "claude" | "settings";
export type AgentScope = "project" | "user";

/** Names the harness's own sub-agents use; a definition may not take them. */
export const RESERVED_AGENT_NAMES: ReadonlySet<string> = new Set([
  "general",
  "explore",
  "plan",
  "vision",
  "verify",
  "verify-detect",
  "verify-manifest",
  "ui-verify",
  "computer",
  "check",
  "main",
]);

export interface AgentRecord {
  name: string;
  description: string;
  instructions: string;
  /** The file it came from, or `user-settings.json` for the older list. */
  source: string;
  scope: AgentScope;
  origin: AgentOrigin;
  readOnly: boolean;
  tools: string[];
  disallowedTools: string[];
  skills: string[];
  /** `inherit`, or a model the agent asks for (honoured in Mixed mode only). */
  model: string;
  maxSteps?: number;
  timeoutMinutes?: number;
  resultFormat?: string;
  status?: string;
  enabled: boolean;
  override?: { value: AgentOverride; from: SettingsLayer };
  /** When set, this agent cannot be activated, and why (an incompatible import). */
  rejected?: string;
  diagnostics: string[];
  shadows: string[];
  /** mtime:size of the file, for change detection. */
  signature: string;
}

export interface AgentIssue {
  severity: "error" | "warning";
  message: string;
}

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_STEPS_LIMIT = 200;
const MAX_TIMEOUT_MINUTES = 120;
const MAX_INSTRUCTION_BYTES = 32 * 1024;
const KNOWN_TOOL_NAMES = new Set(Object.values(TOOL_GROUPS).flat());

export interface AgentValidationInput {
  name: string;
  description: string;
  instructions: string;
  access?: string;
  tools: string[];
  disallowedTools: string[];
  skills: string[];
  model?: string;
  maxSteps?: number;
  timeoutMinutes?: number;
  isolation?: string;
  skillExists?: (name: string) => boolean;
}

export function validateAgentDefinition(input: AgentValidationInput): AgentIssue[] {
  const issues: AgentIssue[] = [];
  const error = (message: string) => issues.push({ severity: "error", message });
  const warn = (message: string) => issues.push({ severity: "warning", message });
  if (!input.name) error("name is required");
  else {
    if (input.name.length > 64) error("name is longer than 64 characters");
    if (!NAME_PATTERN.test(input.name)) error("name may only use lowercase letters, digits and single hyphens");
    if (RESERVED_AGENT_NAMES.has(input.name)) error(`"${input.name}" is the name of a built-in agent; choose another`);
  }
  const description = input.description.trim();
  if (!description) error("description is required: it is how the agent gets chosen for a task");
  else if (description.length > 1024) error("description is longer than 1024 characters");
  else if (description.length < 12) warn("description is very short; say when to use this agent");
  if (!input.instructions.trim()) error("the instructions are empty");
  if (Buffer.byteLength(input.instructions, "utf8") > MAX_INSTRUCTION_BYTES)
    error("the instructions are larger than 32 KB");
  if (input.access !== undefined && input.access !== "read-only" && input.access !== "standard")
    error(`access must be read-only or standard, not "${input.access}"`);
  const expanded = expandToolNames(input.tools);
  for (const name of expanded.unknown) error(`"${name}" is not a tool or group name`);
  for (const name of [...expanded.tools, ...expandToolNames(input.disallowedTools).tools]) {
    if (!KNOWN_TOOL_NAMES.has(name) && !name.startsWith("mcp_"))
      warn(`"${name}" is not a tool Shelra has; it will match nothing`);
  }
  if (input.access === "read-only") {
    const writes = [...expanded.tools].filter((name) =>
      ["write_file", "edit_file", "delete_file", "restore_file", "memory_write", "memory_delete"].includes(name),
    );
    if (writes.length > 0) warn(`a read-only agent never gets ${writes.join(", ")}; they are ignored`);
  }
  if (
    input.maxSteps !== undefined &&
    (!Number.isInteger(input.maxSteps) || input.maxSteps < 1 || input.maxSteps > MAX_STEPS_LIMIT)
  )
    error(`max-steps must be a whole number from 1 to ${MAX_STEPS_LIMIT}`);
  if (
    input.timeoutMinutes !== undefined &&
    (!Number.isFinite(input.timeoutMinutes) || input.timeoutMinutes < 1 || input.timeoutMinutes > MAX_TIMEOUT_MINUTES)
  )
    error(`timeout-minutes must be from 1 to ${MAX_TIMEOUT_MINUTES}`);
  if (input.isolation !== undefined && input.isolation !== "none")
    error(
      `isolation "${input.isolation}" is not available: agents share the session's workspace, and writes are coordinated with file leases`,
    );
  if (input.model && input.model !== "inherit" && !/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/u.test(input.model))
    error(`model "${input.model}" is not a model id`);
  if (containsSecret(`${input.description}\n${input.instructions}`))
    error("the text contains what looks like a secret; remove it");
  if (input.skillExists) {
    for (const skill of input.skills)
      if (!input.skillExists(skill)) warn(`skill "${skill}" does not exist (yet); the agent starts without it`);
  }
  return issues;
}

// --- Discovery --------------------------------------------------------------------------------------------------

function numberOf(value: FrontmatterValue | undefined): number | undefined {
  const text = stringOf(value);
  if (text === undefined || text.trim() === "") return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function recordFromNative(
  file: string,
  scope: AgentScope,
  text: string,
  signature: string,
): AgentRecord | { unreadable: string } {
  const parsed = parseFrontmatter(text);
  if (!parsed.hasFrontmatter) return { unreadable: "no front matter" };
  const name = (stringOf(parsed.data.name) ?? basename(file, ".md")).trim();
  const description = (stringOf(parsed.data.description) ?? "").trim();
  if (!description) return { unreadable: "no description" };
  const access = stringOf(parsed.data.access);
  const maxSteps = numberOf(parsed.data["max-steps"]);
  const timeoutMinutes = numberOf(parsed.data["timeout-minutes"]);
  const tools = toolListOf(parsed.data.tools);
  const disallowedTools = toolListOf(parsed.data["disallowed-tools"]);
  const skills = listOf(parsed.data.skills);
  const issues = validateAgentDefinition({
    name,
    description,
    instructions: parsed.body,
    ...(access ? { access } : {}),
    tools,
    disallowedTools,
    skills,
    ...(stringOf(parsed.data.model) ? { model: stringOf(parsed.data.model) as string } : {}),
    ...(maxSteps !== undefined ? { maxSteps } : {}),
    ...(timeoutMinutes !== undefined ? { timeoutMinutes } : {}),
    ...(stringOf(parsed.data.isolation) ? { isolation: stringOf(parsed.data.isolation) as string } : {}),
  });
  const errors = issues.filter((issue) => issue.severity === "error");
  const record: AgentRecord = {
    name,
    description,
    instructions: parsed.body.trim(),
    source: file,
    scope,
    origin: "shelra",
    readOnly: access === "read-only" || boolOf(parsed.data["read-only"]) === true,
    tools,
    disallowedTools,
    skills,
    model: stringOf(parsed.data.model)?.trim() || "inherit",
    ...(maxSteps !== undefined && Number.isFinite(maxSteps) ? { maxSteps } : {}),
    ...(timeoutMinutes !== undefined && Number.isFinite(timeoutMinutes) ? { timeoutMinutes } : {}),
    ...(stringOf(parsed.data["result-format"])
      ? { resultFormat: stringOf(parsed.data["result-format"]) as string }
      : {}),
    ...(stringOf(parsed.data.status) ? { status: stringOf(parsed.data.status) as string } : {}),
    enabled: true,
    diagnostics: [...parsed.problems, ...issues.map((issue) => `${issue.severity}: ${issue.message}`)],
    shadows: [],
    signature,
  };
  if (errors.length > 0) record.rejected = errors.map((issue) => issue.message).join("; ");
  return record;
}

interface AgentScan {
  records: Map<string, AgentRecord>;
  rejected: Array<{ path: string; reason: string }>;
  signature: string;
  builtAt: number;
}

function agentFolders(root: string): Array<{ dir: string; scope: AgentScope; origin: AgentOrigin }> {
  const userHome = resolve(getProductUserDir(), "..");
  return [
    { dir: join(resolve(root), ".shelra", "agents"), scope: "project", origin: "shelra" },
    { dir: join(resolve(root), ".claude", "agents"), scope: "project", origin: "claude" },
    { dir: join(getProductUserDir(), "agents"), scope: "user", origin: "shelra" },
    { dir: join(userHome, ".claude", "agents"), scope: "user", origin: "claude" },
  ];
}

function scan(root: string): AgentScan {
  const candidates: AgentRecord[] = [];
  const rejected: AgentScan["rejected"] = [];
  const parts: string[] = [];
  for (const folder of agentFolders(root)) {
    let files: string[];
    try {
      if (!existsSync(folder.dir) || !statSync(folder.dir).isDirectory()) continue;
      files = readdirSync(folder.dir)
        .filter((file) => file.endsWith(".md") && !file.startsWith("."))
        .sort();
    } catch {
      continue;
    }
    for (const file of files.slice(0, 500)) {
      const path = join(folder.dir, file);
      let signature: string;
      try {
        const stat = statSync(path);
        signature = `${stat.mtimeMs}:${stat.size}`;
      } catch {
        continue;
      }
      parts.push(`${path}|${signature}`);
      const text = readTextIfExists(path);
      if (text === null) continue;
      if (folder.origin === "claude") {
        const translated = translateClaudeAgent(path, text);
        if ("rejectedFile" in translated) {
          rejected.push({ path, reason: translated.rejectedFile });
          continue;
        }
        candidates.push({
          ...translated.agent,
          source: path,
          scope: folder.scope,
          origin: "claude",
          enabled: true,
          shadows: [],
          signature,
        });
        continue;
      }
      const made = recordFromNative(path, folder.scope, text, signature);
      if ("unreadable" in made) rejected.push({ path, reason: made.unreadable });
      else candidates.push(made);
    }
  }
  // The older list in user-settings.json: trusted (the person wrote it there), full tools as before.
  try {
    for (const legacy of loadValidSubAgents()) {
      candidates.push({
        name:
          legacy.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/gu, "-")
            .replace(/^-+|-+$/gu, "") || legacy.name,
        description: legacy.instruction.trim().split("\n")[0]?.slice(0, 200) || `User-defined agent ${legacy.name}`,
        instructions: legacy.instruction.trim() || `You are the custom sub-agent "${legacy.name}".`,
        source: join(getProductUserDir(), "user-settings.json"),
        scope: "user",
        origin: "settings",
        readOnly: false,
        tools: [],
        disallowedTools: [],
        skills: [],
        model: legacy.model,
        enabled: true,
        diagnostics: [
          "defined in user-settings.json (the older format); move it to ~/.shelra/agents/ to add tools, skills and limits",
        ],
        shadows: [],
        signature: "settings",
      });
    }
  } catch {
    /* an unreadable settings file reads as no legacy agents */
  }
  const order: Record<AgentOrigin, number> = { shelra: 0, claude: 1, settings: 2 };
  const rank = (record: AgentRecord) => (record.scope === "project" ? 0 : 10) + order[record.origin];
  candidates.sort((a, b) => rank(a) - rank(b));
  const layers = readAllLayers(root);
  const records = new Map<string, AgentRecord>();
  for (const record of candidates) {
    const key = record.name.toLowerCase();
    const existing = records.get(key);
    if (existing) {
      existing.shadows.push(record.source);
      continue;
    }
    const override = effectiveOverride<AgentOverride>(layers, "agentOverrides", record.name, ["on", "off"]);
    if (override.value && override.from) record.override = { value: override.value, from: override.from };
    if (override.value === "off") record.enabled = false;
    records.set(key, record);
  }
  return { records, rejected, signature: parts.join("\n"), builtAt: Date.now() };
}

const CACHE_TTL_MS = 750;
const scans = new Map<string, AgentScan>();

/** Keyed by the user folder too: the benchmark clean room moves HOME, and must not be served the person's agents. */
function scanKey(root: string): string {
  return `${resolve(root)}|${getProductUserDir()}`;
}

export function invalidateAgents(root?: string): void {
  if (!root) {
    scans.clear();
    return;
  }
  const prefix = `${resolve(root)}|`;
  for (const key of scans.keys()) if (key.startsWith(prefix)) scans.delete(key);
}

function current(root: string): AgentScan {
  const key = scanKey(root);
  const hit = scans.get(key);
  if (hit && Date.now() - hit.builtAt < CACHE_TTL_MS) return hit;
  const fresh = scan(resolve(root));
  scans.set(key, fresh);
  return fresh;
}

export function listAgents(root: string): AgentRecord[] {
  return [...current(root).records.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function rejectedAgentFiles(root: string): Array<{ path: string; reason: string }> {
  return current(root).rejected;
}

export function getAgent(root: string, name: string): AgentRecord | undefined {
  return current(root).records.get(name.trim().toLowerCase());
}

// --- Resolution: the snapshot a run uses ------------------------------------------------------------------------

export interface ResolvedAgent {
  record: AgentRecord;
  /** The text of the agent's own system prompt: its instructions and, when set, the shape of its result. */
  instructions: string;
  policy: AgentToolPolicy;
  /** The skills the definition preloads: their full text, bounded. */
  preloaded: Array<{ name: string; hash: string; text: string }>;
  notes: string[];
}

const PRELOAD_SKILL_CHARS = 12_000;
const PRELOAD_TOTAL_CHARS = 30_000;

/**
 * The effective model for an agent: in Free mode always the session's (an agent's own model is never run there, so a
 * definition cannot reach a model the session could not), in Mixed the agent's choice when it names one.
 */
export function effectiveAgentModel(
  agentModel: string,
  sessionModel: string,
  policy: "free" | "mixed",
): { model: string; note?: string } {
  if (!agentModel || agentModel === "inherit") return { model: sessionModel };
  if (policy === "free")
    return {
      model: sessionModel,
      note: `the agent asks for ${agentModel}; Free mode runs the session's model (${sessionModel}) instead`,
    };
  return { model: agentModel };
}

export function resolveAgent(
  root: string,
  name: string,
  runId: string,
  options: { request?: string; sessionId?: string } = {},
): { ok: true; agent: ResolvedAgent } | { ok: false; reason: string } {
  const record = getAgent(root, name);
  if (!record) {
    const near = listAgents(root)
      .map((agent) => agent.name)
      .filter((candidate) => candidate.includes(name.toLowerCase()) || name.toLowerCase().includes(candidate));
    return { ok: false, reason: `No agent named "${name}".${near.length ? ` Closest: ${near.join(", ")}.` : ""}` };
  }
  if (record.rejected) return { ok: false, reason: `Agent "${record.name}" cannot be activated: ${record.rejected}` };
  if (!record.enabled)
    return {
      ok: false,
      reason: `Agent "${record.name}" is turned off${record.override ? ` (${record.override.from} settings)` : ""}.`,
    };
  const notes: string[] = [];
  const preloaded: ResolvedAgent["preloaded"] = [];
  let total = 0;
  for (const skillName of record.skills) {
    const skill = getSkill(root, skillName);
    if (!skill) {
      notes.push(`skill "${skillName}" was not found; the agent starts without it`);
      continue;
    }
    // Naming a skill in the agent's own definition is the person's explicit choice, so an explicit-only skill loads.
    const loaded = loadSkill(root, skill.name, {
      invoker: "user",
      request: options.request ?? "",
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    });
    if (!loaded.ok) {
      notes.push(`skill "${skillName}": ${loaded.reason}`);
      continue;
    }
    const text =
      loaded.instructions.length > PRELOAD_SKILL_CHARS
        ? `${loaded.instructions.slice(0, PRELOAD_SKILL_CHARS)}\n[…truncated; read ${skill.file} for the rest]`
        : loaded.instructions;
    if (total + text.length > PRELOAD_TOTAL_CHARS) {
      notes.push(`skill "${skillName}" was not preloaded (the preload budget is spent); load it with the skill tool`);
      continue;
    }
    total += text.length;
    preloaded.push({ name: skill.name, hash: loaded.hash, text });
  }
  const policy = makePolicy({
    owner: `${record.name}:${runId}`,
    readOnly: record.readOnly,
    tools: record.tools,
    disallowedTools: record.disallowedTools,
  });
  const parts = [record.instructions];
  if (record.resultFormat) parts.push(`RESULT FORMAT:\n${record.resultFormat.trim()}`);
  return { ok: true, agent: { record, instructions: parts.join("\n\n"), policy, preloaded, notes } };
}

// --- Writing ----------------------------------------------------------------------------------------------------

export interface AgentWriteInput {
  name: string;
  scope?: AgentScope;
  description?: string;
  instructions?: string;
  access?: "read-only" | "standard";
  tools?: string[];
  disallowedTools?: string[];
  skills?: string[];
  model?: string;
  maxSteps?: number;
  timeoutMinutes?: number;
  resultFormat?: string;
  status?: string;
  /** Where the definition came from, for an import or a creation by a tool. */
  provenance?: string;
  expectedHash?: string;
}

export type AgentWriteOutcome =
  | {
      ok: true;
      action: "created" | "updated" | "unchanged";
      name: string;
      path: string;
      scope: AgentScope;
      hash: string;
      previousHash: string | null;
      snapshot: string | null;
      issues: AgentIssue[];
      active: boolean;
      appliesTo: string;
    }
  | { ok: false; reason: string; issues: AgentIssue[]; conflict?: boolean; currentHash?: string | null };

const AGENT_ORDER = [
  "name",
  "description",
  "access",
  "tools",
  "disallowed-tools",
  "skills",
  "model",
  "max-steps",
  "timeout-minutes",
  "result-format",
  "status",
  "provenance",
];

export function writeAgent(root: string, input: AgentWriteInput): AgentWriteOutcome {
  const scope = input.scope ?? "project";
  const scopeDir = scope === "user" ? getProductUserDir() : join(resolve(root), ".shelra");
  const path = join(scopeDir, "agents", `${input.name}.md`);
  const existingText = readTextIfExists(path);
  const existing = existingText === null ? null : parseFrontmatter(existingText);
  if (existingText === null && (input.description === undefined || input.instructions === undefined))
    return {
      ok: false,
      reason:
        'a new agent needs `description` (when to use it) and `instructions` (its system prompt) in the same call, for example extension_write({ kind: "agent", action: "create", name, description, instructions })',
      issues: [],
    };
  const data: Record<string, FrontmatterValue> = { ...(existing?.data ?? {}) };
  data.name = input.name;
  if (input.description !== undefined) data.description = input.description.trim();
  const setList = (key: string, value: string[] | undefined) => {
    if (value === undefined) return;
    if (value.length === 0) delete data[key];
    else data[key] = value;
  };
  setList("tools", input.tools);
  setList("disallowed-tools", input.disallowedTools);
  setList("skills", input.skills);
  if (input.access !== undefined) data.access = input.access;
  if (input.model !== undefined) {
    if (input.model === "" || input.model === "inherit") delete data.model;
    else data.model = input.model;
  }
  if (input.maxSteps !== undefined) data["max-steps"] = String(input.maxSteps);
  if (input.timeoutMinutes !== undefined) data["timeout-minutes"] = String(input.timeoutMinutes);
  if (input.resultFormat !== undefined) {
    if (input.resultFormat === "") delete data["result-format"];
    else data["result-format"] = input.resultFormat;
  }
  if (input.status !== undefined) data.status = input.status;
  if (input.provenance !== undefined) data.provenance = input.provenance;
  const body = input.instructions ?? existing?.body ?? "";
  const issues = validateAgentDefinition({
    name: input.name,
    description: stringOf(data.description) ?? "",
    instructions: body,
    ...(stringOf(data.access) ? { access: stringOf(data.access) as string } : {}),
    tools: listOf(data.tools),
    disallowedTools: listOf(data["disallowed-tools"]),
    skills: listOf(data.skills),
    ...(stringOf(data.model) ? { model: stringOf(data.model) as string } : {}),
    ...(numberOf(data["max-steps"]) !== undefined ? { maxSteps: numberOf(data["max-steps"]) as number } : {}),
    ...(numberOf(data["timeout-minutes"]) !== undefined
      ? { timeoutMinutes: numberOf(data["timeout-minutes"]) as number }
      : {}),
    skillExists: (skill) => getSkill(root, skill) !== undefined,
  });
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) return { ok: false, reason: errors.map((issue) => issue.message).join("; "), issues };
  const written = writeDefinition({
    path,
    content: serializeFrontmatter(data, body, AGENT_ORDER),
    kind: "agent",
    name: input.name,
    scopeDir,
    ...(input.expectedHash !== undefined ? { expectedHash: input.expectedHash } : {}),
  });
  if (!written.ok)
    return { ok: false, reason: written.reason, issues, conflict: written.conflict, currentHash: written.currentHash };
  invalidateAgents(root);
  const record = getAgent(root, input.name);
  const active = record?.source === path && record.enabled && !record.rejected;
  if (record && record.source !== path)
    issues.push({
      severity: "warning",
      message: `"${input.name}" is shadowed by ${record.source}, which has higher precedence`,
    });
  return {
    ok: true,
    action: written.created ? "created" : written.changed ? "updated" : "unchanged",
    name: input.name,
    path,
    scope,
    hash: written.hash,
    previousHash: written.previousHash,
    snapshot: written.snapshot,
    issues,
    active,
    appliesTo: "the next launch of this agent (a run already going keeps the definition it started with)",
  };
}

export function deleteAgent(root: string, name: string, scope: AgentScope = "project", expectedHash?: string) {
  if (!NAME_PATTERN.test(name) || name.length > 64) {
    return { ok: false as const, conflict: false, reason: `"${name}" is not an agent name`, currentHash: null };
  }
  const scopeDir = scope === "user" ? getProductUserDir() : join(resolve(root), ".shelra");
  const result = removeDefinition({
    path: join(scopeDir, "agents", `${name}.md`),
    kind: "agent",
    name,
    scopeDir,
    ...(expectedHash ? { expectedHash } : {}),
  });
  invalidateAgents(root);
  return result;
}

export type { SkillRecord };
