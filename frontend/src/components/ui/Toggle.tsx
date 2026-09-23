"use client";

import { motion } from "motion/react";
import styles from "./Toggle.module.css";

const spring = { type: "spring", bounce: 0.2, duration: 0.4 } as const;

// Monthly / yearly switch of the pricing section.
export function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <motion.div
      className={`fb ${styles.toggle}`}
      onClick={onToggle}
      initial={false}
      animate={{ backgroundColor: on ? "var(--accent)" : "var(--base)" }}
      transition={spring}
      role="switch"
      aria-checked={on}
    >
      <motion.div
        className={styles.knob}
        initial={false}
        animate={{ left: on ? 20 : 4, backgroundColor: on ? "var(--on-light)" : "var(--default)" }}
        transition={spring}
      />
    </motion.div>
  );
}
