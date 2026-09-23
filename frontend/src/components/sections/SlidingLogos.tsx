"use client";

import { AnimatePresence, motion } from "motion/react";
import { startTransition, useEffect, useState } from "react";
import { logos } from "@/lib/content";
import styles from "./SlidingLogos.module.css";

const INTERVAL = 3; // seconds
const SLIDE = 20; // percent
const BLUR = 3; // px
const LOGO_HEIGHT = 60;

// One cell of the logo wall: cycles through its marks, sliding each one up and out.
export function SlidingLogos({ logos: names, delay }: { logos: string[]; delay: number }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (names.length <= 1) return;
    const timer = setInterval(() => {
      startTransition(() => setIndex((i) => (i + 1) % names.length));
    }, INTERVAL * 1000);
    return () => clearInterval(timer);
  }, [names.length]);

  const logo = logos[names[index]];
  const variants = {
    enter: { y: `${SLIDE}%`, opacity: 0, filter: `blur(${BLUR}px)` },
    center: { y: 0, opacity: 1, filter: "blur(0px)" },
    exit: { y: `-${SLIDE}%`, opacity: 0, filter: `blur(${BLUR}px)` },
  };

  return (
    <div className={styles.cell}>
      <AnimatePresence mode="popLayout">
        <motion.div
          key={`logo-${index}`}
          className={styles.slide}
          style={{ height: LOGO_HEIGHT }}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ type: "tween", delay, duration: 0.6, ease: [0.12, 0.23, 0.16, 1] }}
        >
          <span className={styles.mark} title={logo.name}>
            {logo.text}
          </span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
