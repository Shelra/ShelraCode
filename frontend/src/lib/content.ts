// All copy and links of the site: ShelraCode, the terminal coding agent.
// Facts come from the repository (README, --help, bench/field/SCOREBOARD.md, docs/design). Measured numbers come from
// bench-summary.json (bun run bench:sync), never typed: the field notes below read it like the Benchmark section.
import bench from "./bench-summary.json";

const repo = "https://github.com/yosoyjavieruiz/ShelraCode";

export const links = {
  github: repo,
  install: `${repo}#install`,
  readme: `${repo}#readme`,
  localMode: `${repo}#cloud-runtime-and-secondary-local-mode`,
  fieldCases: `${repo}/blob/main/bench/field/SCOREBOARD.md`,
  bench: `${repo}/blob/main/bench/README.md`,
  benchHistory: `${repo}/blob/main/bench/history/benchmark-history.json`,
  memoryDesign: `${repo}/blob/main/docs/design/shelra-memory-engine.md`,
  harnessLog: `${repo}/blob/main/docs/architecture/14-AGENT-HARNESS-RECONSTRUCTION.md`,
  routingDesign: `${repo}/blob/main/docs/architecture/OPENROUTER-RUNTIME.md`,
  issues: `${repo}/issues`,
  license: `${repo}/blob/main/LICENSE`,
  author: "https://github.com/yosoyjavieruiz",
  openrouter: "https://openrouter.ai",
  // Names the sections import for their calls to action.
  getStarted: `${repo}#install`,
  pricing: `${repo}#install`,
  contactSales: `${repo}#cloud-runtime-and-secondary-local-mode`,
  placeholder: repo,
};

// The guide pages (src/lib/guides.ts holds their copy).
export const guideLinks = {
  memory: { label: "Project memory", href: "/memory" },
  local: { label: "Local mode", href: "/local" },
  freeModels: { label: "Free models", href: "/free-models" },
};

export const nav = [
  { label: "Benchmark", href: "/#benchmark" },
  { label: "Features", href: "/#features-overview" },
  { label: "Use cases", href: "/#use-cases" },
  { label: "How It Works", href: "/#how-it-works" },
  { label: "Field notes", href: "/#testimonials" },
  { label: "Pricing", href: "/#pricing" },
];

export const mobileNav = [
  { label: "Benchmark", href: "/#benchmark" },
  { label: "Features", href: "/#features-overview" },
  { label: "Use cases", href: "/#use-cases" },
  { label: "How it works", href: "/#how-it-works" },
  { label: "Field notes", href: "/#testimonials" },
  { label: "Pricing", href: "/#pricing" },
];

// How the displayed costs were obtained: billed by the provider, or estimated from catalog prices.
function costNote(): string {
  const kinds = new Set(bench.rows.map((row) => row.costKind));
  if (kinds.size === 1 && kinds.has("exact")) return "cost as billed by the provider";
  return kinds.has("exact") ? "cost billed or estimated from catalog prices" : "cost estimated from catalog prices";
}

// Shelra Bench on the landing page; the numbers come from src/lib/bench-summary.json (scripts/bench-summary.ts).
export const benchmark = {
  badge: "BENCHMARK",
  heading: ["Measured, not promised. ", "Same tasks, same oracle, every run on record."],
  suiteLabel: "CORE SUITE",
  updated: "updated",
  columns: ["Agent · model", "Resolved", "Cost", "Time", "Run"],
  // Reference agents measured on the same tasks and oracle; shown as pending until their runs are recorded.
  references: [
    { agent: "claude-code", label: "Claude Code", model: "Sonnet 5" },
    { agent: "codex", label: "Codex", model: "gpt-5.6-luna" },
  ],
  pendingNote: "being recorded · audit 2026-09-23",
  infraNote: "lost to the provider",
  infraFootnote: "tasks lost to the provider, not to the harness",
  progressLabel: "HARNESS PROGRESS",
  progressCaption: "Same model and tasks; only the harness changed between runs.",
  fieldLabel: "FIELD CASE",
  solved: "Solved",
  unsolved: "Not solved",
  reruns: "Re-runs on later commits",
  toolCalls: "tool calls",
  method: `One run is one sample · benchmark-owned oracle · model pinned per run · ${costNote()} · full record in bench/history`,
  button: "See every run",
  link: links.benchHistory,
};

