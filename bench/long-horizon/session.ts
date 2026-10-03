/**
 * One scripted session through the real `Agent.processMessage`, in its own process: the unit every long-horizon
 * evaluation is built from (`year-in-a-box.ts`, `memory-evals.ts`). The parent writes a spec, spawns
 * `session-child.ts`, and reads back what each model request carried and what the tools returned.
 *
 * The child moves HOME to `<root>/home`, runs on a simulated clock, answers with the scripted tool calls (run through
 * the real tools), and answers the agent's text calls (reflection, memory commit) with the spec's scripted items.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RealDate = Date;
const realNow = RealDate.now.bind(RealDate);

export interface ScriptStep {
  tool: string;
  input: Record<string, unknown>;
}

export interface SessionSpec {
  /** Scratch root: HOME is `<root>/home`, the project is `<root>/<workspace>`. */
  root: string;
  workspace: string;
  user: string;
  model: string;
  /** Simulated date of the session (ISO). */
  date: string;
  /** Tool calls per model round; rounds past the script answer with text only. */
  rounds: ScriptStep[][];
  /** Final text of the first round. */
  answer: string;
  /** What an ideal model returns to the reflection prompt (the memories array). */
  reflection: Array<Record<string, unknown>>;
  /** What an ideal model returns to the memory-commit prompt (the items array); used once that prompt exists. */
  commit?: Array<Record<string, unknown>>;
  approveDecisions?: boolean;
  /** The process hangs (to be killed) after this many tool results. */
  crashAfterTools?: number;
  ablate?: string[];
  /** `latest` or an id: resume a saved session instead of starting a new one. */
  session?: string;
  /** Where the child writes its capture. */
  captureFile: string;
}

export interface Capture {
  round: number;
  system: string;
  messages: unknown[];
  tools: string[];
}

export interface SessionResult {
  captures: Capture[];
  text: string;
  toolOutputs: Array<{ tool: string; output: unknown }>;
  textCalls: Array<{ kind: string; chars: number }>;
}

/** Every `new Date()` and `Date.now()` in this process reads the session's date, moving forward in real time. */
function installClock(target: number): void {
  const offset = target - realNow();
  class SimulatedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(realNow() + offset);
      else super(...(args as [string]));
    }
    static now(): number {
      return realNow() + offset;
    }
  }
  globalThis.Date = SimulatedDate as unknown as DateConstructor;
}

/** Files the session wrote carry its date, as they would have; otherwise every memory entry would look stale. */
function stampMtimes(dir: string, since: number, at: number): void {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === ".shelra" || name === "node_modules") continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) stampMtimes(full, since, at);
    else if (stat.mtimeMs >= since - 1_000) utimesSync(full, at / 1000, at / 1000);
  }
}

function toolEvent(id: string, step: ScriptStep) {
  return {
    type: "tool-call" as const,
    toolCall: { id, type: "function" as const, function: { name: step.tool, arguments: JSON.stringify(step.input) } },
  };
}

/** Which scripted answer a text call gets, by the prompt that asked. */
function scriptedText(system: string, spec: SessionSpec): { kind: string; text: string } {
  if (system.includes("MEMORY COMMIT")) return { kind: "commit", text: JSON.stringify({ items: spec.commit ?? [] }) };
  if (system.includes("extract durable project knowledge")) {
    return { kind: "reflection", text: JSON.stringify({ memories: spec.reflection }) };
  }
  return { kind: "other", text: "Summary." };
}

