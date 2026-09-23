import { useEffect } from "react";
import { fill, script } from "./seed";
import { logActivity, notify, update } from "./store";
import type { DemoState, LogLine, Mission } from "./types";

/*
 * Makes the demo move: every tick a running mission prints its next line,
 * advances its plan, spends tokens and, at the end, opens a PR (or fails and
 * pauses for review). Queued missions start when there is capacity. Runs only
 * while a dashboard page is open and the tab is visible.
 */
export const TICK_MS = 1400;
const CAPACITY = 3;

const hash = (s: string) => Array.from(s).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const rate = (model: string) => (model === "deepseek-v4-flash" ? 0.03 : model === "nemotron-3-ultra-free" ? 0 : 0.012);

function advance(
  m: Mission,
  s: DemoState,
  now: number,
): { mission: Mission; finished?: "review" | "merged" | "failed" } {
  const repo = s.repos.find((r) => r.id === m.repoId);
  const line = script[m.cursor];
  if (!line) return finish(m, s, now);

  // The "Running the tests" failure is real for one mission in ten.
  const doomed = hash(m.id) % 10 === 0 && line.step === 4 && line.kind === "ok";
  const text = fill(
    line.text,
    { title: m.title, files: m.files.map((f) => f.path) },
    repo?.fullName ?? "",
    repo?.defaultBranch ?? "main",
    s.nextPr,
    m.files.length,
  );
  const entry: LogLine = doomed
    ? { t: now, kind: "err", text: "Tests still failing after 3 attempts · paused for review" }
    : { t: now, kind: line.kind, text };
  const tokensIn = m.tokensIn + 6000 + (hash(m.id + m.cursor) % 5000);
  const tokensOut = m.tokensOut + 1200 + (hash(m.cursor + m.id) % 1500);
  const next: Mission = {
    ...m,
    cursor: m.cursor + 1,
    log: [...m.log, entry],
    tokensIn,
    tokensOut,
    cost: Math.round(((tokensIn + tokensOut) / 1000) * rate(m.model) * 100) / 100,
    steps: m.steps.map((st, i) => ({ ...st, status: i < line.step ? "done" : i === line.step ? "active" : "pending" })),
  };
  if (doomed) {
    return {
      mission: {
        ...next,
        status: "failed",
        finishedAt: now,
        steps: next.steps.map((st, i) => ({ ...st, status: i < 4 ? "done" : i === 4 ? "failed" : "pending" })),
      },
      finished: "failed",
    };
  }
  return { mission: next };
}

function finish(m: Mission, s: DemoState, now: number): { mission: Mission; finished: "review" | "merged" } {
  const repo = s.repos.find((r) => r.id === m.repoId);
  const merged = m.autonomy === "auto-merge";
  const number = s.nextPr;
  const pr = {
    number,
    url: `https://github.com/${repo?.fullName ?? "acme/api"}/pull/${number}`,
    branch: `shelra/${m.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)}`,
    additions: m.files.reduce((sum, f) => sum + f.additions, 0),
    deletions: m.files.reduce((sum, f) => sum + f.deletions, 0),
    checks: [
      { name: "ci / test", status: "passed" as const },
      { name: "ci / lint", status: "passed" as const },
      { name: "ci / typecheck", status: "passed" as const },
    ],
  };
  const log = [
    ...m.log,
    {
      t: now,
      kind: "ok" as const,
      text: merged
        ? `PR #${number} merged into ${repo?.defaultBranch ?? "main"} (auto-merge policy)`
        : `PR #${number} ready for review`,
    },
  ];
  return {
    mission: {
      ...m,
      status: merged ? "merged" : "review",
      finishedAt: now,
      pr,
      log,
      steps: m.steps.map((st) => ({ ...st, status: "done" })),
    },
    finished: merged ? "merged" : "review",
  };
}

export function tick(now = Date.now()): void {
  update((s) => {
    const running = s.missions.filter((m) => m.status === "running").length;
    if (running === 0 && !s.missions.some((m) => m.status === "queued")) return s;

    let next: DemoState = s;
    let slots = CAPACITY - running;
    let nextPr = s.nextPr;
    const events: { mission: Mission; finished: "review" | "merged" | "failed" }[] = [];

    const missions = s.missions.map((m) => {
      if (m.status === "queued" && slots > 0) {
        slots -= 1;
        return {
          ...m,
          status: "running" as const,
          startedAt: now,
          steps: m.steps.map((st, i) => ({ ...st, status: i === 0 ? ("active" as const) : st.status })),
        };
      }
      if (m.status !== "running") return m;
      // A little jitter so two missions do not print in lockstep.
      if ((hash(m.id + String(now)) & 3) === 0 && m.cursor > 0 && m.cursor < script.length) return m;
      const result = advance(m, { ...s, nextPr }, now);
      if (result.finished) {
        if (result.finished !== "failed") nextPr += 1;
        events.push({ mission: result.mission, finished: result.finished });
      }
      return result.mission;
    });

    const runningAgents = new Set(missions.filter((m) => m.status === "running").map((m) => m.agentId));
    const agents = s.agents.map((a) =>
      a.status === "paused" ? a : { ...a, status: runningAgents.has(a.id) ? ("running" as const) : ("idle" as const) },
    );
    next = { ...next, missions, agents, nextPr };

    const today = new Date(now).toISOString().slice(0, 10);
    for (const { mission, finished } of events) {
      const repo = s.repos.find((r) => r.id === mission.repoId)?.fullName ?? "";
      const agent = s.agents.find((a) => a.id === mission.agentId)?.name ?? "Agent";
      const href = `/dashboard/missions/${mission.id}`;
      if (finished === "failed") {
        next = logActivity(next, "mission", agent, "paused for review", `${mission.title} · ${repo}`, href);
        if (s.preferences.notifyOnFailure)
          next = notify(next, "Mission paused", `${mission.title}: tests still failing after 3 attempts`, href);
      } else if (finished === "merged") {
        next = logActivity(next, "mission", agent, "merged", `${mission.title} · ${repo}`, href);
        next = notify(next, `PR #${mission.pr?.number} merged`, `${mission.title} · ${repo}`, href);
      } else {
        next = logActivity(next, "mission", agent, "opened a PR for", `${mission.title} · ${repo}`, href);
        if (s.preferences.notifyOnReview)
          next = notify(next, `PR #${mission.pr?.number} ready for review`, `${mission.title} · ${repo}`, href);
      }
      // Today's usage grows with every finished mission.
      const usage = next.usage.map((d) =>
        d.date === today
          ? {
              ...d,
              missions: d.missions + 1,
              tokensIn: d.tokensIn + mission.tokensIn,
              tokensOut: d.tokensOut + mission.tokensOut,
              cost: Math.round((d.cost + mission.cost) * 100) / 100,
            }
          : d,
      );
      next = { ...next, usage };
    }
    return next;
  });
}

/** Ticks the simulation while the component is mounted and the tab visible. */
export function useSimulation(): void {
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!document.hidden) tick();
    }, TICK_MS);
    return () => window.clearInterval(interval);
  }, []);
}
