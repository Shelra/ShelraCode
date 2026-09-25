"use client";

import { motion } from "motion/react";
import { useRef } from "react";
import { Appear } from "@/components/motion/Appear";
import { Button } from "@/components/ui/Button";
import { SectionBadge } from "@/components/ui/SectionBadge";
import summary from "@/lib/bench-summary.json";
import { benchmark } from "@/lib/content";
import { useInView } from "@/lib/useInView";
import styles from "./Benchmark.module.css";
import { SectionHeading } from "./SectionHeading";
import shared from "./sections.module.css";

/*
 * Shelra Bench on the landing page: the best completed run per agent and model
 * on the core suite, the product path's progression on its pinned model, and
 * the field cases. Every number comes from bench/history/benchmark-history.json
 * through scripts/bench-summary.ts; nothing is typed in by hand.
 */
const ease = [0.12, 0.23, 0.17, 0.99] as const;
const enter = { opacity: 0, y: 32 };

const money = (usd: number | null) => (usd === null ? "—" : usd === 0 ? "free" : `$${usd.toFixed(2)}`);
const tries = (n: number | null) => (n === null ? "—" : `${n} ${n === 1 ? "try" : "tries"}`);
// "provider/model" may wrap after the slash, never inside the model name.
const modelName = (model: string) => {
  const slash = model.indexOf("/");
  if (slash < 0) return model;
  return (
    <>
      {model.slice(0, slash + 1)}
      <wbr />
      {model.slice(slash + 1)}
    </>
  );
};

