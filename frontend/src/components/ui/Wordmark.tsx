import { LogoMark } from "./LogoMark";
import styles from "./Wordmark.module.css";

/*
 * The ShelraCode logo: the official mark (the favicon's chevron and cursor) and the name, set in the site's
 * mono. The name is text, so it is crisp at any size and follows the tokens; public/brand/shelra-logo.svg is
 * the same logo outlined, for use outside the site. `size` is the font size in pixels.
 */
export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className={styles.wordmark} style={{ fontSize: size }} role="img" aria-label="ShelraCode">
      <LogoMark className={styles.mark} />
      <span className={styles.name} aria-hidden="true">
        shelra
      </span>
    </span>
  );
}
