import type { ToolSet } from "ai";

/**
 * Harness subsystems a benchmark can switch off, to measure what each one adds (audit doc 15, §15.3
 * rule 4: a capability whose ablation changes nothing has not been shown to exist).
 *
 * - memory: no memory tools, retrieval, standing-rule capture or reflection
 * - gate: no completion gate (and so no task contract or requirement audit either)
 * - contract: no task contract; the gate only asks that some check ran after the last change
 * - ledger: no decisions in the prompt, no propose_decision tool and no enforcement of decisions
 * - audit: no requirement audit
 * - plan: no plan tools or planning step in the prompt
 * - skills: no skill catalog in the prompt
 * - context: no compiled context appendix
 * - subagents: no task/delegate tools, delegation guidance or custom sub-agents
 * - web: no web research tools or guidance (and so no research before the work)
 * - research: no web search by the host before the work (src/research/pre-task.ts); the tools stay
 * - smoke: the host does not open the app a turn changed in a headless browser (src/agent/runtime-smoke.ts)
 * - bare: all of the above, a prompt of environment facts only, and six basic tools
 */
export const ABLATIONS = [
  "memory",
  "gate",
  "contract",
  "ledger",
  "audit",
  "plan",
  "skills",
  "context",
  "subagents",
  "web",
  "research",
  "smoke",
  "bare",
] as const;

export type Ablation = (typeof ABLATIONS)[number];

export class Ablations {
  private readonly names: ReadonlySet<Ablation>;

  constructor(list: readonly Ablation[] = []) {
    this.names = new Set(list);
  }

  /** Whether a subsystem is off; `bare` turns every one off. */
  has(name: Exclude<Ablation, "bare">): boolean {
    return this.names.has(name) || this.names.has("bare");
  }

  get bare(): boolean {
    return this.names.has("bare");
  }

  /** The switches as given, in a stable order, for the run record. */
  get list(): Ablation[] {
    return ABLATIONS.filter((name) => this.names.has(name));
  }
}

export const NO_ABLATIONS = new Ablations();

/** Reads a comma-separated list such as `memory,gate`, and names what it did not recognize. */
export function parseAblations(value: string): { ablations: Ablation[]; unknown: string[] } {
  const ablations: Ablation[] = [];
  const unknown: string[] = [];
  for (const raw of value.split(",")) {
    const name = raw.trim().toLowerCase();
    if (!name || name === "none") continue;
    if ((ABLATIONS as readonly string[]).includes(name)) {
      if (!ablations.includes(name as Ablation)) ablations.push(name as Ablation);
    } else unknown.push(raw.trim());
  }
  return { ablations, unknown };
}

const TOOLS_BY_SUBSYSTEM: Partial<Record<Exclude<Ablation, "bare">, readonly string[]>> = {
  memory: ["memory_list", "memory_read", "memory_write", "memory_delete"],
  ledger: ["propose_decision"],
  plan: ["generate_plan", "update_plan_step"],
  subagents: ["task", "delegate", "delegation_read", "delegation_list"],
  web: ["search_web", "open_web"],
};

const BARE_TOOLS: ReadonlySet<string> = new Set([
  "bash",
  "read_file",
  "write_file",
  "edit_file",
  "delete_file",
  "grep",
]);

/** The tool set without the tools of the switched-off subsystems. */
export function ablateTools(tools: ToolSet, ablations: Ablations): ToolSet {
  const dropped = new Set<string>();
  for (const [subsystem, names] of Object.entries(TOOLS_BY_SUBSYSTEM)) {
    if (ablations.has(subsystem as Exclude<Ablation, "bare">)) for (const name of names) dropped.add(name);
  }
  if (dropped.size === 0 && !ablations.bare) return tools;
  const kept: ToolSet = {};
  for (const [name, definition] of Object.entries(tools)) {
    if (dropped.has(name) || (ablations.bare && !BARE_TOOLS.has(name))) continue;
    kept[name] = definition;
  }
  return kept;
}
