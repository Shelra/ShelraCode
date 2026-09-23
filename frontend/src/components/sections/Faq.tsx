"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Appear } from "@/components/motion/Appear";
import { PlusIcon } from "@/components/ui/Icons";
import { faq } from "@/lib/content";
import styles from "./Faq.module.css";
import { SectionHeading } from "./SectionHeading";
import shared from "./sections.module.css";

const ease = [0.12, 0.23, 0.17, 0.99] as const;
const itemTransition = { type: "tween", duration: 0.4, ease } as const;
const textTransition = { type: "tween", duration: 0.6, ease } as const;

export function Faq() {
  return (
    <Appear
      as="section"
      id="faq"
      className={`${shared.section} ${shared.faq}`}
      from={{ opacity: 0 }}
      transition={{ type: "spring", damping: 30, stiffness: 400, mass: 1 }}
      threshold={0}
    >
      <Appear
        className={styles.text}
        from={{ opacity: 0 }}
        transition={{ type: "spring", damping: 60, stiffness: 300, mass: 1 }}
      >
        <SectionHeading
          badge={faq.badge}
          heading={faq.heading as [string, string]}
          maxWidth={640}
          className={styles.headingBlock}
        />
      </Appear>
      <Appear
        className={styles.layout}
        from={{ opacity: 0, y: 16 }}
        transition={{ type: "tween", duration: 0.8, ease }}
      >
        <div className={styles.list}>
          {faq.items.map((item, i) => (
            <Appear key={item.question} transition={{ type: "tween", delay: 0.1 * (i + 1), duration: 1, ease }}>
              <FaqItem question={item.question} answer={item.answer} />
            </Appear>
          ))}
        </div>
      </Appear>
    </Appear>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  return (
    <motion.div
      className={`fb ${styles.item}`}
      onClick={() => setOpen((v) => !v)}
      onHoverStart={() => setHover(true)}
      onHoverEnd={() => setHover(false)}
      initial={false}
      animate={{ backgroundColor: hover ? "var(--surface)" : "var(--base)" }}
      transition={itemTransition}
    >
      <div className={styles.title}>
        <p className="t-body-strong wrap" style={{ textAlign: "left", flex: "1 0 0px", width: 1 }}>
          {question}
        </p>
        <motion.div
          className={styles.plus}
          initial={false}
          animate={{ rotate: open ? 45 : 0 }}
          transition={itemTransition}
        >
          <PlusIcon size={16} strokeWidth={2} color="var(--default)" />
        </motion.div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className={styles.body}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={itemTransition}
            style={{ overflow: "hidden" }}
          >
            <div className={styles.bodyInner}>
              <motion.p
                className={`t-small wrap ${styles.answer}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={textTransition}
              >
                {answer}
              </motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
