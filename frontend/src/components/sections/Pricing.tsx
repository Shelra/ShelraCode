"use client";

import { motion } from "motion/react";
import { useRef, useState } from "react";
import { Appear } from "@/components/motion/Appear";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { CheckIcon } from "@/components/ui/Icons";
import { Toggle } from "@/components/ui/Toggle";
import { pricing } from "@/lib/content";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { useInView } from "@/lib/useInView";
import { AnimatedNumber } from "./AnimatedNumber";
import styles from "./Pricing.module.css";
import { SectionHeading } from "./SectionHeading";
import shared from "./sections.module.css";

const ease = [0.12, 0.23, 0.17, 0.99] as const;
const enter = { opacity: 0, y: 32 };

export function Pricing() {
  const bp = useBreakpoint();
  const mobile = bp !== "desktop";
  const [yearly, setYearly] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, 0.5);
  const { starter, pro, enterprise } = pricing.plans;

  // On phone the whole toggle row is tappable; on desktop and tablet only the switch is.
  const rowTap = bp === "phone" ? () => setYearly((v) => !v) : undefined;

  return (
    <section className={`${shared.section} ${shared.pricing}`} id="pricing">
      <Appear
        className={styles.text}
        from={{ opacity: 0 }}
        transition={{ type: "spring", damping: 60, stiffness: 300, mass: 1 }}
      >
        <SectionHeading badge={pricing.badge} heading={pricing.heading as [string, string]} maxWidth={480} />
      </Appear>

      <div ref={ref} className={`${styles.plansWrap} ${bp === "phone" ? styles.plansWrapMobile : ""}`}>
        <motion.div
          className={styles.toggleRow}
          style={{ cursor: rowTap ? "pointer" : undefined }}
          onClick={rowTap}
          initial={enter}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ type: "tween", duration: 0.6, ease }}
        >
          <p className="t-large pre" style={{ color: "var(--subtle)" }}>
            {pricing.monthly}
          </p>
          <Toggle on={yearly} onToggle={() => setYearly((v) => !v)} label={pricing.yearly} />
          <p className="t-large pre" style={{ color: "var(--subtle)" }}>
            {pricing.yearly}
          </p>
          <Badge text={pricing.discount} />
        </motion.div>

        <div
          className={`${styles.plans} ${bp === "tablet" ? styles.plansTablet : ""} ${bp === "phone" ? styles.plansPhone : ""}`}
        >
          {/* Starter */}
          <motion.div
            className={`fb ${styles.planCard} ${styles.planCardOuter}`}
            initial={enter}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ type: "tween", delay: 0, duration: 0.8, ease }}
          >
            <div className={styles.planInner}>
              <div className={styles.headWrap}>
                <div className={styles.head}>
                  <div className={styles.nameRow}>
                    <h3 className="t-large pre">{starter.name}</h3>
                  </div>
                  <div className={styles.priceRow}>
                    <p className="t-h2 pre">{starter.price}</p>
                    <div className={styles.period}>
                      <p className="t-body pre">{starter.period}</p>
                    </div>
                  </div>
                  <p className="t-body wrap">{starter.description}</p>
                </div>
              </div>
              <Button text={starter.button} href={starter.link} variant={mobile ? "primary-md" : "secondary-md"} />
              <FeaturesDivider />
              <div className={styles.included}>
                {starter.included.map((item) => (
                  <IncludedRow key={item} text={item} />
                ))}
              </div>
            </div>
          </motion.div>

          {/* Pro */}
          <motion.div
            className={`fb ${styles.planCard} ${styles.planCardPro}`}
            initial={enter}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ type: "tween", delay: 0.2, duration: 0.8, ease }}
          >
            <div className={styles.planInner} style={{ zIndex: 2 }}>
              <div className={styles.head}>
                <div className={styles.nameRow} style={{ overflow: "visible" }}>
                  <h3 className="t-large pre">{pro.name}</h3>
                  <Badge text={pro.badge} leadingIcon={false} />
                </div>
                <div className={styles.priceRow}>
                  <AnimatedNumber value={yearly ? pro.yearlyPrice : pro.monthlyPrice} prefix="$" />
                  <div className={styles.period}>
                    <p className="t-body pre">{pro.period}</p>
                  </div>
                </div>
                <p className="t-body wrap" style={{ color: "var(--default)" }}>
                  {pro.description}
                </p>
              </div>
              <Button text={pro.button} href={pro.link} variant="primary-md" />
              <FeaturesDivider />
              <div className={styles.included}>
                {pro.included.map((item) => (
                  <IncludedRow key={item} text={item} light />
                ))}
              </div>
            </div>
          </motion.div>

          {/* Enterprise */}
          <motion.div
            className={`fb ${styles.planCard} ${styles.planCardOuter}`}
            initial={enter}
            animate={inView ? { opacity: 1, y: 0 } : undefined}
            transition={{ type: "tween", delay: 0.4, duration: 0.8, ease }}
          >
            <div className={styles.planInner}>
              <div className={styles.head}>
                <div className={styles.nameRow}>
                  <h3 className="t-large pre">{enterprise.name}</h3>
                </div>
                <div className={styles.priceRow}>
                  <p className="t-h2 pre">{enterprise.price}</p>
                </div>
                <p className="t-body wrap">{enterprise.description}</p>
              </div>
              <Button
                text={enterprise.button}
                href={enterprise.link}
                newTab={!enterprise.link.startsWith("/")}
                variant={mobile ? "primary-md" : "secondary-md"}
              />
              <FeaturesDivider />
              <div className={styles.included}>
                {enterprise.included.map((item) => (
                  <IncludedRow key={item} text={item} />
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function FeaturesDivider() {
  return (
    <div className={styles.divider}>
      <div className={styles.line} />
      <p className="t-small-mono pre" style={{ userSelect: "none" }}>
        {pricing.featuresLabel}
      </p>
      <div className={styles.line} />
    </div>
  );
}

function IncludedRow({ text, light = false }: { text: string; light?: boolean }) {
  return (
    <div className={styles.includedRow}>
      <CheckIcon size={16} strokeWidth={2} color="var(--accent)" className={styles.check} />
      <p className="t-body pre" style={{ color: light ? "var(--default)" : undefined, userSelect: "none" }}>
        {text}
      </p>
    </div>
  );
}
