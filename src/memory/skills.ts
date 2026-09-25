import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordSwallowedError } from "../utils/diagnostics";
import { looksInjectionShaped } from "./gate";
import { ensureMemoryDir, memoryDir, recordMemoryPromotion } from "./store";
import type { MemoryRecord, MemoryScope } from "./types";

/**
 * Knowledge → skill, on the user's yes. A `procedure` memory that was injected into at least two turns whose project
 * checks then passed (its credit, audit doc 15 M3: being retrieved is not the same as helping) and that came from a
 * trustworthy source is reusable capability, not just a fact. A skill changes how Shelra works in this project, and
 * that must never happen silently (docs/architecture/18-MEMORY-V2.md §8): the procedure is proposed under
 * `.shelra/memory/skill-proposals/`, and only `shelra memory promote <slug>` writes `.agents/skills/<slug>/SKILL.md`,
 * where the skill loader surfaces it. A changed procedure is proposed again; a declined one is not, until it changes.
 */

export interface PromotionOptions {
  /** Passing turns the entry must have been part of. */
  minCredit?: number;
  minConfidence?: number;
}

export interface ProposalResult {
  proposed: string[];
  skipped: Array<{ slug: string; reason: string }>;
}

export interface SkillProposal {
  slug: string;
  /** The SKILL.md that approval would write. */
  content: string;
  /** Whether it would replace a skill already in the project. */
  replaces: boolean;
}

const DEFAULT_MIN_CREDIT = 2;
const DEFAULT_MIN_CONFIDENCE = 0.6;
const PROPOSALS_DIR = "skill-proposals";
const DECLINED_FILE = "declined.json";

export function skillPathFor(workspace: string, slug: string): string {
  return join(workspace, ".agents", "skills", slug, "SKILL.md");
}

function proposalsDir(scope: MemoryScope): string {
  return join(memoryDir(scope), PROPOSALS_DIR);
}

function renderSkill(record: MemoryRecord): string {
  const meta = record.entry.frontmatter.metadata;
  const description = `This skill should be used when working on ${record.index.hook.replace(/"/gu, "'")} in this repository.`;
  return [
    "---",
    `name: ${record.slug}`,
    `description: "${description.replace(/\\/gu, "\\\\")}"`,
    "---",
    "",
    `# ${record.index.title}`,
    "",
    record.entry.body.trim(),
    "",
    "## Provenance",
    "",
    // Only what the procedure says: a counter that grows with every passing turn would make an approved skill look
    // changed and be proposed again (doc 18 review, round 3).
    `Promoted from project memory \`${record.slug}\` (${meta.source ?? "inference"}) with the user's approval, after it helped the project's checks pass.`,
    "If this procedure stops working, correct the memory entry with memory_write; the new version is proposed again.",
    "",
  ].join("\n");
}

function readDeclined(scope: MemoryScope): Record<string, number> {
  try {
    const path = join(proposalsDir(scope), DECLINED_FILE);
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/**
 * Proposes each procedure that has earned it as a skill, for the user to approve. Idempotent: nothing is proposed that
 * the project's skill already says, that is already waiting, or that the user declined at this revision. Never throws.
 */
export function proposeProceduresAsSkills(
  scope: MemoryScope,
  workspace: string,
  records: readonly MemoryRecord[],
  options: PromotionOptions = {},
): ProposalResult {
  const minCredit = options.minCredit ?? DEFAULT_MIN_CREDIT;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const result: ProposalResult = { proposed: [], skipped: [] };
  const declined = readDeclined(scope);
  for (const record of records) {
    const meta = record.entry.frontmatter.metadata;
    if (meta.type !== "procedure") continue;
    if ((meta.credit ?? 0) < minCredit) {
      result.skipped.push({
        slug: record.slug,
        reason: `credited in ${meta.credit ?? 0} passing turns, needs ${minCredit}`,
      });
      continue;
    }
    const trusted = meta.source === "human" || meta.source === "observed" || (meta.confidence ?? 0) >= minConfidence;
    if (!trusted) {
      result.skipped.push({ slug: record.slug, reason: "confidence too low for a standing skill" });
      continue;
    }
    if (record.entry.body.trim().length < 80 || looksInjectionShaped(record.entry.body)) {
      result.skipped.push({ slug: record.slug, reason: "body too short or instruction-shaped" });
      continue;
    }
    if (declined[record.slug] === (meta.revision ?? 1)) {
      result.skipped.push({ slug: record.slug, reason: "declined by the user at this revision" });
      continue;
    }
    const rendered = renderSkill(record);
    try {
      const skill = skillPathFor(workspace, record.slug);
      if (existsSync(skill) && readFileSync(skill, "utf8") === rendered) {
        result.skipped.push({ slug: record.slug, reason: "skill already current" });
        continue;
      }
      const proposal = join(proposalsDir(scope), `${record.slug}.md`);
      if (existsSync(proposal) && readFileSync(proposal, "utf8") === rendered) {
        result.skipped.push({ slug: record.slug, reason: "already waiting for approval" });
        continue;
      }
      ensureMemoryDir(scope);
      mkdirSync(proposalsDir(scope), { recursive: true });
      writeFileSync(proposal, rendered, "utf8");
      result.proposed.push(record.slug);
    } catch (error) {
      recordSwallowedError("memory.skill-proposal", error);
      result.skipped.push({ slug: record.slug, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

/** The skills waiting for the user's approval. */
export function listSkillProposals(scope: MemoryScope, workspace: string): SkillProposal[] {
  try {
    const dir = proposalsDir(scope);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .map((name) => {
        const slug = name.slice(0, -3);
        return {
          slug,
          content: readFileSync(join(dir, name), "utf8"),
          replaces: existsSync(skillPathFor(workspace, slug)),
        };
      });
  } catch {
    return [];
  }
}

/** Writes an approved proposal as the project's skill. */
export function approveSkillProposal(
  scope: MemoryScope,
  workspace: string,
  slug: string,
): { ok: boolean; message: string } {
  const proposal = listSkillProposals(scope, workspace).find((item) => item.slug === slug);
  if (!proposal) return { ok: false, message: `No skill proposal "${slug}". shelra memory skills lists them.` };
  const path = skillPathFor(workspace, slug);
  mkdirSync(join(workspace, ".agents", "skills", slug), { recursive: true });
  writeFileSync(path, proposal.content, "utf8");
  rmSync(join(proposalsDir(scope), `${slug}.md`), { force: true });
  recordMemoryPromotion(scope, slug, `skill written to ${path} on the user's approval`);
  return { ok: true, message: `${proposal.replaces ? "Updated" : "Added"} the skill ${path}.` };
}

/** Drops a proposal and does not propose the same revision again. */
export function declineSkillProposal(
  scope: MemoryScope,
  workspace: string,
  slug: string,
  revision: number,
): { ok: boolean; message: string } {
  if (!listSkillProposals(scope, workspace).some((item) => item.slug === slug)) {
    return { ok: false, message: `No skill proposal "${slug}". shelra memory skills lists them.` };
  }
  const declined = { ...readDeclined(scope), [slug]: revision };
  writeFileSync(join(proposalsDir(scope), DECLINED_FILE), `${JSON.stringify(declined, null, 2)}\n`, "utf8");
  rmSync(join(proposalsDir(scope), `${slug}.md`), { force: true });
  return { ok: true, message: `Declined. "${slug}" is not proposed again unless the procedure changes.` };
}
