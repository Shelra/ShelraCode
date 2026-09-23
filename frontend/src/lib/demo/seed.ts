import { slugify } from "./format";
import type {
  Activity,
  Agent,
  ApiKey,
  DemoState,
  FileChange,
  Integration,
  Invoice,
  LogLine,
  Member,
  Mission,
  MissionStatus,
  Notification,
  Repo,
  Step,
  UsageDay,
} from "./types";

/*
 * A believable workspace, generated relative to "now" so the demo always looks
 * fresh: four repos, four agents, a month of missions (two of them running when
 * you open the dashboard), usage, keys, members, invoices and an activity log.
 * The generator is deterministic (seeded PRNG) apart from the timestamps.
 */
export const STATE_VERSION = 2;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const stepTitles = [
  "Reading the codebase",
  "Planning the approach",
  "Writing the code",
  "Running the tests",
  "Fixing failures",
  "Opening the PR",
];

export function makeSteps(status: "pending" | "done" = "pending"): Step[] {
  return stepTitles.map((title, i) => ({ id: `s${i}`, title, status }));
}

const repos: Repo[] = [
  {
    id: "r1",
    fullName: "acme/api",
    defaultBranch: "main",
    language: "TypeScript",
    private: true,
    status: "connected",
    connectedAt: 0,
  },
  {
    id: "r2",
    fullName: "acme/web",
    defaultBranch: "main",
    language: "TypeScript",
    private: true,
    status: "connected",
    connectedAt: 0,
  },
  {
    id: "r3",
    fullName: "acme/mobile",
    defaultBranch: "develop",
    language: "Swift",
    private: true,
    status: "connected",
    connectedAt: 0,
  },
  {
    id: "r4",
    fullName: "acme/infra",
    defaultBranch: "main",
    language: "HCL",
    private: true,
    status: "syncing",
    connectedAt: 0,
  },
];

const agents: Agent[] = [
  {
    id: "a1",
    name: "Bug Fixer",
    description: "Takes an issue, finds the root cause, patches it and adds the regression test.",
    model: "qwen3-coder-30b",
    autonomy: "review",
    triggers: ["manual", "issue"],
    status: "idle",
    createdAt: 0,
  },
  {
    id: "a2",
    name: "Feature Builder",
    description: "Turns a spec into a full-stack implementation with edge cases and tests.",
    model: "deepseek-v4-flash",
    autonomy: "review",
    triggers: ["manual"],
    status: "idle",
    createdAt: 0,
  },
  {
    id: "a3",
    name: "Test Writer",
    description: "Generates unit and integration suites for a module and fixes what fails.",
    model: "nemotron-3-ultra-free",
    autonomy: "auto-merge",
    triggers: ["manual", "pr-comment"],
    status: "idle",
    createdAt: 0,
  },
  {
    id: "a4",
    name: "Dependency Sentinel",
    description: "Every Monday: bumps vulnerable dependencies, runs the suite, opens one PR per repo.",
    model: "nemotron-3-ultra-free",
    autonomy: "auto-merge",
    triggers: ["schedule"],
    status: "idle",
    createdAt: 0,
  },
];

type MissionSeed = { title: string; repo: string; agent: string; files: string[] };

