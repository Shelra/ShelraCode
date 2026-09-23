import { useSyncExternalStore } from "react";
import { slugify } from "./format";
import { makeSteps, STATE_VERSION, seed } from "./seed";
import type {
  Activity,
  ActivityKind,
  Agent,
  ApiKey,
  Autonomy,
  DemoState,
  FileChange,
  Integration,
  Member,
  Mission,
  Notification,
  Plan,
  Preferences,
  Repo,
  Role,
  Trigger,
  Workspace,
} from "./types";

/*
 * The demo workspace lives in this module: one state object, persisted to
 * localStorage, read through `useDemo()` and changed through the actions below.
 * There is no backend; every action edits the state the way a server would.
 */
const KEY = "shelra-demo";
const listeners = new Set<() => void>();
let state: DemoState | null = null;
let saveTimer: number | undefined;

function load(): DemoState | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DemoState;
    return parsed.version === STATE_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

function persist() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Storage may be unavailable (private mode); the demo then lives for the tab only.
    }
  }, 250);
}

export function getState(): DemoState {
  if (!state) state = load() ?? seed();
  return state;
}

export function update(fn: (s: DemoState) => DemoState): void {
  state = fn(getState());
  persist();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const serverSnapshot = () => null;

/** The whole demo state, or null until the browser has hydrated. */
export function useDemo(): DemoState | null {
  return useSyncExternalStore(subscribe, getState, serverSnapshot);
}

export function resetDemo(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  state = seed();
  persist();
  for (const listener of listeners) listener();
}

// ---- helpers ---------------------------------------------------------------

const id = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 8)}`;

// Cuts at a word boundary and marks the cut.
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6))}…`;
}

export function logActivity(
  s: DemoState,
  kind: ActivityKind,
  actor: string,
  action: string,
  target?: string,
  href?: string,
): DemoState {
  const entry: Activity = { id: id("ac-"), t: Date.now(), kind, actor, action, target, href };
  return { ...s, activity: [entry, ...s.activity].slice(0, 200) };
}

export function notify(s: DemoState, title: string, body: string, href?: string): DemoState {
  const n: Notification = { id: id("n-"), t: Date.now(), title, body, read: false, href };
  return { ...s, notifications: [n, ...s.notifications].slice(0, 30) };
}

const actor = (s: DemoState) => s.members.find((m) => m.role === "owner")?.name ?? "You";

function filesFor(repo: Repo | undefined, title: string): FileChange[] {
  const slug = slugify(title) || "change";
  const pascal = slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  const paths =
    repo?.language === "Swift"
      ? [`Sources/${pascal}.swift`, `Tests/${pascal}Tests.swift`]
      : repo?.language === "HCL"
        ? [`modules/${slug}/main.tf`, `modules/${slug}/variables.tf`]
        : [`src/${slug}.ts`, `src/${slug}.test.ts`, "src/index.ts"];
  return paths.map((path, i) => ({
    path,
    additions: 12 + ((i * 37 + slug.length * 11) % 90),
    deletions: (i * 13 + slug.length * 3) % 30,
    status: path.includes("test") || path.includes("Tests") ? "added" : "modified",
  }));
}

// ---- missions --------------------------------------------------------------

export function createMission(input: {
  prompt: string;
  repoId: string;
  agentId: string;
  model: string;
  autonomy: Autonomy;
}): string {
  const missionId = id("m");
  update((s) => {
    const repo = s.repos.find((r) => r.id === input.repoId);
    const title = shorten(input.prompt.split(/[.\n]/)[0].trim(), 64) || "New mission";
    const mission: Mission = {
      id: missionId,
      title: title.charAt(0).toUpperCase() + title.slice(1),
      prompt: input.prompt.trim(),
      repoId: input.repoId,
      agentId: input.agentId,
      model: input.model,
      autonomy: input.autonomy,
      status: "queued",
      createdAt: Date.now(),
      steps: makeSteps(),
      cursor: 0,
      log: [],
      files: filesFor(repo, title),
      cost: 0,
      tokensIn: 0,
      tokensOut: 0,
    };
    const next = { ...s, missions: [mission, ...s.missions] };
    return logActivity(
      next,
      "mission",
      actor(s),
      "started",
      `${mission.title} · ${repo?.fullName ?? ""}`,
      `/dashboard/missions/${missionId}`,
    );
  });
  return missionId;
}

