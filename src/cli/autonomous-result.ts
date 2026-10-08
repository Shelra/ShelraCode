import type { HostTurnResult } from "../agent/evidence-core";
import type { HeadlessOutputFormat, HeadlessWrites } from "../headless/output";

/** The host's completed turn result is the only authority for autonomous CLI success. */
export function autonomousTurnExitCode(result: Pick<HostTurnResult, "status" | "verified"> | null): 0 | 1 {
  return result?.status === "verified" && result.verified ? 0 : 1;
}

export function renderAutonomousTurnResult(
  result: HostTurnResult | null,
  format: HeadlessOutputFormat,
  sessionId?: string,
): HeadlessWrites {
  if (format === "json") {
    return {
      stdout: `${JSON.stringify({ type: "host_result", ...(sessionId ? { sessionID: sessionId } : {}), result })}\n`,
    };
  }
  return {
    stderr: result
      ? `Autonomous turn: ${result.status}.\n`
      : "Autonomous turn ended without a host result; completion is not verified.\n",
  };
}
