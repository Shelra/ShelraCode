import styles from "./Badge.module.css";
import { ZapIcon } from "./Icons";

type Props = {
  text: string;
  leadingIcon?: boolean;
  href?: string;
};

// The small green pill ("Cap it", "BYOK"). A link only when it has somewhere to go: a pill that pointed at
// the repository root would be a link named after nothing.
export function Badge({ text, leadingIcon = true, href }: Props) {
  const content = (
    <>
      {leadingIcon && <ZapIcon size={16} strokeWidth={2} color="var(--accent)" className={styles.icon} />}
      <p className={`t-small-strong pre ${styles.text}`}>{text}</p>
    </>
  );
  return href ? (
    <a href={href} target="_blank" rel="noopener" className={`fb ${styles.badge}`}>
      {content}
    </a>
  ) : (
    <div className={`fb ${styles.badge}`}>{content}</div>
  );
}
