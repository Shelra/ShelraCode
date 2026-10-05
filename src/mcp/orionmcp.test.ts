import * as fs from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { defaultOrionMcpServer, describeOrionMcp, orionMcpHttpServer, withOrionMcpDefault } from "./orionmcp";
import { probeOrionMcp } from "./orionmcp-commands";
import { updateOrionMcpSettings } from "./orionmcp-settings";

const scratch: string[] = [];
afterEach(() => {
  for (const directory of scratch.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});
function settingsFile(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shelra-orionmcp-"));
  scratch.push(directory);
  return path.join(directory, "user-settings.json");
}

describe("native ORIONMCP defaults", () => {
  it("is first and uses the owner's HTTPS endpoint without requiring a local companion", () => {
    const fallback = defaultOrionMcpServer();
    const other = {
      id: "existing",
      label: "Existing",
      transport: "stdio" as const,
      command: "existing",
      enabled: true,
    };
    expect(withOrionMcpDefault([other], fallback)).toEqual([fallback, other]);
    expect(fallback.enabled).toBe(true);
    expect(fallback.url).toBe("https://backend-orionbim-production.up.railway.app/mcp");
    expect(fallback.transport).toBe("http");
    expect(fallback.command).toBeUndefined();
  });
  it("automatically includes HTTP and preserves a user's explicit disable", () => {
    const fallback = defaultOrionMcpServer();
    expect(fallback.enabled).toBe(true);
    const disabled = { ...fallback, enabled: false };
    expect(withOrionMcpDefault([disabled], fallback)).toEqual([disabled]);
  });
  it("repairs a saved HTTP entry that has no endpoint, keeping its enabled state", () => {
    const fallback = defaultOrionMcpServer();
    const broken = { id: "orionmcp", label: fallback.label, enabled: true, transport: "http" as const };
    expect(withOrionMcpDefault([broken], fallback)).toEqual([{ ...broken, url: fallback.url }]);
    expect(withOrionMcpDefault([{ ...broken, enabled: false }], fallback)[0]).toMatchObject({
      enabled: false,
      url: fallback.url,
    });
  });
  it("preserves a saved remote connection, normalizes the identifier, and avoids duplicates", () => {
    const saved = { ...orionMcpHttpServer("https://mcp.example.test/mcp"), id: "ORIONMCP" };
    expect(withOrionMcpDefault([saved, saved])).toEqual([{ ...saved, id: "orionmcp" }]);
  });
  it.each([
    "http://remote.example.test/mcp",
    "https://user:secret@example.test/mcp",
    "https://example.test/mcp?token=secret",
    "https://example.test/mcp#secret",
    "file:///tmp/mcp",
  ])("rejects insecure or credential-bearing endpoints: %s", (endpoint) => {
    expect(() => orionMcpHttpServer(endpoint)).toThrow();
  });
  it("does not disclose secrets or claim end-to-end verification in configuration diagnostics", () => {
    const diagnostic = describeOrionMcp({
      ...orionMcpHttpServer("https://example.test/mcp"),
      headers: { Authorization: "secret" },
    });
    expect(JSON.stringify(diagnostic)).not.toContain("secret");
    expect(diagnostic.endToEndVerified).toBe(false);
  });
});

describe("ORIONMCP configuration changes", () => {
  it("previews without writing, then backs up and merges only ORIONMCP, preserving unrelated data", () => {
    const file = settingsFile();
    const before =
      '{"preference":{"unknown":true},"mcp":{"future":42,"servers":[{"id":"other","headers":{"private":"kept"}}]}}';
    fs.writeFileSync(file, before);
    const server = orionMcpHttpServer("http://127.0.0.1:42123/mcp");
    expect(updateOrionMcpSettings(server, false, file).applied).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    const result = updateOrionMcpSettings(server, true, file);
    expect(result.applied).toBe(true);
    expect(fs.readFileSync(result.backupFile!, "utf8")).toBe(before);
    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(after.preference).toEqual({ unknown: true });
    expect(after.mcp.future).toBe(42);
    expect(after.mcp.servers).toEqual([server, { id: "other", headers: { private: "kept" } }]);
    expect(updateOrionMcpSettings(server, true, file).changed).toBe(false);
    expect(fs.existsSync(`${file}.orionmcp.lock`)).toBe(false);
  });
  it.each([
    "invalid json",
    "null",
    '{"mcp":null}',
    '{"mcp":{"servers":[null]}}',
  ])("preserves malformed configuration: %s", (before) => {
    const file = settingsFile();
    fs.writeFileSync(file, before);
    expect(() => updateOrionMcpSettings(orionMcpHttpServer("https://example.test/mcp"), true, file)).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["user-settings.json"]);
  });
  it("refuses a concurrent configuration writer without changing the file or removing its lock", () => {
    const file = settingsFile();
    fs.writeFileSync(file, "{}");
    fs.writeFileSync(`${file}.orionmcp.lock`, "another writer");
    expect(() => updateOrionMcpSettings(orionMcpHttpServer("https://example.test/mcp"), true, file)).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe("{}");
    expect(fs.readFileSync(`${file}.orionmcp.lock`, "utf8")).toBe("another writer");
  });
});

describe("real MCP transport discovery (protocol fixture, not Revit)", () => {
  it("initializes over Streamable HTTP and discovers a tool without calling it or claiming Revit verification", async () => {
    let calls = 0;
    const mcp = new McpServer({ name: "orionmcp-protocol-fixture", version: "0.0.0-test" });
    mcp.registerTool("fixture_read", { description: "Protocol fixture only", inputSchema: {} }, async () => {
      calls++;
      return { content: [{ type: "text", text: "fixture" }] };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => "fixture-session" });
    await mcp.connect(transport);
    const http = createServer((req, res) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
        await transport.handleRequest(req, res, body);
      })().catch(() => {
        res.writeHead(500);
        res.end();
      });
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const address = http.address();
    if (!address || typeof address === "string") throw new Error("No fixture port");
    try {
      const result = await probeOrionMcp(orionMcpHttpServer(`http://127.0.0.1:${address.port}/mcp`), 3000);
      expect(result.state).toBe("tools_discovered");
      expect(result.toolNames).toEqual(["mcp_orionmcp__fixture_read"]);
      expect(result.endToEndVerified).toBe(false);
      expect(calls).toBe(0);
    } finally {
      await mcp.close();
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) => http.close((error) => (error ? reject(error) : resolve())));
    }
  });
  it("reports a missing server as a connection failure with no fabricated tool names", async () => {
    const result = await probeOrionMcp(orionMcpHttpServer("http://127.0.0.1:1/mcp"), 200);
    expect(result.state).toBe("connection_failed");
    expect(result.toolNames).toEqual([]);
    expect(result.endToEndVerified).toBe(false);
  });
});
