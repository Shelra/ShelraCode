import { RGBA, SyntaxStyle } from "@opentui/core";
import { Fragment, type ReactNode, useMemo } from "react";
import { type CodeTokenKind, MAX_HIGHLIGHT_LINES, splitFences, tokenizeLine } from "./code-highlight";
import { type Block, type InlineSpan, type ListItem, parseBlocks, parseInline } from "./markdown-blocks";
import type { Theme } from "./theme";

function buildSyntaxStyle(t: Theme): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: RGBA.fromHex(t.text) },
    "markup.heading": { fg: RGBA.fromHex(t.mdHeading), bold: true },
    "markup.bold": { fg: RGBA.fromHex(t.mdBold), bold: true },
    "markup.italic": { fg: RGBA.fromHex(t.mdItalic), italic: true },
    "markup.raw": { fg: RGBA.fromHex(t.mdCode) },
    "markup.link": { fg: RGBA.fromHex(t.mdLink), underline: true },
    "markup.link.label": { fg: RGBA.fromHex(t.mdLinkText) },
    "markup.list": { fg: RGBA.fromHex(t.mdListBullet) },
    "markup.quote": { fg: RGBA.fromHex(t.mdItalic), italic: true },
    "markup.separator": { fg: RGBA.fromHex(t.mdHr) },
  });
}

const TABLE_OPTIONS = {
  widthMode: "full" as const,
  columnFitter: "balanced" as const,
  wrapMode: "word" as const,
  // 0 keeps rows one line tall; a padding of 1 also adds an empty line above and below every row.
  cellPadding: 0,
  borders: true,
  outerBorder: true,
  borderStyle: "rounded" as const,
};

/* ── Inline ──────────────────────────────────────────────────────── */

interface InlineBase {
  fg: string;
  bold?: boolean;
  italic?: boolean;
}

function shortUrl(url: string): string {
  const bare = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return bare.length > 44 ? `${bare.slice(0, 43)}…` : bare;
}

/** One coloured run per span. Emphasis colours come from theme tokens, never from the terminal palette. */
function inlineNodes(t: Theme, spans: readonly InlineSpan[], base: InlineBase): ReactNode[] {
  const nodes: ReactNode[] = [];
  spans.forEach((span, index) => {
    const fg = span.code
      ? t.mdCode
      : span.link
        ? t.mdLinkText
        : span.strike
          ? t.textDim
          : span.bold
            ? t.mdBold
            : span.italic
              ? t.mdItalic
              : base.fg;
    // biome-ignore lint/correctness/useJsxKeyInIterable: keyed by the Fragment it is wrapped in below
    let node: ReactNode = <span style={{ fg }}>{span.text}</span>;
    if (span.bold || base.bold) node = <b>{node}</b>;
    if (span.italic || base.italic) node = <i>{node}</i>;
    if (span.link) node = <u>{node}</u>;
    // biome-ignore lint/suspicious/noArrayIndexKey: spans are positional and may repeat
    nodes.push(<Fragment key={index}>{node}</Fragment>);
    // A link's target is shown once, after its label, so it can be read and copied in a terminal.
    if (span.link && spans[index + 1]?.link !== span.link) {
      // biome-ignore lint/suspicious/noArrayIndexKey: positional
      nodes.push(<span key={`url-${index}`} style={{ fg: t.textDim }}>{` (${shortUrl(span.link)})`}</span>);
    }
  });
  return nodes;
}

/* ── Blocks ──────────────────────────────────────────────────────── */

function Heading({ t, level, text }: { t: Theme; level: 1 | 2 | 3; text: string }) {
  const color = level === 1 ? t.brand : level === 2 ? t.mdHeading : t.textSecondary;
  return <text>{inlineNodes(t, parseInline(text), { fg: color, bold: true })}</text>;
}

/** Bullets and numbers sit in their own column so wrapped lines hang under the text, not under the marker. */
function List({ t, items }: { t: Theme; items: readonly ListItem[] }) {
  const numberWidth = Math.max(0, ...items.filter((item) => item.ordered).map((item) => item.marker.length));
  return (
    <box flexDirection="column" flexShrink={0}>
      {items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: list items are positional and may repeat
        <box key={index} flexDirection="row" paddingLeft={item.depth * 2} flexShrink={0}>
          <text fg={item.ordered ? t.textMuted : t.mdListBullet} wrapMode="none" flexShrink={0}>
            {`${item.ordered ? item.marker.padStart(numberWidth) : item.marker} `}
          </text>
          <box flexGrow={1} flexShrink={1} minWidth={0}>
            <text>{inlineNodes(t, parseInline(item.text), { fg: t.text })}</text>
          </box>
        </box>
      ))}
    </box>
  );
}

