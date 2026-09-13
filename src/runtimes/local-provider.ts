import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import { generateText, jsonSchema, type ModelMessage, Output, stepCountIs, streamText, type ToolSet } from "ai";
import { normalizeModelMessages, repairToolInput } from "../providers/messages";
import { normalizeProviderEvents } from "../providers/stream";
import type {
  ProviderAdapter,
  ProviderModelRuntime,
  ProviderStream,
  ProviderStreamRequest,
  ProviderStructuredRequest,
  ProviderStructuredResult,
  ProviderTextRequest,
  ProviderTextResult,
  ProviderToolContext,
  ProviderUsage,
} from "../providers/types";
import type { ModelInfo } from "../types/index";
import type { LocalModelCandidate } from "./types";

function usage(value: unknown): ProviderUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const raw = record(item.raw);
  const inputTokens = typeof item.inputTokens === "number" ? item.inputTokens : undefined;
  const outputTokens = typeof item.outputTokens === "number" ? item.outputTokens : undefined;
  const totalTokens = typeof item.totalTokens === "number" ? item.totalTokens : undefined;
  const costUsdTicks =
    typeof item.costUsdTicks === "number"
      ? item.costUsdTicks
      : typeof item.cost === "number" && Number.isFinite(item.cost)
        ? Math.round(item.cost * 1_000_000)
        : typeof raw?.cost === "number" && Number.isFinite(raw.cost)
          ? Math.round(raw.cost * 1_000_000)
          : undefined;
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    costUsdTicks === undefined
  )
    return undefined;
  return { inputTokens, outputTokens, totalTokens, costUsdTicks };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function stepNumber(value: unknown): number {
  const entry = record(value);
  return typeof entry?.stepNumber === "number" ? entry.stepNumber : 0;
}

function finishReason(value: unknown): string {
  const entry = record(value);
  return typeof entry?.finishReason === "string" ? entry.finishReason : "other";
}

export class LocalProviderAdapter implements ProviderAdapter {
  readonly id: string;
  readonly defaultModelId: string;
  readonly supportsBatch = false;
  private readonly model: LocalModelCandidate;
  private readonly provider: ReturnType<typeof createOpenAICompatible>;
  private readonly toolContext: ProviderToolContext = {};
  private readonly modelInfo?: ModelInfo;
  private readonly maxRetries: number;

