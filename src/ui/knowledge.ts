/**
 * View model for "What Shelra knows about this project": saved memory (with provenance and
 * freshness), user-wide standing rules, and the skills that can be loaded. Read straight from the
 * same stores the agent uses, so the panel can never disagree with what the model is given.
 */

import { detectStaleness } from "../memory/retrieval";
import { listMemoryRecords, listUserMemoryRecords, projectMemoryScope } from "../memory/store";
import type { MemoryRecord } from "../memory/types";
import { discoverSkills } from "../utils/skills";
import { compactCwd } from "./paths";

export type KnowledgeTab = "memory" | "skills" | "user";

export interface KnowledgeRow {
  /** Stable key: scope + slug. */
  key: string;
  slug: string;
  title: string;
  type: string;
  hook: string;
  /** "observed · 90% · used 3× · confirmed 2d ago". */
  facts: string;
  /** Why a reader should distrust it, when they should. */
  stale: string | null;
  body: string;
  scope: "project" | "user";
}

export interface SkillRow {
  key: string;
  name: string;
  description: string;
  scope: "project" | "global";
  location: string;
  /** Review flags raised by the skill loader, in words. */
  warnings: string[];
}

export interface Knowledge {
  memory: KnowledgeRow[];
  user: KnowledgeRow[];
  skills: SkillRow[];
}

const DAY_MS = 86_400_000;

export function formatAge(iso: string | undefined, now: number): string | null {
  const then = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(then)) return null;
  const days = Math.floor((now - then) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function rowFor(record: MemoryRecord, scope: "project" | "user", workspace: string, now: number): KnowledgeRow {
  const meta = record.entry.frontmatter.metadata;
  const stale = scope === "project" ? detectStaleness(workspace, record, now) : { stale: false as const };
  const confirmed = formatAge(meta.lastConfirmed ?? meta.modified, now);
  const facts = [
    meta.source ?? "inference",
    meta.confidence !== undefined ? `${Math.round(meta.confidence * 100)}%` : null,
    `used ${meta.uses ?? 0}×`,
    confirmed ? `confirmed ${confirmed}` : null,
  ]
    .filter((fact): fact is string => fact !== null)
    .join(" · ");
  return {
    key: `${scope}:${record.slug}`,
    slug: record.slug,
    title: record.index.title,
    type: meta.type,
    hook: record.index.hook,
    facts,
    stale: stale.stale ? (stale.reason ?? "may be out of date") : null,
    body: record.entry.body.trim(),
    scope,
  };
}

const REVIEW_TEXT: Record<string, string> = {
  "prompt-injection-shaped": "contains instruction-like text; read it before trusting",
  "missing-description": "has no description",
  "overly-broad-description": "description is too broad to select reliably",
};

export function buildKnowledge(workspace: string, now = Date.now(), home?: string): Knowledge {
  const byType = (a: KnowledgeRow, b: KnowledgeRow) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title);
  const memory = listMemoryRecords(projectMemoryScope(workspace))
    .map((record) => rowFor(record, "project", workspace, now))
    .sort(byType);
  const user = listUserMemoryRecords()
    .map((record) => rowFor(record, "user", workspace, now))
    .sort(byType);
  const skills = discoverSkills(workspace).map<SkillRow>((skill) => ({
    key: `${skill.scope}:${skill.name}`,
    name: skill.name,
    description: skill.description,
    scope: skill.scope === "user" ? "global" : "project",
    location: compactCwd(skill.rootDir, 48, home),
    warnings: skill.review.flags.map((flag) => REVIEW_TEXT[flag] ?? flag),
  }));
  return { memory, user, skills };
}
