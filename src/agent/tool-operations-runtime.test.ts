import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/** Bun, shell execution and SQLite are real; the provider is deterministic and never contacts a network. */
const root = mkdtempSync(join(tmpdir(), "shelra-operation-runtime-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const agentUrl = new URL("./agent.ts", import.meta.url).href;
const sessionsUrl = new URL("../storage/sessions.ts", import.meta.url).href;
const dbUrl = new URL("../storage/db.ts", import.meta.url).href;

function fixture(failedEffect = false) {
  const directory = mkdtempSync(join(root, "case-"));
  const work = join(directory, "work");
  const home = join(directory, "home");
  const effects = join(directory, "effects.jsonl");
  mkdirSync(work);
  mkdirSync(home);
  writeFileSync(
    join(work, "effect.ts"),
    `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(effects)}, 'effect\\n'); ${failedEffect ? "throw new Error('failure after effect');" : "console.log('effect accepted');"}\n`,
  );
  const script = join(directory, "run.ts");
  writeFileSync(
    script,
    `
    import { readFileSync } from 'node:fs';
    const { Agent } = await import(${JSON.stringify(agentUrl)});
    const { SessionStore } = await import(${JSON.stringify(sessionsUrl)});
    const { closeDatabase, getDatabase } = await import(${JSON.stringify(dbUrl)});
    const mode = process.argv[2];
    if (mode === 'crash-started') {
      const original = SessionStore.prototype.operationStore;
      SessionStore.prototype.operationStore = function(id) {
        const store = original.call(this, id);
        return { ...store, finish() { throw new Error('injected receipt-write failure after effect'); } };
      };
    }
    const command = 'bun run ./effect.ts';
    let rounds = 0;
    let recovered = false;
    let observedOutput;
    const priorOperationInHistory = [];
    const provider = {
      id: 'offline-operation-fixture', defaultModelId: 'fixture',
      resolveModelRuntime: modelId => ({ modelId, modelInfo: { id: modelId, name: modelId, contextWindow: 200000, inputPrice: 0, outputPrice: 0, reasoning: false, description: 'Offline fixture', supportsClientTools: true, supportsMaxOutputTokens: true, runtimeKind: 'managed-llama' } }),
      getToolContext: () => ({}),
      generateText: async request => ({ text: '{}', modelId: request.modelId }),
      stream(request) {
        const history = JSON.stringify(request.messages);
        recovered ||= history.includes('Execute the operation once.') && history.includes('Previous host operation receipts');
        priorOperationInHistory.push(history.includes(command));
        const current = ++rounds;
        let resolveResponse;
        let rejectResponse;
        const response = new Promise((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
        return {
          response,
          events: (async function* () {
            if (current === 1 || (mode.includes('retry') && current <= 3)) {
              const input = { command };
              const call = { id: mode + '-call-' + (mode.includes('same-id') ? 'same' : current), type: 'function', function: { name: 'bash', arguments: JSON.stringify(input) } };
              request.tools.bash.inputSchema.parse(input);
              yield { type: 'tool-call', toolCall: call };
              const output = await request.tools.bash.execute(input, { toolCallId: call.id, messages: [], abortSignal: request.signal });
              observedOutput = output;
              if (mode.startsWith('crash')) process.exit(91);
              if (mode.includes('retry') && current < 3) {
                if (mode.includes('after-result')) yield { type: 'tool-result', toolCall: call, output };
                const error = new Error('model connection lost after tool execution');
                rejectResponse(error);
                if (mode.includes('iterator')) throw error;
                yield { type: 'error', error };
                return;
              }
              yield { type: 'tool-result', toolCall: call, output };
              const messages = [
                { role: 'assistant', content: [{ type: 'tool-call', toolCallId: call.id, toolName: 'bash', input }] },
                { role: 'tool', content: [{ type: 'tool-result', toolCallId: call.id, toolName: 'bash', output: { type: 'json', value: output } }] },
                { role: 'assistant', content: 'Finished observing the operation.' }
              ];
              request.onStepFinish?.({ stepNumber: 0, finishReason: 'stop', usage: {}, responseMessages: messages });
              yield { type: 'text-delta', text: 'Finished observing the operation.' };
              resolveResponse({ messages });
            } else {
              yield { type: 'text-delta', text: 'Reported the observed result.' };
              resolveResponse({ messages: [{ role: 'assistant', content: 'Reported the observed result.' }] });
            }
          })()
        };
      }
    };
    const agent = new Agent(undefined, undefined, 'fixture', undefined, { cwd: ${JSON.stringify(work)}, provider, session: mode.startsWith('resume') ? 'latest' : undefined, interruptionBackoffMs: [0] });
    try {
      let text = '';
      let childResult;
      if (mode.startsWith('child')) childResult = await agent.runTask({ agent: 'general', description: 'One external fixture operation', prompt: 'Execute the operation once.' });
      else for await (const chunk of agent.processMessage(mode.startsWith('resume') ? 'Continue the previous operation.' : 'Execute the operation once.')) text += chunk.content ?? '';
      const effects = readFileSync(${JSON.stringify(effects)}, 'utf8').split('effect').length - 1;
      const records = getDatabase().prepare('SELECT state, acknowledged, summary FROM tool_operations').all();
      console.log(JSON.stringify({ effects, recovered, text, observedOutput, priorOperationInHistory, childResult, result: agent.getLastTurnResult(), records }));
    } finally { await agent.cleanup(); closeDatabase(); }
  `,
  );
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    SHELRA_USER_MEMORY_ROOT: join(home, "memory"),
    SHELRA_TRACE: "off",
    SHELRA_DIAGNOSTICS_LOG: "off",
    SHELRA_AGENT_RUNS: "off",
    SHELRA_RESEARCH: "off",
  };
  const run = (mode: string) =>
    execFileSync("bun", [script, mode], { cwd: work, env, encoding: "utf8", timeout: 60_000, windowsHide: true });
  return { run, effects };
}

interface Output {
  effects: number;
  recovered: boolean;
  text: string;
  observedOutput: { success: boolean; output: string };
  priorOperationInHistory: boolean[];
  childResult?: { success: boolean };
  result: { status: string; verified: boolean; limitations: string[] };
  records: Array<{ state: string; acknowledged: number; summary: string }>;
}

describe("operation receipts survive a real process restart", () => {
  it.each([
    "retry-success",
    "retry-same-id",
    "retry-after-result",
  ])("applies the external effect once in %s despite two lost steps", (mode) => {
    const { run } = fixture();
    const output = JSON.parse(run(mode).trim()) as Output;
    expect(output.effects).toBe(1);
    expect(output.priorOperationInHistory.slice(0, 3)).toEqual([false, true, true]);
    expect(output.observedOutput).toMatchObject({ success: true });
  }, 120_000);

  it("does not replay an effect that failed after applying and lost the response", () => {
    const { run } = fixture(true);
    const output = JSON.parse(run("retry-failed").trim()) as Output;
    expect(output.effects).toBe(1);
    expect(output.result).toMatchObject({ status: "unverified", verified: false });
    expect(output.observedOutput).toMatchObject({ success: false, output: expect.stringContaining("uncertain") });
    expect(output.text).toContain("[Not verified");
  }, 120_000);

  it.each(["child-retry-success", "child-retry-iterator"])("preserves the child effect once in %s", (mode) => {
    const { run } = fixture();
    const output = JSON.parse(run(mode).trim()) as Output;
    expect(output.effects).toBe(1);
    expect(output.priorOperationInHistory.slice(0, 3)).toEqual([false, true, true]);
    expect(output.childResult).toMatchObject({ success: true });
  }, 120_000);

  it("does not repeat a confirmed operation whose model step never finished", () => {
    const { run, effects } = fixture();
    try {
      run("crash-confirmed");
      throw new Error("Expected the fixture to exit after its effect.");
    } catch (error) {
      expect(error).toMatchObject({ status: 91 });
    }
    expect(readFileSync(effects, "utf8").split("effect")).toHaveLength(2);
    const output = JSON.parse(run("resume-confirmed").trim()) as Output;
    expect(output.effects).toBe(1);
    expect(output.recovered).toBe(true);
    expect(output.records).toContainEqual(expect.objectContaining({ state: "confirmed", acknowledged: 1 }));
    expect(output.observedOutput).toMatchObject({
      success: true,
      output: expect.stringContaining("Original output was not persisted"),
    });
  }, 120_000);

  it("recovers a started receipt as uncertain after the effect and receipt write loss", () => {
    const { run } = fixture();
    try {
      run("crash-started");
      throw new Error("Expected the fixture to exit after its effect.");
    } catch (error) {
      expect(error).toMatchObject({ status: 91 });
    }
    const output = JSON.parse(run("resume-started").trim()) as Output;
    expect(output.effects).toBe(1);
    expect(output.result).toMatchObject({ status: "unverified", verified: false });
    expect(output.result.limitations).toContainEqual(expect.stringContaining("uncertain"));
    expect(output.text).toContain("[Not verified");
    expect(output.records).toContainEqual(expect.objectContaining({ state: "started", acknowledged: 0 }));
  }, 120_000);
});
