import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { diffLines } from "diff";
import { resolveWorkspacePath } from "../security/workspace-guard";
import type { FileChange } from "./types";

function lineDelta(before: string, after: string): { linesAdded: number; linesRemoved: number } {
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const part of diffLines(before, after)) {
    const count = part.count ?? 0;
    if (part.added) linesAdded += count;
    if (part.removed) linesRemoved += count;
  }
  return { linesAdded, linesRemoved };
}

function writeSafely(path: string, content: string): void {
  const temporary = `${path}.shelra-${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, "utf8");
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) {
      try {
        unlinkSync(temporary);
      } catch {
        // Best effort cleanup. The target write already completed or failed with its original error.
      }
    }
  }
}

function change(relativePath: string, operation: FileChange["operation"], before: string, after: string): FileChange {
  const delta = lineDelta(before, after);
  return {
    path: relativePath,
    operation,
    changed: before !== after,
    ...delta,
    bytesAfter: Buffer.byteLength(after, "utf8"),
  };
}

/** Write a workspace-relative file after checking traversal and symlink containment. */
export async function applyFileWrite(workspace: string, filePath: string, content: string): Promise<FileChange> {
  const target = resolveWorkspacePath(filePath, workspace);
  if (existsSync(target.path) && statSync(target.path).isDirectory()) {
    throw new Error(`Cannot write a directory: ${filePath}`);
  }

  const before = existsSync(target.path) ? readFileSync(target.path, "utf8") : "";
  mkdirSync(dirname(target.path), { recursive: true });
  const operation: FileChange["operation"] = existsSync(target.path) ? "overwrite" : "create";
  if (before !== content) writeSafely(target.path, content);
  return change(target.relativePath, operation, before, content);
}

/** Replace exactly one occurrence. Refusing ambiguous edits prevents silent corruption. */
export async function applyFileEdit(
  workspace: string,
  filePath: string,
  oldText: string,
  newText: string,
): Promise<FileChange> {
  const target = resolveWorkspacePath(filePath, workspace);
  if (!existsSync(target.path)) throw new Error(`Cannot edit missing file: ${filePath}`);
  if (statSync(target.path).isDirectory()) throw new Error(`Cannot edit a directory: ${filePath}`);

  const before = readFileSync(target.path, "utf8");
  const occurrences = oldText === "" ? 1 : before.split(oldText).length - 1;
  if (occurrences === 0) throw new Error(`Edit text was not found in ${filePath}`);
  if (occurrences > 1)
    throw new Error(`Edit text matched ${occurrences} places in ${filePath}; refusing an ambiguous edit`);

  const after = before.replace(oldText, newText);
  if (before !== after) writeSafely(target.path, after);
  return change(target.relativePath, "edit", before, after);
}

/** Delete a workspace file. Missing files are an explicit no-op for idempotent repair plans. */
export async function deleteFile(workspace: string, filePath: string): Promise<FileChange> {
  const target = resolveWorkspacePath(filePath, workspace);
  if (!existsSync(target.path)) {
    return {
      path: target.relativePath,
      operation: "noop",
      changed: false,
      linesAdded: 0,
      linesRemoved: 0,
      bytesAfter: 0,
    };
  }
  if (statSync(target.path).isDirectory()) throw new Error(`Cannot delete a directory: ${filePath}`);

  const before = readFileSync(target.path, "utf8");
  unlinkSync(target.path);
  return change(target.relativePath, "delete", before, "");
}