function codeColor(t: Theme, kind: CodeTokenKind): string {
  switch (kind) {
    case "keyword":
      return t.info;
    case "string":
      return t.mdCode;
    case "comment":
      return t.textMuted;
    case "number":
      return t.warning;
    case "type":
      return t.modePlan;
    default:
      return t.mdCodeBlockFg;
  }
}

/**
 * A fenced code block on its own surface. OpenTUI draws unhighlighted code with a fixed white
 * foreground and no background, which disappears on a light theme, so code is rendered here from
 * theme tokens instead, with light syntax colour.
 */
function CodeBlock({ t, code, lang }: { t: Theme; code: string; lang: string }) {
  const lines = code.replace(/\n$/, "").split("\n");
  const highlight = lines.length <= MAX_HIGHLIGHT_LINES;
  const state = { block: false };

  return (
    <box backgroundColor={t.mdCodeBlockBg} paddingLeft={1} paddingRight={1} flexDirection="column" flexShrink={0}>
      {lang ? <text fg={t.textDim}>{lang}</text> : null}
      {lines.map((line, row) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: code lines are positional and may repeat
        <text key={row} wrapMode="word" fg={t.mdCodeBlockFg}>
          {highlight
            ? tokenizeLine(line, lang, state).map((token, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional within a line
                <span key={index} style={{ fg: codeColor(t, token.kind) }}>
                  {token.text}
                </span>
              ))
            : line || " "}
        </text>
      ))}
    </box>
  );
}

type Node = { kind: "code"; lang: string; text: string } | { kind: "block"; block: Block };

export function Markdown({ content, t, streaming = false }: { content: string; t: Theme; streaming?: boolean }) {
  const syntaxStyle = useMemo(() => buildSyntaxStyle(t), [t]);
  const tableOptions = useMemo(() => ({ ...TABLE_OPTIONS, borderColor: t.border }), [t.border]);
  const nodes = useMemo<Node[]>(
    () =>
      splitFences(content).flatMap<Node>((segment) =>
        segment.kind === "code"
          ? [{ kind: "code", lang: segment.lang, text: segment.text }]
          : parseBlocks(segment.text).map((block) => ({ kind: "block", block })),
      ),
    [content],
  );

  if (nodes.length === 0) return null;

  const renderNode = (node: Node, live: boolean): ReactNode => {
    if (node.kind === "code") return <CodeBlock t={t} code={node.text} lang={node.lang} />;
    const { block } = node;
    switch (block.type) {
      case "heading":
        return <Heading t={t} level={block.level} text={block.text} />;
      case "paragraph":
        return <text>{inlineNodes(t, parseInline(block.text), { fg: t.text })}</text>;
      case "list":
        return <List t={t} items={block.items} />;
      case "quote":
        return (
          <box border={["left"]} borderColor={t.textDim} paddingLeft={1} flexShrink={0}>
            <text>{inlineNodes(t, parseInline(block.text), { fg: t.mdItalic, italic: true })}</text>
          </box>
        );
      case "rule":
        return <box height={1} border={["top"]} borderColor={t.mdHr} flexShrink={0} />;
      case "table":
        return (
          <markdown
            content={block.raw}
            syntaxStyle={syntaxStyle}
            conceal={true}
            // @ts-expect-error MarkdownProps omits inherited Renderable.selectable; needed for TUI text selection
            selectable={true}
            tableOptions={tableOptions}
            streaming={live}
            flexShrink={0}
          />
        );
    }
  };

  return (
    <box flexDirection="column" flexShrink={0}>
      {nodes.map((node, index) => {
        const previous = nodes[index - 1];
        // Breathing room between blocks, except directly under a heading: it belongs to what follows.
        const underSmallHeading =
          previous?.kind === "block" && previous.block.type === "heading" && previous.block.level > 1;
        const gap = index === 0 || underSmallHeading ? 0 : 1;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: nodes are append-only while a message streams
          <box key={index} marginTop={gap} flexShrink={0}>
            {renderNode(node, streaming && index === nodes.length - 1)}
          </box>
        );
      })}
    </box>
  );
}
