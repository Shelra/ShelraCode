import type { HardwareProfile } from "../hardware/profile";
import { HUGGING_FACE_MODELS } from "./huggingface";

export interface ModelRecommendation {
  id: string;
  name: string;
  estimatedMemoryGb: number;
  reason: string;
  alternatives: Array<{ id: string; name: string; label: "faster" | "quality" }>;
}

/**
 * Bootstrap choices used when no verified local artifact exists. The IDs are
 * stable Hugging Face identities; the managed llama.cpp runtime downloads and
 * serves the selected GGUF without an external model application.
 */
export function recommendBootstrapModel(
  hardware: HardwareProfile,
  env: Record<string, string | undefined> = process.env,
): ModelRecommendation {
  const override = env.SHELRA_ONBOARDING_MODEL?.trim();
  if (override) {
    const selected = HUGGING_FACE_MODELS.find((model) => model.id === override);
    return {
      id: override,
      name: override,
      estimatedMemoryGb: selected?.estimatedMemoryGb ?? 2.2,
      reason: "Selected from your ShelraCode onboarding preference.",
      alternatives: [],
    };
  }

  const gpuMemory = (hardware.gpu ?? []).reduce((sum, gpu) => sum + (gpu.vramAvailableGb ?? gpu.vramTotalGb ?? 0), 0);
  if (gpuMemory === 0) {
    const cpuModel = HUGGING_FACE_MODELS[0];
    return {
      id: cpuModel.id,
      name: cpuModel.displayName,
      estimatedMemoryGb: cpuModel.estimatedMemoryGb,
      reason: "A compact coding model selected for a responsive private session on this computer.",
      alternatives: [{ id: HUGGING_FACE_MODELS[1].id, name: HUGGING_FACE_MODELS[1].displayName, label: "quality" }],
    };
  }
  const usableMemory = gpuMemory > 0 ? gpuMemory * 0.72 : (hardware.memoryAvailableGb ?? hardware.memoryGb) * 0.45;
  if (usableMemory < 5) {
    return {
      id: HUGGING_FACE_MODELS[0].id,
      name: HUGGING_FACE_MODELS[0].displayName,
      estimatedMemoryGb: HUGGING_FACE_MODELS[0].estimatedMemoryGb,
      reason: "The best balance of coding quality, GPU headroom, and stable local speed.",
      alternatives: [{ id: HUGGING_FACE_MODELS[1].id, name: HUGGING_FACE_MODELS[1].displayName, label: "quality" }],
    };
  }
  if (usableMemory < 10) {
    return {
      id: HUGGING_FACE_MODELS[1].id,
      name: HUGGING_FACE_MODELS[1].displayName,
      estimatedMemoryGb: HUGGING_FACE_MODELS[1].estimatedMemoryGb,
      reason: "A higher-quality coding model that fits with practical GPU/RAM headroom.",
      alternatives: [{ id: HUGGING_FACE_MODELS[0].id, name: HUGGING_FACE_MODELS[0].displayName, label: "faster" }],
    };
  }
  return {
    id: HUGGING_FACE_MODELS[1].id,
    name: HUGGING_FACE_MODELS[1].displayName,
    estimatedMemoryGb: HUGGING_FACE_MODELS[1].estimatedMemoryGb,
    reason: "The strongest reviewed coding option that keeps practical headroom on this computer.",
    alternatives: [{ id: HUGGING_FACE_MODELS[0].id, name: HUGGING_FACE_MODELS[0].displayName, label: "faster" }],
  };
}
