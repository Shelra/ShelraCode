import { Appear } from "@/components/motion/Appear";
import { features } from "@/lib/content";
import styles from "./Features.module.css";
import { Illustration } from "./Illustrations";
import { SectionHeading } from "./SectionHeading";
import shared from "./sections.module.css";

const ease = [0.12, 0.23, 0.17, 0.99] as const;

export function Features() {
  return (
    <section className={shared.section} id="features-overview">
      <SectionHeading badge={features.badge} heading={features.heading as [string, string]} maxWidth={480} />
      <div className={shared.grid3}>
        {features.cards.map((card) => (
          <Appear key={card.number} transition={{ type: "tween", delay: card.delay, duration: 1, ease }}>
            <div className={styles.card}>
              <div className={styles.number}>
                <p className="t-small-mono pre" style={{ color: "var(--on-light)", userSelect: "none" }}>
                  {card.number}
                </p>
              </div>
              <div className={styles.cardBody}>
                <div className={`fb ${styles.cardBack}`} />
                <div className={`fb ${styles.cardFront}`}>
                  <p className="t-body-strong pre">{card.name}</p>
                  <div className={styles.illustrationBox}>
                    <div className={styles.illustrationCenter}>
                      <Illustration variant={card.illustration as 1 | 2 | 3} />
                    </div>
                  </div>
                  <div className={styles.texts}>
                    <p className="t-small-strong wrap">{card.title}</p>
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
