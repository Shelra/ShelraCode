/** Summarize local telemetry without copying requests, reasoning, tool arguments or credentials. */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getProductUserDir } from "../src/product/identity";
import { getStoredOpenRouterApiKey } from "../src/security/credentials";

const dir = join(getProductUserDir(), "logs", "sessions");
const turns: Array<Record<string, unknown>> = [];
if (existsSync(dir))
  for (const file of readdirSync(dir).filter((x) => x.endsWith(".jsonl"))) {
    let current: {
      start: number;
      last: number;
      toolCalls: number;
      errors: number;
      gaps: number[];
      pending: Set<string>;
      notices: string[];
    } | null = null;
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      if (!line) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const time = Date.parse(String(event.time));
      if (event.kind === "turn")
        current = { start: time, last: time, toolCalls: 0, errors: 0, gaps: [], pending: new Set(), notices: [] };
      if (!current || !Number.isFinite(time)) continue;
      if (event.kind !== "ui") {
        current.gaps.push(time - current.last);
        current.last = time;
      }
      if (event.kind === "tool") {
        current.toolCalls++;
        current.pending.add(String(event.id));
      }
      if (event.kind === "result") {
        current.pending.delete(String(event.id));
        if (event.success === false) current.errors++;
      }
      if (event.kind === "notice") {
        const text = String(event.text);
        const category =
          /\[(Not verified|Not marked complete|Checked by Shelra|Verified|Cancelled|Paused|Limited|Stopped|No response|Error)/u.exec(
            text,
          )?.[1];
        if (category) current.notices.push(category);
      }
      if (event.kind === "end") {
        turns.push({
          durationMs: time - current.start,
          toolCalls: current.toolCalls,
          failedTools: current.errors,
          pendingToolCalls: current.pending.size,
          largestEventGapMs: Math.max(0, ...current.gaps),
          verdict: current.notices.at(-1) ?? "not recorded",
          ended: true,
        });
        current = null;
      }
    }
    if (current)
      turns.push({
        durationMs: current.last - current.start,
        toolCalls: current.toolCalls,
        failedTools: current.errors,
        pendingToolCalls: current.pending.size,
        largestEventGapMs: Math.max(0, ...current.gaps),
        verdict: "no end event",
        ended: false,
      });
  }
const outcomeCounts: Record<string, number> = {};
for (const turn of turns) outcomeCounts[String(turn.verdict)] = (outcomeCounts[String(turn.verdict)] ?? 0) + 1;
const result = {
  at: new Date().toISOString(),
  method:
    "Historical local traces: metadata only; not a randomized current-build benchmark. Gaps include tool work and nonverbose buffering; they do not prove freezes.",
  keyConfigured: Boolean(process.env.OPENROUTER_API_KEY || getStoredOpenRouterApiKey()),
  count: turns.length,
  outcomeCounts,
  longest: turns.toSorted((a, b) => Number(b.durationMs) - Number(a.durationMs)).slice(0, 10),
};
mkdirSync("bench/history/system-audit", { recursive: true });
writeFileSync("bench/history/system-audit/trace-metadata.json", `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
