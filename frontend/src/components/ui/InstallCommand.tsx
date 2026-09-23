"use client";

import { useEffect, useState } from "react";
import { install } from "@/lib/content";
import { CheckIcon, CopyIcon } from "./Icons";
import styles from "./InstallCommand.module.css";

/*
 * The Windows one-line installer as a command you click to copy: the label above it
 * names the shell and confirms the copy; the command itself is real text.
 */
export function InstallCommand({ className }: { className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2400);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(install.command);
      setCopied(true);
    } catch {
      // No clipboard access (an insecure context or a denied permission): the command stays readable.
    }
  };

  return (
    <div className={`${styles.install} ${className ?? ""}`}>
      <p className={`t-small-mono pre ${styles.label} ${copied ? styles.labelCopied : ""}`} aria-live="polite">
        {copied ? install.copied : install.label}
      </p>
      <button
        type="button"
        className={`fb ${styles.command} ${copied ? styles.copied : ""}`}
        onClick={copy}
        title={install.copy}
        aria-label={`${install.copy}: ${install.command}`}
      >
        <span className={`t-body-mono pre ${styles.prompt}`} aria-hidden="true">
          &gt;
        </span>
        <code className={`t-body-mono pre ${styles.text}`}>{install.command}</code>
        <span className={styles.icon} aria-hidden="true">
          {copied ? (
            <CheckIcon size={14} strokeWidth={2.5} color="var(--accent)" />
          ) : (
            <CopyIcon size={14} strokeWidth={2} color="var(--subtle)" />
          )}
        </span>
      </button>
    </div>
  );
}
