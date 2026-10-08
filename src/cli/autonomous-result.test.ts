import { describe, expect, it } from "vitest";
import { createHostTurnResult, type HostTurnResult, type HostTurnStatus } from "../agent/evidence-core";
import { autonomousTurnExitCode, renderAutonomousTurnResult } from "./autonomous-result";

function result(status: HostTurnStatus): HostTurnResult {
  return {
    taskId: "turn-1",
    status,
    verified: status === "verified",
    changedFiles: ["value.json"],
    checks: [{ command: "bun run test", cwd: "/project", source: "agent", passed: true, fresh: true, detail: "ok" }],
    limitations: [],
  };
}

describe("autonomous host result", () => {
  it("exits successfully only for the host's verified outcome", () => {
    expect(autonomousTurnExitCode(result("verified"))).toBe(0);
    for (const status of ["answered", "unverified", "blocked", "limited", "paused", "cancelled"] as const) {
      expect(autonomousTurnExitCode(result(status))).toBe(1);
    }
    expect(autonomousTurnExitCode(null)).toBe(1);
    expect(autonomousTurnExitCode({ status: "answered", verified: true })).toBe(1);
  });

  it("serializes the complete host result separately from model text", () => {
    const host = result("unverified");
    const output = renderAutonomousTurnResult(host, "json", "session-1");
    expect(JSON.parse(output.stdout ?? "")).toEqual({ type: "host_result", sessionID: "session-1", result: host });
    expect(renderAutonomousTurnResult(null, "json").stdout).toBe('{"type":"host_result","result":null}\n');
    expect(renderAutonomousTurnResult(null, "text").stderr).toContain("completion is not verified");
  });

  it("publishes credential-redacted host evidence without changing its status or scope", () => {
    const providerKey = `sk-or-v1-${"A".repeat(32)}`;
    const accountToken = `shr_${"B".repeat(43)}`;
    const host = createHostTurnResult({
      taskId: "turn-with-credentials",
      status: "unverified",
      changedFiles: ["src/value.ts"],
      checks: [
        {
          command: `curl -H 'Authorization: Bearer ${accountToken}' http://localhost:3000/`,
          cwd: "/project/backend",
          source: "agent",
          passed: false,
          fresh: true,
          finished: true,
          detail: `The provider rejected ${providerKey}`,
          unrunnable: `Endpoint refused Authorization: Bearer ${accountToken}`,
        },
      ],
      limitations: [`Provider key rejected: ${providerKey}`],
    });
    const output = renderAutonomousTurnResult(host, "json", "session-1").stdout ?? "";
    expect(output).not.toContain(providerKey);
    expect(output).not.toContain(accountToken);
    const event = JSON.parse(output) as { type: string; result: HostTurnResult };
    expect(event.type).toBe("host_result");
    expect(event.result).toEqual(host);
    expect(event.result.status).toBe("unverified");
    expect(event.result.verified).toBe(false);
    expect(event.result.checks[0]).toEqual(
      expect.objectContaining({ cwd: "/project/backend", source: "agent", passed: false, fresh: true, finished: true }),
    );
  });
});
