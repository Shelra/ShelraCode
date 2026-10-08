import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ToolCallOptions, type ToolSet, tool } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { SCRATCH_ROOT } from "../security/workspace-guard";
import type { ToolResult } from "../types";
import { guardCheckerTools } from "./checker-tools";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function directory(): string {
  const dir = mkdtempSync(join(tmpdir(), "shelra-checker-tools-"));
  dirs.push(dir);
  return dir;
}

function harness() {
  const root = directory();
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, ".shelra", "verify"), { recursive: true });
  writeFileSync(join(root, "src", "app.ts"), "original");
  writeFileSync(join(root, ".shelra", "verify", "behavior.test.ts"), "test source");
  const calls: { name: string; input: unknown }[] = [];
  const fake = (name: string, inputSchema: z.ZodType) =>
    tool({
      description: name,
      inputSchema,
      execute: async (input) => {
        // A scripted tool must accept precisely the schema that the provider receives, including host rewrites.
        inputSchema.parse(input);
        calls.push({ name, input });
        return { success: true, output: "executed" } satisfies ToolResult;
      },
    });
  const tools: ToolSet = {
    read_file: fake("read_file", z.object({ path: z.string(), start_line: z.number().optional() })),
    grep: fake("grep", z.object({ pattern: z.string(), path: z.string().optional(), include: z.string().optional() })),
    write_file: fake("write_file", z.object({ path: z.string(), content: z.string() })),
    edit_file: fake("edit_file", z.object({ path: z.string(), old_string: z.string(), new_string: z.string() })),
    delete_file: fake("delete_file", z.object({ path: z.string() })),
    bash: fake(
      "bash",
      z.object({ command: z.string(), background: z.boolean().optional(), timeout: z.number().optional() }),
    ),
    mcp_remote__apply: fake("mcp_remote__apply", z.object({})),
    paid_request: fake("paid_request", z.object({})),
    desktop_click: fake("desktop_click", z.object({})),
    memory_write: fake("memory_write", z.object({})),
    task: fake("task", z.object({})),
    restore_file: fake("restore_file", z.object({})),
    extension_write: fake("extension_write", z.object({})),
    process_stop: fake("process_stop", z.object({})),
    process_list: fake("process_list", z.object({})),
    search_web: fake("search_web", z.object({})),
  };
  let cwd = root;
  const guarded = guardCheckerTools(tools, { root, cwd: () => cwd });
  return {
    root,
    tools,
    guarded,
    calls,
    setCwd: (next: string) => {
      cwd = next;
    },
  };
}

async function call(tools: ToolSet, name: string, input: unknown): Promise<ToolResult> {
  const definition = tools[name];
  const schema = definition.inputSchema as z.ZodType;
  // Model calls are schema-validated, just like the SDK; unsafe but valid calls must be stopped by the host.
  const parsed = schema.parse(input);
  const execute = definition.execute as (args: unknown, options: ToolCallOptions) => Promise<ToolResult>;
  return execute(parsed, { toolCallId: "checker-test", messages: [] });
}

function writeInput(name: string, path: string): Record<string, string> {
  if (name === "write_file") return { path, content: "changed" };
  if (name === "edit_file") return { path, old_string: "original", new_string: "changed" };
  return { path };
}

