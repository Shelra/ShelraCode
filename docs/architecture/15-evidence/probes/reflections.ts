import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const lines = readFileSync(resolve(import.meta.dir, "../../../../.shelra/memory/reflections.jsonl"), "utf8")
  .split(/\r?\n/)
  .filter(Boolean);
const recs = lines.map((l) => JSON.parse(l));
console.log("records:", recs.length, "first:", recs[0]?.at, "last:", recs.at(-1)?.at);
const byReason: Record<string, number> = {};
let qualified = 0,
  candidates = 0,
  written = 0,
  errors = 0;
const actions: Record<string, number> = {};
const reasons: Record<string, number> = {};
for (const r of recs) {
  byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
  if (r.qualified) qualified++;
  candidates += r.candidates ?? 0;
  written += (r.written ?? []).length;
  if (r.error) errors++;
  for (const d of r.decisions ?? []) {
    actions[d.action] = (actions[d.action] ?? 0) + 1;
    const k = `${d.action}: ${String(d.reason).slice(0, 70)}`;
    reasons[k] = (reasons[k] ?? 0) + 1;
  }
}
console.log({ qualified, candidates, written, errors });
console.log("by qualification reason:", byReason);
console.log("decision actions:", actions);
console.log("top decision reasons:");
for (const [k, v] of Object.entries(reasons)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15))
  console.log("  ", v, k);
console.log("per-day:");
const days: Record<string, { n: number; w: number }> = {};
for (const r of recs) {
  const d = String(r.at).slice(0, 10);
  days[d] ??= { n: 0, w: 0 };
  days[d].n++;
  days[d].w += (r.written ?? []).length;
}
console.log(days);
console.log(
  "errors sample:",
  recs
    .filter((r) => r.error)
    .slice(0, 3)
    .map((r) => String(r.error).slice(0, 150)),
);
console.log("raw text samples (last 3):");
for (const r of recs.slice(-3))
  console.log("---", r.at, r.reason, "|", String(r.rawText).slice(0, 300).replace(/\n/g, " "));
