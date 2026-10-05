import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { loadMcpServers, type McpServerConfig } from "../utils/settings";
import { defaultOrionMcpServer, describeOrionMcp, ORIONMCP_ID, orionMcpHttpServer } from "./orionmcp";
import { loginOrionMcp } from "./orionmcp-oauth";
import { updateOrionMcpSettings } from "./orionmcp-settings";
import { buildMcpToolSet } from "./runtime";

export async function probeOrionMcp(server: McpServerConfig, timeoutMs = 10_000, signal?: AbortSignal) {
  if (!server.enabled) return { state: "disabled", toolNames: [], endToEndVerified: false };
  const bundle = await buildMcpToolSet([server], { timeoutMs, signal });
  try {
    if (bundle.errors.length) {
      // Transport errors can embed auth headers or server-provided text. Keep the public diagnostic bounded.
      return {
        state: bundle.errors.some((error) => error.includes("authentication pending"))
          ? "authentication_pending"
          : "connection_failed",
        toolNames: [],
        endToEndVerified: false,
        nextAction:
          "Run shelra mcp orionmcp login for authentication. Check the HTTPS endpoint if the connection fails. Model-provider login is separate.",
      };
    }
    const toolNames = Object.keys(bundle.tools);
    if (toolNames.includes(`mcp_${ORIONMCP_ID}__connect_revit`)) {
      return {
        state: "authentication_pending",
        toolNames: [],
        endToEndVerified: false,
        nextAction:
          "Ask Shelra anything about your Revit, or run: shelra mcp orionmcp login (one click in the browser).",
      };
    }
    return {
      state: toolNames.length ? "tools_discovered" : "no_tools_available",
      toolNames,
      endToEndVerified: false,
      nextAction:
        "Verify the target Revit instance and document before requesting a task. No Revit operation was run by this check.",
    };
  } finally {
    await bundle.close();
  }
}

function savedOrDefault(): McpServerConfig {
  return loadMcpServers().find((server) => server.id === ORIONMCP_ID) ?? defaultOrionMcpServer();
}

