import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocked = vi.hoisted(() => ({
  create: vi.fn(),
  transports: [] as Array<{ stderr: PassThrough; close: ReturnType<typeof vi.fn> }>,
}));
vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: mocked.create }));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    stderr = new PassThrough();
    close = vi.fn().mockResolvedValue(undefined);
    constructor() {
      mocked.transports.push(this);
    }
  },
}));

import { buildMcpToolSet } from "./runtime";

afterEach(() => {
  mocked.create.mockReset();
  mocked.transports.splice(0);
});
const server = { id: "audit", label: "Audit fixture", enabled: true, transport: "stdio" as const, command: "fixture" };
describe("MCP connection ownership", () => {
  it("keeps MCP failure status in the SDK model output instead of converting it to successful content", async () => {
    const failure = { isError: true, content: [{ type: "text", text: "Database connection refused" }] };
    mocked.create.mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
      tools: vi.fn().mockResolvedValue({
        query: {
          inputSchema: z.object({}),
          execute: async () => failure,
          // The installed MCP SDK's converter discards isError when returning content.
          toModelOutput: () => ({ type: "content", value: [{ type: "text", text: "Database connection refused" }] }),
        },
      }),
    });
    const bundle = await buildMcpToolSet([server]);
    expect(
      await bundle.tools.mcp_audit__query!.toModelOutput!({ toolCallId: "failed-query", input: {}, output: failure }),
    ).toEqual({
      type: "error-text",
      value: "Database connection refused",
    });
    await bundle.close();
  });
  it("preserves the SDK converter for successful image results", async () => {
    const content = { type: "content", value: [{ type: "image-data", data: "AAAA", mediaType: "image/png" }] };
    const convert = vi.fn(() => content);
    mocked.create.mockResolvedValue({
      close: vi.fn().mockResolvedValue(undefined),
      tools: vi.fn().mockResolvedValue({
        image: { inputSchema: z.object({}), execute: async () => ({}), toModelOutput: convert },
      }),
    });
    const bundle = await buildMcpToolSet([server]);
    const input = { toolCallId: "image", input: {}, output: { isError: false, content: [] } };
    expect(await bundle.tools.mcp_audit__image!.toModelOutput!(input)).toBe(content);
    expect(convert).toHaveBeenCalledWith(input);
    await bundle.close();
  });
  it("closes a client that finishes connecting after the caller timed out", async () => {
    let finish: (client: unknown) => void = () => {};
    mocked.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const bundle = await buildMcpToolSet([server], { timeoutMs: 10 });
    expect(bundle.errors[0]).toContain("timed out");
    const client = { close: vi.fn().mockResolvedValue(undefined), tools: vi.fn().mockResolvedValue({}) };
    finish(client);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(client.close).toHaveBeenCalled();
    await bundle.close();
  });
  it("drains stdio stderr and closes the owned transport when initialization never finishes", async () => {
    mocked.create.mockImplementation(() => new Promise(() => {}));
    const bundle = await buildMcpToolSet([server], { timeoutMs: 10 });
    expect(bundle.errors[0]).toContain("timed out");
    const transport = mocked.transports[0]!;
    expect(transport.stderr.readableFlowing).toBe(true);
    expect(transport.close).toHaveBeenCalled();
    await bundle.close();
  });
});
