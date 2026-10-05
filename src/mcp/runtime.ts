import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolSet } from "ai";
import { toToolResult } from "../agent/tool-result";
import { recordSwallowedError } from "../utils/diagnostics";
import type { McpServerConfig } from "../utils/settings";
import { ORIONMCP_ENDPOINT } from "./orionmcp";
import { orionMcpConnectTool } from "./orionmcp-connect-tool";
import { OrionOAuthProvider } from "./orionmcp-oauth";
import { validateMcpServerConfig } from "./validate";

function mcpToolPrefix(server: McpServerConfig): string {
  return `mcp_${server.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function toTransport(server: McpServerConfig) {
  if (server.transport === "stdio") {
    return new StdioClientTransport({
      command: server.command ?? "",
      args: server.args,
      env: server.env,
      cwd: server.cwd,
      stderr: "pipe",
    });
  }

  return {
    type: server.transport,
    url: server.url ?? "",
    headers: server.headers,
    ...(server.id === "orionmcp" && server.transport === "http"
      ? { authProvider: new OrionOAuthProvider(server.url ?? "") }
      : {}),
  } as const;
}

export interface McpToolBundle {
  tools: ToolSet;
  errors: string[];
  close(): Promise<void>;
}

export interface McpToolBundleOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_MCP_TIMEOUT_MS = 20_000;

export async function buildMcpToolSet(
  servers: McpServerConfig[],
  options: McpToolBundleOptions = {},
): Promise<McpToolBundle> {
  const tools: ToolSet = {};
  const errors: string[] = [];
  const clients: MCPClient[] = [];
  const timeoutMs = options.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS;

  for (const server of servers) {
    if (!server.enabled) continue;
    if (options.signal?.aborted) {
      errors.push(`${server.label}: MCP connection was cancelled.`);
      break;
    }

    const validation = validateMcpServerConfig(server);
    if (!validation.ok) {
      errors.push(`${server.label}: ${validation.error}`);
      continue;
    }

    let transport: ReturnType<typeof toTransport>;
    try {
      transport = toTransport(server);
      if (
        !(transport instanceof StdioClientTransport) &&
        server.url === ORIONMCP_ENDPOINT &&
        transport.authProvider &&
        !transport.authProvider.tokens()
      ) {
        // Nobody should need a command: the agent connects the Revit itself when the person asks about it.
        tools[`${mcpToolPrefix(server)}__connect_revit`] = orionMcpConnectTool(server.url ?? ORIONMCP_ENDPOINT);
        continue;
      }
    } catch {
      errors.push(`${server.label}: protected credentials unavailable. Run shelra mcp orionmcp login.`);
      continue;
    }
    let abandoned = false;
    let stderrBytes = 0;
    if (transport instanceof StdioClientTransport) {
      // The SDK pipes into a PassThrough. Leaving it unread eventually blocks the server before its reply.
      transport.stderr?.on("data", (chunk: Buffer | string) => {
        stderrBytes += Buffer.byteLength(chunk);
      });
    }
    const closeClient = (client: MCPClient) => withTimeout(client.close(), timeoutMs, undefined, "client close");
    try {
      const connecting = createMCPClient({
        transport,
        name: `shelra-${server.id}`,
        version: "1.0.0",
      });
      // A timed-out promise does not cancel the underlying connection or own its eventual client.
      void connecting.then(
        (client) => {
          if (abandoned) void closeClient(client).catch((error) => recordSwallowedError("mcp.late-close", error));
        },
        () => {},
      );
      const client = await withTimeout(connecting, timeoutMs, options.signal, `${server.label} connection`);
      clients.push(client);

      const mcpTools = await withTimeout(client.tools(), timeoutMs, options.signal, `${server.label} tools/list`);
      const prefix = mcpToolPrefix(server);

      for (const [name, tool] of Object.entries(mcpTools)) {
        const prefixedName = `${prefix}__${name}`;
        tools[prefixedName] = {
          ...tool,
          description: `[MCP ${server.label}] ${tool.description ?? name}`,
          ...(tool.toModelOutput
            ? {
                toModelOutput: (input: Parameters<NonNullable<typeof tool.toModelOutput>>[0]) => {
                  // The SDK's MCP content converter drops isError. Preserve failure for the model and transcript,
                  // while keeping its image/structured-content conversion for successful results.
                  if (
                    input.output &&
                    typeof input.output === "object" &&
                    "isError" in input.output &&
                    input.output.isError === true
                  ) {
                    const failed = toToolResult(input.output);
                    return { type: "error-text" as const, value: failed.error ?? "MCP tool failed." };
                  }
                  return tool.toModelOutput!(input);
                },
              }
            : {}),
        };
      }
    } catch (error: unknown) {
      abandoned = true;
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${server.label}: ${message}${stderrBytes ? ` (server stderr: ${stderrBytes} bytes)` : ""}`);
      if (transport instanceof StdioClientTransport) {
        try {
          await withTimeout(transport.close(), timeoutMs, undefined, `${server.label} transport close`);
        } catch (closeError) {
          errors.push(`${server.label}: ${String(closeError)}`);
          recordSwallowedError("mcp.transport-close", closeError);
        }
      }
    }
  }

  return {
    tools,
    errors,
    async close() {
      await Promise.all(clients.map((client) => closeOwnedClient(client)));
    },
  };

  async function closeOwnedClient(client: MCPClient): Promise<void> {
    try {
      await withTimeout(client.close(), timeoutMs, undefined, "client close");
    } catch (error) {
      errors.push(`MCP client close failed: ${String(error)}`);
      recordSwallowedError("mcp.close", error);
    }
  }
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  label: string,
): Promise<T> {
  const boundedTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_MCP_TIMEOUT_MS;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => finish(() => reject(new Error(`MCP ${label} was cancelled.`)));

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      settle();
    };

    timer = setTimeout(
      () => finish(() => reject(new Error(`MCP ${label} timed out after ${boundedTimeout}ms.`))),
      boundedTimeout,
    );

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
    );
  });
}
