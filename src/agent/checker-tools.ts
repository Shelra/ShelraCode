/** The independent checker inherits fewer tools and can change only its own verification files. */
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ToolCallOptions, ToolSet } from "ai";
import { resolveWorkspacePath } from "../security/workspace-guard";
import type { ToolResult } from "../types";
import { runnableVerifierCommand, verifierCommandProblem, verifierTestFile } from "./behavior-verifier";
import { checkerWriteProblem } from "./checker-files";

const CHECKER_TOOLS = ["read_file", "grep", "write_file", "edit_file", "delete_file", "bash"] as const;
const WRITES: ReadonlySet<string> = new Set(["write_file", "edit_file", "delete_file"]);

export interface CheckerToolContext {
  root: string;
  /** The working directory used by the inherited core tools, read again for every call. */
  cwd: () => string;
}

function refusal(name: string, reason: string): ToolResult {
  const output = `Checker refused ${name}: ${reason}`;
  return { success: false, output, error: output, refused: "blocked" };
}

function sameDirectory(left: string, right: string): boolean {
  const realLeft = realpathSync.native(left);
  const realRight = realpathSync.native(right);
  return process.platform === "win32" ? realLeft.toLowerCase() === realRight.toLowerCase() : realLeft === realRight;
}

/**
 * Narrow an already policy-guarded tool set; this never creates a tool or removes an inherited guard. Paths are
 * made absolute after validation so a later change to the shell's cwd cannot redirect a file operation.
 * This is a tool boundary, not an OS sandbox for the code a test executes.
 */
export function guardCheckerTools(tools: ToolSet, context: CheckerToolContext): ToolSet {
  const guarded: ToolSet = {};
  for (const name of CHECKER_TOOLS) {
    const definition = tools[name];
    if (!definition?.execute) continue;
    const execute = definition.execute as (input: unknown, options: ToolCallOptions) => unknown;
    guarded[name] = {
      ...definition,
      execute: async (input: unknown, options: ToolCallOptions) => {
        const args = (input !== null && typeof input === "object" ? input : {}) as Record<string, unknown>;
        let checkedInput: Record<string, unknown>;
        try {
          const base = context.cwd();
          if (name === "bash") {
            if (args.background === true) return refusal(name, "background execution is not allowed");
            if (typeof args.command !== "string") return refusal(name, "a test command is required");
            if (!sameDirectory(context.root, base)) return refusal(name, "run the test from the project root");
            const testFile = verifierTestFile(args.command);
            if (!testFile) return refusal(name, "run exactly one test file in .shelra/verify/");
            const commandProblem = verifierCommandProblem(args.command, testFile);
            if (commandProblem) return refusal(name, commandProblem);
            const fileProblem = checkerWriteProblem(context.root, testFile, base);
            if (fileProblem) return refusal(name, fileProblem);
            const { path } = resolveWorkspacePath(testFile, { root: context.root, base });
            if (!lstatSync(path).isFile()) return refusal(name, "the test must be an existing regular file");
            checkedInput = { ...args, command: runnableVerifierCommand(args.command, testFile) };
          } else {
            const filePath = typeof args.path === "string" ? args.path : name === "grep" ? "." : null;
            if (filePath === null) return refusal(name, "a file path is required");
            if (WRITES.has(name)) {
              const problem = checkerWriteProblem(context.root, filePath, base);
              if (problem) return refusal(name, problem);
            }
            const { path } = resolveWorkspacePath(filePath, { root: context.root, base });
            const rel = relative(resolve(context.root), path);
            // The core permits Shelra's shared scratch area; the checker receives only this project's files.
            if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
              return refusal(name, "the path is outside the project workspace");
            }
            checkedInput = { ...args, path };
          }
        } catch (error) {
          return refusal(name, error instanceof Error ? error.message : "the target could not be validated");
        }
        return execute(checkedInput, options);
      },
    } as ToolSet[string];
  }
  return guarded;
}
