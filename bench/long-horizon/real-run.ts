/**
 * Year-in-a-Box, layer 2 (docs/architecture/20-LONG-HORIZON-AUDIT.md §15): one real-model turn on a copy of a project
 * state that layer 1 produced, through the real `Agent.processMessage` with OpenRouter, in a scratch HOME. The model is
 * strict (no fallback may replace it), `--ablate` reaches the agent as in `shelra bench`, and the key is read from the
 * user's auth file without being printed. The answer is graded by hand against the year's facts; this script records
 * what the model was given, what it did and what it said.
 *
 *   bun run bench/long-horizon/year-in-a-box.ts --stop-after 11 --keep     # make a state; note the scratch root
 *   bun run bench/long-horizon/real-run.ts --state <root> --model nvidia/nemotron-3-ultra-550b-a55b:free \
 *     --label recon-ultra --prompt-file bench/long-horizon/prompts/reconstruct.txt [--ablate bare]
 *
 * Spends free-model quota: run one at a time.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { redactPaths } from "./redact";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name: string) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const state = flag("--state");
const model = flag("--model");
const label = flag("--label") ?? "run";
const promptFile = flag("--prompt-file");
const prompt = promptFile ? readFileSync(promptFile, "utf8").trim() : flag("--prompt");
const ablate = (flag("--ablate") ?? "").split(",").filter(Boolean);
const workspaceName = flag("--workspace") ?? "ledgerly";
/** The simulated date of the turn (the state's own timeline); the real date when absent. */
const date = flag("--date");
if (!state || !model || !prompt) {
  console.error(
    "usage: --state <root> --model <id> --prompt-file <file> [--label x] [--ablate list] [--workspace dir]",
  );
  process.exit(2);
}

// The key is read before HOME moves, and never printed.
const auth = JSON.parse(readFileSync(join(homedir(), ".shelra", "auth.json"), "utf8")) as {
  openrouter?: { apiKey?: string };
};
const apiKey = process.env.OPENROUTER_API_KEY || auth.openrouter?.apiKey;
if (!apiKey) {
  console.error("No OpenRouter key found.");
  process.exit(2);
}
const realHome = homedir();

const root = mkdtempSync(join(tmpdir(), `shelra-lh-real-${label}-`));
const home = join(root, "home");
const workspace = join(root, workspaceName);
cpSync(join(state, "home"), home, { recursive: true });
cpSync(join(state, workspaceName), workspace, { recursive: true });
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.SHELRA_USER_MEMORY_ROOT = home;
process.env.SHELRA_TRACE_DIR = join(root, "traces");
process.env.SHELRA_DIAGNOSTICS_LOG = join(root, "swallowed-errors.jsonl");

if (date) {
  // The project's commits and memory carry the simulated year's dates; the turn runs on that timeline too.
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  const offset = Date.parse(date) - realNow();
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

const { Agent } = await import("../../src/agent/agent");
const { fetchOpenRouterCatalog, OPENROUTER_BASE_URL } = await import("../../src/models/openrouter");
const { primeCatalog } = await import("../../src/models/catalog");
const { createOpenRouterProvider } = await import("../../src/providers/openrouter");

const catalog = await fetchOpenRouterCatalog({ apiKey, baseURL: OPENROUTER_BASE_URL });
primeCatalog(catalog.entries);
const modelId = model.startsWith("openrouter/") ? model : `openrouter/${model}`;
const provider = createOpenRouterProvider(apiKey, {
  modelId,
  entries: catalog.entries,
  baseURL: OPENROUTER_BASE_URL,
  fallbackModels: [],
  requireParameters: true,
  policy: "free",
  strictModel: true,
  maxRetries: 6,
});

const requests: Array<{ system: string; messages: number }> = [];
const tracked = {
  ...provider,
  id: provider.id,
  resolveModelRuntime: provider.resolveModelRuntime.bind(provider),
  generateText: provider.generateText.bind(provider),
  getToolContext: provider.getToolContext.bind(provider),
  stream: (request: Parameters<typeof provider.stream>[0]) => {
    requests.push({ system: request.system, messages: request.messages.length });
    return provider.stream(request);
  },
};

const agent = new Agent(undefined, undefined, modelId, 120, {
  provider: tracked as never,
  cwd: workspace,
  persistSession: true,
  ablate: ablate as never,
});
const started = Date.now();
let text = "";
const tools: Array<{ name: string; args: string; ok?: boolean; output?: string }> = [];
for await (const chunk of agent.processMessage(prompt)) {
  const item = chunk as {
    type: string;
    content?: string;
    toolCalls?: Array<{ function: { name: string; arguments: string } }>;
    toolCall?: { function: { name: string } };
    toolResult?: { success?: boolean; output?: string };
  };
  if (item.type === "content" && item.content) text += item.content;
  if (item.type === "tool_calls") {
    for (const call of item.toolCalls ?? [])
      tools.push({ name: call.function.name, args: call.function.arguments.slice(0, 300) });
  }
  if (item.type === "tool_result" && item.toolCall) {
    const last = [...tools]
      .reverse()
      .find((tool) => tool.name === item.toolCall?.function.name && tool.ok === undefined);
    if (last) {
      last.ok = item.toolResult?.success;
      last.output = (item.toolResult?.output ?? "").slice(0, 400);
    }
  }
}
await agent.cleanup?.();
const verdict =
  /\[(?:Checked by Shelra|Not verified|Not marked complete|Cancelled|Paused|Limited|Error|Stopped)[^\]]*\]/u.exec(text);
const result = {
  label,
  date: date ?? null,
  model: modelId,
  ablate,
  prompt,
  seconds: Math.round((Date.now() - started) / 1000),
  requests: requests.length,
  toolCalls: tools.length,
  verdict: verdict?.[0] ?? null,
  firstSystem: requests[0]?.system ?? "",
  tools,
  text,
};
const out = join(HERE, "results", "real");
mkdirSync(out, { recursive: true });
const redacted = redactPaths(JSON.stringify(result, null, 2), { "<root>": root, "~": realHome });
writeFileSync(join(out, `${label}.json`), `${redacted}\n`);
console.log(
  `${label}: ${result.seconds}s, ${result.requests} model requests, ${result.toolCalls} tool calls, verdict ${result.verdict ?? "(none)"}`,
);
console.log(text.slice(-2500));
if (existsSync(join(root, "swallowed-errors.jsonl")))
  console.log(`swallowed errors logged in ${join(root, "swallowed-errors.jsonl")}`);
process.exit(0);
