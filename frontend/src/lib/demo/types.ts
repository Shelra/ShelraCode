// The demo workspace: everything the dashboard shows, simulated in the browser.

export type MissionStatus = "queued" | "running" | "review" | "merged" | "failed" | "cancelled";
export type StepStatus = "pending" | "active" | "done" | "failed";
export type LogKind = "cmd" | "out" | "ok" | "warn" | "err";
export type Autonomy = "review" | "auto-merge";
export type AgentStatus = "idle" | "running" | "paused";
export type Trigger = "manual" | "issue" | "schedule" | "pr-comment";
export type Role = "owner" | "admin" | "member";
export type Plan = "starter" | "pro" | "enterprise";
export type ActivityKind = "mission" | "team" | "billing" | "security" | "integration" | "agent";

export type Step = { id: string; title: string; status: StepStatus };
export type LogLine = { t: number; kind: LogKind; text: string };
export type FileChange = {
  path: string;
  additions: number;
  deletions: number;
  status: "modified" | "added" | "deleted";
};
export type Check = { name: string; status: "pending" | "passed" | "failed" };
export type PullRequest = {
  number: number;
  url: string;
  branch: string;
  additions: number;
  deletions: number;
  checks: Check[];
};

export type Mission = {
  id: string;
  title: string;
  prompt: string;
  repoId: string;
  agentId: string;
  model: string;
  autonomy: Autonomy;
  status: MissionStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  steps: Step[];
  /** Index of the script line the simulation will emit next (running missions only). */
  cursor: number;
  log: LogLine[];
  files: FileChange[];
  pr?: PullRequest;
  cost: number;
  tokensIn: number;
  tokensOut: number;
};

export type Repo = {
  id: string;
  fullName: string;
  defaultBranch: string;
  language: string;
  private: boolean;
  status: "connected" | "syncing" | "error";
  connectedAt: number;
};

export type Agent = {
  id: string;
  name: string;
  description: string;
  model: string;
  autonomy: Autonomy;
  triggers: Trigger[];
  status: AgentStatus;
  createdAt: number;
};

export type UsageDay = { date: string; missions: number; tokensIn: number; tokensOut: number; cost: number };

export type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
};

export type Member = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "invited";
  joinedAt: number;
};

export type Invoice = { id: string; date: number; amount: number; status: "paid" | "open"; description: string };

export type Integration = {
  id: "github" | "linear" | "slack" | "jira" | "notion";
  name: string;
  description: string;
  connected: boolean;
  account?: string;
  connectedAt?: number;
};

export type Activity = {
  id: string;
  t: number;
  kind: ActivityKind;
  actor: string;
  action: string;
  target?: string;
  href?: string;
};

export type Notification = { id: string; t: number; title: string; body: string; read: boolean; href?: string };

export type Workspace = {
  name: string;
  slug: string;
  plan: Plan;
  yearly: boolean;
  seats: number;
  creditsIncluded: number;
  creditsAddOn: number;
  spendLimit: number;
  paymentMethod?: { brand: string; last4: string; expires: string };
};

export type Preferences = {
  defaultModel: string;
  defaultAutonomy: Autonomy;
  maxCostPerMission: number;
  notifyOnReview: boolean;
  notifyOnFailure: boolean;
  weeklyDigest: boolean;
};

export type DemoState = {
  version: number;
  seededAt: number;
  workspace: Workspace;
  preferences: Preferences;
  repos: Repo[];
  agents: Agent[];
  missions: Mission[];
  usage: UsageDay[];
  apiKeys: ApiKey[];
  members: Member[];
  invoices: Invoice[];
  integrations: Integration[];
  activity: Activity[];
  notifications: Notification[];
  nextPr: number;
};

export const models = [
  { id: "qwen3-coder-30b", name: "Qwen3 Coder 30B", note: "Balanced · default", costPer1k: 0.012 },
  {
    id: "nemotron-3-ultra-free",
    name: "Nemotron 3 Ultra (free)",
    note: "OpenRouter Free · quick edits and tests",
    costPer1k: 0,
  },
  { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", note: "Large refactors and migrations", costPer1k: 0.03 },
] as const;

export const planLimits: Record<Plan, { name: string; missions: number; repos: number; seats: number; price: number }> =
  {
    starter: { name: "Starter", missions: 5, repos: 1, seats: 1, price: 0 },
    pro: { name: "Pro", missions: Number.POSITIVE_INFINITY, repos: 10, seats: 5, price: 29 },
    enterprise: {
      name: "Enterprise",
      missions: Number.POSITIVE_INFINITY,
      repos: Number.POSITIVE_INFINITY,
      seats: 100,
      price: 0,
    },
  };
