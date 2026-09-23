"use client";

import { Appear } from "@/components/motion/Appear";
import { SectionBadge } from "@/components/ui/SectionBadge";
import { testimonials } from "@/lib/content";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { Carousel } from "./Carousel";
import { SectionHeading } from "./SectionHeading";
import shared from "./sections.module.css";
import styles from "./Testimonials.module.css";

export function Testimonials() {
  const bp = useBreakpoint();
  const visibleItems = bp === "desktop" ? 3 : bp === "tablet" ? 2 : 1;

  return (
    <section className={`${shared.section} ${shared.testimonials}`} id="testimonials">
      <Appear
        className={styles.text}
        from={{ opacity: 0 }}
        transition={{ type: "spring", damping: 60, stiffness: 300, mass: 1 }}
      >
        <SectionHeading badge={testimonials.badge} heading={testimonials.heading as [string, string]} maxWidth={640} />
      </Appear>
      <div className={styles.carousel}>
        <Carousel visibleItems={visibleItems} gap={16} label="Testimonials">
          {testimonials.items.map((item) => {
            return (
              <div key={item.author} className={`fb ${styles.card}`}>
                <div className={styles.cardTop}>
                  <div className={styles.logo}>
                    <SectionBadge text={item.badge} />
                  </div>
                  <p className="t-large balance">{item.quote}</p>
                </div>
                <div className={styles.cardBottom}>
                  <div className={styles.texts}>
                    <div className={styles.name}>
                      <p className="t-body-strong wrap">{item.author}</p>
                      <p className="t-body wrap">{item.position}</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </Carousel>
      </div>
    </section>
  );
}
