import type { DemoState, Mission } from "@/lib/demo/types";

const DAY = 86_400_000;

export function missionProgress(m: Mission): number {
  const done = m.steps.filter((s) => s.status === "done").length;
  const active = m.steps.some((s) => s.status === "active") ? 0.5 : 0;
  return Math.min(1, (done + active) / m.steps.length);
}

export function repoName(s: DemoState, repoId: string): string {
  return s.repos.find((r) => r.id === repoId)?.fullName ?? "—";
}

export function agentName(s: DemoState, agentId: string): string {
  return s.agents.find((a) => a.id === agentId)?.name ?? "—";
}

export function modelName(id: string): string {
  return id === "deepseek-v4-flash"
    ? "DeepSeek V4 Flash"
    : id === "nemotron-3-ultra-free"
      ? "Nemotron 3 Ultra (free)"
      : "Qwen3 Coder 30B";
}

export function missionsSince(s: DemoState, days: number, now = Date.now()): Mission[] {
  return s.missions.filter((m) => m.createdAt >= now - days * DAY);
}

export function lastUpdated(m: Mission): number {
  return m.finishedAt ?? m.log[m.log.length - 1]?.t ?? m.startedAt ?? m.createdAt;
}

export function successRate(missions: Mission[]): number | null {
  const merged = missions.filter((m) => m.status === "merged").length;
  const failed = missions.filter((m) => m.status === "failed").length;
  const total = merged + failed;
  return total === 0 ? null : merged / total;
}

export function creditsUsed(s: DemoState): number {
  // A credit is about three cents of model spend; the sidebar, usage and billing share this reading.
  return Math.round(s.usage.reduce((sum, d) => sum + d.cost, 0) * 35);
}
