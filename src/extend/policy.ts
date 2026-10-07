/**
 * The tool policy of one agent run, applied at the single broker (`hardenToolSet` is where every tool executes, hooks
 * included). A policy only ever narrows: it removes tools from what the run was going to get and refuses calls that
 * would break its limits. Nothing in a skill, agent or rule file can add a tool or a permission the session did not
 * already grant, and an edit to a definition never widens a run that is already going (the policy is resolved once,
 * at launch, from a snapshot).
 */
import { isAbsolute, resolve } from "node:path";
import type { ToolSet } from "ai";
import { classifyReadOnlyShell } from "./readonly-shell";

/** Named groups an agent file can list instead of individual tools. */
export const TOOL_GROUPS: Readonly<Record<string, readonly string[]>> = {
  read: ["read_file", "grep", "lsp"],
  write: ["write_file", "edit_file", "delete_file", "restore_file"],
  shell: ["bash", "process_logs", "process_list", "process_stop"],
  web: ["search_web", "open_web"],
  memory: ["memory_list", "memory_read"],
  "memory-write": ["memory_write", "memory_delete"],
  skills: ["skill", "extensions"],
};

/** Everything a read-only agent may have. Anything not listed here is removed from a read-only run. */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "read_file",
  "grep",
  "lsp",
  "bash",
  "process_logs",
  "process_list",
  "search_web",
  "open_web",
  "memory_list",
  "memory_read",
  "skill",
  "extensions",
]);

/** Tools that change files, memory, settings, schedules, money or the desktop. A read-only run never executes these. */
export const MUTATING_TOOLS: ReadonlySet<string> = new Set([
  "write_file",
  "edit_file",
  "delete_file",
  "restore_file",
  "memory_write",
  "memory_delete",
  "extension_write",
  "propose_decision",
  "process_stop",
  "delegate",
  "task",
  "paid_request",
  "telegram_send_file",
]);

const WRITE_FILE_TOOLS: ReadonlySet<string> = new Set(["write_file", "edit_file", "delete_file", "restore_file"]);

export interface AgentToolPolicy {
  /** Who is running: the agent's name or run id, used in refusals and for file leases. */
  owner: string;
  readOnly: boolean;
  /** Allowed tool names after expanding groups; null means "whatever the run inherited". */
  allow: ReadonlySet<string> | null;
  deny: ReadonlySet<string>;
  /** Whether MCP and other external tools (`mcp_*`) are kept. Off for a read-only run. */
  externalTools: boolean;
}

export function expandToolNames(names: readonly string[]): { tools: Set<string>; unknown: string[] } {
  const tools = new Set<string>();
  const unknown: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const group = TOOL_GROUPS[name];
    if (group) for (const tool of group) tools.add(tool);
    else if (/^[a-z][a-z0-9_]*(__[a-z0-9_*-]+)?\*?$/u.test(name)) tools.add(name);
    else unknown.push(name);
  }
  return { tools, unknown };
}

export function makePolicy(input: {
  owner: string;
  readOnly: boolean;
  tools?: readonly string[];
  disallowedTools?: readonly string[];
}): AgentToolPolicy {
  const allow = input.tools && input.tools.length > 0 ? expandToolNames(input.tools).tools : null;
  const deny = expandToolNames(input.disallowedTools ?? []).tools;
  return { owner: input.owner, readOnly: input.readOnly, allow, deny, externalTools: !input.readOnly };
}

function matchesName(pattern: string, name: string): boolean {
  if (pattern.endsWith("*")) return name.startsWith(pattern.slice(0, -1));
  return pattern === name;
}

export function toolAllowed(policy: AgentToolPolicy, name: string): boolean {
  const external = name.startsWith("mcp_");
  if (policy.readOnly) {
    if (!READ_ONLY_TOOLS.has(name)) return false;
  } else if (external && !policy.externalTools) return false;
  for (const pattern of policy.deny) if (matchesName(pattern, name)) return false;
  if (policy.allow) {
    // A policy that lists tools means exactly those; the skill and extension readers stay unless denied.
    if (![...policy.allow].some((pattern) => matchesName(pattern, name)))
      return name === "skill" || name === "extensions";
  }
  return true;
}

/** Removes the tools the policy does not allow, so the model never sees them. */
export function narrowTools(tools: ToolSet, policy: AgentToolPolicy): ToolSet {
  const narrowed: ToolSet = {};
  for (const [name, definition] of Object.entries(tools)) if (toolAllowed(policy, name)) narrowed[name] = definition;
  return narrowed;
}

// --- File leases ------------------------------------------------------------------------------------------------

/**
 * Stops two running agents from silently overwriting the same file: the first agent to write a file holds it until it
 * finishes, and another agent's write to it is refused with the holder's name. The main agent is not a holder (its
 * writes are sequential with its own tool calls) but is refused while a running agent holds the file.
 */
