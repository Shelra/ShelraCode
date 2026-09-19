import type { ScrollBoxRenderable } from "@opentui/core";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import type { Knowledge, KnowledgeRow, KnowledgeTab, SkillRow } from "./knowledge";
import { scrollbarStyle, type Theme } from "./theme";

const TABS: ReadonlyArray<{ id: KnowledgeTab; label: string; number: string }> = [
  { id: "memory", label: "Project memory", number: "1" },
  { id: "skills", label: "Skills", number: "2" },
  { id: "user", label: "Across projects", number: "3" },
];

export function knowledgeRowsFor(knowledge: Knowledge, tab: KnowledgeTab): ReadonlyArray<KnowledgeRow | SkillRow> {
  return tab === "memory" ? knowledge.memory : tab === "user" ? knowledge.user : knowledge.skills;
}

const EMPTY: Record<KnowledgeTab, { title: string; detail: string }> = {
  memory: {
    title: "Nothing saved about this project yet.",
    detail:
      "Shelra saves what it learns after verified changes, failures and long investigations. You can also tell it: remember that…",
  },
  skills: {
    title: "No skills found.",
    detail: "Add a folder with a SKILL.md under .agents/skills/ (this project) or ~/.agents/skills/ (all projects).",
  },
  user: {
    title: "No standing rules yet.",
    detail: 'Say "always …" or "never …" and Shelra keeps it in every project.',
  },
};

function isSkill(row: KnowledgeRow | SkillRow): row is SkillRow {
  return "name" in row;
}

function Chip({ t, children, color }: { t: Theme; children: ReactNode; color?: string }) {
  return <span style={{ fg: color ?? t.textMuted }}>{children}</span>;
}

function MemoryEntry({
  t,
  row,
  selected,
  open,
  pendingDelete,
}: {
  t: Theme;
  row: KnowledgeRow;
  selected: boolean;
  open: boolean;
  pendingDelete: boolean;
}) {
  return (
    <box
      id={`kn-${row.key}`}
      flexDirection="column"
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={selected ? t.selectedBg : undefined}
      flexShrink={0}
    >
      <text wrapMode="none">
        <span style={{ fg: selected ? t.brand : t.textDim }}>{open ? "▾ " : "▸ "}</span>
        <span style={{ fg: selected ? t.selected : t.text }}>
          <b>{row.title}</b>
        </span>
      </text>
      <text fg={t.textMuted} wrapMode="none">
        {`  ${row.hook}`}
      </text>
      <text fg={t.textDim} wrapMode="none">
        {`  ${row.facts}`}
      </text>
      {row.stale ? (
        <text fg={t.warning} wrapMode="none">
          {`  ! ${row.stale}`}
        </text>
      ) : null}
      {open && row.body ? (
        <box paddingLeft={2} paddingTop={1} paddingBottom={1} flexShrink={0}>
          <text fg={t.textSecondary}>{row.body.length > 900 ? `${row.body.slice(0, 899)}…` : row.body}</text>
        </box>
      ) : null}
      {pendingDelete ? (
        <text fg={t.danger} wrapMode="none">
          {"  Press x again to delete this memory, esc to keep it"}
        </text>
      ) : null}
    </box>
  );
}

function SkillEntry({ t, row, selected }: { t: Theme; row: SkillRow; selected: boolean }) {
  return (
    <box
      id={`kn-${row.key}`}
      flexDirection="column"
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={selected ? t.selectedBg : undefined}
      flexShrink={0}
    >
      <text wrapMode="none">
        <span style={{ fg: selected ? t.brand : t.textDim }}>{"◆ "}</span>
        <span style={{ fg: selected ? t.selected : t.text }}>
          <b>{row.name}</b>
        </span>
        <Chip t={t} color={t.textDim}>{`  ${row.scope}`}</Chip>
      </text>
      <text fg={t.textMuted}>{`  ${row.description}`}</text>
      <text fg={t.textDim} wrapMode="none">
        {`  ${row.location}`}
      </text>
      {row.warnings.map((warning) => (
        <text key={warning} fg={t.warning} wrapMode="none">
          {`  ! ${warning}`}
        </text>
      ))}
    </box>
  );
}

