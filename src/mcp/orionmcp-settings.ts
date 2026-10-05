import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";
import { getProductUserDir } from "../product/identity";
import type { McpServerConfig } from "../utils/settings";
import { ORIONMCP_ID } from "./orionmcp";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Merge one entry, fail closed on malformed settings, and retain unknown preferences. */
export function updateOrionMcpSettings(
  server: McpServerConfig,
  apply: boolean,
  settingsFile = path.join(getProductUserDir(), "user-settings.json"),
) {
  if (server.id !== ORIONMCP_ID) throw new Error("This operation only configures ORIONMCP.");
  const directory = path.dirname(settingsFile);
  if (apply) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = `${settingsFile}.orionmcp.lock`;
  const lockFd = apply ? fs.openSync(lock, "wx", 0o600) : undefined;
  const temp = `${settingsFile}.${randomUUID()}.tmp`;
  try {
    if (fs.existsSync(settingsFile) && !fs.lstatSync(settingsFile).isFile()) {
      throw new Error("Settings must be a regular file. Repair the configuration before connecting ORIONMCP.");
    }
    const previous = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, "utf8") : undefined;
    let current: unknown;
    try {
      current = previous === undefined ? {} : JSON.parse(previous);
    } catch {
      throw new Error("Shelra settings contain invalid JSON. They have been preserved; repair them before connecting.");
    }
    if (!object(current) || (current.mcp !== undefined && !object(current.mcp))) {
      throw new Error("Shelra settings have an invalid structure. No configuration was changed.");
    }
    const mcp = object(current.mcp) ? current.mcp : {};
    const servers = mcp.servers ?? [];
    if (!Array.isArray(servers) || !servers.every((entry) => object(entry) && typeof entry.id === "string")) {
      throw new Error("The MCP server list has an invalid structure. No configuration was changed.");
    }
    const others = servers.filter((entry) => (entry.id as string).toLowerCase() !== ORIONMCP_ID);
    const next = JSON.stringify({ ...current, mcp: { ...mcp, servers: [server, ...others] } }, null, 2);
    const changed = previous === undefined || JSON.stringify(JSON.parse(previous)) !== JSON.stringify(JSON.parse(next));
    if (!apply || !changed) return { scope: "user", applied: false, changed, settingsFile, backupFile: undefined };
    const backupFile = previous === undefined ? undefined : `${settingsFile}.orionmcp-${randomUUID()}.bak`;
    fs.writeFileSync(temp, `${next}\n`, { flag: "wx", mode: 0o600 });
    const latest = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, "utf8") : undefined;
    if (latest !== previous)
      throw new Error("Settings changed during configuration. Retry; the newer settings were preserved.");
    if (backupFile && previous !== undefined) fs.writeFileSync(backupFile, previous, { flag: "wx", mode: 0o600 });
    fs.renameSync(temp, settingsFile);
    return { scope: "user", applied: true, changed, settingsFile, backupFile };
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    if (lockFd !== undefined) {
      fs.closeSync(lockFd);
      fs.unlinkSync(lock);
    }
  }
}