export const hero = {
  heading: "The terminal coding agent that finishes the job.",
  supporting:
    "Type the task. ShelraCode reads your repo, plans, edits, runs the tests and verifies the result — on OpenRouter Free by default, on your own key when you allow it, fully local when you say so.",
  cta: "Get started",
  image: {
    src: "/images/tui-hero.webp",
    width: 1944,
    height: 1400,
    alt: "ShelraCode in a terminal fixing token refresh tests: it plans three steps, edits src/auth.ts, creates src/token.ts and works through the plan.",
  },
};

// The Windows one-line installer (public/install.ps1). The www host answers directly: the apex
// redirects with a 308, which Windows PowerShell 5.1's Invoke-RestMethod refuses to follow.
export const install = {
  label: "Windows · PowerShell",
  command: "irm https://www.shelra.dev/install.ps1 | iex",
  copy: "Copy the install command",
  copied: "Copied. Paste it in PowerShell.",
};

/** A wordmark of the logo wall: text set in the site's mono, no image. */
export type Logo = { name: string; text: string };

// What ShelraCode runs with: the runtimes, hosts and protocols it actually talks to.
export const logos: Record<string, Logo> = {
  openrouter: { name: "OpenRouter", text: "OpenRouter" },
  llamacpp: { name: "llama.cpp", text: "llama.cpp" },
  huggingface: { name: "Hugging Face", text: "Hugging Face" },
  github: { name: "GitHub", text: "GitHub" },
  telegram: { name: "Telegram", text: "Telegram" },
  bun: { name: "Bun", text: "Bun" },
  opentui: { name: "OpenTUI", text: "OpenTUI" },
  mcp: { name: "Model Context Protocol", text: "MCP" },
};

export const socialProof = {
  title: "Runs with the tools you already have",
  // One entry per grid cell: the marks it cycles through and its transition delay.
  cells: [
    { logos: ["openrouter", "llamacpp", "mcp"], delay: 0 },
    { logos: ["llamacpp", "huggingface", "github"], delay: 0.1 },
    { logos: ["huggingface", "github", "telegram", "bun"], delay: 0.2 },
    { logos: ["github", "telegram", "opentui"], delay: 0.3 },
    { logos: ["telegram", "bun", "openrouter"], delay: 0.4 },
    { logos: ["mcp", "opentui", "llamacpp"], delay: 0.5 },
  ],
};

export const features = {
  badge: "FEATURES",
  heading: ["Free models first. ", "A harness that makes them finish."],
  cards: [
    {
      number: "0.1",
      name: "Cloud-first, free first",
      illustration: 1,
      title: "OpenRouter Free by default",
      description:
        "The live catalog is discovered and filtered by capability. The free policy routes to models that can do the job and never picks a paid one silently; your key and your caps decide the rest.",
      link: guideLinks.freeModels.href,
      delay: 0,
    },
    {
      number: "0.2",
      name: "Persistent memory",
      illustration: 2,
      title: "It remembers your project",
      description:
        "Facts about the codebase live in .shelra/memory and are retrieved for every request. After a verified change, one bounded reflection proposes what to keep and a deterministic gate decides.",
      link: guideLinks.memory.href,
      delay: 0.2,
    },
    {
      number: "0.3",
      name: "Verified, or it says so",
      illustration: 3,
      title: "No “done” without a real check",
      description:
        "A turn that changed files but ran no test, build or request against the running app is asked to verify before it may finish, and is marked Not verified if it never does.",
      delay: 0.4,
    },
  ],
};