export function cancelMission(missionId: string): void {
  update((s) => {
    const mission = s.missions.find((m) => m.id === missionId);
    if (!mission || (mission.status !== "running" && mission.status !== "queued")) return s;
    const missions = s.missions.map((m) =>
      m.id === missionId
        ? {
            ...m,
            status: "cancelled" as const,
            finishedAt: Date.now(),
            steps: m.steps.map((st) => (st.status === "active" ? { ...st, status: "pending" as const } : st)),
            log: [...m.log, { t: Date.now(), kind: "warn" as const, text: "Cancelled by user" }],
          }
        : m,
    );
    return logActivity(
      { ...s, missions },
      "mission",
      actor(s),
      "cancelled",
      mission.title,
      `/dashboard/missions/${missionId}`,
    );
  });
}

export function retryMission(missionId: string): void {
  update((s) => {
    const missions = s.missions.map((m) =>
      m.id === missionId && (m.status === "failed" || m.status === "cancelled")
        ? {
            ...m,
            status: "queued" as const,
            createdAt: Date.now(),
            startedAt: undefined,
            finishedAt: undefined,
            steps: makeSteps(),
            cursor: 0,
            log: [],
            pr: undefined,
            cost: 0,
            tokensIn: 0,
            tokensOut: 0,
          }
        : m,
    );
    return { ...s, missions };
  });
}

export function approveMission(missionId: string): void {
  update((s) => {
    const mission = s.missions.find((m) => m.id === missionId);
    if (!mission || mission.status !== "review") return s;
    const missions = s.missions.map((m) =>
      m.id === missionId
        ? {
            ...m,
            status: "merged" as const,
            log: [
              ...m.log,
              {
                t: Date.now(),
                kind: "ok" as const,
                text: `PR #${m.pr?.number} merged into ${s.repos.find((r) => r.id === m.repoId)?.defaultBranch ?? "main"}`,
              },
            ],
          }
        : m,
    );
    const next = logActivity(
      { ...s, missions },
      "mission",
      actor(s),
      "merged",
      mission.title,
      `/dashboard/missions/${missionId}`,
    );
    return notify(next, `PR #${mission.pr?.number} merged`, mission.title, `/dashboard/missions/${missionId}`);
  });
}

// ---- agents ----------------------------------------------------------------

export function createAgent(input: {
  name: string;
  description: string;
  model: string;
  autonomy: Autonomy;
  triggers: Trigger[];
}): string {
  const agentId = id("a");
  update((s) => {
    const agent: Agent = { id: agentId, ...input, status: "idle", createdAt: Date.now() };
    return logActivity(
      { ...s, agents: [...s.agents, agent] },
      "agent",
      actor(s),
      "created agent",
      agent.name,
      "/dashboard/agents",
    );
  });
  return agentId;
}

export function updateAgent(agentId: string, patch: Partial<Omit<Agent, "id" | "createdAt">>): void {
  update((s) => ({ ...s, agents: s.agents.map((a) => (a.id === agentId ? { ...a, ...patch } : a)) }));
}

export function toggleAgentPaused(agentId: string): void {
  update((s) => {
    const agent = s.agents.find((a) => a.id === agentId);
    if (!agent) return s;
    const status = agent.status === "paused" ? "idle" : "paused";
    const next = {
      ...s,
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, status: status as Agent["status"] } : a)),
    };
    return logActivity(
      next,
      "agent",
      actor(s),
      status === "paused" ? "paused agent" : "resumed agent",
      agent.name,
      "/dashboard/agents",
    );
  });
}

export function deleteAgent(agentId: string): void {
  update((s) => {
    const agent = s.agents.find((a) => a.id === agentId);
    if (!agent) return s;
    return logActivity(
      { ...s, agents: s.agents.filter((a) => a.id !== agentId) },
      "agent",
      actor(s),
      "deleted agent",
      agent.name,
    );
  });
}

// ---- repos -----------------------------------------------------------------

export function connectRepo(fullName: string, language: string, defaultBranch = "main"): void {
  update((s) => {
    if (s.repos.some((r) => r.fullName === fullName)) return s;
    const repo: Repo = {
      id: id("r"),
      fullName,
      defaultBranch,
      language,
      private: true,
      status: "syncing",
      connectedAt: Date.now(),
    };
    const next = { ...s, repos: [...s.repos, repo] };
    return logActivity(next, "integration", actor(s), "connected repository", fullName, "/dashboard/repos");
  });
  // The first index finishes a moment later.
  window.setTimeout(() => {
    update((s) => ({ ...s, repos: s.repos.map((r) => (r.fullName === fullName ? { ...r, status: "connected" } : r)) }));
  }, 4000);
}

export function disconnectRepo(repoId: string): void {
  update((s) => {
    const repo = s.repos.find((r) => r.id === repoId);
    if (!repo) return s;
    return logActivity(
      { ...s, repos: s.repos.filter((r) => r.id !== repoId) },
      "integration",
      actor(s),
      "disconnected repository",
      repo.fullName,
    );
  });
}

