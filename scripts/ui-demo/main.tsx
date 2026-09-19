/**
 * Visual-QA entry point: mounts the REAL <App> on a REAL Agent whose only fake part is the model.
 * Tools run for real against a throw-away fixture project, so transcripts, diffs, test output and
 * every renderer are the production ones. Run inside a terminal (or the capture harness):
 *
 *   SHELRA_DEMO_SCENARIO=fix-auth bun run scripts/ui-demo/main.tsx
 *
 * Point USERPROFILE/HOME at a scratch directory to keep settings and memory out of your profile.
 */
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createElement } from "react";
import packageJson from "../../package.json" with { type: "json" };
import { Agent } from "../../src/agent/agent";
import type { ModelInfo } from "../../src/types/index";
import { App } from "../../src/ui/app";
import { getCurrentSandboxMode, getCurrentSandboxSettings } from "../../src/utils/settings";
import { createFixture, seedKnowledge } from "./fixture";
import { SCENARIOS } from "./scenarios";
import { ScriptedProvider } from "./scripted-provider";

const scenarioName = process.env.SHELRA_DEMO_SCENARIO ?? "fix-auth";
const turns = SCENARIOS[scenarioName];
if (!turns) {
  console.error(`Unknown scenario "${scenarioName}". Available: ${Object.keys(SCENARIOS).join(", ")}`);
  process.exit(2);
}

const dir = process.env.SHELRA_DEMO_DIR ?? join(tmpdir(), "shelra-ui-demo");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
createFixture(dir);
process.chdir(dir);
if (process.env.SHELRA_DEMO_SEED !== "0") seedKnowledge(dir);

const MODEL: ModelInfo = {
  id: "qwen/qwen3-coder:free",
  name: "Qwen3 Coder",
  contextWindow: 262_144,
  inputPrice: 0,
  outputPrice: 0,
  pricingKnown: true,
  reasoning: false,
  description: "Free cloud model routed through OpenRouter",
  supportsClientTools: true,
  category: "cloud",
  provider: "OpenRouter",
};
const OTHER_MODELS: ModelInfo[] = [
  {
    ...MODEL,
    id: "openrouter/free",
    name: "Free Models Router",
    contextWindow: 200_000,
    description: "Routes to an available free model",
  },
  {
    ...MODEL,
    id: "deepseek/deepseek-chat-v3.1:free",
    name: "DeepSeek V3.1",
    contextWindow: 163_840,
    description: "General coding model",
  },
  {
    ...MODEL,
    id: "openai/gpt-oss-120b:free",
    name: "gpt-oss-120b",
    contextWindow: 131_072,
    reasoning: true,
    description: "Open-weight reasoning model",
  },
];

const provider = new ScriptedProvider({ turns, model: MODEL, speed: Number(process.env.SHELRA_DEMO_SPEED ?? 1) });
const agent = new Agent(undefined, undefined, MODEL.id, 24, {
  provider,
  persistSession: false,
  cwd: dir,
  sandboxMode: "off",
});

// Mirrors the renderer options of the production entry point (src/index.ts).
const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  useMouse: true,
  useKittyKeyboard: { disambiguate: true, alternateKeys: true },
});

const onExit = () => {
  void agent.cleanup().finally(() => {
    renderer.destroy();
    process.exit(0);
  });
};

createRoot(renderer).render(
  createElement(App, {
    agent,
    startupConfig: {
      apiKey: "demo",
      baseURL: "https://openrouter.ai/api/v1",
      model: MODEL.id,
      localModels: [MODEL, ...OTHER_MODELS],
      onSelectLocalModel: async () => ({ success: true }),
      maxToolRounds: 24,
      sandboxMode: getCurrentSandboxMode(),
      sandboxSettings: getCurrentSandboxSettings(),
      version: packageJson.version,
    },
    onExit,
  }),
);
