import styles from "./Noise.module.css";

// Film-grain overlay covering the whole page.
export function Noise() {
  return (
    <div className={styles.noise} aria-hidden="true">
      <div className={styles.tile} />
    </div>
  );
}
