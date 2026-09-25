import { links } from "@/lib/content";
import styles from "./GitHubStars.module.css";
import { GithubLogoIcon, StarIcon } from "./Icons";

type Props = {
  /** The repository's star count (lib/github.ts); null when GitHub could not be read. */
  stars: number | null;
  /** Phones: the logo and the count only. */
  compact?: boolean;
};

const format = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

// The repository link in the navbar, with its live star count.
export function GitHubStars({ stars, compact = false }: Props) {
  const count = stars === null ? null : format.format(stars);
  const label =
    stars === null
      ? "ShelraCode on GitHub"
      : `ShelraCode on GitHub, ${stars.toLocaleString("en")} ${stars === 1 ? "star" : "stars"}`;
  return (
    <a
      href={links.github}
      target="_blank"
      rel="noopener"
      className={`fb ${styles.stars} ${compact ? styles.compact : ""}`}
      aria-label={label}
      title={label}
    >
      <GithubLogoIcon size={16} strokeWidth={1.75} color="var(--default)" />
      {!compact && (
        <span className="t-small-strong pre" aria-hidden="true">
          Star
        </span>
      )}
      {count !== null && (
        <span className={styles.count} aria-hidden="true">
          <StarIcon size={12} strokeWidth={2} color="var(--accent)" />
          <span className="t-small-mono pre">{count}</span>
        </span>
      )}
    </a>
  );
}
