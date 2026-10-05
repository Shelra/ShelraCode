# Connect Shelra to Revit with ORIONMCP

ORIONMCP is part of OrionBIM, and Shelra includes it as its first built-in MCP
connection. It uses HTTPS and your OrionBIM account: there are no codes to copy,
no terminal setup and no JSON to edit. The endpoint is
`https://backend-orionbim-production.up.railway.app/mcp`.

## What you need

- Revit 2024 open with the OrionBIM add-in, signed in to OrionBIM.
- Shelra. It already knows the OrionBIM endpoint.

## Connect

1. Run `shelra mcp orionmcp login` (or let Shelra offer it the first time you use Revit).
2. Your browser opens OrionBIM. If you are signed in, press **Permitir**.
3. Ask Shelra something about your Revit, for example "¿en qué proyecto estoy?".

Authentication is independent of your model provider login. Windows protects the
ORIONMCP credentials with DPAPI; this credential store currently requires Windows.

## Check without risk

- `shelra mcp orionmcp test` connects and lists tools; it never runs a Revit tool.
- `shelra mcp orionmcp inspect` reads the real Revit instance (read only).

Every result keeps `endToEndVerified: false` unless a real Revit answer was observed:
a configured file or a tool list is not a Revit result.

## Safety

The AI works with your Revit under your account. Tools that cannot be undone require
your explicit approval. A tool call never reaches another person's Revit: the server
routes by your own OrionBIM identity.
