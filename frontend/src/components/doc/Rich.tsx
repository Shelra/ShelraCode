import type { ReactNode } from "react";
import styles from "./doc.module.css";

// The guides' inline markup: `code`, **strong** and [label](href), rendered as elements (never as raw HTML).
const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;

export function Rich({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let index = 0;
  for (const piece of text.split(TOKEN)) {
    if (!piece) continue;
    const key = index++;
    if (piece.startsWith("`") && piece.endsWith("`")) {
      parts.push(
        <code key={key} className={styles.code}>
          {piece.slice(1, -1)}
        </code>,
      );
    } else if (piece.startsWith("**") && piece.endsWith("**")) {
      parts.push(
        <strong key={key} className={styles.strong}>
          {piece.slice(2, -2)}
        </strong>,
      );
    } else if (piece.startsWith("[")) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(piece) ?? [];
      const external = /^https?:/.test(href);
      parts.push(
        <a key={key} href={href} className={styles.link} {...(external ? { target: "_blank", rel: "noopener" } : {})}>
          {label}
        </a>,
      );
    } else {
      parts.push(piece);
    }
  }
  return <>{parts}</>;
}
