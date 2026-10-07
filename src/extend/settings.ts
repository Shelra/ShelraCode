/**
 * Layered extension settings: where each kind of configuration lives and which layer wins. The rules differ by kind
 * on purpose (docs/architecture/24-EXTENSIONS.md, Precedence); "the last file wins" is not one of them.
 *
 *  - Project:  `<root>/.shelra/settings.json`        (committed; shared with the team; never trusted to run code)
 *  - Local:    `<root>/.shelra/settings.local.json`  (the person's own, gitignored; may relax what the project set)
 *  - User:     `~/.shelra/user-settings.json`        (the person's, all projects; the file Shelra already used)
 *
 * Reads are cached by the file's mtime and size, so asking for the settings on every tool call costs a stat, not a
 * parse. A file that cannot be parsed reads as empty and is reported, never thrown.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getProductUserDir } from "../product/identity";
import { recordSwallowedError } from "../utils/diagnostics";
import { findGitRoot } from "../utils/git-root";

export type SettingsLayer = "project" | "local" | "user";

export type SkillOverride = "on" | "explicit" | "off";
export type AgentOverride = "on" | "off";

export interface SystemPromptSettings {
  /** Text appended to the base prompt. Never replaces it. */
  append?: string;
  /** A file whose text is appended (project-relative or absolute); read at each session start. */
  appendFile?: string;
  /** A file that replaces the base persona. The harness core (permissions, tools, verification) is always kept. */
  file?: string;
}

export interface ExtensionSettings {
  skillOverrides?: Record<string, SkillOverride>;
  agentOverrides?: Record<string, AgentOverride>;
  systemPrompt?: SystemPromptSettings;
  /** Instruction files to leave out (names or project-relative paths), like Claude Code's claudeMdExcludes. */
  instructionExcludes?: string[];
  /** The agent the session runs as, by default (a registry name). */
  agent?: string;
  /** Hooks defined in this file (see src/hooks). A project's are inert until the person trusts them. */
  hooks?: Record<string, unknown>;
  /** Turns every hook off. */
  disableAllHooks?: boolean;
}

export interface LayerRead {
  layer: SettingsLayer;
  path: string;
  exists: boolean;
  data: ExtensionSettings;
  error?: string;
}

const cache = new Map<string, { at: number; signature: string; read: LayerRead }>();

export function projectRootFor(cwd: string): string {
  return findGitRoot(cwd) ?? cwd;
}

export function layerPath(layer: SettingsLayer, root: string): string {
  if (layer === "user") return join(getProductUserDir(), "user-settings.json");
  return join(root, ".shelra", layer === "project" ? "settings.json" : "settings.local.json");
}

function signature(path: string): string {
  try {
    const stat = statSync(path);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
}

export function readLayer(layer: SettingsLayer, root: string): LayerRead {
  const path = layerPath(layer, root);
  const now = Date.now();
  const hit = cache.get(path);
  // One stat per read decides whether the cached parse is still the file's: an edit is seen on the next call.
  const sig = signature(path);
  if (hit && hit.signature === sig) {
    hit.at = now;
    return hit.read;
  }
  let read: LayerRead = { layer, path, exists: false, data: {} };
  if (sig !== "missing" && existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      read =
        parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
          ? { layer, path, exists: true, data: parsed as ExtensionSettings }
          : { layer, path, exists: true, data: {}, error: "the file is not a JSON object" };
    } catch (error) {
      recordSwallowedError("extend.settings.read", error);
      read = { layer, path, exists: true, data: {}, error: error instanceof Error ? error.message : String(error) };
    }
  }
  cache.set(path, { at: now, signature: sig, read });
  return read;
}

export function invalidateSettingsCache(): void {
  cache.clear();
}

export function readAllLayers(root: string): Record<SettingsLayer, LayerRead> {
  return { project: readLayer("project", root), local: readLayer("local", root), user: readLayer("user", root) };
}

/**
 * The effective override of a skill or agent. The most restrictive of the project's and the user's wins (a committed
 * file cannot re-enable what the person turned off, and the person's own `off` is not undone by a repository), then
 * the local file, which is the person's own and may relax either.
 */
export function effectiveOverride<T extends string>(
  layers: Record<SettingsLayer, LayerRead>,
  key: "skillOverrides" | "agentOverrides",
  name: string,
  restrictiveOrder: readonly T[],
): { value: T | null; from: SettingsLayer | null } {
  const pick = (layer: SettingsLayer): T | null => {
    const table = layers[layer].data[key] as Record<string, string> | undefined;
    const value = table?.[name];
    return value !== undefined && (restrictiveOrder as readonly string[]).includes(value) ? (value as T) : null;
  };
  const local = pick("local");
  if (local !== null) return { value: local, from: "local" };
  const project = pick("project");
  const user = pick("user");
  if (project === null && user === null) return { value: null, from: null };
  if (project === null) return { value: user, from: "user" };
  if (user === null) return { value: project, from: "project" };
  // restrictiveOrder lists the least restrictive first: the later one is the more restrictive.
  return restrictiveOrder.indexOf(project) >= restrictiveOrder.indexOf(user)
    ? { value: project, from: "project" }
    : { value: user, from: "user" };
}
