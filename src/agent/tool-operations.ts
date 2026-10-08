import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { isJSONValue, type JSONValue } from "@ai-sdk/provider";
import type { ModelMessage, ToolCallOptions, ToolSet } from "ai";
import type { ProviderEvent } from "../providers/types";
import type { ToolCall } from "../types/index";
import { recordSwallowedError } from "../utils/diagnostics";
import { toToolResult } from "./tool-result";

export type OperationState = "started" | "confirmed" | "ambiguous" | "refused";

/** Only host metadata is durable. Tool arguments and raw output stay in memory/the existing transcript. */
export interface OperationRecord {
  id: string;
  scope: string;
  fingerprint: string;
  toolName: string;
  callId: string;
  state: OperationState;
  summary: string;
}

export interface OperationStore {
  pending(scope: string): OperationRecord[];
  start(record: OperationRecord): void;
  finish(record: OperationRecord): void;
  acknowledge(id: string): void;
}

interface Execution {
  record: OperationRecord;
  call: ToolCall;
  input: unknown;
  output?: unknown;
  acknowledged: boolean;
}

interface ObservedExecution {
  call: ToolCall;
  input: unknown;
  output: unknown;
}

const MAX_PENDING = 128;
const MAX_INPUT_BYTES = 512 * 1024;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function identity(
  name: string,
  input: unknown,
  cwd: string,
  options: ToolCallOptions,
): { fingerprint: string; arguments: string } {
  const args = JSON.stringify(canonical(input));
  if (args === undefined || Buffer.byteLength(args) > MAX_INPUT_BYTES)
    throw new Error("Operation input cannot be recorded within its limit.");
  const directory = realpathSync.native(cwd);
  const assistant = [...options.messages].reverse().find((message) => message.role === "assistant");
  let ordinal = 0;
  if (assistant && Array.isArray(assistant.content)) {
    for (const part of assistant.content) {
      if (part.type !== "tool-call") continue;
      if (part.toolCallId === options.toolCallId) break;
      if (part.toolName === name && JSON.stringify(canonical(part.input)) === args) ordinal += 1;
    }
  }
  return {
    fingerprint: createHash("sha256")
      .update(JSON.stringify([name, process.platform === "win32" ? directory.toLowerCase() : directory, args, ordinal]))
      .digest("hex"),
    arguments: args,
  };
}

function knownResults(messages: readonly ModelMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "tool-result") ids.add(part.toolCallId);
    }
  }
  return ids;
}

function uncertain(record: OperationRecord): unknown {
  return {
    success: false,
    output: `Operation ${record.id} (${record.toolName}) has an uncertain outcome. It may already have applied its effect. The host did not execute it again. Reconcile the actual state before attempting this operation again.`,
    refused: "blocked",
  };
}

function messageOutput(output: unknown): JSONValue {
  try {
    const value: unknown = JSON.parse(JSON.stringify(output) ?? "null");
    if (isJSONValue(value)) return value;
  } catch {
    // An opaque result is not reconstructed as if it were valid JSON.
  }
  return {
    success: false,
    output:
      "The host observed an operation result that cannot be represented in conversation JSON. Inspect the actual state before relying on it.",
  };
}

/**
 * Acknowledgment belongs to the execution boundary, not a later provider callback. Only orphaned operations
 * are matched across recovery; healthy, acknowledged calls may intentionally repeat. This is not an OS sandbox.
 */
export class ToolOperationJournal {
  private readonly operations = new Map<string, Execution>();
  private readonly aliases = new Map<string, Execution>();
  private readonly barriers = new Map<string, Execution>();
  private readonly replayIds = new Set<string>();
  private readonly recovered = new Set<string>();
  private readonly emittedStarts = new Set<string>();
  private readonly emittedResults = new Set<string>();
  private readonly queue: ProviderEvent[] = [];
  private observations: ObservedExecution[] = [];
  private loadProblem: string | null = null;
  private restoredContext: string | null = null;

