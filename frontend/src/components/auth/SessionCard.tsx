"use client";

import { motion } from "motion/react";
import { CheckIcon } from "@/components/ui/Icons";
import type { CardLine } from "@/lib/content";
import styles from "./SessionCard.module.css";

const ease = [0.12, 0.23, 0.17, 0.99] as const;

const lineClass: Record<Exclude<CardLine["type"], "rule">, string> = {
  cmd: "t-body wrap",
  out: "t-body wrap",
  ok: "t-small-strong wrap",
  live: `t-small-strong wrap ${styles.live}`,
};

/*
 * A terminal session that types itself out, in the style of the feature
 * illustrations: a command, its output, a divider, the checks and one live
 * line with a blinking cursor. The card carries the offset back border of
 * the feature cards.
 */
export function SessionCard({ lines, startDelay = 0.6 }: { lines: CardLine[]; startDelay?: number }) {
  return (
    <div className={styles.wrap}>
      <div className={`fb ${styles.back}`} />
      <motion.div
        className={`fb ${styles.card}`}
        initial={{ opacity: 0.001, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "tween", delay: 0.3, duration: 1, ease }}
      >
        {lines.map((line, i) => {
          const delay = startDelay + 0.18 * i;
          if (line.type === "rule") {
            return (
              <motion.div
                key="rule"
                className={styles.rule}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay, duration: 0.4 }}
              />
            );
          }
          return (
            <motion.div
              key={line.text}
              className={styles.line}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "tween", delay, duration: 0.6, ease }}
            >
              {line.type === "ok" && (
                <CheckIcon size={16} strokeWidth={2} color="var(--accent)" className={styles.check} />
              )}
              <p className={lineClass[line.type]}>
                {line.text}
                {line.type === "live" && <span className={styles.cursor} aria-hidden="true" />}
              </p>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
