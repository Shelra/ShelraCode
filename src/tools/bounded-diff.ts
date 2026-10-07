import { createTwoFilesPatch } from "diff";

/** How long one diff may hold the event loop. A normal edit takes a few milliseconds. */
export const DIFF_BUDGET_MS = 150;

export interface BoundedDiff {
  additions: number;
  removals: number;
  patch: string;
  /** False when the file changed too much to diff line by line inside the budget. */
  exact: boolean;
}

function countLines(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  if (text === "") return counts;
  for (const line of text.split("\n")) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
}

/**
 * Lines gained and lost, without aligning them: the lines of each side that the other does not have, as a multiset.
 * Linear in the size of the files, so it never stalls; it equals the exact count when no line only moved.
 */
function approximateCounts(before: string, after: string): { additions: number; removals: number } {
  const remaining = countLines(before);
  let additions = 0;
  if (after !== "") {
    for (const line of after.split("\n")) {
      const left = remaining.get(line) ?? 0;
      if (left > 0) remaining.set(line, left - 1);
      else additions += 1;
    }
  }
  let removals = 0;
  for (const left of remaining.values()) removals += left;
  return { additions, removals };
}

function countPatchLines(patch: string): { additions: number; removals: number } {
  let additions = 0;
  let removals = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) removals += 1;
  }
  return { additions, removals };
}

/**
 * The unified patch of a change, within a time budget.
 *
 * A line diff costs O(lines × changed lines): rewriting an 8,000-line file where half the lines change held the
 * terminal for 15 seconds (measured 2026-10-06), with no way to cancel. Past the budget the change is reported by
 * its size instead, in the same patch format, so the transcript still says what happened.
 */
export function boundedPatch(
  filePath: string,
  before: string,
  after: string,
  budgetMs: number = DIFF_BUDGET_MS,
): BoundedDiff {
  const patch = createTwoFilesPatch(filePath, filePath, before, after, "", "", {
    context: 3,
    timeout: budgetMs,
  }) as string | undefined;
  if (patch !== undefined) return { ...countPatchLines(patch), patch, exact: true };

  const { additions, removals } = approximateCounts(before, after);
  const oldLines = before === "" ? 0 : before.split("\n").length;
  const newLines = after === "" ? 0 : after.split("\n").length;
  const note = `  [${filePath} changed too much to show line by line: about +${additions} −${removals} lines; it was written in full]`;
  const patchText = [
    `--- ${filePath}`,
    `+++ ${filePath}`,
    `@@ -${oldLines === 0 ? 0 : 1},${oldLines} +${newLines === 0 ? 0 : 1},${newLines} @@`,
    note,
    "",
  ].join("\n");
  return { additions, removals, patch: patchText, exact: false };
}
