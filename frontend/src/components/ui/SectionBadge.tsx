import styles from "./SectionBadge.module.css";

// The "[ LABEL ]" mono badge that opens every section.
export function SectionBadge({ text }: { text: string }) {
  return (
    <div className={styles.badge}>
      <p className={`t-small-mono pre ${styles.bracket}`}>[</p>
      <p className={`t-small-mono pre ${styles.text}`}>{text}</p>
      <p className={`t-small-mono pre ${styles.bracket}`}>]</p>
    </div>
  );
}