const missionSeeds: MissionSeed[] = [
  {
    title: "Fix flaky auth token refresh",
    repo: "r1",
    agent: "a1",
    files: ["src/auth/refresh.ts", "src/auth/refresh.test.ts"],
  },
  {
    title: "Add rate limiting to /v1/search",
    repo: "r1",
    agent: "a2",
    files: ["src/api/search.ts", "src/middleware/rateLimit.ts", "src/api/search.test.ts"],
  },
  {
    title: "Make payments webhook idempotent",
    repo: "r1",
    agent: "a2",
    files: ["src/payments/webhook.ts", "src/payments/idempotency.ts", "migrations/0042_webhook_events.sql"],
  },
  {
    title: "Write tests for BillingService",
    repo: "r1",
    agent: "a3",
    files: ["src/billing/BillingService.test.ts", "src/billing/fixtures.ts"],
  },
  {
    title: "Upgrade Next.js 16.2 → 16.3",
    repo: "r2",
    agent: "a4",
    files: ["package.json", "bun.lock", "next.config.ts"],
  },
  {
    title: "Remove dead feature flags",
    repo: "r2",
    agent: "a1",
    files: ["src/flags.ts", "src/app/settings/page.tsx", "src/app/billing/page.tsx"],
  },
  {
    title: "Fix N+1 in OrgMembers query",
    repo: "r1",
    agent: "a1",
    files: ["src/orgs/members.ts", "src/orgs/members.test.ts"],
  },
  {
    title: "Add dark mode to settings",
    repo: "r2",
    agent: "a2",
    files: ["src/app/settings/theme.tsx", "src/styles/tokens.css", "src/lib/useTheme.ts"],
  },
  { title: "Bump lodash (CVE-2026-1234)", repo: "r2", agent: "a4", files: ["package.json", "bun.lock"] },
  {
    title: "Refactor session middleware",
    repo: "r1",
    agent: "a2",
    files: ["src/middleware/session.ts", "src/middleware/session.test.ts", "src/server.ts"],
  },
  {
    title: "Add retry to S3 uploads",
    repo: "r3",
    agent: "a1",
    files: ["Sources/Storage/S3Client.swift", "Tests/StorageTests/RetryTests.swift"],
  },
  {
    title: "Fix timezone bug in scheduler",
    repo: "r1",
    agent: "a1",
    files: ["src/jobs/scheduler.ts", "src/jobs/scheduler.test.ts"],
  },
  {
    title: "Implement CSV export for invoices",
    repo: "r2",
    agent: "a2",
    files: ["src/app/billing/export.ts", "src/app/billing/InvoicesTable.tsx"],
  },
  { title: "Add OpenAPI docs for /v1/agents", repo: "r1", agent: "a2", files: ["openapi.yaml", "src/api/agents.ts"] },
  {
    title: "Reduce dashboard bundle size",
    repo: "r2",
    agent: "a1",
    files: ["next.config.ts", "src/app/dashboard/layout.tsx", "src/components/charts.tsx"],
  },
  {
    title: "Fix memory leak in websocket hub",
    repo: "r1",
    agent: "a1",
    files: ["src/realtime/hub.ts", "src/realtime/hub.test.ts"],
  },
  {
    title: "Add Slack alerts for failed runs",
    repo: "r4",
    agent: "a2",
    files: ["modules/alerts/main.tf", "modules/alerts/variables.tf"],
  },
  {
    title: "Instrument tracing for queue workers",
    repo: "r1",
    agent: "a2",
    files: ["src/queue/worker.ts", "src/telemetry/tracing.ts"],
  },
  { title: "Parallelize CI test matrix", repo: "r4", agent: "a1", files: [".github/workflows/ci.yml"] },
  {
    title: "Handle 429 from GitHub API",
    repo: "r1",
    agent: "a1",
    files: ["src/github/client.ts", "src/github/client.test.ts"],
  },
  { title: "Bump openssl in base image", repo: "r4", agent: "a4", files: ["docker/base.Dockerfile"] },
  { title: "Write tests for InviteFlow", repo: "r2", agent: "a3", files: ["src/app/team/InviteFlow.test.tsx"] },
  {
    title: "Migrate avatars to signed URLs",
    repo: "r3",
    agent: "a2",
    files: ["Sources/Media/AvatarLoader.swift", "Sources/Media/SignedURL.swift"],
  },
  {
    title: "Fix crash on empty push payload",
    repo: "r3",
    agent: "a1",
    files: ["Sources/Push/PayloadParser.swift", "Tests/PushTests/EmptyPayloadTests.swift"],
  },
  {
    title: "Add audit log retention job",
    repo: "r1",
    agent: "a2",
    files: ["src/jobs/retention.ts", "src/jobs/retention.test.ts"],
  },
  { title: "Write tests for RateLimiter", repo: "r1", agent: "a3", files: ["src/middleware/rateLimit.test.ts"] },
];

// The lines a running mission prints, step by step. `{file}` is one of its files.
export const script: { step: number; kind: LogLine["kind"]; text: string }[] = [
  { step: 0, kind: "cmd", text: "$ shelra" },
  { step: 0, kind: "out", text: "> Cloning {repo} @ {branch}" },
  { step: 0, kind: "out", text: "> Indexing 1,284 files · 3 packages" },
  { step: 0, kind: "out", text: "> Reading {file}" },
  { step: 0, kind: "ok", text: "Context ready · 14 relevant files" },
  { step: 1, kind: "out", text: "> Drafting plan" },
  { step: 1, kind: "out", text: "> 1. Reproduce  2. Patch  3. Test  4. PR" },
  { step: 1, kind: "ok", text: "Plan approved by policy: {autonomy}" },
  { step: 2, kind: "out", text: "> Editing {file}" },
  { step: 2, kind: "out", text: "> Editing {file2}" },
  { step: 2, kind: "out", text: "> Formatting · lint clean" },
  { step: 2, kind: "ok", text: "{files} files changed" },
  { step: 3, kind: "cmd", text: "$ bun test" },
  { step: 3, kind: "out", text: "> 212 passed · 1 failed · 4.8s" },
  { step: 3, kind: "warn", text: "FAIL {file2} › handles the empty case" },
  { step: 4, kind: "out", text: "> Reading the failing assertion" },
  { step: 4, kind: "out", text: "> Patching {file}" },
  { step: 4, kind: "cmd", text: "$ bun test" },
  { step: 4, kind: "ok", text: "213 passed · 0 failed · 5.1s" },
  { step: 5, kind: "cmd", text: "$ git push origin {pr}" },
  { step: 5, kind: "out", text: "> Writing the PR summary" },
  { step: 5, kind: "ok", text: "PR #{number} opened · CI running" },
];

