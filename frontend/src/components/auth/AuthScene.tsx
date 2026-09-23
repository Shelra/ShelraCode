"use client";

import { BandsShader, type ShaderFallbacks } from "@/components/hero/BandsShader";
import type { CardLine } from "@/lib/content";
import styles from "./AuthScene.module.css";
import { SessionCard } from "./SessionCard";

// The still frames of the hero shader, shown until WebGL draws (and instead of it when it cannot).
const fallbacks: ShaderFallbacks = {
  desktop: "/images/OZ4jz97tUV7UJHFWkbKSGOsPvY.webp",
  tablet: "/images/vjz6teZ5zSZIeEh17RieNlG3FI.webp",
  phone: "/images/Mb91SokFGCGKHx4NNEVLqF08A.webp",
};

// The right half of an auth page: the site's shader behind a terminal session card.
export function AuthScene({ lines }: { lines: CardLine[] }) {
  return (
    <div className={styles.scene}>
      <div className={styles.shader}>
        <BandsShader fallbacks={fallbacks} />
      </div>
      <div className={styles.card}>
        <SessionCard lines={lines} />
      </div>
    </div>
  );
}
