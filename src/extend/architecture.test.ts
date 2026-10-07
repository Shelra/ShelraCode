import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateHook } from "../hooks/config";

/**
 * Pins what keeps the extension layer independent of any model provider, and inside Free mode by construction: it
 * has no way to call a model. Skill selection is lexical (src/memory/terms.ts), hooks are scripts, and a delegated agent
 * runs through `Agent.runTaskRequest`, whose every model call goes through the guarded provider
 * (src/providers/architecture.test.ts pins that side). If a change here needs a model, it goes through the Agent.
 */
const FOLDERS = [join(__dirname), join(__dirname, "..", "hooks")];

const sources = FOLDERS.flatMap((folder) =>
  readdirSync(folder)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => ({ path: join(folder, file), text: readFileSync(join(folder, file), "utf8") })),
);

describe("the extension layer has no way to call a model or the network", () => {
  it("imports no provider, routing or catalog module", () => {
    for (const { path, text } of sources) {
      expect(text, path).not.toMatch(/from\s+["'][^"']*\/(providers|routing|runtimes)\//u);
      expect(text, path).not.toMatch(/from\s+["'][^"']*\/models\/catalog/u);
    }
  });

  it("does not use a model SDK function or open a network connection", () => {
    for (const { path, text } of sources) {
      expect(text, path).not.toMatch(/\b(streamText|generateText|generateObject|streamObject)\s*\(/u);
      expect(text, path).not.toMatch(/\bfetch\s*\(/u);
      expect(text, path).not.toMatch(/from\s+["'](node:)?(http|https|net|dgram)["']/u);
      expect(text, path).not.toMatch(/\b(openrouter|anthropic|openai|groq)\b/iu);
    }
  });

  it("offers only command hooks: a hook that asks a model is a type Shelra rejects", () => {
    for (const type of ["prompt", "agent", "http", "mcp_tool"]) {
      const result = validateHook({ type, command: "x", prompt: "decide", url: "http://x" });
      expect("error" in result, type).toBe(true);
    }
    expect("hook" in validateHook({ type: "command", command: "echo ok" })).toBe(true);
  });
});
