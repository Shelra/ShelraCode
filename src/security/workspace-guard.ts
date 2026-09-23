import { existsSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "path";

/**
 * Shelra's own scratch area. When the working directory is not a project (the home folder, a
 * Downloads folder), helper scripts go here instead of the user's folders, so the file tools may
 * write here from any workspace. Nothing else outside the workspace is reachable.
 */
export const SCRATCH_ROOT = join(tmpdir(), "shelra-scratch");

export interface WorkspacePathResult {
  path: string;
  relativePath: string;
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Resolves the real location a candidate path *would* occupy, even when its
 * leaf (or several of its parents) do not exist yet: walk up to the nearest
 * existing ancestor, resolve that through the filesystem, then re-append the
 * missing segments. Symlinked ancestors are therefore still followed, so the
 * containment check performed by the caller stays sound.
 */
function resolveThroughExistingAncestor(candidate: string): string {
  const missing: string[] = [];
  let current = candidate;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return candidate;
    missing.unshift(basename(current));
    current = parent;
  }
  const real = realpathSync.native(current);
  return missing.length > 0 ? join(real, ...missing) : real;
}

/** Resolves a model-facing path without allowing traversal or symlink escape. */
export function resolveWorkspacePath(filePath: string, workspaceRoot: string): WorkspacePathResult {
  const root = resolve(workspaceRoot);
  const candidate = isAbsolute(filePath) ? resolve(filePath) : resolve(root, filePath);
  const inWorkspace = isInside(root, candidate);
  if (!inWorkspace && !isInside(SCRATCH_ROOT, candidate)) {
    throw new Error(`Path is outside the workspace: ${filePath}`);
  }

  // The scratch area may not exist yet; it is created on the first write.
  const realRoot = inWorkspace ? realpathSync.native(root) : resolveThroughExistingAncestor(SCRATCH_ROOT);
  const realTarget = resolveThroughExistingAncestor(candidate);
  if (!isInside(realRoot, realTarget)) {
    throw new Error(`Path resolves outside the workspace: ${filePath}`);
  }

  return {
    path: candidate,
    relativePath: inWorkspace
      ? relative(root, candidate).replaceAll("\\", "/") || "."
      : candidate.replaceAll("\\", "/"),
  };
}
