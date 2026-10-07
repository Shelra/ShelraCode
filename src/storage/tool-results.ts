import { toToolResult } from "../agent/tool-result";
import type { ToolResult } from "../types/index";

export function extractToolResultFromOutput(output: unknown): ToolResult | null {
  if (!output || typeof output !== "object") return null;

  // Resume must apply the same protocol validation as live host evidence.
  if ("success" in output || "isError" in output || "content" in output) return toToolResult(output);

  if ("type" in output && output.type === "json" && "value" in output) {
    return extractToolResultFromOutput((output as { value: unknown }).value);
  }

  if ("type" in output && output.type === "error-text" && "value" in output) {
    return {
      success: false,
      error: String((output as { value: unknown }).value),
    };
  }

  if ("type" in output && output.type === "text" && "value" in output) {
    return {
      success: true,
      output: String((output as { value: unknown }).value),
    };
  }

  return null;
}

export function getOutputKind(output: unknown): string {
  if (output && typeof output === "object" && "type" in output && typeof output.type === "string") {
    return output.type;
  }
  return "json";
}

export function isOutputSuccess(output: unknown): boolean {
  const interpreted = extractToolResultFromOutput(output);
  if (interpreted) return interpreted.success;
  if (!output || typeof output !== "object") return true;
  if ("type" in output) {
    return !String(output.type).startsWith("error");
  }
  return true;
}
