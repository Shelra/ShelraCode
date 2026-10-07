import type { Plan, ToolResult } from "../types/index";

/** Translate provider output into the host/UI tool evidence. */
export function toToolResult(output: unknown): ToolResult {
  if (output && typeof output === "object" && ("isError" in output || "content" in output)) {
    try {
      const mcp = output as { isError?: unknown; content?: unknown; structuredContent?: unknown };
      const parts = Array.isArray(mcp.content) ? mcp.content : [];
      let text = parts
        .map((part) =>
          part && typeof part === "object" && "text" in part && typeof part.text === "string"
            ? part.text
            : "[non-text MCP content]",
        )
        .join("\n");
      if (mcp.structuredContent !== undefined) text += `\n${JSON.stringify(mcp.structuredContent)}`;
      if (!text) text = JSON.stringify(output);
      return { success: mcp.isError !== true, output: text, ...(mcp.isError === true ? { error: text } : {}) };
    } catch {
      return { success: false, error: "Tool protocol error: MCP result is not serializable." };
    }
  }
  if (output && typeof output === "object" && "success" in output) {
    if (typeof output.success !== "boolean")
      return { success: false, error: "Tool protocol error: success must be a boolean." };
    const r = output as {
      success: boolean;
      output?: string;
      error?: string;
      diff?: ToolResult["diff"];
      plan?: Plan;
      planUpdate?: ToolResult["planUpdate"];
      task?: ToolResult["task"];
      delegation?: ToolResult["delegation"];
      backgroundProcess?: ToolResult["backgroundProcess"];
      media?: ToolResult["media"];
      computer?: ToolResult["computer"];
      lspDiagnostics?: ToolResult["lspDiagnostics"];
      verifyRecipe?: ToolResult["verifyRecipe"];
      refused?: ToolResult["refused"];
      blocker?: ToolResult["blocker"];
    };
    return {
      success: r.success,
      output: r.output,
      error: r.error ?? (r.success ? undefined : r.output),
      diff: r.diff,
      plan: r.plan,
      planUpdate: r.planUpdate,
      task: r.task,
      delegation: r.delegation,
      backgroundProcess: r.backgroundProcess,
      media: r.media,
      computer: r.computer,
      lspDiagnostics: r.lspDiagnostics,
      verifyRecipe: r.verifyRecipe,
      ...(r.refused ? { refused: r.refused } : {}),
      ...(r.blocker ? { blocker: r.blocker } : {}),
    };
  }
  try {
    return { success: true, output: typeof output === "string" ? output : (JSON.stringify(output) ?? String(output)) };
  } catch {
    return { success: false, error: "Tool protocol error: result is not serializable." };
  }
}
