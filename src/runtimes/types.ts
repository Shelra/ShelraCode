import type { ProviderAdapter } from "../providers/types";

export type LocalRuntimeKind = "managed-llama" | "openai-compatible";

export interface LocalRuntimeHealth {
  healthy: boolean;
  latencyMs?: number;
  reason?: string;
}

export interface LocalModelCandidate {
  id: string;
  name: string;
  runtimeId: string;
  runtimeKind: LocalRuntimeKind;
  baseURL: string;
  contextWindow: number;
  tools: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  loaded?: boolean;
  parameters?: number;
  quantization?: string;
  source: "local" | "remote";
  capabilityConfidence?: "unknown" | "declared" | "probed" | "measured";
  supportsVision?: boolean;
  /** Estimated model memory footprint in GiB when the runtime reports it. */
  memoryRequiredGb?: number;
  /** Optional empirical throughput estimate supplied by a runtime probe. */
  estimatedTokensPerSecond?: number;
  /** Capability class measured by the host, when available. */
  capabilityClass?: "chat" | "coding" | "agent" | "unknown";
}

export interface LocalRuntimeAdapter {
  readonly id: string;
  readonly kind: LocalRuntimeKind;
  readonly baseURL: string;
  detect(signal?: AbortSignal): Promise<boolean>;
  /**
   * Reports runtime readiness. When `modelId` is given the runtime must report
   * on that exact model, so a caller can verify the model it selected is the
   * one actually being served.
   */
  health(signal?: AbortSignal, modelId?: string): Promise<LocalRuntimeHealth>;
  listModels(signal?: AbortSignal): Promise<LocalModelCandidate[]>;
  /** Select and load a specific installed model before creating a provider. */
  prepareModel?(modelId: string, signal?: AbortSignal): Promise<boolean>;
  /** Release any managed child process started during discovery/health checks. */
  dispose?(): Promise<void> | void;
  /** Whether the runtime executable is available for app-managed startup. */
  hasRuntimeBinary?(): Promise<boolean>;
  /** Optional managed install path. A runtime owns resumable artifact setup. */
  installModel?(request: {
    modelId: string;
    signal?: AbortSignal;
    onProgress?: (progress: {
      completed?: number;
      total?: number;
      status?: string;
      speedBytesPerSecond?: number;
      etaSeconds?: number;
    }) => void;
  }): Promise<{ success: boolean; reason?: string }>;
  provider(model: LocalModelCandidate): ProviderAdapter;
}

export interface LocalRuntimeDiscovery {
  runtimes: LocalRuntimeAdapter[];
  health: Record<string, LocalRuntimeHealth>;
  models: LocalModelCandidate[];
}
