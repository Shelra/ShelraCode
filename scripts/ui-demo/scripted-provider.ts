import type {
  ProviderAdapter,
  ProviderEvent,
  ProviderModelRuntime,
  ProviderStream,
  ProviderStreamRequest,
  ProviderTextRequest,
  ProviderTextResult,
  ProviderToolContext,
  ProviderUsage,
} from "../../src/providers/types";
import type { ModelInfo, ToolCall } from "../../src/types/index";

/** One part of a model step. Tool calls run the REAL tool from the request's tool set. */
export type DemoPart =
  | { say: string; pace?: number }
  | { think: string; pace?: number }
  | { call: string; input: Record<string, unknown>; ms?: number }
  | { wait: number }
  | { fail: string };

/** A model step is one assistant message plus the tool calls it makes. */
export type DemoStep = DemoPart[];
/** A turn is what the model does between two user messages. */
export type DemoTurn = DemoStep[];

export interface ScriptedOptions {
  turns: DemoTurn[];
  model: ModelInfo;
  /** Multiplies every delay; <1 is faster. Reduced to 0 for tests. */
  speed?: number;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

function chunkText(text: string, size = 14): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/**
 * Deterministic model for visual QA and UI tests. Everything except the model is real: the Agent
 * loop, the tool implementations (files, grep, bash), transcript projection and every renderer.
 */
export class ScriptedProvider implements ProviderAdapter {
  readonly id = "scripted-demo";
  private turnIndex = 0;
  private callSeq = 0;

  constructor(private readonly options: ScriptedOptions) {}

  resolveModelRuntime(modelId: string): ProviderModelRuntime {
    return { modelId, modelInfo: { ...this.options.model, id: modelId } };
  }

  stream(request: ProviderStreamRequest): ProviderStream {
    const turn = this.options.turns[this.turnIndex] ?? [[{ say: "That is everything I have scripted for this demo." }]];
    this.turnIndex += 1;
    const speed = this.options.speed ?? 1;
    const tools = (request.tools ?? {}) as Record<
      string,
      {
        execute?: (
          input: unknown,
          ctx: { toolCallId: string; messages: unknown[]; abortSignal?: AbortSignal },
        ) => unknown;
      }
    >;
    let transcript = "";
    let inputTokens = 0;
    let outputTokens = 0;
    const nextId = () => `call_${String(++this.callSeq).padStart(3, "0")}`;

    const events = (async function* (): AsyncGenerator<ProviderEvent> {
      for (const [index, step] of turn.entries()) {
        const stepNumber = index + 1;
        request.onStepStart?.(stepNumber);
        let stepHadTools = false;
        for (const part of step) {
          if (request.signal?.aborted) return;
          if ("think" in part) {
            for (const piece of chunkText(part.think, 10)) {
              if (request.signal?.aborted) return;
              yield { type: "reasoning-delta", text: piece };
              await sleep((part.pace ?? 22) * speed, request.signal);
            }
          } else if ("say" in part) {
            for (const piece of chunkText(part.say)) {
              if (request.signal?.aborted) return;
              yield { type: "text-delta", text: piece };
              await sleep((part.pace ?? 18) * speed, request.signal);
            }
            transcript += part.say;
            outputTokens += Math.ceil(part.say.length / 4);
          } else if ("wait" in part) {
            await sleep(part.wait * speed, request.signal);
          } else if ("fail" in part) {
            yield { type: "error", error: new Error(part.fail) };
            return;
          } else {
            stepHadTools = true;
            const toolCall: ToolCall = {
              id: nextId(),
              type: "function",
              function: { name: part.call, arguments: JSON.stringify(part.input) },
            };
            yield { type: "tool-call", toolCall };
            await sleep((part.ms ?? 450) * speed, request.signal);
            const tool = tools[part.call];
            let output: unknown;
            try {
              output = tool?.execute
                ? await tool.execute(part.input, { toolCallId: toolCall.id, messages: [], abortSignal: request.signal })
                : { success: false, error: `Tool ${part.call} is unavailable in this mode.` };
            } catch (error) {
              output = { success: false, error: error instanceof Error ? error.message : String(error) };
            }
            yield { type: "tool-result", toolCall, output };
            inputTokens += 900 + Math.ceil(JSON.stringify(part.input).length / 4);
          }
        }
        const usage: ProviderUsage = { inputTokens: inputTokens + 4200, outputTokens };
        request.onStepFinish?.({
          stepNumber,
          finishReason: stepHadTools && index < turn.length - 1 ? "tool-calls" : "stop",
          usage,
        });
      }
      request.onFinish?.({ inputTokens: inputTokens + 4200, outputTokens });
    })();

    return {
      events,
      response: Promise.resolve({
        messages: [{ role: "assistant", content: transcript || "Done." }],
        usage: { inputTokens: inputTokens + 4200, outputTokens },
      }),
    };
  }

  async generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
    const wantsTitle = /title/i.test(request.system);
    return {
      text: wantsTitle ? "Fix token refresh tests" : "Recap unavailable in the demo.",
      modelId: request.modelId,
    };
  }

  getToolContext(): ProviderToolContext {
    return {};
  }
}
