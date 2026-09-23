"use client";

import { BandsShader } from "@/components/hero/BandsShader";
import type { CardLine } from "@/lib/content";
import { useBreakpoint } from "@/lib/useBreakpoint";
import styles from "./AuthScene.module.css";
import { SessionCard } from "./SessionCard";

// The still frames of the hero shader, shown until WebGL draws (and instead of it when it cannot).
const fallbacks = {
  desktop: "/images/OZ4jz97tUV7UJHFWkbKSGOsPvY.png",
  tablet: "/images/vjz6teZ5zSZIeEh17RieNlG3FI.png",
  phone: "/images/Mb91SokFGCGKHx4NNEVLqF08A.png",
};

// The right half of an auth page: the site's shader behind a terminal session card.
export function AuthScene({ lines }: { lines: CardLine[] }) {
  const bp = useBreakpoint();
  return (
    <div className={styles.scene}>
      <div className={styles.shader}>
        <BandsShader fallback={fallbacks[bp]} />
      </div>
      <div className={styles.card}>
        <SessionCard lines={lines} />
      </div>
    </div>
  );
}