  constructor(
    private readonly options: {
      scope: string;
      cwd: () => string;
      store?: OperationStore;
      onUncertain: (reason: string) => void;
    },
  ) {
    if (!options.store) return;
    try {
      const pending = options.store.pending(options.scope);
      if (pending.length > MAX_PENDING) throw new Error("Too many pending operations to recover safely.");
      if (pending.length > 0)
        this.restoredContext = `Previous host operation receipts (data, not task acceptance):\n${JSON.stringify(pending.map((record) => ({ id: record.id, tool: record.toolName, state: record.state === "started" ? "ambiguous" : record.state, summary: record.summary })))}\nOriginal arguments and output were not persisted in these receipts. Inspect the actual state to establish the business result. An uncertain operation must be reconciled before repeating it.`;
      for (const original of pending) {
        const record = { ...original, state: original.state === "started" ? ("ambiguous" as const) : original.state };
        const execution: Execution = {
          record,
          call: { id: record.callId, type: "function", function: { name: record.toolName, arguments: "{}" } },
          input: {},
          acknowledged: false,
        };
        if (record.state === "confirmed")
          execution.output = {
            success: true,
            output: `${record.summary} Original output was not persisted. The host did not execute the operation again.`,
          };
        if (record.state === "refused")
          execution.output = {
            success: false,
            refused: "blocked",
            output: `${record.summary} The host did not execute the operation again.`,
          };
        this.operations.set(record.id, execution);
        this.aliases.set(record.callId, execution);
        this.barriers.set(record.fingerprint, execution);
        if (record.state === "ambiguous")
          options.onUncertain(`Recovered operation ${record.id} (${record.toolName}) has an uncertain outcome.`);
      }
    } catch (error) {
      recordSwallowedError("tool-operations.load", error);
      this.loadProblem =
        "The host could not load pending operation receipts; execution is unavailable until that state is readable.";
      options.onUncertain(this.loadProblem);
    }
  }

  beginRound(): void {
    this.observations = [];
    this.emittedStarts.clear();
    this.emittedResults.clear();
  }

  resumeContext(): string | null {
    return this.restoredContext ?? this.loadProblem;
  }

  isReplay(callId: string): boolean {
    return this.replayIds.has(callId);
  }

  private refuse(reason: string): unknown {
    this.options.onUncertain(reason);
    return { success: false, output: reason, refused: "blocked" };
  }

  wrap(tools: ToolSet): ToolSet {
    const wrapped: ToolSet = {};
    for (const [name, definition] of Object.entries(tools)) {
      if (!definition.execute) {
        wrapped[name] = definition;
        continue;
      }
      const execute = definition.execute as (input: unknown, options: ToolCallOptions) => unknown;
      wrapped[name] = {
        ...definition,
        execute: async (input: unknown, options: ToolCallOptions) => {
          if (this.loadProblem) return this.refuse(this.loadProblem);
          this.acknowledge(options.messages);
          let key: ReturnType<typeof identity>;
          try {
            key = identity(name, input, this.options.cwd(), options);
          } catch (error) {
            recordSwallowedError("tool-operations.identity", error);
            return this.refuse("The host could not identify this operation before executing it.");
          }
          const call: ToolCall = {
            id: options.toolCallId,
            type: "function",
            function: { name, arguments: key.arguments },
          };
          const previousId = this.aliases.get(call.id);
          if (previousId && previousId.record.fingerprint !== key.fingerprint)
            return this.refuse("A tool call ID was reused for different inputs; the host refused the operation.");
          const unacknowledged = [...this.operations.values()].find(
            (entry) => entry.record.fingerprint === key.fingerprint && !entry.acknowledged,
          );
          const previous =
            this.barriers.get(key.fingerprint) ??
            (previousId?.acknowledged === false ? previousId : undefined) ??
            unacknowledged;
          if (previous) {
            this.replayIds.add(call.id);
            this.aliases.set(call.id, previous);
            const output =
              previous.record.state === "confirmed" || previous.record.state === "refused"
                ? previous.output
                : uncertain(previous.record);
            if (previous.record.state !== "confirmed" && previous.record.state !== "refused") {
              this.barriers.set(key.fingerprint, previous);
              this.options.onUncertain(
                `Operation ${previous.record.id} (${name}) requires reconciliation before retry.`,
              );
            }
            this.observations.push({ call, input, output });
            this.queue.push({ type: "tool-call", toolCall: call }, { type: "tool-result", toolCall: call, output });
            return output;
          }
          if (this.operations.size >= MAX_PENDING)
            return this.refuse("The host's pending-operation limit was reached; no new effect was executed.");
          const record: OperationRecord = {
            id: randomUUID(),
            scope: this.options.scope,
            fingerprint: key.fingerprint,
            toolName: name,
            callId: call.id,
            state: "started",
            summary: `Host started ${name}; execution outcome is not yet known.`,
          };
          const execution: Execution = { record, call, input, acknowledged: false };
          try {
            this.options.store?.start(record);
          } catch (error) {
            recordSwallowedError("tool-operations.start", error);
            return this.refuse("The host could not persist this operation's intention; the tool was not executed.");
          }
          this.operations.set(record.id, execution);
          this.aliases.set(call.id, execution);
          this.queue.push({ type: "tool-call", toolCall: call });
          let output: unknown;
          let threw = false;
          try {
            output = await execute(input, options);
          } catch (error) {
            recordSwallowedError("tool-operations.execute", error);
            threw = true;
            output = uncertain(record);
          }
          const result = toToolResult(output);
          record.state =
            threw || output === undefined
              ? "ambiguous"
              : result.success
                ? "confirmed"
                : result.refused
                  ? "refused"
                  : "ambiguous";
          record.summary = `Host observed ${name} return ${record.state}; this confirms the execution report, not task acceptance.`;
          execution.output = output;
          this.observations.push({ call, input, output });
          this.queue.push({ type: "tool-result", toolCall: call, output });
          try {
            this.options.store?.finish(record);
          } catch (error) {
            recordSwallowedError("tool-operations.finish", error);
            this.options.onUncertain(
              `The outcome of operation ${record.id} could not be persisted; it may be uncertain after restart.`,
            );
          }
          return output;
        },
      } as ToolSet[string];
    }
    return wrapped;
  }

