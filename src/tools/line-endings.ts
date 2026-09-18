/**
 * Line-ending helpers for the file tools.
 *
 * Repositories checked out on Windows carry CRLF; a model's `old_string` almost always carries LF.
 * Seen live 2026-09-17: five `edit_file` rejections in one benchmark task ("old_string not
 * found"), after which the model fell back to full-file rewrites. Matching is done on normalized
 * text and the file's own ending is written back.
 */

export type LineEnding = "\n" | "\r\n";

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/gu, "\n");
}

/** The ending most lines of the text use; LF when the text has no line breaks. */
export function dominantLineEnding(text: string): LineEnding {
  const crlf = (text.match(/\r\n/gu) ?? []).length;
  const lf = (text.match(/\n/gu) ?? []).length - crlf;
  return crlf > lf ? "\r\n" : "\n";
}

/** Re-applies `ending` to every line break of LF-normalized text. */
export function restoreLineEndings(text: string, ending: LineEnding): string {
  return ending === "\n" ? text : normalizeLineEndings(text).replace(/\n/gu, ending);
}
