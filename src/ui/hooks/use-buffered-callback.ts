import { useEffect, useMemo, useRef } from "react";

/** Coalesce a burst of stream deltas without restarting the deadline on every delta. */
export function useBufferedCallback(callback: () => void, delayMs = 50) {
  const latest = useRef(callback);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  latest.current = callback;

  const controls = useMemo(() => {
    const cancel = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
    const flush = () => {
      if (timer.current === null) return;
      cancel();
      latest.current();
    };
    const schedule = () => {
      if (timer.current !== null) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        latest.current();
      }, delayMs);
    };
    return { schedule, flush, cancel };
  }, [delayMs]);

  useEffect(() => controls.cancel, [controls]);
  return controls;
}
