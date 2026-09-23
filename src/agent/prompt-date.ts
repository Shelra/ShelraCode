/**
 * Today's local date. Without it a model reads the current year as the future: a free model
 * diagnosing a webcam on 2026-09-22 decided the registry's "2026" timestamps meant a wrong system
 * clock. It goes last in the prompt so the stable part before it stays cacheable.
 */
export function todayLine(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  return `Today's date: ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} (${weekday}, local time).`;
}
