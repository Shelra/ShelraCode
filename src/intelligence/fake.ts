import type {
  IntelligenceAvailability,
  IntelligenceProvider,
  IntelligenceRequest,
  IntelligenceResult,
  IntelligenceRole,
  IntelligenceUsage,
} from "./types";

/**
 * Scripted intelligence for tests and offline runs.
 *
 * The rest of the autonomy runtime is deterministic, so its tests should be too: this provider
 * answers from a per-role queue instead of spending money or touching the network. An exhausted
 * queue fails loudly rather than inventing an answer, which keeps missing-script bugs visible.
 */

export interface FakeIntelligenceReply<T = unknown> {
  /** Structured answer handed back as `IntelligenceResult.data`. */
  data?: T;
  text?: string;
  /** Defaults to true. Set false to script a model failure the runtime must repair. */
  ok?: boolean;
  error?: string;
  usage?: Partial<IntelligenceUsage>;
}

export type FakeIntelligenceScript = Partial<Record<IntelligenceRole, FakeIntelligenceReply[]>>;

function usageFrom(overrides: Partial<IntelligenceUsage> | undefined): IntelligenceUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    costAvailable: true,
    durationMs: 0,
    turns: 1,
    model: "fake",
    ...overrides,
  };
}

export class FakeIntelligenceProvider implements IntelligenceProvider {
  readonly id = "fake";

  /** Every request seen, in order. Assert against this instead of spying on a transport. */
  readonly calls: IntelligenceRequest[] = [];

  private readonly queues = new Map<IntelligenceRole, FakeIntelligenceReply[]>();
  private readonly anyQueue: FakeIntelligenceReply[] = [];
  private availability: IntelligenceAvailability = {
    available: true,
    detail: "Scripted intelligence provider (no network, no cost).",
  };

  constructor(script: FakeIntelligenceScript = {}) {
    for (const [role, replies] of Object.entries(script)) {
      if (replies?.length) this.queues.set(role as IntelligenceRole, [...replies]);
    }
  }

  /** Appends replies consumed only by the given role. */
  queue<T = unknown>(role: IntelligenceRole, ...replies: FakeIntelligenceReply<T>[]): this {
    const existing = this.queues.get(role) ?? [];
    existing.push(...(replies as FakeIntelligenceReply[]));
    this.queues.set(role, existing);
    return this;
  }

  /** Appends replies used by any role whose own queue is empty. */
  queueAny<T = unknown>(...replies: FakeIntelligenceReply<T>[]): this {
    this.anyQueue.push(...(replies as FakeIntelligenceReply[]));
    return this;
  }

  setAvailability(availability: IntelligenceAvailability): this {
    this.availability = availability;
    return this;
  }

  /** Replies still waiting to be consumed, for end-of-test assertions. */
  get pending(): number {
    let total = this.anyQueue.length;
    for (const queue of this.queues.values()) total += queue.length;
    return total;
  }

  async checkAvailability(): Promise<IntelligenceAvailability> {
    return this.availability;
  }

  async complete<T = unknown>(request: IntelligenceRequest): Promise<IntelligenceResult<T>> {
    this.calls.push(request);
    const reply = this.queues.get(request.role)?.shift() ?? this.anyQueue.shift();
    if (!reply) {
      return {
        ok: false,
        text: "",
        usage: usageFrom({ costAvailable: true }),
        error: `FakeIntelligenceProvider has no scripted reply for role "${request.role}".`,
      };
    }

    const usage = usageFrom(reply.usage);
    if (reply.ok === false) {
      return { ok: false, text: reply.text ?? "", usage, error: reply.error ?? "Scripted intelligence failure." };
    }
    return {
      ok: true,
      ...(reply.data === undefined ? {} : { data: reply.data as T }),
      text: reply.text ?? (reply.data === undefined ? "" : JSON.stringify(reply.data)),
      usage,
    };
  }
}
