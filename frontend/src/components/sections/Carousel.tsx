"use client";

import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import {
  Children,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { easeAppear } from "@/components/motion/Appear";
import { useInView } from "@/lib/useInView";
import styles from "./Carousel.module.css";

/*
 * The testimonial carousel: a strip of `visibleItems` cards moved by dragging
 * (mouse, pen or touch), the round previous/next buttons, the arrow keys or a
 * horizontal trackpad swipe. The look is the one of the Framer code component of
 * the site; the motion runs on a motion value instead of a CSS transition, so a
 * grab interrupts a running snap where it is, a release keeps its momentum, the
 * first and last card rubber-band, and the cards enter with the same staggered
 * appear effect as every other card of the page.
 */
type Props = {
  children: ReactNode;
  visibleItems: number;
  gap: number;
  /** Accessible name of the carousel region. */
  label: string;
};

// Snap of the strip after a drag, a click or a key press.
const snap = { type: "spring", stiffness: 260, damping: 34, mass: 1 } as const;
// Seconds of release velocity projected ahead to choose the card to settle on.
const projection = 0.2;
// A (projected) drag past this fraction of a card moves to the next one, as in the original.
const dragThreshold = 0.3;
const arrowColor = "rgb(0, 0, 0)";
const keyJumps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

// Resistance when the strip is pulled past its first or last card.
function rubberband(overshoot: number, size: number): number {
  const c = 0.55;
  return (1 - 1 / ((overshoot * c) / size + 1)) * size;
}

export function Carousel({ children, visibleItems, gap, label }: Props) {
  const items = Children.toArray(children);
  const count = items.length;
  const maxIndex = Math.max(0, count - visibleItems);
  const canScroll = maxIndex > 0;

  const viewportRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [current, setCurrent] = useState(0);
  const [dragging, setDragging] = useState(false);
  const currentRef = useRef(0);
  const drag = useRef<{ pointerId: number; pointerX: number; originX: number } | null>(null);
  const wheelAt = useRef(0);
  const x = useMotionValue(0);
  const reducedMotion = useReducedMotion();
  const inView = useInView(viewportRef, 0.5);

  const itemWidth = containerWidth > 0 ? (containerWidth - gap * (visibleItems - 1)) / visibleItems : 0;
  const step = itemWidth + gap;

  // Follow the viewport width (window resizes and breakpoint changes included).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setContainerWidth(el.offsetWidth));
    observer.observe(el);
    setContainerWidth(el.offsetWidth);
    return () => observer.disconnect();
  }, []);

  // Realign the strip with the current card, without animating, when the card size changes.
  useEffect(() => {
    const target = Math.min(currentRef.current, maxIndex);
    currentRef.current = target;
    setCurrent(target);
    x.stop();
    x.set(-target * step);
  }, [maxIndex, step, x]);

  const settle = useCallback(
    (index: number, velocity = 0) => {
      const target = Math.max(0, Math.min(maxIndex, index));
      currentRef.current = target;
      setCurrent(target);
      if (reducedMotion) x.set(-target * step);
      else animate(x, -target * step, { ...snap, velocity });
    },
    [maxIndex, reducedMotion, step, x],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!canScroll || step <= 0) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    x.stop();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, pointerX: e.clientX, originX: x.get() };
    setDragging(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const raw = d.originX + (e.clientX - d.pointerX);
    const minX = -maxIndex * step;
    if (raw > 0) x.set(rubberband(raw, containerWidth));
    else if (raw < minX) x.set(minX - rubberband(minX - raw, containerWidth));
    else x.set(raw);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const velocity = e.type === "pointercancel" ? 0 : x.getVelocity();
    // Where the strip would stop if it kept its speed for a moment.
    const projected = x.get() + velocity * projection;
    // Cards travelled since the grab, forward positive: past 30 % of a card the strip moves on,
    // otherwise it settles on the nearest card (a grab that only stopped a snap stays put).
    const travelled = -(projected - d.originX) / step;
    const moves = Math.trunc(travelled + Math.sign(travelled) * (1 - dragThreshold));
    settle(moves !== 0 ? Math.round(-d.originX / step) + moves : Math.round(-projected / step), velocity);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!canScroll) return;
    const jump = keyJumps[e.key];
    if (e.key === "Home") settle(0);
    else if (e.key === "End") settle(maxIndex);
    else if (jump !== undefined) settle(currentRef.current + jump);
    else return;
    e.preventDefault();
  };

  // A horizontal trackpad swipe moves one card; the page keeps its vertical scroll.
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!canScroll || Math.abs(e.deltaX) < 8 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const now = performance.now();
    if (now - wheelAt.current < 450) return;
    wheelAt.current = now;
    settle(currentRef.current + (e.deltaX > 0 ? 1 : -1));
  };

  const slideWidth = `calc((100% - ${gap * (visibleItems - 1)}px) / ${visibleItems})`;
  const viewportClass = [styles.viewport, dragging && styles.dragging, !canScroll && styles.static]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={styles.root} aria-roledescription="carousel" aria-label={label}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the strip is dragged with the pointer */}
      <div
        ref={viewportRef}
        className={viewportClass}
        tabIndex={canScroll ? 0 : -1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
      >
        <motion.div className={styles.track} style={{ gap, x }}>
          {items.map((child, i) => (
            <motion.div
              // biome-ignore lint/suspicious/noArrayIndexKey: slides are a fixed ordered list
              key={i}
              className={styles.slide}
              style={{ width: slideWidth }}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}`}
              initial={reducedMotion ? false : { opacity: 0, y: 40 }}
              animate={inView ? { opacity: 1, y: 0 } : undefined}
              transition={{ type: "tween", duration: 1, ease: easeAppear, delay: 0.1 * i }}
            >
              {child}
            </motion.div>
          ))}
        </motion.div>
      </div>
      {canScroll && (
        <>
          <motion.button
            type="button"
            className={`${styles.arrow} ${styles.left}`}
            onClick={() => settle(currentRef.current - 1)}
            disabled={current === 0}
            aria-label="Previous slide"
            animate={{ opacity: current === 0 ? 0.5 : 1 }}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            transition={{ duration: 0.2 }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <title>Previous</title>
              <path d="M15 18l-6-6 6-6" stroke={arrowColor} strokeWidth="2" strokeLinecap="round" />
            </svg>
          </motion.button>
          <motion.button
            type="button"
            className={`${styles.arrow} ${styles.right}`}
            onClick={() => settle(currentRef.current + 1)}
            disabled={current >= maxIndex}
            aria-label="Next slide"
            animate={{ opacity: current >= maxIndex ? 0.5 : 1 }}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.94 }}
            transition={{ duration: 0.2 }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <title>Next</title>
              <path d="M9 18l6-6-6-6" stroke={arrowColor} strokeWidth="2" strokeLinecap="round" />
            </svg>
          </motion.button>
        </>
      )}
    </section>
  );
}