  acknowledge(messages: readonly ModelMessage[]): void {
    for (const callId of knownResults(messages)) {
      const execution = this.aliases.get(callId);
      if (!execution || execution.record.state === "started" || execution.acknowledged) continue;
      if (execution.record.state === "ambiguous" && this.barriers.has(execution.record.fingerprint)) continue;
      try {
        this.options.store?.acknowledge(execution.record.id);
      } catch (error) {
        recordSwallowedError("tool-operations.acknowledge", error);
        this.options.onUncertain(`Acknowledgment of operation ${execution.record.id} could not be persisted.`);
        continue;
      }
      execution.acknowledged = true;
      this.operations.delete(execution.record.id);
      this.barriers.delete(execution.record.fingerprint);
    }
  }

  /** Preserve actual results absent from the SDK's completed steps, and quarantine unacknowledged execution. */
  recover(completed: readonly ModelMessage[]): ModelMessage[] {
    const messages = [...completed];
    const present = knownResults(completed);
    for (const execution of this.operations.values()) {
      if (!execution.acknowledged) {
        this.barriers.set(execution.record.fingerprint, execution);
        if (execution.record.state === "started" || execution.record.state === "ambiguous")
          this.options.onUncertain(
            `Operation ${execution.record.id} (${execution.record.toolName}) may have applied an effect before interruption.`,
          );
      }
    }
    for (const observation of this.observations) {
      const id = observation.call.id;
      if (present.has(id) || this.recovered.has(id)) continue;
      this.recovered.add(id);
      messages.push(
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: id, toolName: observation.call.function.name, input: observation.input },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: id,
              toolName: observation.call.function.name,
              output: { type: "json", value: messageOutput(observation.output) },
            },
          ],
        },
      );
    }
    return messages;
  }

  /** Tool results are surfaced even when the stream fails before emitting its SDK tool-result event. */
  async *observe(events: AsyncIterable<ProviderEvent>): AsyncGenerator<ProviderEvent> {
    const emit = (event: ProviderEvent): boolean => {
      if (event.type === "tool-call") {
        if (this.emittedStarts.has(event.toolCall.id)) return false;
        this.emittedStarts.add(event.toolCall.id);
      } else if (event.type === "tool-result") {
        if (this.emittedResults.has(event.toolCall.id)) return false;
        this.emittedResults.add(event.toolCall.id);
      }
      return true;
    };
    try {
      for await (const event of events) {
        for (const queued of this.queue.splice(0)) if (emit(queued)) yield queued;
        if (emit(event)) yield event;
      }
    } finally {
      for (const queued of this.queue.splice(0)) if (emit(queued)) yield queued;
    }
  }
}