export const useCases = {
  badge: "USE CASES",
  heading: ["Every task a senior dev would dread. ", "ShelraCode runs it."],
  tabs: ["Fix a bug", "Build a feature", "Verify an app"],
  // Each image's width and height are the box the approved design shows it in (object-fit: cover), not the
  // capture's own 1944×1400: changing them changes the crop.
  items: [
    {
      title: "Find it. Fix it. Prove it.",
      description:
        "Describe the bug in plain English. ShelraCode locates the cause across the repo, patches it, runs the suite and keeps going until it is green — retrying the round, and moving to a fallback model, if the provider stalls.",
      checks: [
        "Root cause found across the whole codebase",
        "Regression test written and run",
        "Provider trouble never ends the turn",
      ],
      button: "Get started",
      link: links.getStarted,
      image: {
        src: "/images/tui-fix-bug.webp",
        width: 2016,
        height: 1408,
        alt: "ShelraCode's summary after a bug fix: what changed, the passing bun test run, and one new memory entry.",
      },
    },
    {
      title: "From goal to verified plan, then code.",
      description:
        "Run it with --autonomous. ShelraCode prints the specification, the acceptance criteria and the ordered plan before touching a file, then executes, checks every criterion and reports the evidence.",
      checks: [
        "[SPECIFICATION] and [PLAN] before any edit",
        "Every acceptance criterion has a concrete check",
        "Plan and evidence persisted under .shelra/objectives",
      ],
      button: "Get started",
      link: links.getStarted,
      image: {
        src: "/images/tui-build-feature.webp",
        width: 2016,
        height: 1408,
        alt: "ShelraCode in plan mode asking where sessions should be stored before it edits any file.",
      },
    },
    {
      title: "Build it, boot it, click it.",
      description:
        "/verify inspects the project, works out how to build and run it, starts it and runs browser smoke checks, with screenshots and video in the report. Headless with --verify for CI.",
      checks: [
        "Build, tests and boot in one flow",
        "Browser smoke checks with screenshots and video",
        "Works with any app type",
      ],
      button: "Get started",
      link: links.getStarted,
      image: {
        src: "/images/tui-verify.webp",
        width: 2016,
        height: 1408,
        alt: "ShelraCode's Checks view: bun test passes and every acceptance criterion is linked to a completed step.",
      },
    },
  ],
};

export const howItWorks = {
  badge: "HOW IT WORKS",
  heading: ["Three steps. ", "Then get out of the way."],
  cards: [
    {
      number: "1",
      title: "Say what you want",
      description:
        "In the terminal: shelra fix the flaky test in src/foo.test.ts. Or type in the composer, message it from your phone through Telegram, or run it headless with -p for scripts and CI.",
      delay: 0,
    },
    {
      number: "2",
      title: "ShelraCode plans, edits, runs",
      description:
        "It reads the codebase, publishes a plan for anything non-trivial, edits, runs the tests and iterates. Sub-agents explore, plan and verify alongside it.",
      delay: 0.2,
    },
    {
      number: "3",
      title: "Review what was verified",
      description:
        "The summary says what changed and which checks ran. Open /diff and /checks, resume with --session latest, and memory carries what it learned into the next task.",
      delay: 0.4,
    },
  ],
};

export const benefits = {
  badge: "BENEFITS",
  heading: ["Less overhead. ", "More output. Free first."],
  cards: [
    {
      icon: "hourglass",
      title: "Free first",
      description:
        "The default policy routes to OpenRouter Free models. Paid routing only inside a policy and a spend cap you set, checked before each request is sent.",
      delay: 0,
    },
    {
      icon: "feather",
      title: "Never aborts",
      description:
        "A rate limit, a cut stream or a rejected key keeps the finished steps, retries, then falls back: another key, OpenRouter Free, an installed local model. Only Esc ends a turn.",
      delay: 0.1,
    },
    {
      icon: "rocket",
      title: "Sub-agents",
      description:
        "explore, plan, general, vision, verify and computer, plus background delegation and your own named agents in user settings.",
      delay: 0.2,
    },
    {
      icon: "eye",
      title: "On the record",
      description:
        "Sessions in a local SQLite database, --session latest to resume, hooks on every tool, and autonomous plans with their evidence under .shelra/objectives.",
      delay: 0.3,
    },
    {
      icon: "gitBranch",
      title: "Your tools",
      description:
        "AGENTS.md instructions, Agent Skills, MCP servers, lifecycle hooks and a Telegram bridge. No new workflow to learn.",
      delay: 0.4,
    },
    {
      icon: "shield",
      title: "Private when needed",
      description:
        "--local runs a managed llama.cpp engine with a SHA-verified GGUF on loopback. Keys live in ~/.shelra/auth.json; a Shuru microVM sandbox is available on Apple Silicon.",
      delay: 0.5,
    },
  ],
} as const;

