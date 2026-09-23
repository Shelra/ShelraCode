"use client";

import { motion } from "motion/react";
import { TextAppear } from "@/components/motion/TextAppear";
import { Button } from "@/components/ui/Button";
import { hero, links } from "@/lib/content";
import { useBreakpoint } from "@/lib/useBreakpoint";
import { BandsShader } from "./BandsShader";
import styles from "./Hero.module.css";

const ease = [0.12, 0.23, 0.17, 0.99] as const;

// Shader still images per breakpoint (shown until WebGL renders).
const fallbacks = {
  desktop: "/images/3IJLNtjweQho9PNl12tZDwW4M.png",
  tablet: "/images/L1BBincTzsxAzBJoZCQxL2y0UGE.png",
  phone: "/images/Bug1gV55GlocHtSojwH9Wwgz7M.png",
};

export function Hero() {
  const bp = useBreakpoint();
  return (
    <header className={styles.hero} id="hero">
      <div className={styles.inner}>
        <div className={styles.content}>
          <div className={styles.text}>
            <TextAppear
              as="h1"
              text={hero.heading}
              tokenization="word"
              blur={4}
              y={12}
              startDelay={0.2}
              duration={0.8}
              className={`t-h1 balance ${styles.heading}`}
              style={{ textAlign: "left" }}
            />
            <TextAppear
              as="p"
              text={hero.supporting}
              tokenization="line"
              blur={10}
              y={20}
              startDelay={0.4}
              duration={0.7}
              className={`t-small balance ${styles.supporting}`}
              style={{ textAlign: "left" }}
            />
          </div>
          <motion.div
            className={styles.cta}
            initial={{ opacity: 0.001, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "tween", delay: 0.4, duration: 1, ease }}
          >
            <Button text={hero.cta} href={links.getStarted} variant="primary-md" showIcon />
          </motion.div>
        </div>
        <motion.div
          className={`fb ${styles.dash}`}
          initial={{ opacity: 0.001, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "tween", delay: 0.3, duration: 1, ease }}
        >
          <img
            src="/images/tui-hero.png"
            alt=""
            width={1944}
            height={1400}
            className={styles.dashImage}
            draggable={false}
          />
        </motion.div>
      </div>
      <div className={styles.shader}>
        <BandsShader fallback={fallbacks[bp]} />
      </div>
    </header>
  );
}
