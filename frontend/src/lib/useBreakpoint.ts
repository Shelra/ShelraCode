"use client";

import { useEffect, useState } from "react";

// The three Framer breakpoints of the project.
export type Breakpoint = "desktop" | "tablet" | "phone";

const queries: Record<Breakpoint, string> = {
  desktop: "(min-width: 1200px)",
  tablet: "(min-width: 810px) and (max-width: 1199.98px)",
  phone: "(max-width: 809.98px)",
};

function current(): Breakpoint {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia(queries.phone).matches) return "phone";
  if (window.matchMedia(queries.tablet).matches) return "tablet";
  return "desktop";
}

// Returns the active breakpoint. Renders as desktop on the server and on the
// first client render, then updates when the viewport changes.
export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>("desktop");
  useEffect(() => {
    const update = () => setBp(current());
    update();
    const lists = Object.values(queries).map((q) => window.matchMedia(q));
    for (const l of lists) l.addEventListener("change", update);
    return () => {
      for (const l of lists) l.removeEventListener("change", update);
    };
  }, []);
  return bp;
}
