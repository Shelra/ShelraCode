"use client";

import { motion } from "motion/react";
import { useId, useState } from "react";
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
              <FaqItem question={item.question} answer={item.answer} link={"link" in item ? item.link : undefined} />
            </Appear>
          ))}
        </div>
      </Appear>
    </Appear>
  );
}

// An accordion item. Every answer is in the server HTML (search engines and readers without JavaScript get all
// of it); a closed answer is collapsed to zero height and inert. The question is a button inside a heading.
type FaqLink = { label: string; href: string };

function FaqItem({ question, answer, link }: { question: string; answer: string; link?: FaqLink }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const id = useId();
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
      <h3 className={styles.heading}>
        <button
          type="button"
          id={`${id}-question`}
          className={styles.title}
          aria-expanded={open}
          aria-controls={`${id}-answer`}
        >
          <span className="t-body-strong wrap" style={{ textAlign: "left", flex: "1 0 0px", width: 1 }}>
            {question}
          </span>
          <motion.span
            className={styles.plus}
            initial={false}
            animate={{ rotate: open ? 45 : 0 }}
            transition={itemTransition}
          >
            <PlusIcon size={16} strokeWidth={2} color="var(--default)" />
          </motion.span>
        </button>
      </h3>
      <motion.div
        id={`${id}-answer`}
        role="region"
        aria-labelledby={`${id}-question`}
        className={styles.body}
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={itemTransition}
        style={{ overflow: "hidden" }}
        inert={!open}
      >
        <div className={styles.bodyInner}>
          <motion.p
            className={`t-small wrap ${styles.answer}`}
            initial={false}
            animate={{ opacity: open ? 1 : 0 }}
            transition={textTransition}
          >
            {answer}
          </motion.p>
          {link && (
            <a
              href={link.href}
              className={`t-small-strong ${styles.more}`}
              onClick={(event) => event.stopPropagation()}
            >
              {link.label} <span aria-hidden="true">→</span>
            </a>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
