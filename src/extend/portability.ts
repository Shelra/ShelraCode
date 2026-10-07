/**
 * Moving definitions in and out of a project without knowing where they live: a skill (with its scripts, references and
 * assets) to any folder and back, an agent to a file, and starting points for both. Everything goes through the same
 * validation and versioned writes as every other definition; an import never overwrites and never trusts the source:
 * it must be a real skill, of a sensible size, and it is stamped with where it came from.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { getProductUserDir } from "../product/identity";
import { getAgent, writeAgent } from "./agents";
import { parseFrontmatter, stringOf } from "./frontmatter";
import { getSkill, invalidateSkills, validateSkillDefinition, writeSkill } from "./skills";
import { readTextIfExists, writeDefinition } from "./store";

const MAX_SKILL_FOLDER_BYTES = 5 * 1024 * 1024;
const SKIP = new Set([".git", "node_modules", ".DS_Store"]);

export type PortabilityOutcome = { ok: true; message: string; path: string } | { ok: false; reason: string };

function folderSize(dir: string, limit: number): number {
  let total = 0;
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else total += statSync(full).size;
      if (total > limit) return;
    }
  };
  walk(dir);
  return total;
}

/** A new skill from a name and a description, with a body that says what to fill in. */
export function scaffoldSkill(root: string, name: string, description: string): PortabilityOutcome {
  const outcome = writeSkill(root, {
    name,
    description,
    instructions: `# ${name}\n\n1. Say what to do first.\n2. Say how to check that it worked.\n\nReplace these lines with the real steps. Keep this file short; put detail in references/.\n`,
    provenance: `scaffolded with /skills new at ${new Date().toISOString()}`,
  });
  if (!outcome.ok) return { ok: false, reason: outcome.reason };
  return {
    ok: true,
    path: outcome.path,
    message: `Created ${outcome.path}. Edit its steps (or ask Shelra to); it is already registered and selectable.`,
  };
}

/** A new agent that can only read, from a name and a description; widen it deliberately by editing the file. */
export function scaffoldAgent(root: string, name: string, description: string): PortabilityOutcome {
  const outcome = writeAgent(root, {
    name,
    description,
    instructions: `You are the ${name} agent. ${description}\n\nWork only on what the task says, cite the files and output you actually saw, and say what you could not check.`,
    access: "read-only",
    provenance: `scaffolded with /agents new at ${new Date().toISOString()}`,
  });
  if (!outcome.ok) return { ok: false, reason: outcome.reason };
  return {
    ok: true,
    path: outcome.path,
    message: `Created ${outcome.path} (read-only; add \`access: standard\` and tools to let it change files). Launch it with the task tool, agent "${name}".`,
  };
}

/** Copies a skill's folder to `<target>/<name>`: the open format, readable by any agent that follows it. */
export function exportSkill(root: string, name: string, target: string): PortabilityOutcome {
  const skill = getSkill(root, name);
  if (!skill) return { ok: false, reason: `No skill named "${name}".` };
  const destination = join(resolve(target), skill.name);
  if (existsSync(destination)) return { ok: false, reason: `${destination} already exists; nothing was overwritten.` };
  try {
    mkdirSync(resolve(target), { recursive: true });
    cpSync(skill.dir, destination, { recursive: true, filter: (source) => !SKIP.has(basename(source)) });
    return { ok: true, path: destination, message: `Exported ${skill.name} to ${destination}.` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Copies a skill folder from anywhere into the project (or the user folder), validated and stamped with its source. */
export function importSkillFromFolder(
  root: string,
  source: string,
  scope: "project" | "user" = "project",
): PortabilityOutcome {
  const from = resolve(source);
  const text = readTextIfExists(join(from, "SKILL.md"));
  if (text === null) return { ok: false, reason: `${from} is not a skill: it has no SKILL.md.` };
  const parsed = parseFrontmatter(text);
  const name = (stringOf(parsed.data.name) ?? basename(from)).trim();
  const issues = validateSkillDefinition({
    name,
    description: stringOf(parsed.data.description) ?? "",
    directoryName: basename(from),
    body: parsed.body,
    data: parsed.data,
  });
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0)
    return { ok: false, reason: `${from} is not a valid skill: ${errors.map((issue) => issue.message).join("; ")}` };
  if (folderSize(from, MAX_SKILL_FOLDER_BYTES) > MAX_SKILL_FOLDER_BYTES)
    return { ok: false, reason: `${from} is larger than ${MAX_SKILL_FOLDER_BYTES / 1024 / 1024} MB.` };
  const base = scope === "user" ? getProductUserDir() : join(resolve(root), ".shelra");
  const destination = join(base, "skills", name);
  if (existsSync(destination))
    return { ok: false, reason: `${destination} already exists; nothing was overwritten. Remove or rename it first.` };
  try {
    mkdirSync(join(base, "skills"), { recursive: true });
    cpSync(from, destination, { recursive: true, filter: (path) => !SKIP.has(basename(path)) });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  invalidateSkills(root);
  // Stamp where it came from, through the same versioned write as any other edit.
  const stamped = writeSkill(root, { name, scope, provenance: `imported from ${from} at ${new Date().toISOString()}` });
  if (!stamped.ok) return { ok: false, reason: `copied, but could not register it: ${stamped.reason}` };
  return {
    ok: true,
    path: join(destination, "SKILL.md"),
    message: `Imported ${name} into ${destination}, validated and registered (provenance recorded).`,
  };
}

/** Copies an agent's definition file to a path, for sharing. */
export function exportAgent(root: string, name: string, file: string): PortabilityOutcome {
  const agent = getAgent(root, name);
  if (!agent || agent.origin === "settings")
    return {
      ok: false,
      reason: agent
        ? `${name} lives in user-settings.json (the older format): recreate it with /agents new to export it.`
        : `No agent named "${name}".`,
    };
  const text = readTextIfExists(agent.source);
  if (text === null) return { ok: false, reason: `${agent.source} could not be read.` };
  const target = resolve(file);
  if (existsSync(target)) return { ok: false, reason: `${target} already exists; nothing was overwritten.` };
  mkdirSync(resolve(target, ".."), { recursive: true });
  const written = writeDefinition({
    path: target,
    content: text,
    kind: "agent",
    name: `export-${agent.name}`,
    scopeDir: join(resolve(root), ".shelra"),
  });
  return written.ok
    ? { ok: true, path: target, message: `Exported ${agent.name} to ${target}.` }
    : { ok: false, reason: written.reason };
}
