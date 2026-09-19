import { useEffect, useState } from "react";
import type { Plan } from "../types/index";
import {
  type ActivityPhrase,
  type ActivityRowModel,
  type ActivityTone,
  explainError,
  summarizeGroup,
  truncateText,
} from "./activity";
import { DiffView } from "./diff-view";
import {
  type TranscriptActivityItem,
  type TranscriptSummaryItem,
  type TranscriptThoughtItem,
  turnSummaryGroups,
} from "./observability";
import type { Theme } from "./theme";

/* ── Vocabulary ──────────────────────────────────────────────────
 * One glyph and one colour per state, shared by history rows, the live line, the sidebar and the
 * inspector. Colour reinforces the glyph; it is never the only signal.
 */

export const GLYPH = {
  done: "✓",
  failed: "×",
  active: "●",
  quiet: "·",
  collapsed: "▸",
  expanded: "▾",
} as const;

/** The glyph that goes with a work status; colour reinforces it, never replaces it. */
export function statusGlyph(tone: ActivityTone): string {
  if (tone === "danger") return GLYPH.failed;
  if (tone === "active") return GLYPH.active;
  if (tone === "warning") return "!";
  if (tone === "success") return GLYPH.done;
  return GLYPH.quiet;
}

export function toneColor(t: Theme, tone: ActivityTone): string {
  switch (tone) {
    case "active":
      return t.brand;
    case "success":
      return t.success;
    case "danger":
      return t.danger;
    case "warning":
      return t.warning;
    default:
      return t.textMuted;
  }
}

function toneGlyph(tone: ActivityTone): string {
  if (tone === "danger") return GLYPH.failed;
  if (tone === "warning") return "!";
  return GLYPH.done;
}

/* ── Spinner ─────────────────────────────────────────────────────── */

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 90;

/** One animated glyph: proof of life for the current action. Static under reduced motion. */
export function Spinner({ color, reducedMotion }: { color: string; reducedMotion: boolean }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (reducedMotion) return;
    const interval = setInterval(
      () => setFrame((current) => (current + 1) % SPINNER_FRAMES.length),
      SPINNER_INTERVAL_MS,
    );
    return () => clearInterval(interval);
  }, [reducedMotion]);

  return <span style={{ fg: color }}>{reducedMotion ? GLYPH.active : SPINNER_FRAMES[frame]}</span>;
}

/* ── One line of activity ────────────────────────────────────────── */

interface ActivityLineProps {
  t: Theme;
  tone: ActivityTone;
  verb: string;
  object?: string;
  meta?: string;
  /** Characters available for the whole line, glyph and meta included. */
  width: number;
  glyph?: string;
  quiet?: boolean;
}

/**
 * The single row primitive of the transcript: glyph · verb · object ........ meta.
 * The object is truncated first so the verb and the right-hand fact always stay readable.
 */
export function ActivityLine({ t, tone, verb, object, meta, width, glyph, quiet }: ActivityLineProps) {
  const failed = tone === "danger";
  const metaWidth = meta ? meta.length + 2 : 0;
  const room = Math.max(8, width - 2 - verb.length - 1 - metaWidth);
  const shownObject = object ? truncateText(object, room) : "";
  const glyphColor = quiet ? t.textDim : toneColor(t, tone);

  return (
    <box flexDirection="row" flexShrink={0} width="100%">
      <text wrapMode="none">
        <span style={{ fg: glyphColor }}>{`${glyph ?? toneGlyph(tone)} `}</span>
        <span style={{ fg: failed ? t.danger : quiet ? t.textSecondary : t.text }}>{verb}</span>
        {shownObject ? (
          <span style={{ fg: failed ? t.textSecondary : t.textSecondary }}>{` ${shownObject}`}</span>
        ) : null}
      </text>
      <box flexGrow={1} />
      {meta ? (
        <text wrapMode="none" fg={failed ? t.danger : t.textMuted}>
          {meta}
        </text>
      ) : null}
    </box>
  );
}

function DetailLines({
  t,
  lines,
  tone,
  width,
}: {
  t: Theme;
  lines: readonly string[];
  tone: ActivityTone;
  width: number;
}) {
  if (lines.length === 0) return null;
  const color = tone === "danger" ? t.danger : t.textMuted;
  return (
    <box flexDirection="column" paddingLeft={2} flexShrink={0}>
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: output lines are static and may repeat
        <text key={`${index}:${line}`} fg={color} wrapMode="none">
          {truncateText(line, Math.max(12, width - 4))}
        </text>
      ))}
    </box>
  );
}

