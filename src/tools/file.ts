import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname } from "path";
import { summarizeDiagnostics, syncFileWithLsp } from "../lsp/runtime";
import type { LspDiagnosticFile } from "../lsp/types";
import { resolveWorkspacePath, viewRoot, type WorkspaceView } from "../security/workspace-guard";
import { boundedPatch } from "./bounded-diff";
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

function resolvePath(filePath: string, cwd: WorkspaceView): string {
  return resolveWorkspacePath(filePath, cwd).path;
}

const BOM = String.fromCharCode(0xfeff);

/**
 * Writes a file so a crash or a kill halfway leaves the old content, not a truncated file: the text goes to a
 * sibling temporary file that then replaces the target. Where the replacement is refused (another program holds the
 * file open, which Windows enforces), the text is written in place as before.
 */
function writeFileAtomically(path: string, text: string): void {
  const temporary = `${path}.shelra-${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, text, "utf-8");
    try {
      renameSync(temporary, path);
      return;
    } catch {
      writeFileSync(path, text, "utf-8");
    }
  } finally {
    if (existsSync(temporary)) {
      try {
        unlinkSync(temporary);
      } catch {
        // Best effort: the target is already written.
      }
    }
  }
}

/** Names Windows reserves for devices: writing to one succeeds without creating a file. */
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

/**
 * What the file keeps when the model rewrites it whole: its own line endings and byte-order mark. A model sends LF
 * text, so a rewrite of a CRLF file turned every line into a change (and, in a repo that checks line endings,
 * every line into a diff); the mark was dropped the same way.
 */
function keepFileConventions(before: string, content: string): string {
  if (before === "") return content;
  let kept = content;
  if (dominantLineEnding(before) === "\r\n" && !kept.includes("\r\n")) kept = restoreLineEndings(kept, "\r\n");
  if (before.startsWith(BOM) && !kept.startsWith(BOM)) kept = `${BOM}${kept}`;
  return kept;
}

/** The largest file `read_file` loads whole; a bigger one is read with grep or a shell command instead. */
const READ_MAX_BYTES = 25 * 1024 * 1024;

/**
 * The text to write: a PowerShell script, module or data file with non-ASCII text gets a UTF-8 byte-order mark.
 * Windows PowerShell 5.1 reads a file without one as the ANSI code page, so `é` or `✓` in a model-written `.ps1`
 * became mojibake or a parse error (five failed `bash` calls on one such script in the 2026-10-03 runs); with the
 * mark both 5.1 and PowerShell 7 read it as UTF-8. Every other file is written as given.
 */
export function withPowerShellEncoding(filePath: string, content: string): string {
  if (!/\.ps[dm]?1$/iu.test(filePath) || content.startsWith(BOM)) return content;
  return /[\u0080-\u{10FFFF}]/u.test(content) ? `${BOM}${content}` : content;
}

function computeDiff(filePath: string, before: string, after: string): FileDiff {
  const { additions, removals, patch } = boundedPatch(filePath, before, after);
  return { filePath, additions, removals, patch, isNew: before === "" };
}

/**
 * Reads a file's content immediately before a write/edit would touch it, so a caller can
 * checkpoint it for revert. Kept separate from `writeFile`/`editFile` so their existing
 * signatures (and tests) stay untouched — this is purely additive.
 */
export function snapshotForCheckpoint(
  filePath: string,
  cwd: WorkspaceView,
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

export function readFile(filePath: string, cwd: WorkspaceView, startLine?: number, endLine?: number): FileResult {
  try {
    const full = resolvePath(filePath, cwd);
    if (!existsSync(full)) {
      return { success: false, output: `File not found: ${filePath}` };
    }
    const info = statSync(full);
    if (info.isDirectory()) {
      return {
        success: false,
        output: `${filePath} is a folder, not a file. List it with bash (ls or Get-ChildItem).`,
      };
    }
    if (info.size > READ_MAX_BYTES) {
      return {
        success: false,
        output: `${filePath} is ${Math.round(info.size / 1_048_576)} MB, too large to read whole. Search it with grep or read part of it with bash (Select-String, head, tail).`,
      };
    }
    const content = readFileSync(full, "utf-8");
    // A CRLF file would show a stray \r at the end of every line, and a byte-order mark would sit on line 1.
    const lines = (content.startsWith(BOM) ? content.slice(BOM.length) : content)
      .split("\n")
      .map((line) => line.replace(/\r$/u, ""));
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

export async function writeFile(filePath: string, rawContent: string, cwd: WorkspaceView): Promise<FileResult> {
  try {
    const full = resolvePath(filePath, cwd);
    if (process.platform === "win32" && WINDOWS_DEVICE_NAME.test(basename(full))) {
      return {
        success: false,
        output: `${basename(full)} is a reserved Windows device name: writing to it creates no file. Pick another name.`,
      };
    }
    const before = existsSync(full) ? readFileSync(full, "utf-8") : "";
    const content = keepFileConventions(before, rawContent);
    const dir = dirname(full);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const written = withPowerShellEncoding(full, content);
    writeFileAtomically(full, written);

    // The byte-order mark is not part of the change the model asked for.
    const unmarked = before.startsWith(BOM) ? before.slice(BOM.length) : before;
    const diff = computeDiff(filePath, unmarked, content.startsWith(BOM) ? content.slice(BOM.length) : content);
    const verb = before === "" ? "Created" : "Updated";
    const lspDiagnostics = await syncFileWithLsp(viewRoot(cwd), full, content, true, true).catch(
      () => [] as LspDiagnosticFile[],
    );
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

/** Where `needle` occurs in `text` when any run of whitespace may be any other run (at least one character). */
function whitespaceTolerantMatch(text: string, needle: string): Array<{ start: number; end: number }> {
  const trimmed = needle.trim();
  if (trimmed.length < 8) return [];
  const pattern = trimmed
    .split(/\s+/u)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("\\s+");
  const matches: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(new RegExp(pattern, "gu"))) {
    matches.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
    if (matches.length > 3) break;
  }
  return matches;
}

/**
 * `newString` fitted to the whitespace of the text it replaces, when the model's quote matched only with its
 * whitespace ignored. The file keeps its own indentation before the match and its own whitespace after it, so the
 * replacement is trimmed at both ends. Each later line that repeats a line of the quote takes the indentation the file
 * has on that line (lines are paired by content, since a model can flatten every level to one space); a line the
 * replacement adds takes the indentation of the line before it, one level deeper or shallower when the model's own
 * indentation says so. Seen live 2026-09-25: the model quoted a 4-space block with every line at 1 space, its
 * replacement was spliced in untrimmed, the block's indentation doubled and a blank line appeared, the next exact
 * edit undid it, and four files flipped back and forth for two hours.
 */
function fitToMatch(oldString: string, newString: string, matched: string, ending: "\r\n" | "\n"): string {
  const indentOf = (line: string) => /^[ \t]*/u.exec(line)?.[0] ?? "";
  const quote = oldString.trim().split(/\r?\n/u);
  const file = matched.split(/\r?\n/u);
  const lines = newString.trim().split(/\r?\n/u);
  // The file's indentation for each line of the quote, when the quote and the matched text have the same lines.
  const fileIndent =
    quote.length === file.length ? file.map((line, index) => (index === 0 ? "" : indentOf(line))) : null;
  // One indentation step of the file: its smallest positive difference between lines, else four spaces.
  const widths = file.map((line) => indentOf(line)).filter((indent) => indent.length > 0);
  const tab = widths.some((indent) => indent.includes("\t"));
  const step = tab ? "\t" : " ".repeat(Math.min(...widths.map((indent) => indent.length), 4) || 4);
  // Pair the replacement's lines with the quote's by content (longest common subsequence of trimmed lines).
  const a = quote.map((line) => line.trim());
  const b = lines.map((line) => line.trim());
  const paired = new Array<number>(b.length).fill(-1);
  if (fileIndent && a.length * b.length <= 250_000) {
    const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
      }
    }
    for (let i = 0, j = 0; i < a.length && j < b.length; ) {
      if (a[i] === b[j]) {
        paired[j] = i;
        i += 1;
        j += 1;
      } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i += 1;
      else j += 1;
    }
  }
  const out: string[] = [];
  let previous = "";
  lines.forEach((line, index) => {
    const text = line.trim();
    if (index === 0 || !text) {
      out.push(text);
      previous = index === 0 ? (fileIndent?.[0] ?? "") : previous;
      return;
    }
    const pairedAt = paired[index] ?? -1;
    let indent: string;
    if (fileIndent && pairedAt >= 0) indent = fileIndent[pairedAt] ?? "";
    else {
      // An added line: as deep as the line before it, one step deeper or shallower when the model indents it so.
      const own = indentOf(line).length - indentOf(lines[index - 1] ?? "").length;
      indent =
        own > 0
          ? `${previous}${step}`
          : own < 0 && previous.endsWith(step)
            ? previous.slice(0, -step.length)
            : previous;
    }
    out.push(`${indent}${text}`);
    previous = indent;
  });
  return out.join(ending);
}

/** The lines of `text` that share the most words with `needle`'s first lines, clipped, for a retry that fixes a quote. */
function closestLines(text: string, needle: string): { line: number; text: string } | null {
  const words = (value: string) => new Set(value.split(/[^A-Za-z0-9_$]+/u).filter((word) => word.length > 2));
  const target = words(needle.split(/\r?\n/u).slice(0, 3).join(" "));
  if (target.size === 0) return null;
  const lines = text.split(/\r?\n/u);
  let best = { index: -1, score: 0 };
  lines.forEach((line, index) => {
    const own = words(line);
    let score = 0;
    for (const word of target) if (own.has(word)) score += 1;
    if (score > best.score) best = { index, score };
  });
  if (best.index < 0 || best.score < Math.min(3, target.size)) return null;
  const clip = (line: string) => (line.length > 400 ? `${line.slice(0, 400)}…` : line);
  const excerpt = lines
    .slice(best.index, best.index + 3)
    .map(clip)
    .join("\n");
  return { line: best.index + 1, text: excerpt };
}

export async function editFile(
  filePath: string,
  oldString: string,
  newString: string,
  cwd: WorkspaceView,
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
      // A model quoting from memory gets the spacing of a long line or an indentation slightly wrong (seen live
      // 2026-09-25: two misses in one minute on a one-line HTML file, each costing a full re-read). A unique match that
      // differs only in whitespace is applied; otherwise the closest lines are shown, so one retry can fix the quote.
      const loose = whitespaceTolerantMatch(before, oldString);
      if (loose.length === 1 && loose[0]) {
        const { start, end } = loose[0];
        const fitted = fitToMatch(oldString, newString, before.slice(start, end), ending);
        const after = `${before.slice(0, start)}${fitted}${before.slice(end)}`;
        if (after === before) {
          // Seen live 2026-09-25: edits that only re-indented a method were reported "Edited (+0 -0)" three times while
          // the build kept failing on a brace; the model took them for changes.
          return {
            success: false,
            output: `No change to ${filePath}: new_string differs from the matched text only in whitespace, and the file keeps its own. If the code is wrong, change what it says, not its spacing: read the failure again.`,
          };
        }
        writeFileAtomically(full, withPowerShellEncoding(full, after));
        const diff = computeDiff(filePath, before, after);
        const lspDiagnostics = await syncFileWithLsp(viewRoot(cwd), full, after, true, true).catch(
          () => [] as LspDiagnosticFile[],
        );
        const lspSummary = summarizeDiagnostics(lspDiagnostics);
        return {
          success: true,
          output: `Edited ${filePath} (+${diff.additions} -${diff.removals}; old_string matched with different whitespace)${lspSummary ? `\n${lspSummary}` : ""}`,
          diff,
          lspDiagnostics,
        };
      }
      if (loose.length > 1) {
        return {
          success: false,
          output: `old_string not found exactly in ${filePath}, and it matches ${loose.length} places when whitespace is ignored. Include more surrounding context.`,
        };
      }
      const closest = closestLines(before, oldString);
      return {
        success: false,
        output: `old_string not found in ${filePath}.${closest ? ` The closest text is at line ${closest.line}:\n${closest.text}\nCopy the text to replace exactly from there (or read_file those lines) and retry.` : ""}`,
      };
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
      : // A replacement the model wrote with LF lines goes into a CRLF file with CRLF lines, not as a mixed ending.
        before.replace(oldString, () => (ending === "\r\n" ? restoreLineEndings(newString, "\r\n") : newString));
    if (after === before) {
      return { success: false, output: `No change to ${filePath}: new_string is the same as old_string.` };
    }
    writeFileAtomically(full, withPowerShellEncoding(full, after));

    const diff = computeDiff(filePath, before, after);
    const lspDiagnostics = await syncFileWithLsp(viewRoot(cwd), full, after, true, true).catch(
      () => [] as LspDiagnosticFile[],
    );
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

export async function deleteFile(filePath: string, cwd: WorkspaceView): Promise<FileResult> {
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