export class WriteCoordinator {
  private readonly leases = new Map<string, { owner: string; since: number }>();

  private key(path: string, cwd: string): string {
    const full = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
    return process.platform === "win32" ? full.toLowerCase() : full;
  }

  claim(path: string, cwd: string, owner: string | null): { ok: true } | { ok: false; holder: string } {
    const key = this.key(path, cwd);
    const lease = this.leases.get(key);
    if (lease && lease.owner !== owner) return { ok: false, holder: lease.owner };
    if (owner !== null && !lease) this.leases.set(key, { owner, since: Date.now() });
    return { ok: true };
  }

  release(owner: string): number {
    let released = 0;
    for (const [key, lease] of this.leases) {
      if (lease.owner === owner) {
        this.leases.delete(key);
        released++;
      }
    }
    return released;
  }

  held(): Array<{ path: string; owner: string }> {
    return [...this.leases].map(([path, lease]) => ({ path, owner: lease.owner }));
  }
}

const CONTROL_FILES = /\.shelra[\\/]+(trust\.json|user-settings\.json|auth\.json)/iu;
const PATH_TOOLS: ReadonlySet<string> = new Set([
  "read_file",
  "write_file",
  "edit_file",
  "delete_file",
  "restore_file",
  "grep",
]);

function referencesControlFile(tool: string, args: Record<string, unknown>): boolean {
  if (tool === "bash") return CONTROL_FILES.test(String(args.command ?? ""));
  if (PATH_TOOLS.has(tool)) return CONTROL_FILES.test(String(args.path ?? ""));
  return false;
}

type ToolExecute = (input: unknown, options: { abortSignal?: AbortSignal }) => unknown;

export interface GuardContext {
  cwd: () => string;
  /** Lease holder for writes; null for the main agent (refused only while another agent holds the file). */
  coordinator?: WriteCoordinator;
  /** The owner whose leases a write takes; null for the main agent. */
  leaseOwner?: string | null;
}

/**
 * Wraps each remaining tool with the checks that must hold at execution time, not just in the schema: a read-only run
 * cannot execute a mutating tool or a shell command that is not provably read-only, and file writes respect leases.
 */
export function guardTools(tools: ToolSet, policy: AgentToolPolicy | null, context: GuardContext): ToolSet {
  const guarded: ToolSet = {};
  for (const [name, definition] of Object.entries(tools)) {
    const execute = (definition as { execute?: ToolExecute }).execute;
    if (typeof execute !== "function") {
      guarded[name] = definition;
      continue;
    }
    guarded[name] = {
      ...definition,
      execute: async (input: unknown, options: { abortSignal?: AbortSignal }) => {
        const args = (input !== null && typeof input === "object" ? input : {}) as Record<string, unknown>;
        // The person's own controls (the hooks they approved, their settings and keys) are changed through /hooks and
        // /config, never by an agent: no tool of any agent reaches them. A guard on the words of a command is a second
        // line, not the only one: the approved hooks also live outside what a file edit in the project can change.
        if (referencesControlFile(name, args)) {
          return {
            success: false,
            output:
              "That path holds your controls (approved hooks, settings, keys), so no agent may read or change it. Ask the person to use /hooks or /config.",
          };
        }
        if (policy?.readOnly) {
          if (MUTATING_TOOLS.has(name) || (!READ_ONLY_TOOLS.has(name) && !name.startsWith("skill"))) {
            return {
              success: false,
              output: `[Read-only agent "${policy.owner}"] ${name} is not available: this agent cannot change anything. Report what you found instead.`,
            };
          }
          if (name === "bash") {
            if (args.background === true) {
              return {
                success: false,
                output: `[Read-only agent "${policy.owner}"] background processes are not allowed.`,
              };
            }
            const verdict = classifyReadOnlyShell(String(args.command ?? ""));
            if (!verdict.allowed) {
              return {
                success: false,
                output: `[Read-only agent "${policy.owner}"] this command was not run: ${verdict.reason}. Use read_file, grep, or a plain listing/search/git-inspection command instead.`,
              };
            }
          }
        }
        if (context.coordinator && WRITE_FILE_TOOLS.has(name) && typeof args.path === "string") {
          const claim = context.coordinator.claim(args.path, context.cwd(), context.leaseOwner ?? null);
          if (!claim.ok) {
            return {
              success: false,
              output: `${args.path} is being changed by agent "${claim.holder}" right now. Do not overwrite it: wait for that agent to finish, or work on a different file.`,
            };
          }
        }
        return execute(input, options);
      },
    } as ToolSet[string];
  }
  return guarded;
}

/** Narrow and guard in one step: the order every agent run uses. */
export function applyPolicy(tools: ToolSet, policy: AgentToolPolicy | null, context: GuardContext): ToolSet {
  return guardTools(policy ? narrowTools(tools, policy) : tools, policy, context);
}
