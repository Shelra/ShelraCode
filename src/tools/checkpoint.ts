import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import { dirname } from "path";
import { resolveWorkspacePath } from "../security/workspace-guard";
import { getLatestCheckpoint } from "../storage/objectives";

export interface RevertResult {
  success: boolean;
  output: string;
}

/**
 * Restores a file to the content captured by its most recent checkpoint in this workspace
 * (recorded by `checkpointBeforeMutation` in `src/toolset/tools.ts`, immediately before
 * write_file/edit_file/delete_file touched it). If the file did not exist before that mutation, revert
 * deletes it instead of writing empty content — matching the checkpoint's own
 * `previousExisted` record.
 */
export function revertLatestCheckpoint(filePath: string, cwd: string, workspaceId: string): RevertResult {
  const resolved = resolveWorkspacePath(filePath, cwd);
  const checkpoint = getLatestCheckpoint(workspaceId, resolved.relativePath);
  if (!checkpoint) {
    return { success: false, output: `No checkpoint found for ${filePath}.` };
  }

  try {
    if (checkpoint.previousExisted) {
      const dir = dirname(resolved.path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(resolved.path, checkpoint.previousContent ?? "", "utf-8");
      return {
        success: true,
        output: `Reverted ${filePath} to its state before ${checkpoint.reason} at ${checkpoint.createdAt.toISOString()}.`,
      };
    }
    if (existsSync(resolved.path)) unlinkSync(resolved.path);
    return {
      success: true,
      output: `Removed ${filePath} — it did not exist before ${checkpoint.reason} at ${checkpoint.createdAt.toISOString()}.`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, output: `Failed to revert ${filePath}: ${msg}` };
  }
}
