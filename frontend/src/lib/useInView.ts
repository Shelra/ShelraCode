"use client";

import { type RefObject, useEffect, useState } from "react";

const thresholds = Array.from({ length: 21 }, (_, i) => i / 20);

/*
 * Framer's appear trigger: an element is "in view" once the visible part of it
 * covers `threshold` of min(element height, viewport height). With `once` the
 * value stays true after the first time.
 */
export function useInView(ref: RefObject<Element | null>, threshold = 0.5, once = true): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let seen = false;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const rect = entry.boundingClientRect;
          const visible =
            rect.height === 0
              ? entry.isIntersecting
              : entry.isIntersecting &&
                entry.intersectionRect.height / Math.min(rect.height, window.innerHeight) >= threshold;
          if (visible) {
            seen = true;
            setInView(true);
          } else if (!once || !seen) {
            setInView(false);
          }
        }
      },
      { threshold: thresholds },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, threshold, once]);
  return inView;
}
