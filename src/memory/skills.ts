import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { looksInjectionShaped } from "./gate";
import { recordMemoryPromotion } from "./store";
import type { MemoryRecord, MemoryScope } from "./types";

/**
 * Knowledge → skill. A `procedure` memory that retrieval has injected into at least two turns and
 * that came from a trustworthy source is reusable capability, not just a fact; it is promoted to a
 * project skill under `.agents/skills/<slug>/SKILL.md`, where the existing skill loader surfaces it
 * with progressive disclosure (name + description always, body on demand). Promotion is
 * deterministic and idempotent: the skill file is rewritten only when the memory changed after it.
 */

export interface PromotionOptions {
  minUses?: number;
  minConfidence?: number;
  now?: number;
}

export interface PromotionResult {
  promoted: string[];
  skipped: Array<{ slug: string; reason: string }>;
}

const DEFAULT_MIN_USES = 2;
const DEFAULT_MIN_CONFIDENCE = 0.6;

export function skillPathFor(workspace: string, slug: string): string {
  return join(workspace, ".agents", "skills", slug, "SKILL.md");
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
    `Promoted automatically from project memory \`${record.slug}\` (source: ${meta.source ?? "inference"}, confidence ${Math.round((meta.confidence ?? 0.6) * 100)}%, used in ${meta.uses ?? 0} turns${meta.lastConfirmed ? `, last confirmed ${meta.lastConfirmed.slice(0, 10)}` : ""}).`,
    "If this procedure stops working, correct the memory entry with memory_write and the skill will be regenerated.",
    "",
  ].join("\n");
}

export function promoteProceduresToSkills(
  scope: MemoryScope,
  workspace: string,
  records: readonly MemoryRecord[],
  options: PromotionOptions = {},
): PromotionResult {
  const minUses = options.minUses ?? DEFAULT_MIN_USES;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const result: PromotionResult = { promoted: [], skipped: [] };
  for (const record of records) {
    const meta = record.entry.frontmatter.metadata;
    if (meta.type !== "procedure") continue;
    if ((meta.uses ?? 0) < minUses) {
      result.skipped.push({ slug: record.slug, reason: `used ${meta.uses ?? 0} times, needs ${minUses}` });
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
    const path = skillPathFor(workspace, record.slug);
    if (existsSync(path)) {
      const rendered = renderSkill(record);
      try {
        const current = readFileSync(path, "utf8");
        const skillNewer = statSync(path).mtimeMs >= Date.parse(meta.modified);
        if (current === rendered || skillNewer) {
          result.skipped.push({ slug: record.slug, reason: "skill already current" });
          continue;
        }
      } catch {
        // fall through and rewrite
      }
    }
    try {
      mkdirSync(join(workspace, ".agents", "skills", record.slug), { recursive: true });
      writeFileSync(path, renderSkill(record), "utf8");
      recordMemoryPromotion(scope, record.slug, `skill written to ${path}`);
      result.promoted.push(record.slug);
    } catch (error) {
      result.skipped.push({ slug: record.slug, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
