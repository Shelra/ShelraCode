import { existsSync, readdirSync } from "node:fs";
import { memoryContextFor } from "../agent/prompts";
import { pendingReflectionCount, readEpisodes } from "./episodes";
import { isStandingRule } from "./retrieval";
import { approveSkillProposal, declineSkillProposal, listSkillProposals } from "./skills";
import {
  isCurrentMemory,
  listMemoryRecords,
  memoryDir,
  projectMemoryScope,
  readMemoryEntry,
  readMemoryHistory,
  readMemoryVersions,
  readReflectionAudit,
  userMemoryScope,
} from "./store";
import type { MemoryRecord, MemoryScope } from "./types";

/**
 * `shelra memory`: what Shelra remembers about this project and this person, and why (docs/architecture/18-MEMORY-V2.md
 * §4.5). Memory must not be a black box: `list` shows what is kept, `show` one entry with its history, `why` what a
 * request would be given and the reasons, `stats` the funnel from turns to lessons.
 */

export const MEMORY_ACTIONS = ["list", "show", "why", "stats", "skills", "promote", "decline"] as const;

export interface MemoryCliOptions {
  /** list: include superseded and archived entries. */
  all?: boolean;
  /** why: the request before this one, for a follow-up. */
  previous?: string;
  /** why: print the memory section exactly as the model would get it. */
  full?: boolean;
}

function percent(value: number | undefined): string {
  return value === undefined ? "" : ` ${Math.round(value * 100)}%`;
}

function describe(record: MemoryRecord): string {
  const meta = record.entry.frontmatter.metadata;
  const facts = [
    meta.type,
    `${meta.source ?? "inference"}${percent(meta.confidence)}`,
    ...(meta.uses ? [`used ${meta.uses}×`] : []),
    ...(meta.credit ? [`credit ${meta.credit > 0 ? "+" : ""}${meta.credit}`] : []),
    `since ${(meta.created ?? meta.modified).slice(0, 10)}`,
  ];
  return `  ${record.slug}  ${record.index.hook}\n      ${facts.join(" · ")}`;
}

/** Entries whose files remain although they left the index: superseded, invalidated or archived. */
function retiredRecords(scope: MemoryScope): MemoryRecord[] {
  const dir = memoryDir(scope);
  if (!existsSync(dir)) return [];
  const indexed = new Set(listMemoryRecords(scope).map((record) => record.slug));
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name !== "MEMORY.md")
    .map((name) => name.slice(0, -3))
    .filter((slug) => !indexed.has(slug))
    .flatMap((slug) => {
      try {
        const entry = readMemoryEntry(scope, slug).entry;
        if (!entry) return [];
        const hook = entry.frontmatter.description;
        return [{ slug, index: { title: slug, file: `${slug}.md`, hook }, entry }];
      } catch {
        return [];
      }
    })
    .filter((record) => !isCurrentMemory(record));
}

function list(workspace: string, options: MemoryCliOptions): string {
  const project = listMemoryRecords(projectMemoryScope(workspace));
  const user = listMemoryRecords(userMemoryScope());
  if (project.length === 0 && user.length === 0) {
    return "No memory saved yet. Shelra records what it learns as it works: the rules you state, what failed and what worked.";
  }
  const sections: string[] = [];
  const rules = project.filter(isStandingRule);
  const knowledge = project.filter((record) => !isStandingRule(record));
  if (rules.length > 0)
    sections.push(`Your rules for this project (${rules.length}):\n${rules.map(describe).join("\n")}`);
  if (knowledge.length > 0)
    sections.push(`What Shelra learned here (${knowledge.length}):\n${knowledge.map(describe).join("\n")}`);
  if (user.length > 0) sections.push(`Yours in every project (${user.length}):\n${user.map(describe).join("\n")}`);
  const retired = retiredRecords(projectMemoryScope(workspace));
  if (retired.length > 0) {
    if (options.all) {
      sections.push(
        `No longer current (${retired.length}):\n${retired
          .map((record) => {
            const meta = record.entry.frontmatter.metadata;
            const until = meta.validUntil ? ` until ${meta.validUntil.slice(0, 10)}` : "";
            const by = meta.supersededBy ? `, replaced by ${meta.supersededBy}` : "";
            return `  ${record.slug}  ${record.index.hook}\n      ${meta.status}${until}${by}`;
          })
          .join("\n")}`,
      );
    } else {
      sections.push(`${retired.length} no longer current (superseded or archived): shelra memory list --all`);
    }
  }
  return sections.join("\n\n");
}