export function registerMcpCommands(root: Command): void {
  const mcp = root.command("mcp").alias("mcps").description("Manage MCP connections; ORIONMCP is included by default");
  mcp
    .command("list", { isDefault: true })
    .description("List MCP configuration without exposing credentials")
    .action(() => {
      console.log(
        JSON.stringify(
          loadMcpServers().map(({ id, label, transport, enabled }) => ({ id, label, transport, enabled })),
          null,
          2,
        ),
      );
    });
  const orion = mcp.command(ORIONMCP_ID).description("Configure and check the native Revit / Dynamo integration");
  orion
    .command("login")
    .description("Connect Shelra to your Revit with your OrionBIM account (one click in the browser)")
    .action(async () => {
      try {
        const server = savedOrDefault();
        if (server.transport !== "http" || !server.url) throw new Error("Select an ORIONMCP HTTP connection first.");
        await loginOrionMcp(server.url);
        console.log("ORIONMCP authentication completed. Run shelra mcp orionmcp inspect to verify Revit.");
      } catch {
        console.error(
          "ORIONMCP login failed or expired. Sign in to OrionBIM in your browser, press Allow, and try again.",
        );
        process.exitCode = 1;
      }
    });
  orion
    .command("inspect")
    .description("Use real MCP tools to inspect the live Revit version and documents (read-only)")
    .action(async () => {
      const bundle = await buildMcpToolSet([savedOrDefault()], { timeoutMs: 10_000 });
      try {
        if (bundle.errors.length) throw new Error("ORIONMCP connection failed. Run the connection check first.");
        async function invoke(name: string, input: Record<string, unknown>) {
          const tool = bundle.tools[`mcp_orionmcp__${name}`];
          if (!tool?.execute) throw new Error("The required ORIONMCP read capability is unavailable.");
          const raw = await tool.execute(input, { toolCallId: randomUUID(), messages: [] });
          if (!raw || typeof raw !== "object" || !("content" in raw) || !Array.isArray(raw.content))
            throw new Error("Invalid ORIONMCP result.");
          const text = raw.content.find(
            (item: unknown) => item && typeof item === "object" && "type" in item && item.type === "text",
          );
          if (!text || typeof text.text !== "string") throw new Error("ORIONMCP did not return a readable result.");
          const result = JSON.parse(text.text);
          if (("isError" in raw && raw.isError === true) || result.ok === false)
            throw new Error("ORIONMCP reported a Revit operation failure. Inspect the host activity before retrying.");
          return result;
        }
        if (bundle.tools[`mcp_${ORIONMCP_ID}__connect_revit`])
          throw new Error("ORIONMCP is not connected yet. Run shelra mcp orionmcp login (one click in the browser).");
        const status = await invoke("orion_status", {});
        const instanceId = status.revitInstances?.[0]?.instanceId;
        if (typeof instanceId !== "string")
          throw new Error("No live Revit instance. Open Revit with the ORIONMCP add-in, then retry.");
        const revit = await invoke("revit_status", { instanceId });
        const documents = await invoke("revit_documents_list", { instanceId });
        console.log(
          JSON.stringify(
            {
              state: "revit_read_verified",
              instance: revit.result,
              documents: documents.result,
              transport: savedOrDefault().transport,
              remoteRevitVerified: status.mode === "remote",
              dynamoEvaluationVerified: false,
              llmProviderTested: false,
            },
            null,
            2,
          ),
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : "Revit inspection failed.");
        process.exitCode = 1;
      } finally {
        await bundle.close();
      }
    });
  orion
    .command("connect")
    .description("Preview ORIONMCP settings; --apply backs up and merges only this connection")
    .option("--url <endpoint>", "Local or remote Streamable HTTP MCP endpoint")
    .option("--command <executable>", "Absolute path to the installed ORIONMCP companion")
    .option("--args <json>", "Companion argument array", '["mcp","--stdio"]')
    .option("--apply", "Apply the previewed user-scope configuration")
    .action((options: { url?: string; command?: string; args: string; apply?: boolean }) => {
      try {
        if (options.url && options.command) throw new Error("Choose either --url or --command.");
        let server = savedOrDefault();
        if (options.url) server = orionMcpHttpServer(options.url);
        else if (options.command || server.transport === "stdio") {
          const command = options.command ?? server.command ?? "";
          if (!path.isAbsolute(command) || !existsSync(command) || !statSync(command).isFile()) {
            throw new Error(
              "ORIONMCP companion is not installed. Install ORIONMCP or provide --url for your deployed MCP endpoint.",
            );
          }
          const args: unknown = JSON.parse(options.args);
          if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string"))
            throw new Error("--args must be a JSON array of strings.");
          server = {
            id: ORIONMCP_ID,
            label: defaultOrionMcpServer().label,
            enabled: true,
            transport: "stdio",
            command,
            args,
          };
        }
        server = { ...server, enabled: true };
        const result = updateOrionMcpSettings(server, options.apply === true);
        console.log(
          JSON.stringify(
            {
              ...result,
              connection: describeOrionMcp(server),
              nextAction: options.apply
                ? "Run: shelra mcp orionmcp test"
                : "Review scope and transport, then repeat with --apply. Other MCP servers and preferences are preserved.",
            },
            null,
            2,
          ),
        );
      } catch (error) {
        console.error(error instanceof Error ? error.message : "ORIONMCP configuration failed.");
        process.exitCode = 1;
      }
    });
  orion
    .command("test")
    .description("Perform MCP initialization and tool discovery, without modifying Revit")
    .option("--url <endpoint>", "Check an endpoint without saving configuration")
    .action(async (options: { url?: string }) => {
      const abort = new AbortController();
      const cancel = () => abort.abort();
      process.once("SIGINT", cancel);
      try {
        if (process.stderr.isTTY) console.error("Checking ORIONMCP transport and tools...");
        const server = options.url ? orionMcpHttpServer(options.url) : savedOrDefault();
        const result = await probeOrionMcp(server, 10_000, abort.signal);
        console.log(JSON.stringify(result, null, 2));
        if (result.state !== "tools_discovered") process.exitCode = 1;
      } catch {
        console.error("ORIONMCP could not be checked. Check installation and authentication, then retry.");
        process.exitCode = 1;
      } finally {
        process.removeListener("SIGINT", cancel);
      }
    });
  orion
    .command("disconnect")
    .description("Disable ORIONMCP for new tool bundles; existing Revit jobs are not cancelled")
    .option("--apply", "Persist the change after preview")
    .action((options: { apply?: boolean }) => {
      try {
        console.log(
          JSON.stringify(
            updateOrionMcpSettings({ ...savedOrDefault(), enabled: false }, options.apply === true),
            null,
            2,
          ),
        );
      } catch {
        console.error(
          "ORIONMCP could not be disabled. Existing settings were preserved; check the settings file and retry.",
        );
        process.exitCode = 1;
      }
    });
}
