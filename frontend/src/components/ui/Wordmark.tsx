import styles from "./Wordmark.module.css";

/*
 * The ShelraCode wordmark: a prompt, the name and a block cursor, set in the
 * site's mono. Text, not an image, so it is crisp at any size and follows the
 * tokens. `size` is the cap height in pixels.
 */
export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className={styles.wordmark} style={{ fontSize: size }} role="img" aria-label="ShelraCode">
      <span className={styles.prompt} aria-hidden="true">
        $
      </span>
      <span className={styles.name} aria-hidden="true">
        shelra
      </span>
      <span className={styles.cursor} aria-hidden="true" />
    </span>
  );
}