/* ── History ─────────────────────────────────────────────────────── */

const FOLDED_GROUPS = new Set(["explore", "research"]);

function RowView({ t, row, width, detailed }: { t: Theme; row: ActivityRowModel; width: number; detailed: boolean }) {
  const failed = row.tone === "danger";
  // Failures are evidence: they are always visible. Passing output only appears on request.
  const lines = failed || detailed ? row.lines : [];
  const showTail = detailed && !failed && row.tail && row.tail.length > 0 && row.lines.length === 0;
  return (
    <box flexDirection="column" flexShrink={0}>
      <ActivityLine t={t} tone={row.tone} verb={row.verb} object={row.object} meta={row.meta} width={width} />
      <DetailLines t={t} lines={lines} tone={row.tone} width={width} />
      {showTail ? <DetailLines t={t} lines={row.tail ?? []} tone="neutral" width={width} /> : null}
      {detailed && row.diff ? <DiffView t={t} diff={row.diff} maxRows={14} showHeader={false} indent={2} /> : null}
    </box>
  );
}

/**
 * A run of same-kind operations. Reads and searches fold into one counted line by default; edits,
 * commands and checks always keep their own row because each carries its own evidence.
 */
export function TranscriptActivityView({
  t,
  item,
  width,
  detailed,
  livePlan = null,
}: {
  t: Theme;
  item: TranscriptActivityItem;
  width: number;
  detailed: boolean;
  /** The current plan, when this row is the one that created it: it draws as a live checklist. */
  livePlan?: Plan | null;
}) {
  if (item.group === "load") {
    // One quiet line: what the agent pulled into its context this turn. Details live in /context.
    const loads = summarizeGroup(item.rows);
    return (
      <box paddingLeft={3} marginTop={1} flexShrink={0}>
        <ActivityLine t={t} tone={loads.tone} verb={loads.title} width={width} quiet glyph={GLYPH.quiet} />
      </box>
    );
  }
  if (item.group === "plan" && livePlan && livePlan.steps.length > 0) {
    return (
      <box paddingLeft={3} marginTop={1} flexShrink={0} flexDirection="column">
        <PlanBlock t={t} plan={livePlan} width={width} detailed={detailed} />
      </box>
    );
  }
  const folded = FOLDED_GROUPS.has(item.group) && !detailed && !item.rows.some((row) => row.tone === "danger");
  const summary = summarizeGroup(item.rows);
  // One failed read needs no group header: the row already says what failed.
  const groupHeader = FOLDED_GROUPS.has(item.group) && (item.rows.length > 1 || detailed);

  return (
    <box paddingLeft={3} marginTop={1} flexShrink={0} flexDirection="column">
      {folded ? (
        <ActivityLine t={t} tone={summary.tone} verb={summary.title} width={width} quiet glyph={GLYPH.done} />
      ) : groupHeader ? (
        <>
          <ActivityLine t={t} tone={summary.tone} verb={summary.title} width={width} quiet glyph={GLYPH.expanded} />
          <box flexDirection="column" paddingLeft={2} flexShrink={0}>
            {item.rows.map((row) => (
              <RowView key={row.id} t={t} row={row} width={width - 2} detailed={detailed} />
            ))}
          </box>
        </>
      ) : (
        item.rows.map((row) => <RowView key={row.id} t={t} row={row} width={width} detailed={detailed} />)
      )}
    </box>
  );
}

/**
 * The plan as a checklist in the log. Unfinished, it shows the steps around the one being worked on
 * (at most five, like a to-do list); finished, it folds to one line. Detail mode shows every step.
 */