// Field notes: real problems and measurements (bench/field/SCOREBOARD.md, Shelra Bench), read from the summary.
const case001 = bench.fieldCases.find((fieldCase) => fieldCase.id.startsWith("001"));
const firstRerun = case001?.reruns[0];
const lastRerun = case001?.reruns.at(-1);
const progressRuns = bench.progress.runs;
const firstProgress = progressRuns[0];
const bestProgress = progressRuns.reduce((best, run) => (run.resolved > best.resolved ? run : best), progressRuns[0]);
const progressRow = bench.rows.find((row) => row.model === bench.progress.model);
// "qwen/qwen3-coder-30b-a3b-instruct" → "qwen3-coder-30b"
const modelName = (id: string) => (id.split("/").pop() ?? id).replace(/^(.*?\d+b)-.*$/, "$1");
const count = (n: number) => ["no", "one", "two", "three", "four", "five"][n] ?? String(n);
const tries = (n: number | null) => (n === 1 ? "on its first answer" : `in ${count(n ?? 0)} tries`);

export const testimonials = {
  badge: "FIELD NOTES",
  heading: ["Real problems. ", "What happened when they met free models."],
  items: [
    {
      badge: "FIELD CASE 001",
      quote: `Google Meet said the camera was in use. On a free model, ShelraCode named the process holding it ${tries(case001?.tries ?? null)}. ${case001?.reference?.agent} needed ${count(case001?.reference?.tries ?? 0)} tries.`,
      author: case001?.model ?? "",
      position: `${case001?.date} · ${case001?.tries} ${case001?.tries === 1 ? "try" : "tries"} vs ${case001?.reference?.tries}`,
    },
    {
      badge: "RE-RUNS",
      quote: `Across ${count(case001?.reruns.length ?? 0)} later harness commits the same case went from ${firstRerun?.minutes.toFixed(1)} minutes and ${firstRerun?.toolCalls} tool calls to ${lastRerun?.minutes.toFixed(1)} minutes and ${lastRerun?.toolCalls}, with ${count(lastRerun?.gateLoops ?? 0)} completion-gate loops.`,
      author: `Case 001 · ${firstRerun?.commit} → ${lastRerun?.commit}`,
      position: "Same free model, same prompt",
    },
    {
      badge: "SHELRA BENCH",
      quote: `The real turn loop went from ${firstProgress.resolved} of ${firstProgress.total} tasks to ${bestProgress.resolved} of ${bestProgress.total} with the same model. The model did not change; the harness did.`,
      author: `${bench.suite.name} v${bench.suite.version.replace(/\.0$/, "")}`,
      position: `${modelName(bench.progress.model)} · $${progressRow?.costUsd?.toFixed(2)} · ${progressRow?.minutes} min`,
    },
    {
      badge: "RESILIENCE",
      quote:
        "A rejected key mid-session moved the turn to a saved key, then to OpenRouter Free, then to a local Qwen2.5-Coder that was already installed. Eight seconds, nothing downloaded.",
      author: "Live check · 2026-09-22",
      position: "src/agent/resilience.test.ts",
    },
    {
      badge: "MEMORY",
      quote:
        "After a verified change, one bounded reflection proposes durable facts; a deterministic gate admits, merges or rejects them. No secrets, no prompt-injection phrasing, no inference over what you said.",
      author: "docs/design/shelra-memory-engine.md",
      position: "Proof suite · shelra-memory-v0.1",
    },
  ],
};

