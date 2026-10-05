import type { McpServerConfig } from "../utils/settings";

export const ORIONMCP_ID = "orionmcp";
export const ORIONMCP_LABEL = "ORIONMCP — Revit & Dynamo";
export const ORIONMCP_ENDPOINT = "https://backend-orionbim-production.up.railway.app/mcp";

/** Addresses ORIONMCP used before it moved into the OrionBIM backend. A saved entry pointing at one is migrated, not honored. */
const LEGACY_ENDPOINTS = new Set([
  "https://orionmpc-production.up.railway.app/mcp",
  "https://orionmcp-production.up.railway.app/mcp",
]);

/** Public endpoint supplied by the product owner. Authentication is a separate step. */
export function defaultOrionMcpServer(): McpServerConfig {
  return orionMcpHttpServer(ORIONMCP_ENDPOINT);
}

/** Available by default in interactive and headless sessions; a saved opt-out wins. */
export function withOrionMcpDefault(saved: McpServerConfig[], fallback = defaultOrionMcpServer()): McpServerConfig[] {
  const configured = saved.find((server) => server.id.toLowerCase() === ORIONMCP_ID);
  // A saved HTTP entry without an endpoint (older partial setup) cannot connect: repair it, keeping the saved opt-out.
  const repaired =
    configured &&
    configured.transport === "http" &&
    (!configured.url?.trim() || LEGACY_ENDPOINTS.has(configured.url.trim()))
      ? { ...configured, url: fallback.url }
      : configured;
  return [
    repaired ? { ...repaired, id: ORIONMCP_ID } : fallback,
    ...saved.filter((server) => server.id.toLowerCase() !== ORIONMCP_ID),
  ];
}

export function orionMcpHttpServer(endpoint: string): McpServerConfig {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("ORIONMCP URL is invalid. Use the MCP endpoint provided by your installation.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Use HTTPS for remote ORIONMCP, or HTTP on loopback for a local installation.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("ORIONMCP URLs must not contain credentials, query strings or fragments.");
  }
  return { id: ORIONMCP_ID, label: ORIONMCP_LABEL, enabled: true, transport: "http", url: url.href };
}

/** Do not print headers, environment variables or command arguments in diagnostics. */
export function describeOrionMcp(server: McpServerConfig) {
  return {
    id: ORIONMCP_ID,
    transport: server.transport,
    enabled: server.enabled,
    configured: server.transport === "stdio" ? Boolean(server.command) : Boolean(server.url),
    authentication: "not_verified",
    endToEndVerified: false,
  };
}
