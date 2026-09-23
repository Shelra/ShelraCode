"use client";

import { animate, useMotionValue } from "motion/react";
import { useEffect, useState } from "react";

const font: React.CSSProperties = {
  fontFamily: '"Geist Mono", monospace',
  fontFeatureSettings: "'zero' on, 'tnum' on",
  fontSize: "36px",
  fontStyle: "normal",
  fontWeight: 400,
  letterSpacing: "-0.03em",
  lineHeight: "1.1em",
};

// The Pro price: counts between the monthly and yearly value with a spring.
export function AnimatedNumber({ value, prefix = "" }: { value: number; prefix?: string }) {
  const motionValue = useMotionValue(value);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const controls = animate(motionValue, value, {
      type: "spring",
      duration: 1,
      bounce: 0,
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [value, motionValue]);

  const format = (n: number) => n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  return (
    <div style={{ position: "relative", width: "auto", height: "auto", flex: "none" }}>
      {/* Invisible copy keeps the width stable while the number animates. */}
      <p style={{ ...font, margin: 0, opacity: 0, pointerEvents: "none", userSelect: "none", textAlign: "center" }}>
        {prefix}
        {format(value)}
      </p>
      <p style={{ ...font, position: "absolute", inset: 0, margin: 0, textAlign: "center", color: "var(--default)" }}>
        {prefix}
        {format(display)}
      </p>
    </div>
  );
}