export const pricing = {
  badge: "PRICING",
  heading: ["Free first. ", "Your key or your machine when you want."],
  monthly: "Free policy",
  yearly: "Paid policy",
  discount: "Cap it",
  featuresLabel: "Included",
  plans: {
    starter: {
      name: "Free",
      price: "$0",
      period: "/forever",
      description:
        "OpenRouter Free models with the whole harness. No card, no trial: an OpenRouter key is all it takes.",
      button: "Install",
      link: links.install,
      included: [
        "Free models: 50–1,000 requests a day",
        "Memory, sub-agents, web research",
        "Skills, MCP servers, hooks",
        "Telegram remote control",
      ],
    },
    pro: {
      name: "Your key",
      badge: "BYOK",
      monthlyPrice: 0,
      yearlyPrice: 5,
      period: "/session cap",
      description:
        "Point it at OpenRouter or any OpenAI-compatible provider. The cap runs before every request; a paid model is never picked silently.",
      button: "Read the docs",
      link: links.readme,
      included: [
        "Routing policy: free → max",
        "--max-cost and --max-request-cost",
        "shelra models use <id> to pin one",
        "Falls back to Free on a bad key",
      ],
    },
    enterprise: {
      name: "Local",
      price: "$0",
      description:
        "Private or offline: a managed llama.cpp engine with a SHA-verified GGUF, chosen for your hardware, health-checked before chat.",
      button: "Run --local",
      link: guideLinks.local.href,
      included: [
        "No API key, no model provider",
        "Resumable, verified GGUF download",
        "Picks the model for your hardware",
        "Same agent loop, tools and memory",
      ],
    },
  },
};

export const faq = {
  badge: "FAQ",
  heading: ["Before you install. ", "Everything you need to know."],
  items: [
    {
      question: "Do I need an API key?",
      answer:
        "For the cloud path, yes: an OpenRouter key (shelra auth openrouter <key>) unlocks the Free catalog. The --local mode needs no key at all.",
    },
    {
      question: "Which models does it use?",
      answer:
        "Whatever OpenRouter serves. The catalog is discovered live and filtered by capability and by your spend policy; the default policy is Free and never picks a paid model silently. Pin one with shelra models use <id>.",
    },
    {
      question: "Is the free tier really free?",
      answer:
        "Yes: the default policy only uses OpenRouter's free models, which cost nothing. OpenRouter allows them 20 requests a minute and 50 a day, or 1,000 a day once you have bought $10 of credits, and a real task can take dozens. When a limit hits, ShelraCode retries and falls back; --local has no limit at all.",
      link: { label: "What the free tier allows", href: guideLinks.freeModels.href },
    },
    {
      question: "Does my code leave my machine?",
      answer:
        "In cloud mode the context the model needs goes to the provider you chose. In --local mode the model runs on your machine (a managed llama.cpp server on loopback with a verified GGUF), so no model provider sees your code; web research and the commands the agent runs can still reach the network.",
      link: { label: "How local mode works", href: guideLinks.local.href },
    },
    {
      question: "What happens when a provider fails mid-task?",
      answer:
        "The turn does not end. Finished steps are kept, the round is retried, and after two failures ShelraCode moves to the next fallback: another key you have, OpenRouter Free, then an installed local model. Only Esc ends a turn.",
    },
    {
      question: "How does it remember my project?",
      answer:
        "Project memory under .shelra/memory: every request retrieves the relevant entries; after a verified change one bounded reflection proposes durable facts and a deterministic gate admits, merges or rejects them. Rules you state are captured directly; repeated procedures become skills.",
      link: { label: "What it keeps and what it refuses", href: guideLinks.memory.href },
    },
    {
      question: "Can I run it without the TUI?",
      answer:
        'shelra -p "…" runs one prompt headless, --format json streams step events, --autonomous prints the specification, plan and verification before touching files, --session latest resumes. Pair Telegram to drive a running session from your phone.',
    },
  ],
};

export const finalCta = {
  heading: "Your backlog won't clear itself.",
  supporting: "Give ShelraCode the task. Get it back verified.",
  button: "Install ShelraCode",
  link: links.install,
  image: {
    src: "/images/tui-home.webp",
    width: 1944,
    height: 1400,
    alt: "The ShelraCode start screen: the project it opened and what it already knows, 3 memories, 1 skill and AGENTS.md.",
  },
};

export const footer = {
  tagline: "The terminal coding agent that finishes the job — free models first, local when you need it.",
  builtBy: "Built by",
  author: "yosoyjavieruiz",
  separator: "·",
  license: "MIT",
  navigationTitle: "Navigation",
  navigation: nav,
  socialsTitle: "Resources",
  socials: [
    guideLinks.memory,
    guideLinks.local,
    guideLinks.freeModels,
    { label: "GitHub", href: links.github },
    { label: "Field cases", href: links.fieldCases },
    { label: "Issues", href: links.issues },
  ],
};

