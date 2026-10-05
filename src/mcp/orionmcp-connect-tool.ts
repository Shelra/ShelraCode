import { tool } from "ai";
import { z } from "zod";
import { loginOrionMcp } from "./orionmcp-oauth";

/**
 * The tool Shelra offers while ORIONMCP has no OrionBIM authorization yet. Nobody has to know a command:
 * when the person asks about their Revit, the agent calls this, the browser opens OrionBIM, the person presses
 * "Permitir" once, and the Revit tools appear on the next turn. Browser and callback are the same login the
 * `shelra mcp orionmcp login` command runs.
 */
export function orionMcpConnectTool(
  endpoint: string,
  login: (endpoint: string, announce?: (message: string) => void) => Promise<void> = loginOrionMcp,
) {
  return tool({
    description:
      "Connect the user's Revit (via their OrionBIM account) to Shelra. ORIONMCP is not authorized yet, so no Revit tool is available. " +
      "Call this when the user asks anything about their Revit or Dynamo. It opens the user's browser so they press 'Permitir' in OrionBIM " +
      "(they must also have Revit open with OrionBIM signed in). When it returns ok, tell the user it is connected and answer their request again.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        await login(endpoint, () => {});
        return {
          ok: true,
          message: "Conectado con OrionBIM. Ya puedes usar las herramientas de Revit: repite la petición del usuario.",
        };
      } catch {
        return {
          ok: false,
          message:
            "No se completó la conexión. Pide al usuario que inicie sesión en OrionBIM en el navegador y pulse «Permitir»; después vuelve a intentarlo.",
        };
      }
    },
  });
}