// ---- api keys --------------------------------------------------------------

export function createApiKey(name: string, scopes: string[]): string {
  const random = Array.from(
    { length: 32 },
    () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)],
  ).join("");
  const secret = `shl_live_${random}`;
  update((s) => {
    const key: ApiKey = { id: id("k"), name, prefix: secret.slice(0, 13), scopes, createdAt: Date.now() };
    return logActivity(
      { ...s, apiKeys: [key, ...s.apiKeys] },
      "security",
      actor(s),
      "created API key",
      name,
      "/dashboard/api-keys",
    );
  });
  return secret;
}

export function revokeApiKey(keyId: string): void {
  update((s) => {
    const key = s.apiKeys.find((k) => k.id === keyId);
    if (!key || key.revokedAt) return s;
    const next = { ...s, apiKeys: s.apiKeys.map((k) => (k.id === keyId ? { ...k, revokedAt: Date.now() } : k)) };
    return logActivity(next, "security", actor(s), "revoked API key", key.name, "/dashboard/api-keys");
  });
}

// ---- team ------------------------------------------------------------------

export function inviteMember(email: string, role: Role): void {
  update((s) => {
    if (s.members.some((m) => m.email === email)) return s;
    const name = email
      .split("@")[0]
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const member: Member = { id: id("u"), name, email, role, status: "invited", joinedAt: Date.now() };
    return logActivity(
      { ...s, members: [...s.members, member] },
      "team",
      actor(s),
      "invited",
      `${email} as ${role}`,
      "/dashboard/team",
    );
  });
}

export function updateMemberRole(memberId: string, role: Role): void {
  update((s) => ({ ...s, members: s.members.map((m) => (m.id === memberId ? { ...m, role } : m)) }));
}

export function removeMember(memberId: string): void {
  update((s) => {
    const member = s.members.find((m) => m.id === memberId);
    if (!member || member.role === "owner") return s;
    return logActivity(
      { ...s, members: s.members.filter((m) => m.id !== memberId) },
      "team",
      actor(s),
      member.status === "invited" ? "cancelled invite for" : "removed",
      member.email,
    );
  });
}

// ---- integrations, billing, settings ---------------------------------------

export function toggleIntegration(integrationId: Integration["id"]): void {
  update((s) => {
    const integration = s.integrations.find((i) => i.id === integrationId);
    if (!integration) return s;
    const connected = !integration.connected;
    const integrations = s.integrations.map((i) =>
      i.id === integrationId
        ? {
            ...i,
            connected,
            account: connected ? s.workspace.slug : undefined,
            connectedAt: connected ? Date.now() : undefined,
          }
        : i,
    );
    return logActivity(
      { ...s, integrations },
      "integration",
      actor(s),
      connected ? "connected" : "disconnected",
      integration.name,
      "/dashboard/integrations",
    );
  });
}

export function updateWorkspace(patch: Partial<Workspace>): void {
  update((s) => ({ ...s, workspace: { ...s.workspace, ...patch } }));
}

export function updatePreferences(patch: Partial<Preferences>): void {
  update((s) => ({ ...s, preferences: { ...s.preferences, ...patch } }));
}

export function changePlan(plan: Plan, yearly: boolean): void {
  update((s) => {
    const creditsIncluded = plan === "starter" ? 250 : plan === "pro" ? 2500 : 25000;
    const next = { ...s, workspace: { ...s.workspace, plan, yearly, creditsIncluded } };
    return logActivity(
      next,
      "billing",
      actor(s),
      "changed plan to",
      `${plan} (${yearly ? "yearly" : "monthly"})`,
      "/dashboard/billing",
    );
  });
}

export function buyCredits(amount: number, price: number): void {
  update((s) => {
    const next = {
      ...s,
      workspace: { ...s.workspace, creditsAddOn: s.workspace.creditsAddOn + amount },
      invoices: [
        {
          id: `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`,
          date: Date.now(),
          amount: price,
          status: "paid" as const,
          description: `${amount} add-on credits`,
        },
        ...s.invoices,
      ],
    };
    return notify(
      logActivity(next, "billing", actor(s), "bought", `${amount} add-on credits`, "/dashboard/billing"),
      "Credits added",
      `${amount} add-on credits are ready to use.`,
      "/dashboard/billing",
    );
  });
}

export function markNotificationsRead(notificationId?: string): void {
  update((s) => ({
    ...s,
    notifications: s.notifications.map((n) =>
      notificationId === undefined || n.id === notificationId ? { ...n, read: true } : n,
    ),
  }));
}
