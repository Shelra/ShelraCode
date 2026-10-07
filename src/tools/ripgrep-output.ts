/** Matches parsed and ranked by recency. More than this is a search to narrow, and handling them all froze the terminal. */
export const MAX_RANKED_MATCHES = 5_000;
const MATCH_LINE = '{"type":"match"';

/**
 * The first `limit` match lines of ripgrep's JSON output, and how many there were in all. A search matching 180,000
 * lines is 40 MB of text: nothing past the first few thousand is ever shown, so the rest is counted and dropped
 * before it is copied or parsed anywhere.
 */
export function trimRipgrepOutput(
  stdout: string,
  limit: number = MAX_RANKED_MATCHES,
): { stdout: string; total: number } {
  const kept: string[] = [];
  let total = 0;
  let position = 0;
  while (position < stdout.length) {
    let end = stdout.indexOf(String.fromCharCode(10), position);
    if (end === -1) end = stdout.length;
    if (stdout.startsWith(MATCH_LINE, position)) {
      total += 1;
      if (kept.length < limit) kept.push(stdout.slice(position, end));
    }
    position = end + 1;
  }
  return { stdout: kept.join(String.fromCharCode(10)), total };
}
