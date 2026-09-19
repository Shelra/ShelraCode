import type { FileDiff } from "../types/index";
import type { Theme } from "./theme";

type DiffRow =
  | { kind: "context"; oldNum: number; newNum: number; text: string }
  | { kind: "added"; newNum: number; text: string }
  | { kind: "removed"; oldNum: number; text: string }
  | { kind: "separator"; count: number };

const DEFAULT_MAX_DIFF_ROWS = 20;
const LINE_NUM_WIDTH = 4;

export function parsePatch(patch: string): DiffRow[] {
  const lines = patch.split("\n");
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let prevOldEnd = 0;

  for (const line of lines) {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      const skipped = oldLine - prevOldEnd - 1;
      if (skipped > 0) {
        rows.push({ kind: "separator", count: skipped });
      }
      continue;
    }

    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("\\")) continue;
    if (line.startsWith("Index:") || line.startsWith("====")) continue;

    if (line.startsWith("-")) {
      rows.push({ kind: "removed", oldNum: oldLine, text: line.slice(1) });
      oldLine++;
      prevOldEnd = oldLine - 1;
    } else if (line.startsWith("+")) {
      rows.push({ kind: "added", newNum: newLine, text: line.slice(1) });
      newLine++;
    } else if (line.length > 0 || (oldLine > 0 && newLine > 0)) {
      const content = line.startsWith(" ") ? line.slice(1) : line;
      rows.push({ kind: "context", oldNum: oldLine, newNum: newLine, text: content });
      oldLine++;
      newLine++;
      prevOldEnd = oldLine - 1;
    }
  }

  return rows;
}

export interface DiffViewProps {
  t: Theme;
  diff: FileDiff;
  /** Rows shown before "+N more lines". */
  maxRows?: number;
  /** The caller already names the file and its +/- counts (e.g. an activity row above). */
  showHeader?: boolean;
  /** Left padding in cells, so the diff aligns under its parent row. */
  indent?: number;
}

/** Unified diff with gutters. Colour marks the change; the +/- counts and line numbers carry it too. */
export function DiffView({ t, diff, maxRows = DEFAULT_MAX_DIFF_ROWS, showHeader = true, indent = 5 }: DiffViewProps) {
  const rows = parsePatch(diff.patch);
  if (rows.length === 0) return null;

  const truncated = rows.length > maxRows;
  const visible = truncated ? rows.slice(0, maxRows) : rows;

  const pad = (n: number | undefined) =>
    n !== undefined ? String(n).padStart(LINE_NUM_WIDTH) : " ".repeat(LINE_NUM_WIDTH);

  return (
    <box paddingLeft={indent} marginTop={0} flexShrink={0}>
      <box flexDirection="column">
        {showHeader ? (
          <box backgroundColor={t.diffHeader} paddingLeft={1} paddingRight={1}>
            <text>
              <span style={{ fg: t.diffHeaderFg }}>{diff.filePath}</span>
              <span style={{ fg: t.textDim }}>{"  "}</span>
              <span style={{ fg: t.diffRemovedFg }}>{`-${diff.removals}`}</span>
              <span style={{ fg: t.textDim }}> </span>
              <span style={{ fg: t.diffAddedFg }}>{`+${diff.additions}`}</span>
            </text>
          </box>
        ) : null}

        {visible.map((row, i) => {
          if (row.kind === "separator") {
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: separator rows lack unique identifiers
              <box key={`sep-${i}`} backgroundColor={t.diffSeparator} paddingLeft={1}>
                <text fg={t.diffSeparatorFg}>{`⋯  ${row.count} unchanged lines`}</text>
              </box>
            );
          }
          if (row.kind === "removed") {
            return (
              <box key={`rm-${row.oldNum}`} backgroundColor={t.diffRemoved} flexDirection="row">
                <text fg={t.diffRemovedLineNum}>{pad(row.oldNum)}</text>
                <text fg={t.diffRemovedFg}>{` - ${row.text}`}</text>
              </box>
            );
          }
          if (row.kind === "added") {
            return (
              <box key={`add-${row.newNum}`} backgroundColor={t.diffAdded} flexDirection="row">
                <text fg={t.diffAddedLineNum}>{pad(row.newNum)}</text>
                <text fg={t.diffAddedFg}>{` + ${row.text}`}</text>
              </box>
            );
          }
          return (
            <box key={`ctx-${row.oldNum}`} backgroundColor={t.diffContext} flexDirection="row">
              <text fg={t.diffLineNumber}>{pad(row.oldNum)}</text>
              <text fg={t.diffContextFg}>{`   ${row.text}`}</text>
            </box>
          );
        })}

        {truncated ? (
          <box backgroundColor={t.diffSeparator} paddingLeft={1}>
            <text fg={t.diffSeparatorFg}>{`⋯  ${rows.length - maxRows} more lines`}</text>
          </box>
        ) : null}
      </box>
    </box>
  );
}