export function KnowledgeModal({
  t,
  width,
  height,
  tab,
  knowledge,
  selected,
  expanded,
  pendingDelete,
}: {
  t: Theme;
  width: number;
  height: number;
  tab: KnowledgeTab;
  knowledge: Knowledge;
  selected: number;
  expanded: ReadonlySet<string>;
  pendingDelete: string | null;
}) {
  const listRef = useRef<ScrollBoxRenderable>(null);
  const rows = knowledgeRowsFor(knowledge, tab);
  const active = rows[selected];

  useEffect(() => {
    if (active) listRef.current?.scrollChildIntoView(`kn-${active.key}`);
  }, [active]);

  const panelWidth = Math.min(96, width - 4);
  const contentLines = rows.length === 0 ? 3 : rows.length * (tab === "skills" ? 4 : 4) + 2;
  const panelHeight = Math.min(height - 2, 36, Math.max(16, contentLines + 9));
  const top = Math.max(1, Math.floor((height - panelHeight) / 2));
  const actionable = tab !== "skills";
  const empty = EMPTY[tab];

  let lastType = "";
  const body: ReactNode[] = [];
  for (const [index, row] of rows.entries()) {
    if (isSkill(row)) {
      body.push(<SkillEntry key={row.key} t={t} row={row} selected={index === selected} />);
      continue;
    }
    if (row.type !== lastType) {
      lastType = row.type;
      body.push(
        <box key={`type-${row.key}`} paddingLeft={2} paddingTop={index === 0 ? 0 : 1} flexShrink={0}>
          <text fg={t.textMuted}>
            <b>{row.type}</b>
          </text>
        </box>,
      );
    }
    body.push(
      <MemoryEntry
        key={row.key}
        t={t}
        row={row}
        selected={index === selected}
        open={expanded.has(row.key)}
        pendingDelete={pendingDelete === row.key}
      />,
    );
  }

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      alignItems="center"
      paddingTop={top}
      backgroundColor={t.overlay}
      zIndex={400}
    >
      <box
        width={panelWidth}
        height={panelHeight}
        backgroundColor={t.backgroundPanel}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <box flexShrink={0} flexDirection="row" paddingLeft={3} paddingRight={3}>
          <text fg={t.primary}>
            <b>{"What Shelra knows"}</b>
          </text>
          <box flexGrow={1} />
          <text fg={t.textMuted}>{"esc close"}</text>
        </box>
        <box flexShrink={0} flexDirection="row" gap={3} paddingLeft={3} paddingTop={1} paddingBottom={1}>
          {TABS.map((entry) => {
            const count =
              entry.id === "memory"
                ? knowledge.memory.length
                : entry.id === "skills"
                  ? knowledge.skills.length
                  : knowledge.user.length;
            const current = entry.id === tab;
            return (
              <text key={entry.id} wrapMode="none">
                <span style={{ fg: current ? t.brand : t.textDim }}>{`${entry.number} `}</span>
                <span style={{ fg: current ? t.text : t.textMuted }}>
                  {current ? <b>{entry.label}</b> : entry.label}
                </span>
                <span style={{ fg: t.textDim }}>{` ${count}`}</span>
              </text>
            );
          })}
        </box>
        <scrollbox scrollbarOptions={scrollbarStyle(t)} ref={listRef} flexGrow={1} minHeight={0}>
          {rows.length === 0 ? (
            <box paddingLeft={3} paddingRight={3} flexDirection="column">
              <text fg={t.text}>{empty.title}</text>
              <text fg={t.textMuted}>{empty.detail}</text>
            </box>
          ) : (
            body
          )}
        </scrollbox>
        <box flexShrink={0} paddingLeft={3} paddingTop={1} flexDirection="row">
          <text wrapMode="none">
            <span style={{ fg: t.text }}>{"↑↓ "}</span>
            <span style={{ fg: t.textMuted }}>{"move"}</span>
            {actionable ? (
              <>
                <span style={{ fg: t.textDim }}>{" · "}</span>
                <span style={{ fg: t.text }}>{"enter "}</span>
                <span style={{ fg: t.textMuted }}>{"open"}</span>
                <span style={{ fg: t.textDim }}>{" · "}</span>
                <span style={{ fg: t.text }}>{"c "}</span>
                <span style={{ fg: t.textMuted }}>{"still true"}</span>
                <span style={{ fg: t.textDim }}>{" · "}</span>
                <span style={{ fg: t.text }}>{"x "}</span>
                <span style={{ fg: t.textMuted }}>{"delete"}</span>
              </>
            ) : null}
            <span style={{ fg: t.textDim }}>{" · "}</span>
            <span style={{ fg: t.text }}>{"←→ "}</span>
            <span style={{ fg: t.textMuted }}>{"tab"}</span>
          </text>
        </box>
      </box>
    </box>
  );
}
