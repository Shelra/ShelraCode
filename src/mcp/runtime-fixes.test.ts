import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import { buildMcpToolSet, capMcpResult, describeStderr, modelToolName } from "./runtime";

/*
 * Fixes from the 2026-10-07 review of the MCP layer: what a failing server said was dropped, a server started through
 * npx was given no time to download itself, tool names could be rejected by a provider, and a result had no size limit.
 */
afterEach(() => {
  mocked.create.mockReset();
  mocked.transports.splice(0);
});
const server = { id: "audit", label: "Audit fixture", enabled: true, transport: "stdio" as const, command: "fixture" };
const ESC = String.fromCharCode(27);

describe("what a failing MCP server said", () => {
  it("is in the error, so the real cause is not lost", async () => {
    mocked.create.mockImplementation(() => {
      // The server writes why it cannot start, then the connection fails.
      mocked.transports[0]?.stderr.write(`${ESC}[31mError:${ESC}[0m Chromium distribution 'chrome' is not found\n`);
      return Promise.reject(new Error("Connection closed"));
    });
    const bundle = await buildMcpToolSet([server]);
    expect(bundle.errors[0]).toContain("Connection closed");
    expect(bundle.errors[0]).toContain("the server said: Error: Chromium distribution 'chrome' is not found");
    expect(bundle.errors[0]).not.toContain(ESC);
    await bundle.close();
  });

  it("is described on one short line", () => {
    expect(describeStderr("  line one\n\tline two  ")).toBe("line one line two");
    expect(describeStderr("x".repeat(500)).length).toBe(300);
  });
});

describe("the time a server gets to start", () => {
  it("is longer for one started through npx, which may have to download itself", async () => {
    mocked.create.mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    const bundle = await buildMcpToolSet([{ ...server, command: "npx", args: ["-y", "@playwright/mcp@latest"] }], {
      timeoutMs: 30,
      signal: AbortSignal.timeout(250),
    });
    // A plain server gives up at 30 ms; the runner is waited for until the 250 ms signal stops it.
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    expect(bundle.errors[0]).toContain("cancelled");
    await bundle.close();
  });

  it("is the usual one for a server that is already installed", async () => {
    mocked.create.mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    const bundle = await buildMcpToolSet([server], { timeoutMs: 30 });
    expect(Date.now() - started).toBeLessThan(150);
    expect(bundle.errors[0]).toContain("timed out");
    await bundle.close();
  });
});

describe("tool names and result sizes", () => {
  it("are names with characters and a length every provider accepts, never the same twice", () => {
    expect(modelToolName("mcp_pw", "browser.navigate")).toBe("mcp_pw__browser_navigate");
    const long = modelToolName("mcp_pw", "x".repeat(100));
    expect(long.length).toBeLessThanOrEqual(64);
    expect(modelToolName("mcp_pw", "x".repeat(100))).toBe(long);
    expect(modelToolName("mcp_pw", "x".repeat(101))).not.toBe(long);
    expect(modelToolName("mcp_pw", "a.b", new Set(["mcp_pw__a_b"]))).toBe("mcp_pw__a_b_2");
    expect(modelToolName("mcp_pw", "ok-name_1")).toBe("mcp_pw__ok-name_1");
  });

  it("cut a result that would flood the context, and leave a small one alone", () => {
    const small = { content: [{ type: "text", text: "fine" }] };
    expect(capMcpResult(small)).toBe(small);
    const big = {
      isError: false,
      content: [
        { type: "text", text: "a".repeat(70_000) },
        { type: "image", data: "x" },
      ],
    };
    const capped = capMcpResult(big) as typeof big;
    expect((capped.content[0] as { text: string }).text.length).toBeLessThan(61_000);
    expect((capped.content[0] as { text: string }).text).toContain("[result cut at 60000 characters]");
    expect(capped.content[1]).toEqual({ type: "image", data: "x" });
    expect(capMcpResult("plain string")).toBe("plain string");
  });
});