const names = [
  ["Ada Lovelace", "ada@acme.dev"],
  ["Marcus Chen", "marcus@acme.dev"],
  ["Priya Natarajan", "priya@acme.dev"],
  ["Tomás Rivera", "tomas@acme.dev"],
  ["Lena Fischer", "lena@acme.dev"],
];

export function seed(now = Date.now()): DemoState {
  const rand = rng(20260923);
  const between = (a: number, b: number) => a + rand() * (b - a);

  const missions: Mission[] = [];
  let nextPr = 118;
  missionSeeds.forEach((m, i) => {
    // Newest first: the first two run right now, the next three wait for review.
    const status: MissionStatus =
      i < 2 ? "running" : i < 5 ? "review" : i === 9 || i === 17 ? "failed" : i === 14 ? "cancelled" : "merged";
    // Spread over the last four weeks, newest first.
    const createdAt =
      i < 2
        ? now - between(2, 9) * 60_000
        : now - ((i - 2) / (missionSeeds.length - 2)) * 27 * DAY - between(2, 20) * HOUR;
    const durationMs = between(6, 22) * 60_000;
    const done = status !== "running";
    const tokensIn = Math.round(between(60, 240) * 1000);
    const tokensOut = Math.round(between(12, 60) * 1000);
    const model = agents.find((a) => a.id === m.agent)?.model ?? "qwen3-coder-30b";
    const rate = model === "deepseek-v4-flash" ? 0.03 : model === "nemotron-3-ultra-free" ? 0 : 0.012;
    const files: FileChange[] = m.files.map((path, j) => ({
      path,
      additions: Math.round(between(4, 120)),
      deletions: Math.round(between(0, 40)),
      status: j === m.files.length - 1 && path.includes("test") ? "added" : "modified",
    }));
    const prNumber = done && status !== "cancelled" ? nextPr++ : undefined;
    const steps = makeSteps(done ? "done" : "pending");
    if (status === "failed") {
      steps[3].status = "failed";
      steps[4].status = "pending";
      steps[5].status = "pending";
    }
    if (status === "cancelled") for (let k = 2; k < 6; k++) steps[k].status = "pending";
    const repo = repos.find((r) => r.id === m.repo);
    const log: LogLine[] = done
      ? script
          .filter((line) => status !== "failed" || line.step <= 3)
          .map((line, k) => ({
            t: createdAt + (k / script.length) * durationMs,
            kind: line.kind,
            text: fill(line.text, m, repo?.fullName ?? "", repo?.defaultBranch ?? "main", prNumber ?? 0, files.length),
          }))
      : [];
    if (status === "failed")
      log.push({
        t: createdAt + durationMs,
        kind: "err",
        text: "Tests still failing after 3 attempts · paused for review",
      });
    missions.push({
      id: `m${String(1000 + i).padStart(4, "0")}`,
      title: m.title,
      prompt: prompts[i % prompts.length].replace("{title}", m.title.toLowerCase()),
      repoId: m.repo,
      agentId: m.agent,
      model,
      autonomy: m.agent === "a3" || m.agent === "a4" ? "auto-merge" : "review",
      status,
      createdAt,
      startedAt: createdAt + 20_000,
      finishedAt: done ? createdAt + durationMs : undefined,
      steps,
      cursor: 0,
      log,
      files,
      pr: prNumber
        ? {
            number: prNumber,
            url: `https://github.com/${repo?.fullName}/pull/${prNumber}`,
            branch: `shelra/${slugify(m.title)}`,
            additions: files.reduce((s, f) => s + f.additions, 0),
            deletions: files.reduce((s, f) => s + f.deletions, 0),
            checks: [
              { name: "ci / test", status: status === "failed" ? "failed" : "passed" },
              { name: "ci / lint", status: "passed" },
              { name: "ci / typecheck", status: "passed" },
            ],
          }
        : undefined,
      cost: done ? Math.round(((tokensIn + tokensOut) / 1000) * rate * 100) / 100 : 0,
      tokensIn: done ? tokensIn : 0,
      tokensOut: done ? tokensOut : 0,
    });
  });
  // The two running missions have already made some progress.
  for (const [i, cursor] of [
    [0, 9],
    [1, 3],
  ]) {
    const m = missions[i];
    const repo = repos.find((r) => r.id === m.repoId);
    const seedFiles = missionSeeds[i].files;
    for (let k = 0; k < cursor; k++) {
      const line = script[k];
      m.log.push({
        t: m.createdAt + k * 40_000,
        kind: line.kind,
        text: fill(
          line.text,
          missionSeeds[i],
          repo?.fullName ?? "",
          repo?.defaultBranch ?? "main",
          0,
          seedFiles.length,
        ),
      });
    }
    m.cursor = cursor;
    const step = script[cursor].step;
    m.steps = m.steps.map((s, k) => ({ ...s, status: k < step ? "done" : k === step ? "active" : "pending" }));
    m.tokensIn = Math.round(cursor * 9_000);
    m.tokensOut = Math.round(cursor * 2_100);
    m.cost = Math.round(((m.tokensIn + m.tokensOut) / 1000) * 0.012 * 100) / 100;
  }
  agents[0].status = "running";
  agents[1].status = "running";

  // Daily usage is what the finished missions actually cost, so every page tells the same story.
  const usage: UsageDay[] = [];
  const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
  for (let d = 29; d >= 0; d--) {
    const date = dayKey(now - d * DAY);
    const done = missions.filter((m) => m.status !== "running" && dayKey(m.createdAt) === date);
    usage.push({
      date,
      missions: done.length,
      tokensIn: done.reduce((sum, m) => sum + m.tokensIn, 0),
      tokensOut: done.reduce((sum, m) => sum + m.tokensOut, 0),
      cost: Math.round(done.reduce((sum, m) => sum + m.cost, 0) * 100) / 100,
    });
  }

  const apiKeys: ApiKey[] = [
    {
      id: "k1",
      name: "CI (GitHub Actions)",
      prefix: "shl_live_7f3a",
      scopes: ["missions:write", "repos:read"],
      createdAt: now - 41 * DAY,
      lastUsedAt: now - 2 * HOUR,
    },
    {
      id: "k2",
      name: "Local CLI",
      prefix: "shl_live_c91e",
      scopes: ["missions:write", "missions:read", "usage:read"],
      createdAt: now - 12 * DAY,
      lastUsedAt: now - 25 * 60_000,
    },
    {
      id: "k3",
      name: "Old laptop",
      prefix: "shl_live_2b0d",
      scopes: ["missions:read"],
      createdAt: now - 90 * DAY,
      lastUsedAt: now - 30 * DAY,
      revokedAt: now - 20 * DAY,
    },
  ];

  const members: Member[] = names.map(([name, email], i) => ({
    id: `u${i + 1}`,
    name,
    email,
    role: i === 0 ? "owner" : i === 1 ? "admin" : "member",
    status: i === 4 ? "invited" : "active",
    joinedAt: now - (60 - i * 9) * DAY,
  }));

  const invoices: Invoice[] = Array.from({ length: 6 }, (_, i) => {
    const date = new Date(now);
    date.setMonth(date.getMonth() - i, 1);
    return {
      id: `INV-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      date: date.getTime(),
      amount: 29 * 5 + (i === 1 ? 25 : 0),
      status: i === 0 ? "open" : "paid",
      description: i === 1 ? "Pro · 5 seats + 625 add-on credits" : "Pro · 5 seats",
    };
  });

  const integrations: Integration[] = [
    {
      id: "github",
      name: "GitHub",
      description: "Repos, PRs, checks and issue triggers.",
      connected: true,
      account: "acme",
      connectedAt: now - 62 * DAY,
    },
    {
      id: "linear",
      name: "Linear",
      description: "Start missions from issues and post status back.",
      connected: true,
      account: "acme-labs",
      connectedAt: now - 30 * DAY,
    },
    { id: "slack", name: "Slack", description: "Alerts for reviews, failures and merges.", connected: false },
    { id: "jira", name: "Jira", description: "Pick up tickets and link PRs to them.", connected: false },
    { id: "notion", name: "Notion", description: "Read specs and write mission summaries.", connected: false },
  ];

  const activity: Activity[] = [];
  missions.slice(2, 22).forEach((m, i) => {
    const repo = repos.find((r) => r.id === m.repoId)?.fullName;
    activity.push({
      id: `ac-m${i}`,
      t: m.finishedAt ?? m.createdAt,
      kind: "mission",
      actor: agents.find((a) => a.id === m.agentId)?.name ?? "Agent",
      action:
        m.status === "merged"
          ? "merged"
          : m.status === "failed"
            ? "paused for review"
            : m.status === "cancelled"
              ? "cancelled"
              : "opened a PR for",
      target: `${m.title} · ${repo}`,
      href: `/dashboard/missions/${m.id}`,
    });
  });
  activity.push(
    {
      id: "ac-t1",
      t: now - 3 * DAY,
      kind: "team",
      actor: "Ada Lovelace",
      action: "invited",
      target: "lena@acme.dev as member",
    },
    {
      id: "ac-b1",
      t: now - 33 * DAY,
      kind: "billing",
      actor: "Ada Lovelace",
      action: "bought",
      target: "625 add-on credits",
    },
    {
      id: "ac-s1",
      t: now - 20 * DAY,
      kind: "security",
      actor: "Marcus Chen",
      action: "revoked API key",
      target: "Old laptop",
    },
    {
      id: "ac-i1",
      t: now - 30 * DAY,
      kind: "integration",
      actor: "Ada Lovelace",
      action: "connected",
      target: "Linear (acme-labs)",
    },
    {
      id: "ac-a1",
      t: now - 45 * DAY,
      kind: "agent",
      actor: "Priya Natarajan",
      action: "created agent",
      target: "Dependency Sentinel",
    },
    {
      id: "ac-s2",
      t: now - 12 * DAY,
      kind: "security",
      actor: "Ada Lovelace",
      action: "created API key",
      target: "Local CLI",
    },
  );
  activity.sort((a, b) => b.t - a.t);

  const notifications: Notification[] = [
    {
      id: "n1",
      t: now - 25 * 60_000,
      title: "PR #120 ready for review",
      body: "Make payments webhook idempotent · acme/api",
      read: false,
      href: "/dashboard/missions/m1002",
    },
    {
      id: "n2",
      t: now - 3 * HOUR,
      title: "Mission paused",
      body: "Refactor session middleware: tests still failing after 3 attempts",
      read: false,
      href: "/dashboard/missions/m1009",
    },
    {
      id: "n3",
      t: now - 9 * HOUR,
      title: "PR #121 merged",
      body: "Write tests for BillingService · acme/api",
      read: true,
      href: "/dashboard/missions/m1003",
    },
    {
      id: "n4",
      t: now - 2 * DAY,
      title: "Credits at 80%",
      body: "You have used 80% of this month's included credits.",
      read: true,
      href: "/dashboard/billing",
    },
  ];

  return {
    version: STATE_VERSION,
    seededAt: now,
    workspace: {
      name: "Acme Labs",
      slug: "acme-labs",
      plan: "pro",
      yearly: false,
      seats: 5,
      creditsIncluded: 2500,
      creditsAddOn: 625,
      spendLimit: 250,
      paymentMethod: { brand: "Visa", last4: "4242", expires: "08/28" },
    },
    preferences: {
      defaultModel: "qwen3-coder-30b",
      defaultAutonomy: "review",
      maxCostPerMission: 5,
      notifyOnReview: true,
      notifyOnFailure: true,
      weeklyDigest: false,
    },
    repos: repos.map((r, i) => ({ ...r, connectedAt: now - (62 - i * 11) * DAY })),
    agents: agents.map((a, i) => ({ ...a, createdAt: now - (58 - i * 6) * DAY })),
    missions,
    usage,
    apiKeys,
    members,
    invoices,
    integrations,
    activity,
    notifications,
    nextPr,
  };
}

const prompts = [
  "Investigate and {title}. Add a regression test that fails before the fix and passes after.",
  "{title}. Keep the public API unchanged, cover edge cases, and open a PR with a short summary.",
  "{title}. Follow the conventions in CONTRIBUTING.md and make sure the whole suite passes.",
];

export function fill(
  text: string,
  m: MissionSeed | { files: string[] },
  repo: string,
  branch: string,
  pr: number,
  files: number,
): string {
  const list = m.files;
  return text
    .replace("{repo}", repo)
    .replace("{branch}", branch)
    .replace("{file2}", list[1] ?? list[0] ?? "src/index.ts")
    .replace("{file}", list[0] ?? "src/index.ts")
    .replace("{files}", String(files))
    .replace("{number}", String(pr))
    .replace("{pr}", `shelra/${slugify("title" in m ? m.title : "mission")}`)
    .replace("{autonomy}", "review before merge");
}
