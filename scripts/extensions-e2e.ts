/**
 * A real-model run of the extension flow: `bun run scripts/extensions-e2e.ts <project dir> "<prompt>" [--mixed]`.
 *
 * It builds the real Agent on the real routing provider (the session setup the terminal UI and headless runs use) and
 * prints every tool call with whether it succeeded, then the final text. Free mode by default: only models Shelra can
 * show are free. It does not go through the CLI's start gate, so it needs no ShelraCode sign-in; it does need a provider
 * key in `~/.shelra/auth.json` of the HOME it runs under. Point HOME/USERPROFILE at a scratch folder holding a copy of
 * that file, so the run's skills, agents, runs and memory land there and not in the person's own home.
 */
import { Agent } from "../src/agent/agent";
import { configureRoutedSession } from "../src/startup/routed-session";

const [project, prompt, ...flags] = process.argv.slice(2);
if (!project || !prompt) {
  console.error('usage: bun run scripts/extensions-e2e.ts <project dir> "<prompt>" [--mixed]');
  process.exit(2);
}
process.chdir(project);
const policy = flags.includes("--mixed") ? "mixed" : "free";
const agent = new Agent(undefined, undefined, undefined, 120, { cwd: project });
const session = await configureRoutedSession(agent, {
  policy,
  explicitModelSelection: false,
  pickedModel: () => undefined,
  saveMode: () => undefined,
});
console.log(`mode: ${policy}; session model: ${session.modelId}`);

const started = Date.now();
const calls: Array<{ tool: string; ok: boolean | null; note: string }> = [];
let text = "";
for await (const chunk of agent.processMessage(prompt)) {
  if (chunk.type === "content") text += chunk.content ?? "";
  if (chunk.type === "tool_calls") {
    for (const call of chunk.toolCalls ?? []) {
      let detail = "";
      try {
        const input = JSON.parse(call.function.arguments) as Record<string, unknown>;
        detail = `${input.kind ?? ""} ${input.action ?? ""} ${input.name ?? input.agent ?? input.path ?? ""}`.trim();
      } catch {
        /* arguments that are not JSON are shown as they are */
      }
      calls.push({ tool: call.function.name, ok: null, note: detail });
    }
  }
  if (chunk.type === "tool_result") {
    const entry = [...calls].reverse().find((call) => call.ok === null && call.tool === chunk.toolCall?.function.name);
    if (entry) {
      entry.ok = chunk.toolResult?.success ?? null;
      if (entry.ok === false) entry.note += ` — ${(chunk.toolResult?.output ?? "").replace(/\s+/g, " ").slice(0, 160)}`;
    }
  }
}
console.log(`\n${calls.length} tool calls in ${Math.round((Date.now() - started) / 1000)}s:`);
for (const call of calls)
  console.log(`  ${call.ok === true ? "✓" : call.ok === false ? "✗" : "?"} ${call.tool} ${call.note}`);
console.log(`\nfinal answer:\n${text.trim().slice(0, 2500)}`);
await agent.cleanup();
process.exit(0);
