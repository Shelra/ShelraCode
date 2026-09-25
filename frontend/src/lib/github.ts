import { repoSlug } from "./content";

/*
 * The repository's star count for the navbar, read from GitHub's API on the server. The response is cached for
 * an hour and the pages that show it are regenerated in the background, so a visitor never calls GitHub and the
 * count is at most an hour old. GITHUB_TOKEN, when set, raises the API's rate limit; it is optional. Any failure
 * (rate limit, timeout, GitHub down) returns null and the navbar shows the link without a count.
 */
const TIMEOUT_MS = 4_000;

export async function getRepoStars(): Promise<number | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "shelra-website",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    // A plain timer rather than an abort signal: a signal would opt the request out of per-render memoization.
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
    const response = await Promise.race([
      fetch(`https://api.github.com/repos/${repoSlug}`, { headers, next: { revalidate: 3600 } }),
      timeout,
    ]);
    if (!response?.ok) return null;
    const data = (await response.json()) as { stargazers_count?: unknown };
    return typeof data.stargazers_count === "number" ? data.stargazers_count : null;
  } catch {
    return null;
  }
}