function show(workspace: string, slug: string | undefined): { exitCode: number; output: string } {
  if (!slug) return { exitCode: 2, output: "Usage: shelra memory show <slug>" };
  for (const scope of [projectMemoryScope(workspace), userMemoryScope()]) {
    let entry: ReturnType<typeof readMemoryEntry>["entry"];
    try {
      entry = readMemoryEntry(scope, slug).entry;
    } catch {
      return { exitCode: 2, output: `"${slug}" is not a memory entry name.` };
    }
    if (!entry) continue;
    const meta = entry.frontmatter.metadata;
    const lines = [
      `${slug}${scope.kind === "user" ? " (yours in every project)" : ""}`,
      `  ${entry.frontmatter.description}`,
      `  ${meta.type} · ${meta.source ?? "inference"}${percent(meta.confidence)} · ${meta.status ?? "active"}`,
      `  created ${(meta.created ?? meta.modified).slice(0, 10)} · changed ${meta.modified.slice(0, 10)}${meta.lastConfirmed ? ` · confirmed ${meta.lastConfirmed.slice(0, 10)}` : ""}`,
      ...(meta.uses ? [`  used in ${meta.uses} turns${meta.credit ? `, credit ${meta.credit}` : ""}`] : []),
      ...(meta.relatedFiles?.length ? [`  files: ${meta.relatedFiles.join(", ")}`] : []),
      ...(meta.supersedes ? [`  replaces: ${meta.supersedes}`] : []),
      ...(meta.supersededBy ? [`  replaced by: ${meta.supersededBy} (${meta.validUntil?.slice(0, 10) ?? ""})`] : []),
      "",
      entry.body.trim(),
    ];
    const versions = readMemoryVersions(scope, slug);
    if (versions.length > 0) {
      lines.push("", `Earlier versions (${versions.length}):`);
      for (const version of versions) {
        const first = version.body.trim().split("\n")[0] ?? "";
        lines.push(`  ${version.frontmatter.metadata.modified.slice(0, 10)}  ${first.slice(0, 110)}`);
      }
    }
    const history = readMemoryHistory(scope, 2_000).filter((event) => event.slug === slug);
    if (history.length > 0) {
      lines.push("", "History:");
      for (const event of history.slice(-10)) {
        lines.push(
          `  ${event.at.slice(0, 16).replace("T", " ")}  ${event.event}${event.detail ? `  ${event.detail}` : ""}`,
        );
      }
    }
    return { exitCode: 0, output: lines.join("\n") };
  }
  return { exitCode: 1, output: `No memory entry "${slug}" in this project or yours. shelra memory list shows them.` };
}

function why(
  workspace: string,
  request: string | undefined,
  options: MemoryCliOptions,
): { exitCode: number; output: string } {
  if (!request?.trim()) return { exitCode: 2, output: 'Usage: shelra memory why "<request>" [--previous "<request>"]' };
  const context = memoryContextFor(workspace, request, [], options.previous);
  if (!context.text) return { exitCode: 0, output: "No memory saved yet, so a request gets none." };
  if (options.full) return { exitCode: 0, output: context.text };
  const explain = context.explain ?? [];
  const lines = [`For "${request}" Shelra would give the model ${context.text.length} characters of memory:`];
  const tier = (name: string, heading: string) => {
    const items = explain.filter((item) => item.tier === name);
    if (items.length === 0) return;
    lines.push("", heading);
    for (const item of items) lines.push(`  ${item.slug}  (${item.score})  ${item.reasons.join(" · ")}`);
  };
  tier("rule", "Your rules, on every request:");
  tier("knowledge", "Shown in full, most relevant first:");
  tier("episode", "Past attempts shown as lessons:");
  tier("pointer", "Listed by title, readable with memory_read:");
  if (!explain.some((item) => item.tier === "knowledge"))
    lines.push("", "No saved entry matched this request closely enough to show in full.");
  return { exitCode: 0, output: lines.join("\n") };
}

