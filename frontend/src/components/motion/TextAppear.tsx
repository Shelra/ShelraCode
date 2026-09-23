"use client";

import { motion } from "motion/react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

/*
 * Framer's text "Appear" effect with word or line tokenization: every token
 * starts blurred, transparent and shifted down, then animates in with a
 * staggered delay. Lines are measured from the rendered layout so the line
 * tokens match what the browser actually wrapped.
 */
type Props = {
  text: string;
  tokenization: "word" | "line";
  blur: number;
  y: number;
  startDelay: number;
  stagger?: number;
  duration: number;
  as: "h1" | "h2" | "p";
  className?: string;
  style?: React.CSSProperties;
};

const ease = [0.12, 0.23, 0.17, 0.98] as const;
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function TextAppear({
  text,
  tokenization,
  blur,
  y,
  startDelay,
  stagger = 0.05,
  duration,
  as: Tag,
  className,
  style,
}: Props) {
  const words = text.split(" ");
  const ref = useRef<HTMLElement>(null);
  // Line index of every word, measured after layout (only used for line tokenization).
  const [lines, setLines] = useState<number[] | null>(null);

  useIsoLayoutEffect(() => {
    if (tokenization !== "line") return;
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const spans = Array.from(el.querySelectorAll<HTMLElement>("[data-word]"));
      const tops: number[] = [];
      const result = spans.map((span) => {
        const top = Math.round(span.offsetTop);
        let i = tops.findIndex((t) => Math.abs(t - top) < 2);
        if (i === -1) {
          tops.push(top);
          i = tops.length - 1;
        }
        return i;
      });
      setLines(result);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tokenization, text]);

  const tokenIndex = (wordIndex: number) => (tokenization === "word" ? wordIndex : (lines?.[wordIndex] ?? 0));
  const ready = tokenization === "word" || lines !== null;

  const content: ReactNode[] = words.map((word, i) => (
    <motion.span
      // biome-ignore lint/suspicious/noArrayIndexKey: words repeat, their position is the identity
      key={`${i}-${word}`}
      data-word=""
      style={{ display: "inline-block", whiteSpace: "pre" }}
      initial={{ opacity: 0.001, y, filter: `blur(${blur}px)` }}
      animate={ready ? { opacity: 1, y: 0, filter: "blur(0px)" } : undefined}
      transition={{ type: "tween", duration, ease, delay: startDelay + stagger * tokenIndex(i) }}
    >
      {word}
    </motion.span>
  ));
  // Framer keeps the spaces between the word spans, outside the animated boxes.
  const spaced: ReactNode[] = [];
  content.forEach((span, i) => {
    if (i > 0) spaced.push(" ");
    spaced.push(span);
  });

  const Component = motion[Tag];
  return (
    <Component ref={ref as never} className={className} style={style}>
      {spaced}
    </Component>
  );
}
