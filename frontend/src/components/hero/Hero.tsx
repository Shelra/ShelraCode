"use client";

import { motion } from "motion/react";
import { TextAppear } from "@/components/motion/TextAppear";
import { Button } from "@/components/ui/Button";
import { InstallCommand } from "@/components/ui/InstallCommand";
import { hero, links } from "@/lib/content";
import { BandsShader, type ShaderFallbacks } from "./BandsShader";
import styles from "./Hero.module.css";

const ease = [0.12, 0.23, 0.17, 0.99] as const;

// Shader still images per breakpoint (shown until WebGL renders).
const fallbacks: ShaderFallbacks = {
  desktop: "/images/3IJLNtjweQho9PNl12tZDwW4M.webp",
  tablet: "/images/L1BBincTzsxAzBJoZCQxL2y0UGE.webp",
  phone: "/images/Bug1gV55GlocHtSojwH9Wwgz7M.webp",
};

export function Hero() {
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
            <InstallCommand />
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
            src={hero.image.src}
            alt={hero.image.alt}
            width={hero.image.width}
            height={hero.image.height}
            className={styles.dashImage}
            fetchPriority="high"
            draggable={false}
          />
        </motion.div>
      </div>
      <div className={styles.shader}>
        <BandsShader fallbacks={fallbacks} />
      </div>
    </header>
  );
}
