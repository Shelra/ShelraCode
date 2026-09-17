import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeIntelligenceProvider } from "../intelligence/fake";
import { ExecutionJournal } from "./journal";
import { AutonomyKernel, type KernelDeps, type RuntimeEvent } from "./kernel";

const workspaces: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "shelra-plan-events-"));
  workspaces.push(root);
  return root;
}

afterEach(() => {
  for (const root of workspaces.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("AutonomyKernel plan visibility", () => {
  it("emits and persists the executable specification, plan, and task progress", async () => {
    const root = workspace();
    const intelligence = new FakeIntelligenceProvider({
      interpret: [
        {
          data: {
            requirements: ["Create proof.txt."],
            criteria: [
              {
                id: "AC1",
                description: "proof.txt exists",
                required: false,
                kind: "file_exists",
                path: "proof.txt",
              },
            ],
          },
        },
      ],
      plan: [
        {
          data: {
            tasks: [{ id: "T1", description: "Write proof.txt", satisfies: [] }],
          },
        },
      ],
      implement: [
        {
          data: {
            summary: "Create the requested proof file.",
            files: [{ path: "proof.txt", action: "write", content: "verified\n" }],
          },
        },
      ],
    });
    const deps: KernelDeps = {
      intelligence,
      runCommand: async (command, options) => ({
        command,
        cwd: options.cwd,
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 0,
        timedOut: false,
        state: "completed",
        truncated: false,
      }),
      writeFile: async (base, path, content) => {
        const target = join(base, path);
        const existed = existsSync(target);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, "utf8");
        return {
          path,
          operation: existed ? "overwrite" : "create",
          changed: true,
          linesAdded: content.split(/\r?\n/u).length,
          linesRemoved: 0,
          bytesAfter: Buffer.byteLength(content),
        };
      },
      editFile: async () => {
        throw new Error("editFile was not expected");
      },
      deleteFile: async () => {
        throw new Error("deleteFile was not expected");
      },
      startProcess: async () => {
        throw new Error("startProcess was not expected");
      },
      stopProcess: async () => {},
      probeHttp: async (url) => ({ url, ok: true, status: 200, durationMs: 0 }),
      observePage: async (url) => ({
        url,
        ok: true,
        status: 200,
        consoleErrors: [],
        pageErrors: [],
        failedRequests: [],
        externalRequests: [],
        assertions: [],
      }),
      serveStatic: async () => {
        throw new Error("serveStatic was not expected");
      },
    };

    const kernel = new AutonomyKernel(deps, { workspace: root, request: "Create a visible proof file" });
    const events: RuntimeEvent[] = [];
    for await (const event of kernel.run()) events.push(event);

    expect(events.find((event) => event.type === "specification")?.specification).toMatchObject({
      goal: "Create a visible proof file",
      requirements: ["Create proof.txt."],
      acceptance: [{ id: "AC1", required: true }],
    });
    expect(events.find((event) => event.type === "plan")?.plan).toEqual([
      expect.objectContaining({ id: "T1", description: "Write proof.txt", satisfies: ["AC1"], status: "pending" }),
    ]);
    expect(events.filter((event) => event.type === "task").map((event) => event.task?.status)).toEqual([
      "active",
      "done",
    ]);
    expect(events.at(-1)?.outcome).toMatchObject({ verified: true, stopReason: "verified_success" });
    expect(existsSync(join(root, "proof.txt"))).toBe(true);

    const persisted = ExecutionJournal.load(kernel.getObjective().runDir);
    expect(persisted?.objective.plan).toEqual([
      expect.objectContaining({ id: "T1", satisfies: ["AC1"], status: "done" }),
    ]);
  });

  it("uses a supplied verification contract without spending calls on interpretation or planning", async () => {
    const root = workspace();
    const intelligence = new FakeIntelligenceProvider({
      implement: [
        {
          data: {
            summary: "Create the requested proof file.",
            files: [{ path: "proof.txt", action: "write", content: "verified\n" }],
          },
        },
      ],
    });
    const commandCalls: string[] = [];
    const deps: KernelDeps = {
      intelligence,
      runCommand: async (command, options) => {
        commandCalls.push(command);
        return {
          command,
          cwd: options.cwd,
          exitCode: 0,
          stdout: "passed",
          stderr: "",
          durationMs: 1,
          timedOut: false,
          state: "completed",
          truncated: false,
        };
      },
      writeFile: async (base, path, content) => {
        const target = join(base, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content, "utf8");
        return {
          path,
          operation: "create",
          changed: true,
          linesAdded: 1,
          linesRemoved: 0,
          bytesAfter: Buffer.byteLength(content),
        };
      },
      editFile: async () => {
        throw new Error("editFile was not expected");
      },
      deleteFile: async () => {
        throw new Error("deleteFile was not expected");
      },
      startProcess: async () => {
        throw new Error("startProcess was not expected");
      },
      stopProcess: async () => {},
      probeHttp: async (url) => ({ url, ok: true, status: 200, durationMs: 0 }),
      observePage: async (url) => ({
        url,
        ok: true,
        status: 200,
        consoleErrors: [],
        pageErrors: [],
        failedRequests: [],
        externalRequests: [],
        assertions: [],
      }),
      serveStatic: async () => {
        throw new Error("serveStatic was not expected");
      },
    };

    const kernel = new AutonomyKernel(deps, {
      workspace: root,
      request: "Create proof.txt. Do not modify tests.",
      acceptanceCriteria: [
        {
          id: "AC1",
          description: "proof.txt exists",
          required: true,
          check: { kind: "file_exists", path: "proof.txt" },
        },
        {
          id: "AC2",
          description: "visible tests pass",
          required: true,
          check: { kind: "command_succeeds", command: "bun test" },
        },
      ],
    });
    for await (const _event of kernel.run()) {
      // Drain the autonomous run.
    }

    expect(intelligence.calls.map((call) => call.role)).toEqual(["implement"]);
    expect(kernel.getObjective().plan).toEqual([
      expect.objectContaining({ id: "T1", satisfies: ["AC1", "AC2"], status: "done" }),
    ]);
    expect(commandCalls).toEqual(["bun test", "bun test"]);
    expect(kernel.getObjective().actions).toContainEqual(
      expect.objectContaining({ kind: "run_command", summary: "self-check: bun test", ok: true }),
    );
  });

  it("rejects test-file mutations when the objective protects tests", async () => {
    const root = workspace();
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "feature.test.ts"), "original\n", "utf8");
    const intelligence = new FakeIntelligenceProvider({
      implement: [
        {
          data: {
            summary: "Attempt to replace the protected test.",
            files: [{ path: "src/feature.test.ts", action: "write", content: "changed\n" }],
          },
        },
        {
          data: {
            summary: "No second mutation.",
            files: [],
          },
        },
      ],
      diagnose: [
        {
          data: {
            rootCause: "The protected test was not changed.",
            strategy: "Stop attempting to modify tests.",
            confident: true,
            summary: "No valid repair.",
            files: [],
          },
        },
      ],
    });
    const deps: KernelDeps = {
      intelligence,
      runCommand: async (command, options) => ({
        command,
        cwd: options.cwd,
        exitCode: 1,
        stdout: "",
        stderr: "failed",
        durationMs: 0,
        timedOut: false,
        state: "completed",
        truncated: false,
      }),
      writeFile: async () => {
        throw new Error("protected write reached the filesystem");
      },
      editFile: async () => {
        throw new Error("editFile was not expected");
      },
      deleteFile: async () => {
        throw new Error("deleteFile was not expected");
      },
      startProcess: async () => {
        throw new Error("startProcess was not expected");
      },
      stopProcess: async () => {},
      probeHttp: async (url) => ({ url, ok: true, status: 200, durationMs: 0 }),
      observePage: async (url) => ({
        url,
        ok: true,
        status: 200,
        consoleErrors: [],
        pageErrors: [],
        failedRequests: [],
        externalRequests: [],
        assertions: [],
      }),
      serveStatic: async () => {
        throw new Error("serveStatic was not expected");
      },
    };
    const kernel = new AutonomyKernel(deps, {
      workspace: root,
      request: "Implement the feature. Do not modify tests.",
      acceptanceCriteria: [
        {
          id: "AC1",
          description: "visible tests pass",
          required: true,
          check: { kind: "command_succeeds", command: "bun test" },
        },
      ],
      maxRepairAttempts: 1,
    });
    for await (const _event of kernel.run()) {
      // Drain the autonomous run.
    }

    expect(readFileSync(join(root, "src", "feature.test.ts"), "utf8")).toBe("original\n");
    expect(kernel.getObjective().actions).toContainEqual(
      expect.objectContaining({
        kind: "write_file",
        ok: false,
        detail: expect.stringContaining("Protected by the objective"),
      }),
    );
  });
});
