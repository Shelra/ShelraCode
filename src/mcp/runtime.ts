import { createHash } from "node:crypto";
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

/** The longest tool name providers accept (OpenAI's limit, the strictest in common use). */
const MAX_TOOL_NAME = 64;

/**
 * The name the model sees for a server's tool: letters, digits, `_` and `-` only, at most 64 characters. A dotted or
 * long name from a server made the provider reject the whole request, not just the tool (review 2026-10-07).
 */
export function modelToolName(prefix: string, name: string, taken: ReadonlySet<string> = new Set()): string {
  let full = `${prefix}__${name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  if (full.length > MAX_TOOL_NAME) {
    full = `${full.slice(0, MAX_TOOL_NAME - 9)}_${createHash("sha256").update(full).digest("hex").slice(0, 8)}`;
  }
  let unique = full;
  for (let n = 2; taken.has(unique); n += 1) unique = `${full.slice(0, MAX_TOOL_NAME - 3)}_${n}`;
  return unique;
}

/** The most text one MCP tool result may put in front of the model. */
const MAX_MCP_TEXT = 60_000;

/** Cuts the text parts of an MCP result that are longer than the limit, and says so. */
export function capMcpResult(result: unknown): unknown {
  const content = (result as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return result;
  let cut = false;
  const capped = content.map((part: unknown) => {
    const item = part as { type?: unknown; text?: unknown };
    if (item?.type === "text" && typeof item.text === "string" && item.text.length > MAX_MCP_TEXT) {
      cut = true;
      return { ...item, text: `${item.text.slice(0, MAX_MCP_TEXT)}\n[result cut at ${MAX_MCP_TEXT} characters]` };
    }
    return part;
  });
  return cut ? { ...(result as object), content: capped } : result;
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

function hasOrionTokens(server: McpServerConfig): boolean {
  try {
    return Boolean(new OrionOAuthProvider(server.url ?? "").tokens());
  } catch {
    return false;
  }
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
/** How long a server started through a package runner (npx, bunx, uvx) may take to download and start. */
const RUNNER_MCP_TIMEOUT_MS = 60_000;
/** How much of a failing server's stderr is kept to explain the failure. */
const STDERR_KEPT = 2_000;

function serverTimeoutMs(server: McpServerConfig, base: number): number {
  const command = (server.command ?? "").split(/[\\/]/u).pop() ?? "";
  return server.transport === "stdio" && /^(?:npx|bunx|uvx|pnpm|yarn|npm|pipx)(?:\.cmd|\.exe)?$/iu.test(command)
    ? Math.max(base, RUNNER_MCP_TIMEOUT_MS)
    : base;
}

/** The first lines a server wrote to stderr, on one line, without control characters or anything long. */
export function describeStderr(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escapes are what is being removed
  const clean = text.replace(/\u001b\[[0-9;]*[A-Za-z]/gu, "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, " ");
  return clean.replace(/\s+/gu, " ").trim().slice(0, 300);
}

/**
 * HTTP MCP connections are reused between turns. Before, every turn opened a new client and asked for the tool list again
 * (0.2-0.8 s of network before the model could start, measured 2026-10-05, and a "Connecting configured MCP tools" pause the
 * person could read as a freeze). A stdio server is a child process owned by one turn, so it is never cached.
 */
interface CachedMcp {
  client: MCPClient;
  tools: Awaited<ReturnType<MCPClient["tools"]>>;
  expires: number;
}
const MCP_CACHE_MS = 10 * 60_000;
const mcpCache = new Map<string, CachedMcp>();

function cacheKeyOf(server: McpServerConfig): string | null {
  return server.transport === "http" ? `${server.id}|${server.url}|${JSON.stringify(server.headers ?? {})}` : null;
}

function dropCached(key: string | null): void {
  if (!key) return;
  const entry = mcpCache.get(key);
  mcpCache.delete(key);
  if (entry) void entry.client.close().catch(() => {});
}

/** For tests and shutdown: close every cached connection. */
export function resetMcpCache(): void {
  for (const key of [...mcpCache.keys()]) dropCached(key);
}

/** The server said the credentials are no longer valid (expired refresh, revoked, signed out elsewhere). */
function isUnauthorized(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /UnauthorizedError|\b401\b|unauthori[sz]ed|invalid_token|invalid_grant/iu.test(text);
}

export async function buildMcpToolSet(
  servers: McpServerConfig[],
  options: McpToolBundleOptions = {},
): Promise<McpToolBundle> {
  const tools: ToolSet = {};
  const errors: string[] = [];
  const clients: MCPClient[] = [];
  const baseTimeoutMs = options.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS;

  function register(server: McpServerConfig, mcpTools: Awaited<ReturnType<MCPClient["tools"]>>): void {
    const prefix = mcpToolPrefix(server);

    for (const [name, tool] of Object.entries(mcpTools)) {
      const prefixedName = modelToolName(prefix, name, new Set(Object.keys(tools)));
      const execute = tool.execute;
      tools[prefixedName] = {
        ...tool,
        description: `[MCP ${server.label}] ${tool.description ?? name}`,
        ...(execute
          ? {
              execute: async (...args: Parameters<typeof execute>) => {
                try {
                  return capMcpResult(await execute(...args));
                } catch (error) {
                  // Revoked or expired mid-session: forget the stale credentials so the next turn offers the one-click
                  // reconnect (connect_revit) instead of failing the same way again.
                  if (server.id === "orionmcp" && isUnauthorized(error)) {
                    try {
                      new OrionOAuthProvider(server.url ?? "").invalidateCredentials("tokens");
                    } catch {
                      /* best-effort */
                    }
                    dropCached(cacheKeyOf(server));
                    return {
                      isError: true,
                      content: [
                        {
                          type: "text",
                          text: "La autorización con OrionBIM caducó. Dile al usuario que repita su pregunta: se reconectará con un clic.",
                        },
                      ],
                    };
                  }
                  // A cached connection that fails is probably dead: forget it, so the next turn connects again instead
                  // of failing the same way until the cache expires (review 2026-10-07).
                  dropCached(cacheKeyOf(server));
                  throw error;
                }
              },
            }
          : {}),
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
  }

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

    const key = cacheKeyOf(server);
    const cached = key ? mcpCache.get(key) : undefined;
    if (cached && cached.expires > Date.now() && !(server.id === "orionmcp" && !hasOrionTokens(server))) {
      register(server, cached.tools);
      continue;
    }
    if (cached) dropCached(key);

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
    let stderrText = "";
    if (transport instanceof StdioClientTransport) {
      // The SDK pipes into a PassThrough. Leaving it unread eventually blocks the server before its reply. The first
      // part is kept: it is where a server says why it cannot start ("Chromium distribution 'chrome' is not found").
      transport.stderr?.on("data", (chunk: Buffer | string) => {
        stderrBytes += Buffer.byteLength(chunk);
        if (stderrText.length < STDERR_KEPT) stderrText += chunk.toString();
      });
    }
    // A server started through a package runner may have to download itself first: it gets longer than a running one.
    const timeoutMs = serverTimeoutMs(server, baseTimeoutMs);
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
      if (key) {
        dropCached(key);
        mcpCache.set(key, { client, tools: mcpTools, expires: Date.now() + MCP_CACHE_MS });
        clients.pop(); // the cache owns it now: closing the bundle must not close a connection the next turn reuses
      }
      register(server, mcpTools);
    } catch (error: unknown) {
      abandoned = true;
      if (server.id === "orionmcp" && isUnauthorized(error)) {
        try {
          new OrionOAuthProvider(server.url ?? "").invalidateCredentials("tokens");
        } catch {
          /* best-effort */
        }
        tools[`${mcpToolPrefix(server)}__connect_revit`] = orionMcpConnectTool(server.url ?? ORIONMCP_ENDPOINT);
        continue;
      }
      const message = error instanceof Error ? error.message : String(error);
      const said = describeStderr(stderrText);
      errors.push(
        `${server.label}: ${message}${said ? ` (the server said: ${said})` : stderrBytes ? ` (server stderr: ${stderrBytes} bytes)` : ""}`,
      );
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
      await withTimeout(client.close(), baseTimeoutMs, undefined, "client close");
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
