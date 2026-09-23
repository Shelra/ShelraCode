"use client";

import Lenis from "lenis";
import { useEffect } from "react";

/*
 * Lenis smooth scrolling, as on the original site (1s duration), including
 * smooth navigation for in-page anchors.
 */
export function SmoothScroll() {
  useEffect(() => {
    const lenis = new Lenis({ duration: 1 });
    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);

    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement | null)?.closest?.("a[href]");
      if (!(target instanceof HTMLAnchorElement)) return;
      const hash = target.hash;
      if (!hash || target.origin !== window.location.origin || target.pathname !== window.location.pathname) return;
      let element: Element | null = null;
      try {
        element = document.querySelector(decodeURIComponent(hash));
      } catch {
        return;
      }
      if (!element) return;
      event.preventDefault();
      // Lenis subtracts the target's scroll-margin-top itself, like the original site.
      lenis.scrollTo(element as HTMLElement);
    };
    document.addEventListener("click", onClick);

    return () => {
      document.removeEventListener("click", onClick);
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);
  return null;
}