export const notFound = {
  heading: "404: No such task.",
  supporting: "This page was never built. Check the URL or head back — ShelraCode is waiting for a real task.",
  button: "Back to home",
};

// Auth pages (written in the site's voice).
export type CardLine = { type: "cmd" | "out" | "ok" | "live" | "rule"; text?: string };

const loginCard: CardLine[] = [
  { type: "cmd", text: "$ shelra auth" },
  { type: "out", text: "> Opening a secure session..." },
  { type: "out", text: "> Provider: GitHub · Google" },
  { type: "rule" },
  { type: "ok", text: "Identity verified" },
  { type: "ok", text: "Workspace linked · 3 repos" },
  { type: "live", text: "> Resuming session latest" },
];

const signupCard: CardLine[] = [
  { type: "cmd", text: "$ shelra init" },
  { type: "out", text: "> Creating workspace..." },
  { type: "out", text: "> Policy: free · OpenRouter Free catalog" },
  { type: "rule" },
  { type: "ok", text: "Account ready" },
  { type: "ok", text: "GitHub · Google sign-in enabled" },
  { type: "live", text: "> Waiting for your first task" },
];

export const authCopy = {
  back: "Back to home",
  legal: "By continuing you agree to the Terms of Service and Privacy Policy.",
  providers: { github: "Continue with GitHub", google: "Continue with Google" },
  pending: "Opening {provider}…",
  notConfigured: "Not configured",
  login: {
    badge: "SIGN IN",
    heading: ["Welcome back. ", "Your sessions kept their memory."] as [string, string],
    supporting: "Sign in to manage your workspace, keys and usage across the CLI and the web.",
    switchText: "New here?",
    switchLink: "Create an account",
    switchHref: "/signup",
    card: loginCard,
  },
  signup: {
    badge: "CREATE ACCOUNT",
    heading: ["Ship while you sleep. ", "Start on free models."] as [string, string],
    supporting:
      "Create your account with GitHub or Google. No card: the free policy is the default, on your machine or in the cloud.",
    switchText: "Already have an account?",
    switchLink: "Sign in",
    switchHref: "/login",
    card: signupCard,
  },
  account: {
    badge: "ACCOUNT",
    heading: ["You're in. ", "Your workspace is ready."] as [string, string],
    supporting: "Sessions, connected repos and usage will show up here as you run them.",
    via: "via",
    expires: "Session valid until",
    home: "Back to home",
    signOut: "Sign out",
    card: { whoami: "$ shelra whoami", signedIn: "Signed in", session: "> Session active until" },
  },
  form: {
    or: "or",
    name: "NAME",
    email: "EMAIL",
    password: "PASSWORD",
    namePlaceholder: "Your name",
    emailPlaceholder: "you@company.com",
    login: { passwordPlaceholder: "Your password", submit: "Access", pending: "Checking…" },
    signup: { passwordPlaceholder: "At least 8 characters", submit: "Create account", pending: "Creating…" },
    errors: {
      email: "Enter a valid email address.",
      password: "Enter your password.",
      short: "Use at least 8 characters.",
      wrong: "Wrong email or password.",
      exists: "An account with this email already exists — sign in instead.",
      unavailable: "Email sign-in isn't set up on this deployment yet.",
      failed: "That didn't go through. Try again.",
    },
  },
  errors: {
    OAuthAccountNotLinked: "That email already belongs to another sign-in method. Use the one you signed up with.",
    AccessDenied: "The provider denied access. Try again or use another method.",
    Configuration: "Sign-in isn't set up on this deployment yet.",
    default: "Sign-in with {provider} didn't complete. Try again.",
  } as Record<string, string>,
};

export const seo = {
  title: "ShelraCode – open-source terminal coding agent, free models first",
  description:
    "An open-source (MIT) terminal coding agent: it plans, edits, runs your tests and reports what it verified. OpenRouter's free models by default, or fully local.",
};
