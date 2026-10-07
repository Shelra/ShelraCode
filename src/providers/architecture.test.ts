import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("provider boundary architecture", () => {
  it("keeps xAI provider types out of the Agent and tool registry", () => {
    const agent = readFileSync(new URL("../agent/agent.ts", import.meta.url), "utf8");
    const tools = readFileSync(new URL("../toolset/tools.ts", import.meta.url), "utf8");
    const compaction = readFileSync(new URL("../agent/compaction.ts", import.meta.url), "utf8");
    expect(agent).not.toContain("XaiProvider");
    expect(tools).not.toContain("XaiProvider");
    expect(compaction).not.toContain("XaiProvider");
  });

  it("keeps the xAI SDK import out of the Agent", () => {
    const agent = readFileSync(new URL("../agent/agent.ts", import.meta.url), "utf8");
    expect(agent).not.toContain("@ai-sdk/xai");
  });
});

/**
 * Free mode is enforced where a provider is called, so what matters is that nothing builds a provider or calls a model
 * somewhere the enforcement does not reach. These lists are the review: a new place that builds a provider or calls a
 * model fails here until someone has checked it against Free mode and added it.
 */
function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      if (name !== "node_modules") sourceFiles(path, found);
    } else if (/\.(ts|tsx)$/u.test(name) && !/\.test\./u.test(name)) {
      found.push(path);
    }
  }
  return found;
}

const SRC = fileURLToPath(new URL("..", import.meta.url));
const FILES = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
}));

function filesWith(pattern: RegExp): string[] {
  return FILES.filter((file) => pattern.test(file.text))
    .map((file) => file.path)
    .sort();
}

describe("where providers are built and models are called", () => {
  it("builds each kind of provider adapter only in the files that were reviewed against Free mode", () => {
    expect(filesWith(/createOpenRouterProvider\(/u)).toEqual([
      "agent/agent.ts", // setApiKey: an agent built from a key and a URL; the adapter enforces Free mode itself
      "index.ts", // key fallbacks and the benchmark; the adapter enforces Free mode itself
      "intelligence/openrouter.ts", // the retiring autonomous kernel; the adapter enforces Free mode itself
      "providers/definitions/openrouter.ts",
      "providers/openrouter.ts",
    ]);
    expect(filesWith(/createFreeProvider\(/u)).toEqual([
      "index.ts", // the benchmark's strict provider; Agent.setProvider's guard applies
      "providers/free-providers.ts",
    ]);
    expect(filesWith(/new RoutingProvider\(/u)).toEqual(["routing/runtime.ts"]);
    expect(filesWith(/createOmniRouteAdapter\(/u)).toEqual([
      "providers/definitions/omniroute.ts",
      "providers/omniroute.ts",
    ]);
    expect(filesWith(/createOpenAICompatibleProvider\(/u)).toEqual([
      "agent/agent.ts", // the user's own endpoint (SHELRA_BASE_URL)
      "providers/definitions/free-plan.ts",
      "providers/free-providers.ts",
      "providers/omniroute.ts",
      "providers/openrouter.ts",
      "runtimes/discovery.ts", // a local endpoint
      "runtimes/local-provider.ts",
    ]);
  });

  it("calls a model only from the files that take their provider from the agent", () => {
    // Each of these receives the agent's provider (the routing provider, guarded by Agent.setProvider) as a
    // parameter or reads it from the agent; none builds its own.
    const callers = filesWith(/\.(generateText|generateStructured)\(|provider\.stream\(/u).filter(
      (path) => !path.startsWith("providers/") && !path.startsWith("routing/"),
    );
    expect(callers).toEqual([
      "agent/agent.ts",
      "agent/compaction.ts", // provider parameter, from the agent
      "intelligence/openrouter.ts", // the retiring kernel's OpenRouter adapter, which enforces Free mode itself
      "memory/reflection.ts", // provider option, from the agent
      "startup/orchestrator.ts", // a local model's health probe
      "utils/side-question.ts", // provider parameter, from the agent
    ]);
  });

  it("installs every provider the agent holds through the guard", () => {
    const agent = FILES.find((file) => file.path === "agent/agent.ts")?.text ?? "";
    const assignments = agent.match(/this\.provider = [^\n]+/gu) ?? [];
    for (const assignment of assignments) {
      expect(assignment, assignment).toMatch(
        /guardForFreePolicy|createOpenRouterProvider|createOpenAICompatibleProvider/u,
      );
    }
    expect(agent).toContain("guardForFreePolicy(provider, defaultFreeGuardOptions())");
  });
});
