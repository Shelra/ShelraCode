import type { Theme } from "../theme";

/**
 * The site's `[ LABEL ]` section badge: uppercase, accent, one space inside the brackets. Every
 * panel and dialog starts with one; `detail` is the metadata that follows it (a count, a state).
 */
export function SectionBadge({ t, label, detail }: { t: Theme; label: string; detail?: string }) {
  return (
    <text wrapMode="none">
      <span style={{ fg: t.brand }}>{`[ ${label.toUpperCase()} ]`}</span>
      {detail ? <span style={{ fg: t.textMuted }}>{`  ${detail}`}</span> : null}
    </text>
  );
}