export function Benchmark() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, 0.3);
  const { rows, progress, suite, fieldCases } = summary;
  const recorded = new Set(rows.map((r) => r.agent));
  const pending = benchmark.references.filter((r) => !recorded.has(r.agent));
  const judged = fieldCases.filter((c) => c.solved !== null);
  const best = Math.max(0, ...progress.runs.map((r) => r.resolved));

  return (
    <section className={`${shared.section} ${styles.benchmark}`} id="benchmark">
      <Appear
        className={styles.text}
        from={{ opacity: 0 }}
        transition={{ type: "spring", damping: 60, stiffness: 300, mass: 1 }}
      >
        <SectionHeading badge={benchmark.badge} heading={benchmark.heading as [string, string]} maxWidth={640} />
      </Appear>

      <div ref={ref} className={styles.grid}>
        <motion.div
          className={`fb ${styles.board}`}
          initial={enter}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ type: "tween", delay: 0, duration: 0.8, ease }}
        >
          <div className={styles.boardHead}>
            <div className={styles.headLeft}>
              <SectionBadge text={benchmark.suiteLabel} />
              <p className="t-small-mono pre muted">
                {suite.name} v{suite.version} · {suite.tasks} tasks
              </p>
            </div>
            <p className="t-small-mono pre muted">
              {benchmark.updated} {summary.updatedAt} · {summary.runsTotal} runs on record
            </p>
          </div>
          <div className={`${styles.cols} ${styles.colsHead}`}>
            {benchmark.columns.map((label) => (
              <p key={label} className={`t-small-mono pre ${styles.colLabel}`}>
                {label}
              </p>
            ))}
          </div>
          {rows.map((row, i) => (
            <div key={`${row.agent}-${row.model}-${row.variant ?? ""}`} className={`${styles.cols} ${styles.row}`}>
              <div className={styles.who}>
                <p className="t-body-strong pre">{row.label}</p>
                <p className="t-small-mono wrap muted">
                  {modelName(row.free ? row.model.replace(/:free$/, "") : row.model)}
                  {row.free ? " · free" : ""}
                  {row.variant ? ` · ${row.variant}` : ""}
                </p>
              </div>
              <div className={styles.score}>
                <div className={styles.track}>
                  <motion.div
                    className={`${styles.fill} ${row.agent === "shelra" ? "" : styles.fillRef}`}
                    initial={{ width: 0 }}
                    animate={inView ? { width: `${(row.resolved / row.total) * 100}%` } : undefined}
                    transition={{ type: "tween", delay: 0.3 + 0.1 * i, duration: 0.9, ease }}
                  />
                </div>
                <p className="t-body-mono pre">
                  {row.resolved}/{row.total}
                </p>
                {row.infra > 0 && (
                  <p className="t-small-mono pre muted">
                    {row.infra} {benchmark.infraNote}
                  </p>
                )}
              </div>
              <p className={`t-body-mono pre ${styles.num}`}>{money(row.costUsd)}</p>
              <p className={`t-body-mono pre ${styles.num}`}>{row.minutes === null ? "—" : `${row.minutes} min`}</p>
              <p className={`t-small-mono pre muted ${styles.run}`}>
                {row.runs} {row.runs === 1 ? benchmark.run : benchmark.runs} · {row.date}
                {row.commit ? ` · ${row.commit}` : ""}
              </p>
            </div>
          ))}
          {pending.map((r) => (
            <div key={r.agent} className={`${styles.cols} ${styles.row} ${styles.pending}`}>
              <div className={styles.who}>
                <p className="t-body-strong pre">{r.label}</p>
                <p className="t-small-mono wrap muted">{r.model}</p>
              </div>
              <p className={`t-small-mono pre muted ${styles.pendingNote}`}>{benchmark.pendingNote}</p>
            </div>
          ))}
        </motion.div>

        <div className={styles.side}>
          <motion.div
            className={`fb ${styles.panel}`}
            initial={enter}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ type: "tween", delay: 0.2, duration: 0.8, ease }}
          >
            <div className={styles.panelHead}>
              <SectionBadge text={benchmark.progressLabel} />
              <p className="t-small-mono pre muted">{progress.model}</p>
            </div>
            <div className={styles.bars}>
              {progress.runs.map((run, i) => (
                <div key={run.runNumber} className={styles.bar}>
                  <p className="t-small-mono pre">
                    {run.resolved}/{run.total}
                    {run.infra > 0 ? "*" : ""}
                  </p>
                  <motion.div
                    className={`${styles.barFill} ${run.resolved === best ? styles.barBest : ""}`}
                    initial={{ height: 0 }}
                    animate={inView ? { height: `${Math.max(4, (run.resolved / run.total) * 100)}%` } : undefined}
                    transition={{ type: "tween", delay: 0.4 + 0.1 * i, duration: 0.9, ease }}
                  />
                  <p className="t-small-mono pre muted">#{run.runNumber}</p>
                </div>
              ))}
            </div>
            <p className={`t-small-mono wrap muted ${styles.caption}`}>
              {benchmark.progressCaption}
              {progress.runs.some((r) => r.infra > 0) ? ` · * ${benchmark.infraFootnote}` : ""}
            </p>
          </motion.div>

          {judged.map((c, i) => (
            <motion.div
              key={c.id}
              className={`fb ${styles.panel}`}
              initial={enter}
              animate={inView ? { opacity: 1, y: 0 } : undefined}
              transition={{ type: "tween", delay: 0.3 + 0.1 * i, duration: 0.8, ease }}
            >
              <div className={styles.panelHead}>
                <SectionBadge text={`${benchmark.fieldLabel} ${c.id.slice(0, 3)}`} />
                <p className="t-small-mono pre muted">{c.date}</p>
              </div>
              <div className={styles.panelBody}>
                <h3 className="t-body-strong wrap">{c.title}</h3>
                <div className={styles.versus}>
                  <div className={styles.side1}>
                    <p className="t-small-mono pre muted">
                      ShelraCode · {c.model?.includes(":free") ? "free model" : c.model}
                    </p>
                    <p className={`t-body-mono pre ${styles.accent}`}>
                      {c.solved ? benchmark.solved : benchmark.unsolved} · {tries(c.tries)}
                    </p>
                  </div>
                  {c.reference && (
                    <div className={styles.side1}>
                      <p className="t-small-mono pre muted">{c.reference.agent}</p>
                      <p className="t-body-mono pre">{tries(c.reference.tries)}</p>
                    </div>
                  )}
                </div>
                {c.reruns.length > 0 && (
                  <p className="t-small-mono wrap muted">
                    {benchmark.reruns}: {c.reruns.map((r) => `${r.minutes} min`).join(" → ")} ·{" "}
                    {c.reruns.map((r) => r.toolCalls).join(" → ")} {benchmark.toolCalls}
                  </p>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <motion.div
        className={styles.foot}
        initial={enter}
        animate={inView ? { opacity: 1, y: 0 } : undefined}
        transition={{ type: "tween", delay: 0.5, duration: 0.8, ease }}
      >
        <p className="t-small-mono wrap muted">{benchmark.method}</p>
        <Button text={benchmark.button} href={benchmark.link} variant="secondary-md" showIcon />
      </motion.div>
    </section>
  );
}
