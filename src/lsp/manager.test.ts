import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LspClientSession } from "./client";
import { createWorkspaceLspManager } from "./manager";
import type { NormalizedLspSettings } from "./types";

const BASE_SETTINGS: NormalizedLspSettings = {
  enabled: true,
  tool: true,
  autoInstall: false,
  startupTimeoutMs: 5_000,
  diagnosticsDebounceMs: 0,
  builtins: {
    typescript: {
      enabled: false,
    },
  },
  servers: [
    {
      id: "fake-ts",
      command: "fake-lsp",
      extensions: [".ts"],
      languageIds: {
        ".ts": "typescript",
      },
      rootMarkers: [".git"],
    },
  ],
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createWorkspaceLspManager", () => {
  it("reports a transport failure as unavailable rather than a successful empty reference search", async () => {
    const root = await createTempWorkspace();
    const filePath = path.join(root, "demo.ts");
    await writeFile(filePath, "export const demo = 1;\n");
    const manager = createWorkspaceLspManager(root, BASE_SETTINGS, {
      createClient: async () =>
        createFakeClient({
          sendRequest: async () => {
            throw new Error("transport disconnected");
          },
        }),
    });
    const result = await manager.query({ operation: "findReferences", filePath });
    expect(result).toMatchObject({ success: false, availability: { status: "unavailable", responded: [] } });
    expect(result.output).toContain("transport disconnected");
    expect(result.output).not.toContain("No results found");
    await manager.close();
  });

  it("reports a failure of the second call-hierarchy request without escaping the query", async () => {
    const root = await createTempWorkspace();
    const filePath = path.join(root, "demo.ts");
    await writeFile(filePath, "export function demo() {}\n");
    const manager = createWorkspaceLspManager(root, BASE_SETTINGS, {
      createClient: async () =>
        createFakeClient({
          sendRequest: async (method) => {
            if (method === "textDocument/prepareCallHierarchy") return [{ name: "demo" }];
            throw new Error("incoming calls timed out");
          },
        }),
    });
    const result = await manager.query({ operation: "incomingCalls", filePath });
    expect(result).toMatchObject({ success: false, availability: { status: "unavailable" } });
    expect(result.output).toContain("incoming calls timed out");
    await manager.close();
  });

  it("preserves partial results when one queried server fails and never promotes them to complete", async () => {
    const root = await createTempWorkspace();
    const filePath = path.join(root, "demo.ts");
    await writeFile(filePath, "export const demo = 1;\n");
    const settings = {
      ...BASE_SETTINGS,
      servers: [...BASE_SETTINGS.servers, { ...BASE_SETTINGS.servers[0], id: "broken" }],
    };
    const manager = createWorkspaceLspManager(root, settings, {
      createClient: async ({ serverId }) =>
        createFakeClient({
          sendRequest: async () => {
            if (serverId.includes("broken")) throw new Error("server did not answer");
            return [{ name: "realReference", uri: "file:///consumer.ts" }];
          },
        }),
    });
    const result = await manager.query({ operation: "findReferences", filePath });
    expect(result).toMatchObject({ success: false, availability: { status: "partial" } });
    expect(result.output).toContain("realReference");
    expect(result.output).toContain("server did not answer");
    await manager.close();
  });

  it("identifies a valid empty response as complete only within the queried servers", async () => {
    const root = await createTempWorkspace();
    const filePath = path.join(root, "demo.ts");
    await writeFile(filePath, "export const demo = 1;\n");
    const manager = createWorkspaceLspManager(root, BASE_SETTINGS, { createClient: async () => createFakeClient({}) });
    const result = await manager.query({ operation: "findReferences", filePath });
    expect(result).toMatchObject({ success: true, availability: { status: "complete", failed: [] } });
    expect(result.output).toContain("No results found");
    expect(result.output).toContain("queried LSP");
    await manager.close();
  });

  it("does not query stale source after synchronizing the document fails", async () => {
    const root = await createTempWorkspace();
    const filePath = path.join(root, "demo.ts");
    await writeFile(filePath, "export const demo = 1;\n");
    const sendRequest = vi.fn(async () => []);
    const client = createFakeClient({ sendRequest });
    client.openOrChangeFile.mockRejectedValueOnce(new Error("document could not be synchronized"));
    const manager = createWorkspaceLspManager(root, BASE_SETTINGS, { createClient: async () => client });
    const result = await manager.query({ operation: "findReferences", filePath });
    expect(result).toMatchObject({ success: false, availability: { status: "unavailable" } });
    expect(result.output).toContain("document could not be synchronized");
    expect(sendRequest).not.toHaveBeenCalled();
    await manager.close();
  });

  it("reports a missing query source as unavailable rather than querying a stale LSP document", async () => {
    const root = await createTempWorkspace();
    const client = createFakeClient({});
    const manager = createWorkspaceLspManager(root, BASE_SETTINGS, { createClient: async () => client });
    const result = await manager.query({ operation: "findReferences", filePath: path.join(root, "missing.ts") });
    expect(result).toMatchObject({ success: false, availability: { status: "unavailable" } });
    expect(result.output).toContain("Could not read the file");
    expect(client.openOrChangeFile).not.toHaveBeenCalled();
    await manager.close();
  });

  it("routes queries through the matching LSP client", async () => {
    const root = await createTempWorkspace();
    const filePath = path.join(root, "src", "demo.ts");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "const demo = 1;\n");

    const sendRequest = vi.fn(async (method: string, params: unknown) => {
      expect(method).toBe("textDocument/definition");
      expect(params).toMatchObject({
        position: {
          line: 4,
          character: 2,
        },
      });
      return [{ uri: "file:///demo.ts", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } } }];
    });
    const client = createFakeClient({ sendRequest });

    const manager = createWorkspaceLspManager(root, BASE_SETTINGS, {
      createClient: async () => client,
    });

    const result = await manager.query({
      operation: "goToDefinition",
      filePath,
      line: 5,
      character: 3,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("file:///demo.ts");
    expect(client.openOrChangeFile).toHaveBeenCalledWith(filePath, "typescript", "const demo = 1;\n");
    expect(client.waitForDiagnostics).toHaveBeenCalledWith(filePath);

    await manager.close();
    expect(client.stop).toHaveBeenCalled();
  });

  it("returns diagnostics after syncing a saved file", async () => {
    const root = await createTempWorkspace();
    const filePath = path.join(root, "demo.ts");
    const diagnostics = [
      {
        filePath,
        serverId: "fake-ts",
        diagnostics: [
          {
            message: "Type error",
            severity: 1,
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 4 },
            },
          },
        ],
      },
    ];

    const client = createFakeClient({
      diagnostics: diagnostics[0].diagnostics,
    });

    const manager = createWorkspaceLspManager(root, BASE_SETTINGS, {
      createClient: async () => client,
    });

    const result = await manager.syncFile(filePath, "const broken = true;\n", true, true);

    expect(result).toEqual(diagnostics);
    expect(client.saveFile).toHaveBeenCalledWith(filePath);
    expect(client.waitForDiagnostics).toHaveBeenCalledWith(filePath);

    await manager.close();
  });

  it("does not start a server that failed to start again on the next edit (seen live 2026-09-25)", async () => {
    const root = await createTempWorkspace();
    const filePath = path.join(root, "demo.ts");
    const createClient = vi.fn(async (): Promise<LspClientSession> => {
      throw new Error("Timed out waiting for the server to initialize");
    });
    const manager = createWorkspaceLspManager(root, BASE_SETTINGS, { createClient });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    for (let edit = 0; edit < 4; edit += 1) {
      expect(await manager.syncFile(filePath, `const a = ${edit};\n`, true, true)).toEqual([]);
    }

    // Tried once; every later edit goes on without waiting for another start.
    expect(createClient).toHaveBeenCalledTimes(1);
    errors.mockRestore();
    await manager.close();
  });

  it("reports when no matching server exists", async () => {
    const root = await createTempWorkspace();
    const filePath = path.join(root, "demo.rb");
    await writeFile(filePath, "puts 'hello'\n");

    const manager = createWorkspaceLspManager(root, { ...BASE_SETTINGS, servers: [] });
    const result = await manager.query({
      operation: "hover",
      filePath,
      line: 1,
      character: 1,
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain("No LSP server available");

    await manager.close();
  });
});

async function createTempWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "shelra-lsp-manager-"));
  tempDirs.push(root);
  await mkdir(path.join(root, ".git"), { recursive: true });
  return root;
}

function createFakeClient(input: {
  diagnostics?: LspClientSession["getDiagnostics"] extends (filePath: string) => infer TResult ? TResult : never;
  sendRequest?: (method: string, params: unknown) => Promise<unknown>;
}): LspClientSession & {
  openOrChangeFile: ReturnType<typeof vi.fn>;
  saveFile: ReturnType<typeof vi.fn>;
  waitForDiagnostics: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  const diagnostics = input.diagnostics ?? [];
  return {
    serverId: "fake-ts",
    root: "/tmp",
    openOrChangeFile: vi.fn(async () => {}),
    saveFile: vi.fn(async () => {}),
    closeFile: vi.fn(async () => {}),
    sendRequest: (async <TResult>(method: string, params: unknown) =>
      (input.sendRequest ? await input.sendRequest(method, params) : []) as TResult) as LspClientSession["sendRequest"],
    waitForDiagnostics: vi.fn(async () => diagnostics),
    getDiagnostics: vi.fn(() => diagnostics),
    stop: vi.fn(async () => {}),
  };
}
