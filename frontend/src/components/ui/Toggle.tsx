"use client";

import { motion } from "motion/react";
import styles from "./Toggle.module.css";

const spring = { type: "spring", bounce: 0.2, duration: 0.4 } as const;

// The free / paid policy switch of the pricing section: a native button, so it is focusable and toggles
// with Enter and Space.
export function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <motion.button
      type="button"
      className={`fb ${styles.toggle}`}
      onClick={(event) => {
        // The phone layout makes the whole row a tap target; one tap must toggle once.
        event.stopPropagation();
        onToggle();
      }}
      initial={false}
      animate={{ backgroundColor: on ? "var(--accent)" : "var(--base)" }}
      transition={spring}
      role="switch"
      aria-checked={on}
      aria-label={label}
    >
      <motion.span
        className={styles.knob}
        initial={false}
        animate={{ left: on ? 20 : 4, backgroundColor: on ? "var(--on-light)" : "var(--default)" }}
        transition={spring}
      />
    </motion.button>
  );
}
