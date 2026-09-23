import { createTwoFilesPatch } from "diff";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { dirname } from "path";
import { summarizeDiagnostics, syncFileWithLsp } from "../lsp/runtime";
import type { LspDiagnosticFile } from "../lsp/types";
import { resolveWorkspacePath } from "../security/workspace-guard";
import { dominantLineEnding, normalizeLineEndings, restoreLineEndings } from "./line-endings";

export interface FileDiff {
  filePath: string;
  additions: number;
  removals: number;
  patch: string;
  isNew: boolean;
}

export interface FileResult {
  success: boolean;
  output: string;
  diff?: FileDiff;
  lspDiagnostics?: LspDiagnosticFile[];
}

function resolvePath(filePath: string, cwd: string): string {
  return resolveWorkspacePath(filePath, cwd).path;
}

function computeDiff(filePath: string, before: string, after: string): FileDiff {
  const patch = createTwoFilesPatch(filePath, filePath, before, after, "", "", {
    context: 3,
  });

  let additions = 0;
  let removals = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    if (line.startsWith("-") && !line.startsWith("---")) removals++;
  }

  return { filePath, additions, removals, patch, isNew: before === "" };
}

/**
 * Reads a file's content immediately before a write/edit would touch it, so a caller can
 * checkpoint it for revert. Kept separate from `writeFile`/`editFile` so their existing
 * signatures (and tests) stay untouched — this is purely additive.
 */
export function snapshotForCheckpoint(
  filePath: string,
  cwd: string,
): { previousExisted: boolean; previousContent: string | null; relativePath: string } {
  const resolved = resolveWorkspacePath(filePath, cwd);
  const previousExisted = existsSync(resolved.path);
  return {
    previousExisted,
    previousContent: previousExisted ? readFileSync(resolved.path, "utf-8") : null,
    relativePath: resolved.relativePath,
  };
}

/**
 * What one read returns. A model re-sends every tool result on each later step, so a whole large file
 * weighs on the rest of the turn: a free model once read four files of 50,000-200,000 characters and
 * then sent about 124,000 tokens per step until the turn ended. Without a range a read stops after
 * `READ_DEFAULT_LINES`; any read stops at `READ_MAX_CHARS`, and says where to continue.
 */
export const READ_DEFAULT_LINES = 2_000;
export const READ_MAX_CHARS = 50_000;
/** A longer line (minified code, data) is cut rather than spending the budget on one line. */
export const READ_MAX_LINE_CHARS = 2_000;

export function readFile(filePath: string, cwd: string, startLine?: number, endLine?: number): FileResult {
  try {
    const full = resolvePath(filePath, cwd);
    if (!existsSync(full)) {
      return { success: false, output: `File not found: ${filePath}` };
    }
    const content = readFileSync(full, "utf-8");
    const lines = content.split("\n");
    const totalLines = lines.length;

    const start = Math.max(0, (startLine ?? 1) - 1);
    if (start >= totalLines) {
      return { success: true, output: `[${filePath}: ${totalLines} lines; line ${start + 1} is past the end]` };
    }
    const last = Math.min(totalLines, endLine ?? start + READ_DEFAULT_LINES);
    const numbered: string[] = [];
    let chars = 0;
    let end = start;
    for (let index = start; index < last; index++) {
      const line = lines[index] ?? "";
      const text =
        line.length > READ_MAX_LINE_CHARS
          ? `${line.slice(0, READ_MAX_LINE_CHARS)}… [line cut at ${READ_MAX_LINE_CHARS} characters]`
          : line;
      const row = `${index + 1} | ${text}`;
      if (numbered.length > 0 && chars + row.length + 1 > READ_MAX_CHARS) break;
      numbered.push(row);
      chars += row.length + 1;
      end = index + 1;
    }

    const header = `[${filePath}: lines ${start + 1}-${end} of ${totalLines}]`;
    const cutShort = end < last || (endLine === undefined && end < totalLines);
    const more = cutShort
      ? `\n[${totalLines - end} more lines not shown: read on with start_line=${end + 1}, or grep for what you need]`
      : "";
    return { success: true, output: `${header}\n${numbered.join("\n")}${more}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, output: `Failed to read file: ${msg}` };
  }
}

export async function writeFile(filePath: string, content: string, cwd: string): Promise<FileResult> {
  try {
    const full = resolvePath(filePath, cwd);
    const before = existsSync(full) ? readFileSync(full, "utf-8") : "";
    const dir = dirname(full);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(full, content, "utf-8");

    const diff = computeDiff(filePath, before, content);
    const verb = before === "" ? "Created" : "Updated";
    const lspDiagnostics = await syncFileWithLsp(cwd, full, content, true, true).catch(() => [] as LspDiagnosticFile[]);
    const lspSummary = summarizeDiagnostics(lspDiagnostics);
    return {
      success: true,
      output: `${verb} ${filePath} (+${diff.additions} -${diff.removals})${lspSummary ? `\n${lspSummary}` : ""}`,
      diff,
      lspDiagnostics,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, output: `Failed to write file: ${msg}` };
  }
}

export async function editFile(
  filePath: string,
  oldString: string,
  newString: string,
  cwd: string,
): Promise<FileResult> {
  try {
    const full = resolvePath(filePath, cwd);
    if (!existsSync(full)) {
      return { success: false, output: `File not found: ${filePath}` };
    }
    const before = readFileSync(full, "utf-8");
    let count = before.split(oldString).length - 1;
    // A CRLF checkout and an LF snippet from the model are the common case on Windows: match on
    // normalized text and write the file's own endings back.
    const ending = dominantLineEnding(before);
    const normalizedBefore = normalizeLineEndings(before);
    const normalizedOld = normalizeLineEndings(oldString);
    const useNormalized = count === 0 && normalizedBefore !== before;
    if (useNormalized) count = normalizedBefore.split(normalizedOld).length - 1;

    if (count === 0) {
      return { success: false, output: `old_string not found in ${filePath}` };
    }
    if (count > 1) {
      return {
        success: false,
        output: `old_string is not unique in ${filePath} (${count} occurrences). Include more surrounding context to make it unique.`,
      };
    }

    // Function replacers: a literal replacement must never expand `$&`-style patterns.
    const after = useNormalized
      ? restoreLineEndings(
          normalizedBefore.replace(normalizedOld, () => normalizeLineEndings(newString)),
          ending,
        )
      : before.replace(oldString, () => newString);
    writeFileSync(full, after, "utf-8");

    const diff = computeDiff(filePath, before, after);
    const lspDiagnostics = await syncFileWithLsp(cwd, full, after, true, true).catch(() => [] as LspDiagnosticFile[]);
    const lspSummary = summarizeDiagnostics(lspDiagnostics);
    return {
      success: true,
      output: `Edited ${filePath} (+${diff.additions} -${diff.removals})${lspSummary ? `\n${lspSummary}` : ""}`,
      diff,
      lspDiagnostics,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, output: `Failed to edit file: ${msg}` };
  }
}

export async function deleteFile(filePath: string, cwd: string): Promise<FileResult> {
  try {
    const full = resolvePath(filePath, cwd);
    if (!existsSync(full)) {
      return { success: false, output: `File not found: ${filePath}` };
    }
    if (statSync(full).isDirectory()) {
      return { success: false, output: `Cannot delete a directory: ${filePath}` };
    }
    const before = readFileSync(full, "utf-8");
    unlinkSync(full);

    const diff = computeDiff(filePath, before, "");
    return {
      success: true,
      output: `Deleted ${filePath} (-${diff.removals} lines)`,
      diff,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, output: `Failed to delete file: ${msg}` };
  }
}
