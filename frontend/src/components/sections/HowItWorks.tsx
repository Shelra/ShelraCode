import { Appear } from "@/components/motion/Appear";
import { howItWorks } from "@/lib/content";
import styles from "./HowItWorks.module.css";
import { SectionHeading } from "./SectionHeading";
import shared from "./sections.module.css";

const ease = [0.12, 0.23, 0.17, 0.99] as const;

export function HowItWorks() {
  return (
    <section className={shared.section} id="how-it-works">
      <SectionHeading badge={howItWorks.badge} heading={howItWorks.heading as [string, string]} maxWidth={580} />
      <div className={`${shared.grid3} ${styles.grid}`}>
        {howItWorks.cards.map((card) => (
          <Appear key={card.number} transition={{ type: "tween", delay: card.delay, duration: 1, ease }}>
            <div className={styles.card}>
              <div className={styles.number}>
                <p className="t-body-mono pre" style={{ color: "var(--on-light)", userSelect: "none" }}>
                  {card.number}
                </p>
              </div>
              <div className={styles.cards}>
                <div className={`fb ${styles.cardBack}`} />
                <div className={`fb ${styles.cardFront}`}>
                  <div className={styles.texts}>
                    <p className="t-body-strong wrap">{card.title}</p>
                    <p className="t-body balance">{card.description}</p>
                  </div>
                </div>
              </div>
            </div>
          </Appear>
        ))}
      </div>
    </section>
  );
}
