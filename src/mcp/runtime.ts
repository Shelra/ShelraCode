import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolSet } from "ai";
import type { McpServerConfig } from "../utils/settings";
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

    const validation = validateMcpServerConfig(server);
    if (!validation.ok) {
      errors.push(`${server.label}: ${validation.error}`);
      continue;
    }

    try {
      const client = await withTimeout(
        createMCPClient({
          transport: toTransport(server),
          name: `shelra-${server.id}`,
          version: "1.0.0",
        }),
        timeoutMs,
        options.signal,
        `${server.label} connection`,
      );
      clients.push(client);

      const mcpTools = await withTimeout(client.tools(), timeoutMs, options.signal, `${server.label} tools/list`);
      const prefix = mcpToolPrefix(server);

      for (const [name, tool] of Object.entries(mcpTools)) {
        const prefixedName = `${prefix}__${name}`;
        tools[prefixedName] = {
          ...tool,
          description: `[MCP ${server.label}] ${tool.description ?? name}`,
        };
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${server.label}: ${message}`);
    }
  }

  return {
    tools,
    errors,
    async close() {
      await Promise.all(
        clients.map((client) => withTimeout(client.close(), timeoutMs, undefined, "client close").catch(() => {})),
      );
    },
  };
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
