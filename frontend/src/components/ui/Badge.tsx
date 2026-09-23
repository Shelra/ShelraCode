import { links } from "@/lib/content";
import styles from "./Badge.module.css";
import { ZapIcon } from "./Icons";

type Props = {
  text: string;
  leadingIcon?: boolean;
  href?: string;
};

// The small green pill ("20% OFF", "Popular"). It is a link in the original too.
export function Badge({ text, leadingIcon = true, href = links.placeholder }: Props) {
  return (
    <a href={href} target="_blank" rel="noopener" className={`fb ${styles.badge}`}>
      {leadingIcon && <ZapIcon size={16} strokeWidth={2} color="var(--accent)" className={styles.icon} />}
      <p className={`t-small-strong pre ${styles.text}`}>{text}</p>
    </a>
  );
}