describe("the independent checker's host tool boundary", () => {
  it("exposes only inherited core tools, retaining their schemas", () => {
    const { guarded, tools } = harness();
    expect(Object.keys(guarded)).toEqual(["read_file", "grep", "write_file", "edit_file", "delete_file", "bash"]);
    for (const [name, definition] of Object.entries(guarded))
      expect(definition.inputSchema).toBe(tools[name].inputSchema);
  });

  it("cannot add removed tools or bypass an inherited denial", async () => {
    const { root, tools, calls } = harness();
    delete tools.write_file;
    const denied = tool({
      description: "denied",
      inputSchema: z.object({ path: z.string() }),
      execute: async () => ({ success: false, output: "inherited policy refused" }),
    });
    tools.delete_file = denied;
    const guarded = guardCheckerTools(tools, { root, cwd: () => root });
    expect(guarded.write_file).toBeUndefined();
    expect(await call(guarded, "delete_file", { path: ".shelra/verify/behavior.test.ts" })).toEqual({
      success: false,
      output: "inherited policy refused",
    });
    expect(calls).toHaveLength(0);
  });

  it("reads and searches contained paths against the actual cwd, preserving arguments", async () => {
    const { root, guarded, calls, setCwd } = harness();
    setCwd(join(root, "src"));
    expect((await call(guarded, "read_file", { path: "app.ts", start_line: 3 })).success).toBe(true);
    expect((await call(guarded, "grep", { pattern: "original", include: "*.ts" })).success).toBe(true);
    expect(calls).toEqual([
      { name: "read_file", input: { path: join(root, "src", "app.ts"), start_line: 3 } },
      { name: "grep", input: { pattern: "original", path: join(root, "src"), include: "*.ts" } },
    ]);
  });

  it("refuses reading or searching outside the workspace, including shared scratch", async () => {
    const { guarded, calls } = harness();
    for (const path of [join(directory(), "secret.txt"), join(SCRATCH_ROOT, "secret.txt"), "../secret.txt"]) {
      for (const name of ["read_file", "grep"]) {
        const input = name === "grep" ? { pattern: "secret", path } : { path };
        expect((await call(guarded, name, input)).success).toBe(false);
      }
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses writes, edits and deletes of source, config, directories and traversals before execution", async () => {
    const { root, guarded, calls } = harness();
    for (const name of ["write_file", "edit_file", "delete_file"]) {
      for (const path of [
        "src/app.ts",
        "package.json",
        ".shelra/trust.json",
        ".shelra/verify",
        ".shelra/verify/../../src/app.ts",
        "../outside.ts",
      ]) {
        const result = await call(guarded, name, writeInput(name, path));
        expect(result.success, `${name} ${path}`).toBe(false);
        expect(result.error).toContain("Checker refused");
      }
    }
    expect(calls).toHaveLength(0);
    expect(readFileSync(join(root, "src", "app.ts"), "utf8")).toBe("original");
  });

  it("allows only regular verification files, including creation under missing contained parents", async () => {
    const { root, guarded, calls } = harness();
    for (const name of ["write_file", "edit_file", "delete_file"]) {
      const path = name === "write_file" ? ".shelra/verify/helpers/new.ts" : ".shelra/verify/behavior.test.ts";
      expect((await call(guarded, name, writeInput(name, path))).success).toBe(true);
    }
    expect(calls.map(({ input }) => (input as { path: string }).path)).toEqual([
      join(root, ".shelra", "verify", "helpers", "new.ts"),
      join(root, ".shelra", "verify", "behavior.test.ts"),
      join(root, ".shelra", "verify", "behavior.test.ts"),
    ]);
  });

  it.each([
    ".shelra",
    ".shelra/verify",
    ".shelra/verify/linked",
  ])("refuses a linked verification ancestor %s", async (segment) => {
    const { root, guarded, calls } = harness();
    const target = directory();
    const link = join(root, segment);
    rmSync(link, { recursive: true, force: true });
    if (segment !== ".shelra") mkdirSync(join(root, ".shelra"), { recursive: true });
    if (segment === ".shelra/verify/linked") mkdirSync(join(root, ".shelra", "verify"), { recursive: true });
    symlinkSync(target, link, "junction");
    for (const name of ["write_file", "edit_file", "delete_file"]) {
      expect((await call(guarded, name, writeInput(name, `${segment}/escape.ts`))).success).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses a junction to another folder inside the workspace as well as a read escape", async () => {
    const { root, guarded, calls } = harness();
    symlinkSync(join(root, "src"), join(root, ".shelra", "verify", "alias"), "junction");
    expect(
      (await call(guarded, "write_file", { path: ".shelra/verify/alias/app.ts", content: "changed" })).success,
    ).toBe(false);
    const outside = directory();
    symlinkSync(outside, join(root, "escape"), "junction");
    expect((await call(guarded, "read_file", { path: "escape/secret.txt" })).success).toBe(false);
    expect((await call(guarded, "grep", { pattern: "secret", path: "escape" })).success).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("runs only an existing test, using canonical runner commands that cannot auto-install", async () => {
    const { guarded, calls } = harness();
    for (const command of [
      "bun test .shelra/verify/behavior.test.ts",
      "npx vitest run .shelra/verify/behavior.test.ts",
      "bunx jest .shelra/verify/behavior.test.ts",
    ]) {
      expect((await call(guarded, "bash", { command, timeout: 1234 })).success).toBe(true);
    }
    expect(calls.map(({ input }) => input)).toEqual([
      { command: "bun test ./.shelra/verify/behavior.test.ts", timeout: 1234 },
      { command: "npx --no-install vitest run .shelra/verify/behavior.test.ts", timeout: 1234 },
      { command: "bunx --no-install jest .shelra/verify/behavior.test.ts", timeout: 1234 },
    ]);
  });

  it("refuses general shell, installs, chains and flags that can replace or skip the oracle", async () => {
    const { guarded, calls } = harness();
    for (const command of [
      "rg app src",
      "bun install",
      "npm install vitest",
      "bun run src/app.ts",
      "bun test .shelra/verify/behavior.test.ts && echo done",
      "node --test --import=evil .shelra/verify/behavior.test.ts",
      "bun test .shelra/verify/behavior.test.ts --test-name-pattern=skip",
      "npx vitest run .shelra/verify/behavior.test.ts --update",
      "npx vitest run .shelra/verify/behavior.test.ts --passWithNoTests",
      "bun test .shelra/verify/missing.test.ts",
      "bun test src/app.ts",
      "bun test .shelra/verify",
      "bun test .shelra/verify/behavior.test.ts .shelra/verify/other.test.ts",
    ]) {
      expect((await call(guarded, "bash", { command })).success, command).toBe(false);
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses background tests, non-root cwd and a test replaced with a directory", async () => {
    const { root, guarded, calls, setCwd } = harness();
    const command = "bun test .shelra/verify/behavior.test.ts";
    expect((await call(guarded, "bash", { command, background: true })).success).toBe(false);
    setCwd(join(root, "src"));
    expect((await call(guarded, "bash", { command })).success).toBe(false);
    setCwd(root);
    rmSync(join(root, ".shelra", "verify", "behavior.test.ts"));
    mkdirSync(join(root, ".shelra", "verify", "behavior.test.ts"));
    expect((await call(guarded, "bash", { command })).success).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
