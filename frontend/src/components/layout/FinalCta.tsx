"use client";

import { motion } from "motion/react";
import { useRef } from "react";
import { TextAppear } from "@/components/motion/TextAppear";
import { Button } from "@/components/ui/Button";
import { finalCta } from "@/lib/content";
import { useInView } from "@/lib/useInView";
import styles from "./FinalCta.module.css";

const ease = [0.12, 0.23, 0.17, 0.99] as const;

// Closing call to action with the fading dashboard shot (part of the site layout).
export function FinalCta() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, 0.5);
  return (
    <header className={styles.cta}>
      <div className={styles.content} ref={ref}>
        <div className={styles.texts}>
          {inView ? (
            <TextAppear
              as="h2"
              text={finalCta.heading}
              tokenization="word"
              blur={4}
              y={12}
              startDelay={0}
              duration={0.8}
              className={`t-h2 wrap ${styles.heading}`}
              style={{ textAlign: "center" }}
            />
          ) : (
            <h2 className={`t-h2 wrap ${styles.heading}`} style={{ textAlign: "center", opacity: 0 }}>
              {finalCta.heading}
            </h2>
          )}
          <p className={`t-small balance ${styles.supporting}`} style={{ textAlign: "center" }}>
            {finalCta.supporting}
          </p>
        </div>
        <motion.div
          className={styles.button}
          initial={{ opacity: 0.001, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ type: "tween", delay: 0.4, duration: 1.5, ease }}
        >
          <Button text={finalCta.button} href={finalCta.link} variant="primary-md" showIcon />
        </motion.div>
      </div>
      <motion.div
        className={`fb ${styles.dash}`}
        initial={{ opacity: 0.001, y: 40 }}
        animate={inView ? { opacity: 1, y: 0 } : undefined}
        transition={{ type: "tween", delay: 0.3, duration: 1, ease }}
      >
        <img
          src={finalCta.image.src}
          alt={finalCta.image.alt}
          width={finalCta.image.width}
          height={finalCta.image.height}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      </motion.div>
    </header>
  );
}
