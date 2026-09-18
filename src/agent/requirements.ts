/**
 * Requirement extraction from a request, for the completion gate's requirement audit.
 *
 * The hard tasks a mid-tier model fails are the ones whose prompt states five to eight
 * behaviors in prose; the model implements the ones its own tests happen to cover, sees green,
 * and reports done. The gate uses this list to demand one real check per stated behavior
 * instead of "some verification ran". Deterministic and conservative: only sentences that read
 * as obligations, quoted verbatim, never the model's paraphrase.
 */

const OBLIGATION_RE =
  /\b(must|should|has to|have to|needs? to|never|always|only|reject|preserve|return|support|default|throw|treat|allow|stop|record|validate|expose|accept|include|ensure|keep|implement|complete|migrate)\b/iu;
/** Sentences that tell the agent how to work, not what the code must do. */
const PROCESS_RE = /^(run|do not modify|don't modify|please run|then run|use the|make sure to run)\b/iu;
const MAX_REQUIREMENTS = 10;
/** Behavior separators inside one obligation sentence: "trim X, move Y, and preserve Z". */
const BEHAVIOR_SEPARATOR_RE = /,\s+(?:and\s+)?|;\s+/gu;

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/gu, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z`"'(])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** Obligation-shaped sentences from the request, in order, capped and deduplicated. */
export function extractRequirements(prompt: string): string[] {
  const seen = new Set<string>();
  const requirements: string[] = [];
  for (const sentence of splitSentences(prompt)) {
    if (sentence.length < 12 || sentence.length > 400) continue;
    if (!OBLIGATION_RE.test(sentence) || PROCESS_RE.test(sentence)) continue;
    const key = sentence.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    requirements.push(sentence);
    if (requirements.length >= MAX_REQUIREMENTS) break;
  }
  return requirements;
}

/**
 * Rough count of distinct behaviors the requirements name. One sentence that enumerates six
 * behaviors with commas counts as six; the audit fires on this, not on the sentence count.
 */
export function countStatedBehaviors(requirements: readonly string[]): number {
  let total = 0;
  for (const requirement of requirements) {
    const parts = requirement.split(BEHAVIOR_SEPARATOR_RE).filter((part) => part.trim().split(" ").length >= 2);
    total += Math.max(1, parts.length);
  }
  return total;
}

/** True when the request names enough behaviors that one green run is weak evidence for all of them. */
export function isRequirementDense(prompt: string): boolean {
  return countStatedBehaviors(extractRequirements(prompt)) >= 3;
}
