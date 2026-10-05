import { describe, expect, it, vi } from "vitest";
import { orionMcpConnectTool } from "./orionmcp-connect-tool";

const ENDPOINT = "https://backend.example.test/mcp";
const run = (login: (endpoint: string, announce?: (message: string) => void) => Promise<void>) =>
  // biome-ignore lint/suspicious/noExplicitAny: the AI SDK types execute() with a call-options argument the tool does not use
  (orionMcpConnectTool(ENDPOINT, login).execute as any)({}, { toolCallId: "t", messages: [] });

describe("ORIONMCP connect tool", () => {
  it("opens the OrionBIM login for the exact endpoint, silently, and tells the agent to repeat the request", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    const result = await run(login);
    expect(login).toHaveBeenCalledWith(ENDPOINT, expect.any(Function));
    expect(result.ok).toBe(true);
    expect(result.message).toContain("DETENTE");
  });
  it("reports a denied or expired login without exposing the underlying error", async () => {
    const result = await run(vi.fn().mockRejectedValue(new Error("secret detail: token=abc")));
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret detail");
    expect(result.message).toContain("Permitir");
  });
});