  constructor(
    model: LocalModelCandidate,
    apiKey?: string,
    providerId?: string,
    options: OpenAICompatibleProviderOptions = {},
  ) {
    this.model = model;
    this.id = providerId ?? `local:${model.runtimeId}`;
    this.defaultModelId = model.id;
    this.modelInfo = options.modelInfo;
    this.maxRetries = options.maxRetries ?? 0;
    this.provider = createOpenAICompatible({
      name: this.id,
      baseURL: model.baseURL,
      ...(apiKey ? { apiKey } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      includeUsage: true,
      supportsStructuredOutputs: model.structuredOutput,
      ...(options.transformRequestBody ? { transformRequestBody: options.transformRequestBody } : {}),
    });
  }

  resolveModelRuntime(modelId: string): ProviderModelRuntime {
    return {
      modelId,
      modelInfo: this.modelInfo
        ? { ...this.modelInfo, id: modelId }
        : {
            id: modelId,
            name: this.model.name,
            contextWindow: this.model.contextWindow,
            inputPrice: 0,
            outputPrice: 0,
            reasoning: this.model.reasoning,
            description: `${this.model.runtimeKind} local model${this.model.quantization ? ` (${this.model.quantization})` : ""}`,
            supportsClientTools: this.model.tools,
            supportsMaxOutputTokens: true,
            capabilityConfidence: this.model.capabilityConfidence ?? "unknown",
            runtimeKind: this.model.runtimeKind,
            supportsVision: this.model.supportsVision,
          },
    };
  }

  stream(request: ProviderStreamRequest): ProviderStream {
    const result = streamText({
      model: this.provider(request.modelId),
      system: request.system,
      messages: normalizeModelMessages(request.messages as ModelMessage[]),
      ...(request.tools ? { tools: request.tools as ToolSet } : {}),
      stopWhen: stepCountIs(request.maxSteps),
      maxRetries: this.maxRetries,
      abortSignal: request.signal,
      temperature: request.temperature,
      ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
      // OpenRouter's unified reasoning control is a nested `{ reasoning: { effort } }` body field,
      // not the flat `reasoning_effort` string @ai-sdk/openai-compatible maps its own
      // `reasoningEffort` provider option to (verified against OpenRouter's docs 2026-09-13 — a
      // flat field is not honored). `reasoning` isn't a key openai-compatible's own schema
      // claims, so passing it under our own provider id here rides its raw passthrough straight
      // into the request body, keyed by `this.id` — the same string this adapter registered as
      // `name` with `createOpenAICompatible`, which is what `providerOptionsName` resolves to.
      ...(request.reasoningEffort
        ? { providerOptions: { [this.id]: { reasoning: { effort: request.reasoningEffort } } } }
        : {}),
      prepareStep: ({ messages }) => ({
        messages: normalizeModelMessages(messages),
      }),
      experimental_repairToolCall: async ({ toolCall }) => {
        const repairedInput = repairToolInput(toolCall.toolName, toolCall.input);
        return repairedInput === null ? null : { ...toolCall, input: repairedInput };
      },
      experimental_onStepStart: (event: unknown) => request.onStepStart?.(stepNumber(event)),
      onStepFinish: (event: unknown) => {
        const entry = record(event);
        request.onStepFinish?.({
          stepNumber: stepNumber(event),
          finishReason: finishReason(event),
          usage: usage(entry?.usage) ?? {},
        });
      },
      onFinish: (event: { totalUsage?: unknown }) => request.onFinish?.(usage(event.totalUsage) ?? {}),
    });

    return {
      events: normalizeProviderEvents(result.fullStream as AsyncIterable<unknown>),
      response: Promise.resolve(result.response).then((response) => ({
        messages: response.messages as readonly unknown[],
      })),
    };
  }

  async generateText(request: ProviderTextRequest): Promise<ProviderTextResult> {
    const result = await generateText({
      model: this.provider(request.modelId),
      system: request.system,
      prompt: request.prompt,
      abortSignal: request.signal,
      temperature: request.temperature,
      ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
      maxRetries: this.maxRetries,
    });
    return { text: result.text ?? "", modelId: request.modelId, usage: usage(result.usage) };
  }

  async generateStructured(request: ProviderStructuredRequest): Promise<ProviderStructuredResult> {
    const result = await generateText({
      model: this.provider(request.modelId),
      system: request.system,
      prompt: request.prompt,
      output: Output.object({
        schema: jsonSchema(request.schema),
        ...(request.schemaName ? { name: request.schemaName } : {}),
        ...(request.schemaDescription ? { description: request.schemaDescription } : {}),
      }),
      abortSignal: request.signal,
      temperature: request.temperature,
      ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
      maxRetries: this.maxRetries,
    });
    return {
      data: result.output,
      text: result.text ?? JSON.stringify(result.output),
      modelId: request.modelId,
      usage: usage(result.totalUsage),
    };
  }

  getToolContext(): ProviderToolContext {
    return this.toolContext;
  }
}

export function createLocalProvider(model: LocalModelCandidate): ProviderAdapter {
  return new LocalProviderAdapter(model);
}

export interface OpenAICompatibleProviderOptions {
  fetch?: FetchFunction;
  headers?: Record<string, string>;
  maxRetries?: number;
  modelInfo?: ModelInfo;
  providerId?: string;
  supportsStructuredOutputs?: boolean;
  transformRequestBody?: (body: Record<string, unknown>) => Record<string, unknown>;
}

/** Generic OpenAI-compatible adapter used for explicit remote endpoints. It
 * deliberately has no provider-specific protocol or feature assumptions. */
export function createOpenAICompatibleProvider(
  apiKey: string,
  baseURL: string,
  modelId = "default",
  options: OpenAICompatibleProviderOptions = {},
): ProviderAdapter {
  return new LocalProviderAdapter(
    {
      id: modelId,
      name: modelId,
      runtimeId: "openai-compatible",
      runtimeKind: "openai-compatible",
      baseURL: baseURL.replace(/\/$/, ""),
      contextWindow: options.modelInfo?.contextWindow ?? 128_000,
      tools: true,
      structuredOutput: options.supportsStructuredOutputs ?? true,
      reasoning: options.modelInfo?.reasoning ?? false,
      source: "remote",
      capabilityConfidence: options.modelInfo?.capabilityConfidence ?? "unknown",
      supportsVision: options.modelInfo?.supportsVision ?? false,
    },
    apiKey,
    options.providerId ?? "openai-compatible",
    options,
  );
}
