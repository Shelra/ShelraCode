import { useTerminalDimensions } from "@opentui/react";
import { useMemo } from "react";
import type { FileDiff } from "../types/index";
import { shortenPath, truncateText } from "./activity";
import { changeSummaryParts, cutDiff, type DiffLine, layoutDiff, parsePatch, type SummaryPart } from "./diff-lines";
import { GLYPH } from "./glyphs";
import { codeColor } from "./markdown";
import type { Theme } from "./theme";

const DEFAULT_MAX_DIFF_LINES = 20;

export interface DiffViewProps {
  t: Theme;
  diff: FileDiff;
  /** Rows shown before "… +N lines". */
  maxRows?: number;
  /** The caller already names the file and what changed (the log's `Update(path)` block). */
  showHeader?: boolean;
  /** Left padding in cells, so the diff aligns under its parent row. */
  indent?: number;
  /** Cells the diff may take, gutter included; the terminal's width when not given. */
  width?: number;
}

function bandColor(t: Theme, kind: DiffLine["kind"]): string {
  if (kind === "added") return t.diffAdded;
  if (kind === "removed") return t.diffRemoved;
  return t.diffContext;
}

/**
 * A unified diff the way a reviewer reads one: every removed line on a red band and every added line
 * on a green band, with its line number and its `-` or `+`, the code highlighted like a code block.
 * A long line wraps inside its band instead of being cut. Colour marks the change; the marker and the
 * number carry it as well, for a screen without colour.
 */
export function DiffView({
  t,
  diff,
  maxRows = DEFAULT_MAX_DIFF_LINES,
  showHeader = true,
  indent = 5,
  width,
}: DiffViewProps) {
  const terminal = useTerminalDimensions();
  const room = Math.max(24, (width ?? terminal.width - 8) - indent);
  // The log redraws on every streamed token; a diff is parsed, highlighted and wrapped once per width.
  const { lines, numberWidth } = useMemo(
    () => layoutDiff(parsePatch(diff.patch), { width: room, path: diff.filePath }),
    [diff.patch, diff.filePath, room],
  );
  if (lines.length === 0) return null;

  const { visible, hiddenLines: hidden } = cutDiff(lines, maxRows);
  const gutter = " ".repeat(numberWidth);

  return (
    <box paddingLeft={indent} flexShrink={0} flexDirection="column">
      {showHeader ? (
        <box backgroundColor={t.diffHeader} paddingLeft={1} paddingRight={1} flexShrink={0}>
          <text wrapMode="none">
            <span style={{ fg: t.diffHeaderFg }}>{diff.filePath}</span>
            <span style={{ fg: t.textDim }}>{"  "}</span>
            <span style={{ fg: t.diffRemovedFg }}>{`−${diff.removals}`}</span>
            <span style={{ fg: t.textDim }}> </span>
            <span style={{ fg: t.diffAddedFg }}>{`+${diff.additions}`}</span>
          </text>
        </box>
      ) : null}

      {visible.map((line, index) => {
        if (line.kind === "separator") {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and may repeat
            <text key={index} fg={t.diffSeparatorFg} wrapMode="none">
              {`${gutter}  …`}
            </text>
          );
        }
        const changed = line.kind !== "context";
        const numberColor =
          line.kind === "added"
            ? t.diffAddedLineNum
            : line.kind === "removed"
              ? t.diffRemovedLineNum
              : t.diffLineNumber;
        const marker = line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " ";
        const number = line.number === null ? gutter : String(line.number).padStart(numberWidth);
        // A context line's continuation starts in the marker column; a changed line repeats its marker.
        const lead = line.number === null && !changed ? "" : marker;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and may repeat
          <box key={index} backgroundColor={bandColor(t, line.kind)} flexShrink={0} width="100%">
            <text wrapMode="none">
              <span style={{ fg: numberColor }}>{`${number} `}</span>
              {lead ? <span style={{ fg: numberColor }}>{lead}</span> : null}
              {line.tokens.map((token, tokenIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional
                <span key={tokenIndex} style={{ fg: codeColor(t, token.kind) }}>
                  {token.text}
                </span>
              ))}
            </text>
          </box>
        );
      })}

      {hidden > 0 ? (
        <text fg={t.textDim} wrapMode="none">{`${gutter}  … +${hidden} lines (ctrl+o to expand)`}</text>
      ) : null}
    </box>
  );
}

export interface FileChangeBlockProps {
  t: Theme;
  /** What the tool did to the file: `Update`, `Write`, `Delete`. */
  action: string;
  path: string;
  diff?: FileDiff;
  /** The error a failed change returned; the block then says it instead of the diff. */
  error?: string;
  /** Cells for the whole block. */
  width: number;
  /** Detail mode shows every row of the diff. */
  detailed: boolean;
  /** A blank line above: the block follows another row of its group. */
  spaced?: boolean;
}

/**
 * A file change in the log, readable at a glance: `● Update(src/auth.ts)`, what it did in words
 * (`Added 1 line, removed 1 line`), then the diff itself. Nothing about an edit is hidden behind a
 * key: the removed lines are there in red and the added ones in green.
 */
export function FileChangeBlock({ t, action, path, diff, error, width, detailed, spaced }: FileChangeBlockProps) {
  const failed = error !== undefined;
  const parts = diff && !failed ? changeSummaryParts(diff) : [];
  const partColor = (tone: SummaryPart["tone"]) =>
    tone === "added" ? t.diffAddedFg : tone === "removed" ? t.diffRemovedFg : t.textMuted;
  // A deleted file's lines are evidence, not reading: a short preview; a new file's first screenful.
  const preview = detailed ? 400 : action === "Delete" ? 8 : diff?.isNew ? 12 : 24;
  return (
    <box flexDirection="column" flexShrink={0} marginTop={spaced ? 1 : 0}>
      <text wrapMode="none">
        <span style={{ fg: failed ? t.danger : t.success }}>{`${failed ? GLYPH.failed : GLYPH.active} `}</span>
        <b>
          <span style={{ fg: failed ? t.danger : t.text }}>{action}</span>
        </b>
        <span style={{ fg: t.textMuted }}>(</span>
        <span style={{ fg: failed ? t.textSecondary : t.brand }}>
          {shortenPath(path, Math.max(12, width - action.length - 4))}
        </span>
        <span style={{ fg: t.textMuted }}>)</span>
      </text>
      {failed || parts.length > 0 ? (
        <text wrapMode="none">
          <span style={{ fg: t.textDim }}>{"  └ "}</span>
          {failed ? (
            <span style={{ fg: t.danger }}>{truncateText(error, Math.max(12, width - 4))}</span>
          ) : (
            parts.map((part, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: two parts can read the same ("1 line")
              <span key={index} style={{ fg: partColor(part.tone) }}>
                {part.text}
              </span>
            ))
          )}
        </text>
      ) : null}
      {diff && !failed ? (
        <DiffView t={t} diff={diff} showHeader={false} indent={4} width={width} maxRows={preview} />
      ) : null}
    </box>
  );
}
