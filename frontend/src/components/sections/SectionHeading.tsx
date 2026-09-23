import { Appear } from "@/components/motion/Appear";
import { SectionBadge } from "@/components/ui/SectionBadge";
import styles from "./sections.module.css";

type Props = {
  badge: string;
  /** [white part, grey part] of the heading. */
  heading: readonly [string, string];
  maxWidth: number;
  className?: string;
};

// Section badge + two-tone heading, with their appear animations.
export function SectionHeading({ badge, heading, maxWidth, className }: Props) {
  return (
    <div className={`${styles.heading} ${className ?? ""}`} style={{ maxWidth }}>
      <Appear className={styles.badge}>
        <SectionBadge text={badge} />
      </Appear>
      <Appear
        className={styles.title}
        transition={{ type: "tween", delay: 0.2, duration: 1, ease: [0.12, 0.23, 0.17, 0.99] }}
      >
        <h2 className="t-h2">
          {heading[0]}
          <span className="muted">{heading[1]}</span>
        </h2>
      </Appear>
    </div>
  );
}
