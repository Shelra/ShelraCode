import readline from "readline";
import { detectHardware, type HardwareProfile, localModelFitScore } from "../hardware/profile";
import { CLI_NAME, PRODUCT_NAME } from "../product/identity";
import { type RouteDecision, selectLocalRoute } from "../router/local-first";
import { discoverLocalRuntimes, disposeLocalRuntimes } from "../runtimes/discovery";
import type { LocalModelCandidate, LocalRuntimeDiscovery } from "../runtimes/types";
import { saveUserSettings } from "../utils/settings";

export interface OnboardingState {
  hardware: HardwareProfile;
  discovery: LocalRuntimeDiscovery;
  route: RouteDecision;
}

export interface OnboardingOptions {
  requestedModel?: string;
  interactive?: boolean;
  discovery?: LocalRuntimeDiscovery;
  hardware?: HardwareProfile;
}

export async function collectOnboardingState(options: OnboardingOptions = {}): Promise<OnboardingState> {
  const hardware = options.hardware ?? (await detectHardware());
  const discovery = options.discovery ?? (await discoverLocalRuntimes(undefined, AbortSignal.timeout(60_000)));
  const route = selectLocalRoute(discovery.models, {
    preferredModel: options.requestedModel,
    requiresTools: true,
    hardware,
  });
  return { hardware, discovery, route };
}

function modelLabel(model: LocalModelCandidate): string {
  const details = [
    model.runtimeId,
    `${Math.round(model.contextWindow / 1_000)}K context`,
    model.quantization,
    model.parameters ? `${Math.round(model.parameters / 1_000_000_000)}B` : undefined,
  ].filter(Boolean);
  return `${model.name} (${details.join(", ")})`;
}

export function renderOnboarding(state: OnboardingState): string {
  const lines = [
    `${PRODUCT_NAME} onboarding`,
    "",
    "Local-first setup inspects the machine and prepares a managed model when the runtime supports installation.",
    "",
    `Hardware: ${state.hardware.cpuModel} · ${state.hardware.cpuCores} CPU cores · ${state.hardware.memoryGb.toFixed(1)} GB RAM`,
    ...(state.hardware.gpu?.length
      ? state.hardware.gpu.map(
          (gpu) =>
            `GPU: ${gpu.vendor} ${gpu.model}${gpu.vramTotalGb ? ` · ${gpu.vramTotalGb.toFixed(1)} GB VRAM` : ""}`,
        )
      : ["GPU: no compatible accelerator detected (CPU mode remains supported)"]),
    ...(state.hardware.storageAvailableGb !== undefined
      ? [`Storage available: ${state.hardware.storageAvailableGb.toFixed(1)} GB`]
      : []),
    "",
    "Local runtimes:",
  ];

  if (state.discovery.runtimes.length === 0) {
    lines.push("  [ ] Shelra local engine is not installed yet.");
  } else {
    for (const runtime of state.discovery.runtimes) {
      const health = state.discovery.health[runtime.id];
      lines.push(`  [${health?.healthy ? "ok" : "!"}] ${runtime.id} · ${runtime.baseURL}`);
    }
  }

  lines.push("", "Discovered local models:");
  if (state.discovery.models.length === 0) {
    lines.push("  [ ] None. Start a local runtime and install/load a model, then rerun `shelra setup`.");
  } else {
    const ranked = [...state.discovery.models].sort(
      (a, b) => localModelFitScore(b, state.hardware) - localModelFitScore(a, state.hardware),
    );
    for (const model of ranked) {
      const selected = state.route.model?.id === model.id;
      lines.push(`  ${selected ? "[>]" : "[ ]"} ${modelLabel(model)}${selected ? " · recommended" : ""}`);
    }
  }

  lines.push("", "Routing:");
  lines.push(
    state.route.model
      ? `  [ok] ${state.route.model.id} via ${state.route.model.runtimeId}`
      : "  [ ] No eligible local model yet.",
  );
  for (const reason of state.route.reasons.slice(0, 4)) lines.push(`  - ${reason}`);

  lines.push(
    "",
    "Next steps:",
    "  1. Return to `shelra` and accept the recommended private model.",
    "  2. Shelra downloads, verifies, and starts its local engine automatically.",
    `  3. Run ${CLI_NAME} setup again, or use ${CLI_NAME} models to inspect discovery.`,
  );
  return lines.join("\n");
}

async function chooseModel(models: LocalModelCandidate[]): Promise<LocalModelCandidate | undefined> {
  if (models.length === 0 || !process.stdin.isTTY || !process.stderr.isTTY) return undefined;
  const ranked = [...models].sort((a, b) => localModelFitScore(b) - localModelFitScore(a));
  const prompt = [
    "",
    "Choose the local model to use by default (Enter keeps the recommendation):",
    ...ranked.map((model, index) => `  ${index + 1}. ${modelLabel(model)}`),
    "Choice: ",
  ].join("\n");
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolve) => rl.question(prompt, resolve));
    const index = Number.parseInt(answer.trim(), 10);
    return Number.isInteger(index) && index >= 1 && index <= ranked.length ? ranked[index - 1] : ranked[0];
  } finally {
    rl.close();
  }
}

export async function runOnboarding(options: OnboardingOptions = {}): Promise<OnboardingState> {
  const state = await collectOnboardingState(options);
  try {
    let selected = state.route.model;
    if (options.interactive && !options.requestedModel)
      selected = (await chooseModel(state.discovery.models)) ?? selected;
    if (selected) saveUserSettings({ defaultModel: selected.id });
    const finalState =
      selected === state.route.model ? state : { ...state, route: { ...state.route, model: selected } };
    console.log(renderOnboarding(finalState));
    if (selected) console.log(`\nSaved default local model: ${selected.id}`);
    return finalState;
  } finally {
    // `setup` is an inspection command. Discovery may have started the
    // app-managed server to validate a model, but the command must not leave
    // that child running after it exits.
    await disposeLocalRuntimes(state.discovery);
  }
}
