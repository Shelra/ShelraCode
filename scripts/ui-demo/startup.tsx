/**
 * Visual-QA entry point for the startup screens, which the production CLI shows before the chat
 * mounts. Pick one with SHELRA_DEMO_STARTUP:
 *
 *   cloud-booting | cloud-error | local-onboarding | local-downloading
 *
 *   SHELRA_DEMO_STARTUP=cloud-booting bun run scripts/ui-demo/startup.tsx
 */
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createElement } from "react";
import type { HardwareProfile } from "../../src/hardware/profile";
import type { ModelRecommendation } from "../../src/models/recommendation";
import type { StartupProgress } from "../../src/startup/types";
import { CloudStartupScreen, StartupScreen } from "../../src/ui/startup";

const variant = process.env.SHELRA_DEMO_STARTUP ?? "cloud-booting";

const hardware: HardwareProfile = {
  platform: "win32",
  arch: "x64",
  cpuModel: "AMD Ryzen 7 5800H",
  cpuCores: 16,
  memoryGb: 32,
  memoryAvailableGb: 21,
  gpu: [{ vendor: "NVIDIA", model: "GeForce GTX 1650", vramTotalGb: 4, accelerationBackends: ["cuda"] }],
};

const recommendation: ModelRecommendation = {
  id: "hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M",
  name: "Qwen2.5 Coder 1.5B",
  estimatedMemoryGb: 1.4,
  reason: "Fits the 4 GB GPU with room for the context window.",
  alternatives: [],
};

const progress: Record<string, StartupProgress> = {
  "cloud-booting": {
    state: "detecting-models",
    message: "Preparing OpenRouter Free mode",
    detail: "Cloud models are primary. No local model download is started.",
  },
  "cloud-error": {
    state: "recoverable-error",
    message: "Remote model setup needs attention",
    detail: "OpenRouter returned no usable models. Try again with network access.",
  },
  "local-onboarding": {
    state: "onboarding",
    message: "Let's prepare a local coding model",
    detail: "No local model is installed yet.",
  },
  "local-downloading": {
    state: "downloading-model",
    message: "Downloading Qwen2.5 Coder 1.5B",
    model: "Qwen2.5 Coder 1.5B · Q4_K_M",
    percent: 62,
    completed: 690_000_000,
    total: 1_100_000_000,
    speedBytesPerSecond: 18_500_000,
    etaSeconds: 22,
    elapsedSeconds: 37,
  },
};

const selected = progress[variant];
if (!selected) {
  console.error(`Unknown startup variant "${variant}". Available: ${Object.keys(progress).join(", ")}`);
  process.exit(2);
}

const renderer = await createCliRenderer({ exitOnCtrlC: true, useMouse: true });
const exit = () => {
  renderer.destroy();
  process.exit(0);
};
const node = variant.startsWith("cloud")
  ? createElement(CloudStartupScreen, { progress: selected, onRetry: () => {}, onExit: exit })
  : createElement(StartupScreen, {
      progress: selected,
      hardware,
      discovery: { runtimes: [], health: {}, models: [] },
      onRetry: () => {},
      onInstall: () => {},
      onExit: exit,
      recommendation,
      canInstall: true,
      canBootstrapRuntime: true,
    });
createRoot(renderer).render(node);