export function PlanBlock({ t, plan, width, detailed }: { t: Theme; plan: Plan; width: number; detailed: boolean }) {
  const steps = plan.steps;
  const total = steps.length;
  const done = steps.filter((step) => step.status === "complete").length;
  if (done === total && !detailed) {
    return <ActivityLine t={t} tone="success" verb={`Plan ${done}/${total}`} width={width} glyph={GLYPH.done} />;
  }

  const current = steps.findIndex((step) => step.status === "working" || step.status === "failed");
  const active =
    current >= 0
      ? current
      : Math.max(
          0,
          steps.findIndex((step) => (step.status ?? "pending") === "pending"),
        );
  const max = detailed ? total : 5;
  const start = total <= max ? 0 : Math.min(Math.max(0, active - 1), total - max);
  const visible = steps.slice(start, start + max);
  const after = total - (start + visible.length);
  const room = Math.max(12, width - 4);

  return (
    <box flexDirection="column" flexShrink={0}>
      <text wrapMode="none">
        <span style={{ fg: t.textDim }}>{"[ "}</span>
        <span style={{ fg: t.brand }}>
          <b>{"PLAN"}</b>
        </span>
        <span style={{ fg: t.textMuted }}>{` ${done}/${total}`}</span>
        <span style={{ fg: t.textDim }}>{" ]"}</span>
      </text>
      {start > 0 ? <text fg={t.textDim}>{`  ${start} earlier`}</text> : null}
      {visible.map((step, offset) => {
        const status = step.status ?? "pending";
        const glyph =
          status === "complete"
            ? GLYPH.done
            : status === "failed"
              ? GLYPH.failed
              : status === "working"
                ? GLYPH.active
                : GLYPH.quiet;
        const glyphColor =
          status === "complete"
            ? t.success
            : status === "failed"
              ? t.danger
              : status === "working"
                ? t.brand
                : t.textDim;
        const titleColor =
          status === "working"
            ? t.text
            : status === "failed"
              ? t.danger
              : status === "complete"
                ? t.textMuted
                : t.textDim;
        const title = truncateText(step.title, room);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: plan steps are ordered and titles may repeat
          <box key={`${start + offset}:${step.title}`} flexDirection="column" flexShrink={0}>
            <text wrapMode="none">
              <span style={{ fg: glyphColor }}>{`${glyph} `}</span>
              {status === "working" ? (
                <b>
                  <span style={{ fg: titleColor }}>{title}</span>
                </b>
              ) : (
                <span style={{ fg: titleColor }}>{title}</span>
              )}
            </text>
            {detailed && step.description ? (
              <text fg={t.textMuted} wrapMode="none">{`  ${truncateText(step.description, room)}`}</text>
            ) : null}
          </box>
        );
      })}
      {after > 0 ? <text fg={t.textDim}>{`  ${after} more`}</text> : null}
    </box>
  );
}

/** The last line of a turn that changed files or ran a check: `─ 2 files +6 -1 · tests ✓ · 42s`. */
export function TurnSummaryLine({ t, item }: { t: Theme; item: TranscriptSummaryItem }) {
  const groups = turnSummaryGroups(item);
  if (groups.length === 0) return null;
  const colorOf = (tone: SummaryTone): string => {
    if (tone === "added") return t.diffAddedFg;
    if (tone === "removed") return t.diffRemovedFg;
    if (tone === "success") return t.success;
    if (tone === "danger") return t.danger;
    if (tone === "warning") return t.warning;
    return t.textMuted;
  };
  return (
    <box paddingLeft={3} marginTop={1} flexShrink={0}>
      <text wrapMode="none">
        <span style={{ fg: t.textDim }}>{"─ "}</span>
        {groups.map((group, index) => (
          <span key={group.map((segment) => segment.text).join("")}>
            {index > 0 ? <span style={{ fg: t.textDim }}>{" · "}</span> : null}
            {group.map((segment) => (
              <span key={segment.text} style={{ fg: colorOf(segment.tone) }}>
                {segment.text}
              </span>
            ))}
          </span>
        ))}
      </text>
    </box>
  );
}

type SummaryTone = ReturnType<typeof turnSummaryGroups>[number][number]["tone"];

/** "Thought for 8s" - the model's own reasoning, shown only when the user asks for detail. */
export function ThoughtView({
  t,
  item,
  width,
  detailed,
}: {
  t: Theme;
  item: TranscriptThoughtItem;
  width: number;
  detailed: boolean;
}) {
  const seconds = Math.max(1, Math.round(item.durationMs / 1000));
  const label = `Thought for ${seconds}s${item.steps > 1 ? ` · ${item.steps} steps` : ""}`;
  return (
    <box paddingLeft={3} marginTop={1} flexShrink={0} flexDirection="column">
      <ActivityLine
        t={t}
        tone="neutral"
        verb={label}
        width={width}
        quiet
        glyph={detailed ? GLYPH.expanded : GLYPH.collapsed}
      />
      {detailed && item.text ? (
        <box paddingLeft={2} flexShrink={0}>
          <text fg={t.textMuted}>
            <i>{item.text}</i>
          </text>
        </box>
      ) : null}
    </box>
  );
}