function stats(workspace: string): string {
  const scope = projectMemoryScope(workspace);
  const episodes = readEpisodes(scope, 100_000);
  const outcomes = new Map<string, number>();
  for (const episode of episodes) outcomes.set(episode.outcome, (outcomes.get(episode.outcome) ?? 0) + 1);
  const audit = readReflectionAudit(scope, 100_000);
  const reflected = audit.filter((record) => record.qualified && record.reason !== "the user's own words");
  const failed = reflected.filter((record) => record.error).length;
  const written = audit.reduce((sum, record) => sum + record.written.length, 0);
  const records = listMemoryRecords(scope);
  const bySource = new Map<string, number>();
  for (const record of records) {
    const source = record.entry.frontmatter.metadata.source ?? "inference";
    bySource.set(source, (bySource.get(source) ?? 0) + 1);
  }
  const used = records.filter((record) => (record.entry.frontmatter.metadata.uses ?? 0) > 0).length;
  const credited = records.filter((record) => (record.entry.frontmatter.metadata.credit ?? 0) > 0).length;
  const retired = retiredRecords(scope);
  const statements = [...records, ...retired].filter((record) =>
    (record.entry.frontmatter.metadata.tags ?? []).includes("user-directive"),
  ).length;
  const format = (map: Map<string, number>) =>
    [...map]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => `${key} ${count}`)
      .join(", ") || "none";
  return [
    `Memory of ${workspace}`,
    `  turns that did work: ${episodes.length}${episodes.length > 0 ? ` (${format(outcomes)})` : ""}`,
    `  reflections: ${reflected.length}${failed > 0 ? `, ${failed} could not run` : ""}; waiting for a model: ${pendingReflectionCount(scope)}`,
    `  statements of yours kept: ${statements}`,
    `  entries written: ${written}; current: ${records.length} (${format(bySource)}); no longer current: ${retired.length}`,
    `  entries a turn was given: ${used}; credited by passing checks: ${credited}`,
    `  yours in every project: ${listMemoryRecords(userMemoryScope()).length}`,
    `  skills waiting for your approval: ${listSkillProposals(scope, workspace).length}`,
  ].join("\n");
}

function skills(workspace: string): string {
  const proposals = listSkillProposals(projectMemoryScope(workspace), workspace);
  if (proposals.length === 0) {
    return "No skill waiting for approval. A procedure that helped two turns pass the project's checks is proposed here.";
  }
  const lines = [`Skills proposed from what worked (${proposals.length}); nothing is written until you approve:`];
  for (const proposal of proposals) {
    const heading = proposal.content.match(/^# (.+)$/mu)?.[1] ?? proposal.slug;
    lines.push(`  ${proposal.slug}  ${heading}${proposal.replaces ? "  (updates the existing skill)" : ""}`);
  }
  lines.push(
    "",
    "shelra memory show <slug> shows the procedure; shelra memory promote <slug> adds it, decline <slug> drops it.",
  );
  return lines.join("\n");
}

export function runMemoryCommand(
  workspace: string,
  action = "list",
  argument?: string,
  options: MemoryCliOptions = {},
): { exitCode: number; output: string } {
  switch (action.toLowerCase()) {
    case "list":
      return { exitCode: 0, output: list(workspace, options) };
    case "show":
      return show(workspace, argument);
    case "why":
      return why(workspace, argument, options);
    case "stats":
      return { exitCode: 0, output: stats(workspace) };
    case "skills":
      return { exitCode: 0, output: skills(workspace) };
    case "promote": {
      if (!argument) return { exitCode: 2, output: "Usage: shelra memory promote <slug>" };
      const result = approveSkillProposal(projectMemoryScope(workspace), workspace, argument);
      return { exitCode: result.ok ? 0 : 1, output: result.message };
    }
    case "decline": {
      if (!argument) return { exitCode: 2, output: "Usage: shelra memory decline <slug>" };
      const scope = projectMemoryScope(workspace);
      let revision = 1;
      try {
        revision = readMemoryEntry(scope, argument).entry?.frontmatter.metadata.revision ?? 1;
      } catch {
        return { exitCode: 2, output: `"${argument}" is not a memory entry name.` };
      }
      const result = declineSkillProposal(scope, workspace, argument, revision);
      return { exitCode: result.ok ? 0 : 1, output: result.message };
    }
    default:
      return { exitCode: 2, output: `Unknown action "${action}". Use one of: ${MEMORY_ACTIONS.join(", ")}.` };
  }
}
