import os from "node:os";
import path from "node:path";
import { loadHooksConfig } from "../hooks/index";
import { listInstructionFiles } from "../utils/instructions";
import { loadMcpServers, loadValidSubAgents } from "../utils/settings";
import { discoverSkills } from "../utils/skills";

/** What a session has in its context besides the conversation: the answer to `/context`'s "what is loaded". */
export interface LoadedContext {
  /** Instruction files (AGENTS.md and overrides), shortened for display. */
  rules: string[];
  skills: string[];
  hooks: { commands: number; events: string[] };
  agents: { builtIn: string[]; custom: string[] };
  mcp: string[];
}

export const BUILT_IN_AGENTS = ["explore", "plan", "general", "vision", "verify", "computer"] as const;

function shorten(file: string, cwd: string): string {
  const relative = path.relative(cwd, file);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative.replace(/\\/g, "/");
  const home = os.homedir();
  return file.startsWith(home) ? `~${file.slice(home.length).replace(/\\/g, "/")}` : file.replace(/\\/g, "/");
}

function attempt<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/** Reads the configuration a session loads. Every source is optional, so a broken one costs only its own row. */
export function gatherLoadedContext(cwd: string): LoadedContext {
  const hooksConfig = attempt(() => loadHooksConfig(), {});
  const events = Object.entries(hooksConfig)
    .filter(([, matchers]) => (matchers ?? []).some((matcher) => matcher.hooks.length > 0))
    .map(([event]) => event);
  const commands = Object.values(hooksConfig).reduce(
    (sum, matchers) => sum + (matchers ?? []).reduce((inner, matcher) => inner + matcher.hooks.length, 0),
    0,
  );

  return {
    rules: attempt(() => listInstructionFiles(cwd), []).map((file) => shorten(file, cwd)),
    skills: attempt(() => discoverSkills(cwd), []).map((skill) => skill.name),
    hooks: { commands, events },
    agents: {
      builtIn: [...BUILT_IN_AGENTS],
      custom: attempt(() => loadValidSubAgents(), []).map((agent) => agent.name),
    },
    mcp: attempt(() => loadMcpServers(), [])
      .filter((server) => server.enabled)
      .map((server) => server.label),
  };
}

export interface LoadedRow {
  label: string;
  text: string;
}

function list(names: readonly string[], max: number): string {
  return names.length <= max ? names.join(" · ") : `${names.slice(0, max).join(" · ")} +${names.length - max}`;
}

/**
 * One row per kind of thing that is actually loaded: a session with no hooks has no hooks row, the
 * same rule the log follows. Memory comes from the memory store, not from configuration.
 */
export function loadedContextRows(
  loaded: LoadedContext | null,
  memory: { saved: number; recalled: number },
): LoadedRow[] {
  const rows: LoadedRow[] = [];
  if (loaded) {
    if (loaded.rules.length > 0) rows.push({ label: "Rules", text: list(loaded.rules, 3) });
    if (loaded.skills.length > 0) rows.push({ label: "Skills", text: list(loaded.skills, 5) });
    if (loaded.hooks.commands > 0) {
      const hooks = `${loaded.hooks.commands} ${loaded.hooks.commands === 1 ? "hook" : "hooks"}`;
      rows.push({ label: "Hooks", text: `${hooks} · ${list(loaded.hooks.events, 4)}` });
    }
    const custom = loaded.agents.custom.length > 0 ? ` + ${list(loaded.agents.custom, 3)}` : "";
    rows.push({ label: "Agents", text: `${loaded.agents.builtIn.length} built in${custom}` });
    if (loaded.mcp.length > 0) {
      rows.push({
        label: "MCP",
        text: `${loaded.mcp.length} ${loaded.mcp.length === 1 ? "server" : "servers"} · ${list(loaded.mcp, 4)}`,
      });
    }
  }
  if (memory.saved > 0 || memory.recalled > 0) {
    const recalled = memory.recalled > 0 ? ` · ${memory.recalled} recalled this turn` : "";
    rows.push({ label: "Memory", text: `${memory.saved} saved${recalled}` });
  }
  return rows;
}
