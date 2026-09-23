"use client";

import { motion } from "motion/react";
import { useState } from "react";
import styles from "./Button.module.css";
import { ArrowRightIcon } from "./Icons";

export type ButtonVariant = "primary-md" | "primary-sm" | "secondary-md" | "secondary-sm";

type Props = {
  text: string;
  /** Link target; without it the button submits the form it sits in. */
  href?: string;
  variant?: ButtonVariant;
  showIcon?: boolean;
  newTab?: boolean;
  className?: string;
  onClick?: () => void;
  /** Submit buttons only: greyed out and inert (e.g. while the form is pending). */
  disabled?: boolean;
  /** Without `href`: "submit" (default) submits the form around it, "button" only runs onClick. */
  type?: "submit" | "button";
};

const spring = { type: "spring", bounce: 0.2, duration: 0.4 } as const;

// The site's Button component with its four variants and hover states.
export function Button({
  text,
  href,
  variant = "primary-md",
  showIcon = false,
  newTab = true,
  className,
  onClick,
  disabled = false,
  type = "submit",
}: Props) {
  const [hover, setHover] = useState(false);
  const primary = variant.startsWith("primary");
  const small = variant.endsWith("sm");

  const background = primary
    ? hover
      ? "var(--hover)"
      : "var(--accent)"
    : hover
      ? "var(--accent-16)"
      : "var(--accent-0)";
  const shadow = primary ? (hover ? "0px 0px 20px 0px var(--accent-16)" : "0px 0px 0px 0px var(--accent-16)") : "none";

  const shared = {
    className: `${styles.button} ${small ? styles.small : ""} ${hover ? styles.hover : ""} ${className ?? ""}`,
    onHoverStart: () => setHover(true),
    onHoverEnd: () => setHover(false),
    animate: { backgroundColor: background, boxShadow: shadow },
    transition: spring,
    initial: false as const,
    onClick,
  };
  const content = (
    <>
      <p className={`t-body-mono pre ${styles.label}`} style={{ color: primary ? "var(--on-light)" : "var(--accent)" }}>
        {text}
      </p>
      {showIcon && (
        <div className={styles.icon}>
          <ArrowRightIcon size={12} strokeWidth={2.5} color={primary ? "rgb(0, 0, 0)" : "var(--accent)"} />
          <ArrowRightIcon size={12} strokeWidth={2.5} color={primary ? "rgb(0, 0, 0)" : "var(--accent)"} />
        </div>
      )}
    </>
  );

  if (href === undefined) {
    return (
      <motion.button type={type} disabled={disabled} {...shared}>
        {content}
      </motion.button>
    );
  }
  return (
    <motion.a href={href} target={newTab ? "_blank" : undefined} rel={newTab ? "noopener" : undefined} {...shared}>
      {content}
    </motion.a>
  );
}
