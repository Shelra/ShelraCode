"use client";

import { motion } from "motion/react";
import { useState } from "react";
import type { IconProps } from "./Icons";
import styles from "./SocialsButton.module.css";

type Props = {
  href: string;
  icon: (props: IconProps) => React.JSX.Element;
  /** The tablet/phone variant is always tinted; desktop tints on hover. */
  mobile?: boolean;
};

const spring = { type: "spring", bounce: 0.2, duration: 0.4 } as const;

// Square social link of the footer.
export function SocialsButton({ href, icon: Icon, mobile = false }: Props) {
  const [hover, setHover] = useState(false);
  const active = mobile || hover;
  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noopener"
      className={`${styles.button} ${mobile ? styles.mobile : ""}`}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      initial={false}
      animate={{ backgroundColor: active ? "var(--accent-16)" : "var(--accent-0)" }}
      transition={spring}
    >
      <motion.div
        className={styles.icon}
        initial={false}
        animate={{ color: active ? "var(--accent)" : "var(--default)" }}
        transition={spring}
      >
        <Icon size={24} strokeWidth={1.5} color="currentColor" />
      </motion.div>
    </motion.a>
  );
}
