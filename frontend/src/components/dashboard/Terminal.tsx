"use client";

import { useEffect, useRef } from "react";
import { CheckIcon } from "@/components/ui/Icons";
import type { LogLine } from "@/lib/demo/types";
import styles from "./Terminal.module.css";

const time = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/*
 * The mission log, in the style of the feature illustrations: commands in
 * default, output in subtle, checks in green, warnings in amber, errors in red,
 * and a blinking cursor while the mission runs. Follows the newest line.
 */
export function Terminal({
  lines,
  live,
  height = 360,
  title,
}: {
  lines: LogLine[];
  live: boolean;
  height?: number;
  title?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const count = lines.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the log whenever a line is appended
  useEffect(() => {
    const el = ref.current;
    if (el && live) el.scrollTop = el.scrollHeight;
  }, [live, count]);

  return (
    <div className={`fb ${styles.terminal}`}>
      <div className={styles.head}>
        <span className={styles.lights} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <p className={`t-small-mono pre ${styles.title}`}>{title ?? "shelra · session"}</p>
        {live && (
          <p className={`t-small-mono pre ${styles.live}`}>
            <span className={styles.liveDot} /> live
          </p>
        )}
      </div>
      <div ref={ref} className={styles.body} style={{ maxHeight: height }}>
        {lines.length === 0 && <p className={`t-body pre ${styles.waiting}`}>&gt; Waiting for the agent to start…</p>}
        {lines.map((line, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only
            key={i}
            className={styles.line}
          >
            <span className={`t-small-mono pre ${styles.time}`}>{time.format(line.t)}</span>
            {line.kind === "ok" && (
              <CheckIcon size={14} strokeWidth={2} color="var(--accent)" className={styles.check} />
            )}
            <p className={`${line.kind === "out" ? "t-body" : "t-small-strong"} wrap ${styles[line.kind]}`}>
              {line.text}
            </p>
          </div>
        ))}
        {live && (
          <div className={styles.line}>
            <span className={`t-small-mono pre ${styles.time}`} />
            <p className={`t-small-strong pre ${styles.ok}`}>
              &gt; <span className={styles.cursor} aria-hidden="true" />
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
