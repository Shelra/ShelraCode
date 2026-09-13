import type { HardwareProfile } from "../hardware/profile";
import type { ModelRecommendation } from "../models/recommendation";
import type { ProviderAdapter } from "../providers/types";
import type { RouteDecision } from "../router/local-first";
import type { LocalModelCandidate, LocalRuntimeDiscovery } from "../runtimes/types";

export type StartupState =
  | "booting"
  | "detecting-runtime"
  | "detecting-models"
  | "validating-model"
  | "detecting-hardware"
  | "onboarding"
  | "recommending-model"
  | "downloading-model"
  | "preparing-runtime"
  | "loading-model"
  | "health-check"
  | "ready"
  | "recoverable-error"
  | "fatal-error";

export interface StartupProgress {
  state: StartupState;
  message: string;
  detail?: string;
  model?: string;
  runtime?: string;
  percent?: number;
  completed?: number;
  total?: number;
  speedBytesPerSecond?: number;
  etaSeconds?: number;
  elapsedSeconds?: number;
}

export interface StartupResult {
  state: Extract<StartupState, "ready" | "onboarding" | "recoverable-error" | "fatal-error">;
  hardware: HardwareProfile;
  discovery: LocalRuntimeDiscovery;
  route: RouteDecision;
  model?: LocalModelCandidate;
  provider?: ProviderAdapter;
  error?: string;
  healthChecked: boolean;
  recommendation?: ModelRecommendation;
}

export interface StartupOptions {
  requestedModel?: string;
  signal?: AbortSignal;
  discovery?: LocalRuntimeDiscovery;
  hardware?: HardwareProfile;
  onProgress?: (progress: StartupProgress) => void;
  /** Set false for diagnostics/tests that should stop before generation. */
  healthCheck?: boolean;
  persistSelection?: boolean;
}