/* ── Live ────────────────────────────────────────────────────────── */

export interface LiveTurnProps {
  t: Theme;
  phrase: ActivityPhrase;
  elapsedMs: number | null;
  /** Latest reasoning sentence while the model is thinking. */
  thought?: string | null;
  /** A specific, factual waiting note (never a generic "working"). */
  note?: string | null;
  /** The next unstarted plan step, sourced from the real plan. */
  next?: string | null;
  /** A delegated agent's current action, when one is running. */
  agentLine?: string | null;
  failed?: boolean;
  reducedMotion: boolean;
  width: number;
}

function formatClock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

/** The one line that always says exactly what is happening now, with its target and clock. */
export function LiveTurn({
  t,
  phrase,
  elapsedMs,
  thought,
  note,
  next,
  agentLine,
  failed,
  reducedMotion,
  width,
}: LiveTurnProps) {
  const color = failed ? t.danger : t.brand;
  const clock = elapsedMs !== null ? formatClock(elapsedMs) : "";
  const room = Math.max(12, width - 4 - phrase.verb.length - (clock ? clock.length + 2 : 0));
  const object = phrase.object ? truncateText(phrase.object, room) : "";

  return (
    <box paddingLeft={3} marginTop={1} flexShrink={0} flexDirection="column">
      <box flexDirection="row" width="100%">
        <text wrapMode="none">
          {failed ? (
            <span style={{ fg: color }}>{GLYPH.failed}</span>
          ) : (
            <Spinner color={color} reducedMotion={reducedMotion} />
          )}
          <span style={{ fg: color }}>
            <b>{` ${phrase.verb}`}</b>
          </span>
          {object ? <span style={{ fg: t.text }}>{` ${object}`}</span> : null}
        </text>
        <box flexGrow={1} />
        {clock ? <text fg={t.textMuted}>{clock}</text> : null}
      </box>
      {thought ? (
        <box paddingLeft={2} flexShrink={0}>
          <text fg={t.textMuted} wrapMode="none">
            <i>{truncateText(thought, Math.max(16, width - 8))}</i>
          </text>
        </box>
      ) : null}
      {agentLine ? (
        <box paddingLeft={2} flexShrink={0}>
          <text fg={t.subagentAccent} wrapMode="none">{`↳ ${truncateText(agentLine, Math.max(16, width - 10))}`}</text>
        </box>
      ) : null}
      {note ? (
        <box paddingLeft={2} flexShrink={0}>
          <text fg={t.textMuted} wrapMode="none">
            {truncateText(note, Math.max(16, width - 8))}
          </text>
        </box>
      ) : null}
      {next ? (
        <box paddingLeft={2} flexShrink={0}>
          <text
            fg={t.textDim}
            wrapMode="none"
          >{`Next · ${truncateText(next.split(" — ")[0] ?? next, Math.max(16, width - 14))}`}</text>
        </box>
      ) : null}
    </box>
  );
}

/* ── Errors ──────────────────────────────────────────────────────── */

/**
 * A failed request, in words and with a next step. Rate limits, timeouts and connection loss are
 * common on free models; the block says which one it was and what to do, never just "error".
 */
export function ErrorBlock({ t, message, width }: { t: Theme; message: string; width: number }) {
  const explanation = explainError(message);
  const detail = message.replace(/\s+/g, " ").trim();
  return (
    <box paddingLeft={3} marginTop={1} flexShrink={0} flexDirection="column">
      <ActivityLine t={t} tone="danger" verb={explanation.title} width={width} glyph={GLYPH.failed} />
      <box paddingLeft={2} flexDirection="column" flexShrink={0}>
        <text fg={t.textMuted}>{truncateText(detail, Math.max(30, width * 2 - 10))}</text>
        <text fg={t.textSecondary}>{explanation.hint}</text>
      </box>
    </box>
  );
}
