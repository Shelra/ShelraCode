"use client";

import { motion } from "motion/react";
import styles from "@/app/not-found.module.css";
import { BandsShader, type ShaderFallbacks } from "@/components/hero/BandsShader";
import { SiteFrame } from "@/components/layout/SiteFrame";
import { TextAppear } from "@/components/motion/TextAppear";
import { Button } from "@/components/ui/Button";
import { notFound } from "@/lib/content";

const ease = [0.12, 0.23, 0.17, 0.99] as const;

const fallbacks: ShaderFallbacks = {
  desktop: "/images/OZ4jz97tUV7UJHFWkbKSGOsPvY.webp",
  tablet: "/images/vjz6teZ5zSZIeEh17RieNlG3FI.webp",
  phone: "/images/Mb91SokFGCGKHx4NNEVLqF08A.webp",
};

// The 404 page's animated view; app/not-found.tsx wraps it so the page can carry its own title.
export function NotFoundView() {
  return (
    <SiteFrame showFinalCta={false}>
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.content} id="navbar-bg">
            <div className={styles.texts}>
              <TextAppear
                as="h1"
                text={notFound.heading}
                tokenization="word"
                blur={4}
                y={12}
                startDelay={0}
                duration={0.8}
                className={`t-h2 wrap ${styles.heading}`}
                style={{ textAlign: "center" }}
              />
              <TextAppear
                as="p"
                text={notFound.supporting}
                tokenization="line"
                blur={10}
                y={20}
                startDelay={0.2}
                duration={0.7}
                className={`t-small balance ${styles.supporting}`}
                style={{ textAlign: "center" }}
              />
            </div>
            <motion.div
              className={styles.button}
              initial={{ opacity: 0.001, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "tween", delay: 0.4, duration: 1.5, ease }}
            >
              <Button text={notFound.button} href="/" variant="primary-md" newTab={false} />
            </motion.div>
          </div>
          <div className={styles.shader}>
            <BandsShader fallbacks={fallbacks} />
          </div>
        </div>
      </div>
    </SiteFrame>
  );
}
