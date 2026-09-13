import type { HardwareProfile } from "../hardware/profile";
import type { LocalRuntimeAdapter, LocalRuntimeDiscovery } from "../runtimes/types";

export interface InstallProgress {
  runtime: string;
  modelId: string;
  completed?: number;
  total?: number;
  status?: string;
  speedBytesPerSecond?: number;
  etaSeconds?: number;
}

export interface InstallResult {
  success: boolean;
  runtime?: string;
  reason?: string;
}

function findInstallableRuntime(discovery: LocalRuntimeDiscovery): LocalRuntimeAdapter | undefined {
  return discovery.runtimes.find((runtime) => typeof runtime.installModel === "function");
}

/**
 * Installs through a runtime-owned, resumable API. The manager never writes a
 * model file directly and never marks a partial download as installed.
 */
export async function installLocalModel(
  discovery: LocalRuntimeDiscovery,
  modelId: string,
  hardware: HardwareProfile,
  onProgress?: (progress: InstallProgress) => void,
  signal?: AbortSignal,
  expectedSizeGb?: number,
): Promise<InstallResult> {
  const runtime = findInstallableRuntime(discovery);
  if (!runtime?.installModel)
    return { success: false, reason: "No managed local runtime can install models on this computer." };

  // A runtime can reserve space and resume itself. Refuse early when the
  // machine reports an obviously insufficient disk, retaining a safety margin.
  const requiredStorage = Math.max(4, (expectedSizeGb ?? 0) * 1.25);
  if (hardware.storageAvailableGb !== undefined && hardware.storageAvailableGb < requiredStorage) {
    return { success: false, reason: "There is not enough free storage to install a local coding model." };
  }

  const result = await runtime.installModel({
    modelId,
    signal,
    onProgress: (progress) => onProgress?.({ runtime: runtime.id, modelId, ...progress }),
  });
  return { ...result, runtime: runtime.id };
}
