"use client";

import { motion, type Transition } from "motion/react";
import { type CSSProperties, type ReactNode, useRef } from "react";
import { useInView } from "@/lib/useInView";

// Framer's "Appear" effect: start hidden and animate in once the layer is in view.
export const easeAppear = [0.12, 0.23, 0.17, 0.99] as const;

type Props = {
  children: ReactNode;
  id?: string;
  className?: string;
  style?: CSSProperties;
  /** Starting state of the layer. */
  from?: { opacity?: number; y?: number; x?: number };
  transition?: Transition;
  /** Fraction of the layer that must be visible before it animates (Framer's threshold). */
  threshold?: number;
  /** Animate on mount instead of waiting for the layer to be in view. */
  onMount?: boolean;
  as?: "div" | "section" | "header";
};

export function Appear({
  children,
  id,
  className,
  style,
  from = { opacity: 0, y: 40 },
  transition = { type: "tween", duration: 1, ease: easeAppear },
  threshold = 0.5,
  onMount = false,
  as = "div",
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, threshold);
  const show = onMount || inView;
  const Tag = motion[as];
  return (
    <Tag
      ref={ref}
      id={id}
      className={className}
      style={style}
      initial={{ opacity: from.opacity ?? 0, y: from.y ?? 0, x: from.x ?? 0 }}
      animate={show ? { opacity: 1, y: 0, x: 0 } : undefined}
      transition={transition}
    >
      {children}
    </Tag>
  );
}
