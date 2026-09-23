"use client";

import { useId } from "react";

/* Small inline SVG charts in the palette: bars, a sparkline and a ring. No chart library. */

export function Bars({
  data,
  labels,
  height = 140,
  format,
}: {
  data: number[];
  labels?: string[];
  height?: number;
  format?: (value: number) => string;
}) {
  const max = Math.max(1, ...data);
  const n = data.length;
  const gap = n > 20 ? 2 : 4;
  const width = 100;
  const bar = (width - gap * (n - 1)) / n;
  const last = n - 1;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      role="img"
      aria-label="Bar chart"
    >
      <title>Bar chart</title>
      {data.map((value, i) => {
        const h = Math.max(1, (value / max) * (height - 4));
        return (
          <rect
            // biome-ignore lint/suspicious/noArrayIndexKey: bars are positional
            key={i}
            x={i * (bar + gap)}
            y={height - h}
            width={bar}
            height={h}
            fill={i === last ? "var(--accent)" : "var(--accent-40)"}
          >
            <title>{`${labels?.[i] ?? i}: ${format ? format(value) : value}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function Sparkline({ data, height = 48 }: { data: number[]; height?: number }) {
  const id = useId();
  const max = Math.max(1, ...data);
  const w = 100;
  const points = data.map(
    (v, i) => [(i / Math.max(1, data.length - 1)) * w, height - 2 - (v / max) * (height - 6)] as const,
  );
  const line = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `0,${height} ${line} ${w},${height}`;
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      role="img"
      aria-label="Trend"
    >
      <title>Trend</title>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Ring({ value, size = 88, label }: { value: number; size?: number; label?: string }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={label ?? "Ring"}>
      <title>{label ?? "Ring"}</title>
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--border)" strokeWidth="6" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke={v > 0.85 ? "var(--warn)" : "var(--accent)"}
        strokeWidth="6"
        strokeDasharray={`${c * v} ${c * (1 - v)}`}
        strokeDashoffset={c / 4}
        style={{ transition: "stroke-dasharray 0.6s cubic-bezier(0.12, 0.23, 0.17, 0.99)" }}
      />
      <text
        x="50"
        y="55"
        textAnchor="middle"
        fill="var(--default)"
        fontFamily="var(--font-geist-mono)"
        fontSize="18"
        fontWeight="500"
      >
        {Math.round(v * 100)}%
      </text>
    </svg>
  );
}
