import { Appear } from "@/components/motion/Appear";
import { socialProof } from "@/lib/content";
import { SlidingLogos } from "./SlidingLogos";
import styles from "./SocialProof.module.css";

const ease = [0.12, 0.23, 0.17, 0.99] as const;

export function SocialProof() {
  return (
    <section className={styles.section} id="social-proof">
      <div className={styles.logos}>
        <Appear className={styles.title} transition={{ type: "tween", delay: 0.2, duration: 1, ease }}>
          <p className="t-small wrap" style={{ textAlign: "center" }}>
            {socialProof.title}
          </p>
        </Appear>
        <div className={styles.gridWrap}>
          <Appear
            className={styles.grid}
            from={{ opacity: 0, y: 24 }}
            transition={{ type: "tween", delay: 0.4, duration: 1.5, ease }}
          >
            {socialProof.cells.map((cell) => (
              <div key={cell.logos.join("-")} className={styles.cell}>
                <SlidingLogos logos={cell.logos} delay={cell.delay} />
              </div>
            ))}
          </Appear>
        </div>
      </div>
    </section>
  );
}