/** The child's body: runs the session in this process and exits. */
export async function runSession(spec: SessionSpec): Promise<void> {
  const home = join(spec.root, "home");
  const workspace = join(spec.root, spec.workspace);
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.SHELRA_USER_MEMORY_ROOT = home;
  process.env.SHELRA_RESEARCH = "off";
  process.env.SHELRA_TRACE_DIR = join(spec.root, "traces");
  process.env.SHELRA_DIAGNOSTICS_LOG = join(spec.root, "swallowed-errors.jsonl");
  const target = Date.parse(spec.date);
  installClock(target);
  const realStart = realNow();
  const { Agent } = await import("../../src/agent/agent");

  const result: SessionResult = { captures: [], text: "", toolOutputs: [], textCalls: [] };
  let round = 0;
  let toolResults = 0;
  const provider = {
    id: "scripted",
    defaultModelId: spec.model,
    resolveModelRuntime: (modelId: string) => ({
      modelId,
      modelInfo: {
        id: modelId,
        name: "Scripted ideal model",
        contextWindow: 200_000,
        inputPrice: 0,
        outputPrice: 0,
        reasoning: false,
        description: "Scripted model for long-horizon evaluations",
        supportsClientTools: true,
        supportsMaxOutputTokens: true,
      },
    }),
    stream: (request: { system: string; messages: unknown[]; tools?: Record<string, unknown> }) => {
      result.captures.push({
        round: round + 1,
        system: request.system,
        // A copy: the agent keeps appending to the same array, and the capture is what this request carried.
        messages: JSON.parse(JSON.stringify(request.messages)),
        tools: Object.keys(request.tools ?? {}),
      });
      const steps = spec.rounds[round] ?? [];
      const answer = round === 0 ? spec.answer : "Done.";
      round += 1;
      const tools = (request.tools ?? {}) as Record<
        string,
        { execute?: (input: unknown, options: unknown) => Promise<unknown> }
      >;
      const thisRound = round;
      // The response carries the tool calls and results as the AI SDK's would, so the transcript holds them.
      const messages: unknown[] = [];
      let finish: (value: { messages: unknown[] }) => void = () => {};
      const response = new Promise<{ messages: unknown[] }>((resolve) => {
        finish = resolve;
      });
      return {
        events: (async function* () {
          for (const [index, step] of steps.entries()) {
            if (spec.crashAfterTools !== undefined && toolResults >= spec.crashAfterTools) {
              writeFileSync(`${spec.captureFile}.crash-ready`, String(process.pid));
              await new Promise(() => {});
            }
            const id = `s-r${thisRound}-${index}`;
            yield toolEvent(id, step);
            const output = await tools[step.tool]?.execute?.(step.input, { toolCallId: id, messages: [] });
            result.toolOutputs.push({ tool: step.tool, output });
            toolResults += 1;
            messages.push(
              {
                role: "assistant",
                content: [{ type: "tool-call", toolCallId: id, toolName: step.tool, input: step.input }],
              },
              {
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: id,
                    toolName: step.tool,
                    output: { type: "json", value: output ?? null },
                  },
                ],
              },
            );
            yield { ...toolEvent(id, step), type: "tool-result" as const, output };
          }
          yield { type: "text-delta" as const, text: answer };
          messages.push({ role: "assistant", content: answer });
          finish({ messages });
        })(),
        response,
      };
    },
    generateText: async (request: { system: string; prompt: string; modelId: string }) => {
      const answer = scriptedText(request.system, spec);
      result.textCalls.push({ kind: answer.kind, chars: request.prompt.length });
      return { text: answer.text, modelId: request.modelId };
    },
    getToolContext: () => ({}),
  };

  const agent = new Agent(undefined, undefined, spec.model, undefined, {
    // The scripted provider satisfies the adapter contract structurally.
    provider: provider as never,
    cwd: workspace,
    persistSession: true,
    ...(spec.session ? { session: spec.session } : {}),
    ablate: (spec.ablate ?? []) as never,
  });
  if (spec.approveDecisions) agent.setDecisionApproval(async () => "approve");
  for await (const chunk of agent.processMessage(spec.user)) {
    const item = chunk as { type: string; content?: string };
    if (item.type === "content" && item.content) result.text += item.content;
  }
  writeFileSync(spec.captureFile, JSON.stringify(result, null, 2));
  stampMtimes(workspace, realStart, target);
  process.exit(0);
}

function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => child.on("exit", (code) => resolve(code)));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs one session in a fresh process. A session with `crashAfterTools` is killed once it has saved its live record
 * after that many tool results, as a closed terminal or a crash would end it.
 */
export async function spawnSession(spec: SessionSpec): Promise<{ exit: string; result: SessionResult | null }> {
  const specFile = `${spec.captureFile}.spec.json`;
  writeFileSync(specFile, JSON.stringify(spec));
  const child = spawn(process.execPath, ["run", join(HERE, "session-child.ts"), specFile], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (data) => {
    stderr += String(data);
  });
  let exit: string;
  if (spec.crashAfterTools !== undefined) {
    const marker = `${spec.captureFile}.crash-ready`;
    const liveDir = join(spec.root, spec.workspace, ".shelra", "memory", "live");
    const deadline = realNow() + 120_000;
    while (realNow() < deadline && !(existsSync(marker) && existsSync(liveDir) && readdirSync(liveDir).length > 0)) {
      await sleep(100);
    }
    await sleep(300);
    child.kill("SIGKILL");
    await waitForExit(child);
    exit = existsSync(marker) ? "killed mid-turn after its first tool result" : "killed (marker missing)";
  } else {
    const code = await waitForExit(child);
    exit = code === 0 ? "ok" : `exit ${code}: ${stderr.slice(-400)}`;
  }
  const result = existsSync(spec.captureFile)
    ? (JSON.parse(readFileSync(spec.captureFile, "utf8")) as SessionResult)
    : null;
  return { exit, result };
}

/** The text of a model request: system prompt, then every message's text, tool inputs and tool results. */
export function requestText(capture: Capture | undefined): string {
  if (!capture) return "";
  const parts: string[] = [capture.system];
  for (const message of capture.messages as Array<{ role: string; content: unknown }>) {
    if (typeof message.content === "string") {
      parts.push(`[${message.role}] ${message.content}`);
      continue;
    }
    for (const part of (message.content ?? []) as Array<Record<string, unknown>>) {
      if (typeof part.text === "string") parts.push(`[${message.role}] ${part.text}`);
      else parts.push(`[${message.role}:${String(part.type)}] ${JSON.stringify(part.input ?? part.output ?? "")}`);
    }
  }
  return parts.join("\n");
}
