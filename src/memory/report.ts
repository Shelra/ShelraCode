import { detectStaleness } from "./retrieval";
import { listMemoryRecords, projectMemoryScope, readMemoryHistory, readReflectionAudit } from "./store";

/**
 * Plain-text view of a project's memory for the `/memory` command: what Shelra has learned, how
 * trustworthy each item is, how often it has been used, what looks stale, and what the last
 * automatic capture decided. Lets the user inspect and correct memory instead of re-teaching it.
 */
export function formatMemoryForChat(workspace: string, now = Date.now()): string {
  const scope = projectMemoryScope(workspace);
  const records = listMemoryRecords(scope);
  const lines: string[] = [];
  if (records.length === 0) {
    lines.push(
      "No project memory saved yet.",
      "Memory is written automatically after turns that change and verify files, work through a failure, or investigate substantially, and by memory_write.",
      `Location: ${workspace}/.shelra/memory/`,
    );
  } else {
    lines.push(
      `Project memory (${records.length} entr${records.length === 1 ? "y" : "ies"}) — ${workspace}/.shelra/memory/`,
      "",
    );
    const byType = new Map<string, typeof records>();
    for (const record of records) {
      const type = record.entry.frontmatter.metadata.type;
      byType.set(type, [...(byType.get(type) ?? []), record]);
    }
    for (const [type, group] of [...byType.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`${type}:`);
      for (const record of group) {
        const meta = record.entry.frontmatter.metadata;
        const staleness = detectStaleness(workspace, record, now);
        const facts = [
          meta.source ?? "inference",
          meta.confidence !== undefined ? `${Math.round(meta.confidence * 100)}%` : null,
          `used ${meta.uses ?? 0}x`,
          staleness.stale ? `MAY BE STALE: ${staleness.reason}` : null,
        ].filter(Boolean);
        lines.push(`- ${record.index.title} (${record.slug}) — ${record.index.hook}`, `    ${facts.join(" · ")}`);
      }
      lines.push("");
    }
  }
  const history = readMemoryHistory(scope, 8);
  if (history.length > 0) {
    lines.push("Recent changes:");
    for (const event of history.slice(-8)) {
      lines.push(
        `- ${event.at.slice(0, 16).replace("T", " ")} ${event.event} ${event.slug}${event.detail ? ` — ${event.detail.slice(0, 80)}` : ""}`,
      );
    }
    lines.push("");
  }
  const audit = readReflectionAudit(scope, 1).at(-1);
  if (audit) {
    const decisions = audit.decisions.map((decision) => `${decision.slug}:${decision.action}`).join(", ") || "none";
    lines.push(
      `Last automatic capture (${audit.at.slice(0, 16).replace("T", " ")}): ${audit.qualified ? audit.reason : `skipped — ${audit.reason}`}; decisions: ${decisions}${audit.error ? `; error: ${audit.error}` : ""}`,
      "",
    );
  }
  lines.push(
    "Correct an entry with memory_write (same slug), remove one with memory_delete, or edit the markdown files directly.",
  );
  return lines.join("\n").trimEnd();
}
