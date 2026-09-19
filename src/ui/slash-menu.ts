export interface SlashMenuItem {
  id: string;
  label: string;
  description: string;
  aliases?: string[];
}

export const SLASH_MENU_ITEMS: SlashMenuItem[] = [
  { id: "models", label: "models", description: "Choose a model", aliases: ["model", "mode"] },
  { id: "plan", label: "plan", description: "The plan and what is left" },
  { id: "diff", label: "diff", description: "Files changed in this session" },
  { id: "checks", label: "checks", description: "Tests, types and lint results" },
  { id: "context", label: "context", description: "What is loaded and how full it is" },
  { id: "status", label: "status", description: "Plan, activity and evidence" },
  { id: "help", label: "help", description: "Shortcuts and commands" },
  { id: "verify", label: "verify", description: "Run local verification" },
  { id: "review", label: "review", description: "Review recent changes" },
  { id: "memory", label: "memory", description: "What Shelra knows about this project" },
  { id: "skills", label: "skills", description: "Skills available to Shelra" },
  { id: "agents", label: "agents", description: "Custom sub-agents" },
  {
    id: "tasks",
    label: "tasks",
    description: "Background and delegated agents",
    aliases: ["delegations"],
  },
  {
    id: "effort",
    label: "effort",
    description: "Reasoning effort",
    aliases: ["reasoning"],
  },
  { id: "new", label: "new session", description: "Start a new session" },
  { id: "commit-push", label: "commit & push", description: "Commit and push" },
  { id: "commit-pr", label: "commit & pr", description: "Commit and open a PR" },
  { id: "btw", label: "btw", description: "Ask a side question" },
  { id: "recaps", label: "recaps", description: "Session recaps on or off", aliases: ["recap", "summary"] },
  {
    id: "theme",
    label: "theme",
    description: "Appearance and motion",
    aliases: ["appearance"],
  },
  { id: "sandbox", label: "sandbox", description: "Shell sandbox mode" },
  { id: "mcp", label: "mcp", description: "MCP servers" },
  { id: "schedule", label: "schedule", description: "Scheduled runs" },
  { id: "wallet", label: "wallet", description: "Wallet and payments" },
  { id: "remote-control", label: "remote-control", description: "Remote control" },
  { id: "update", label: "update", description: "Update ShelraCode" },
  { id: "exit", label: "exit", description: "Quit Shelra" },
];

export function filterSlashMenuItems(items: SlashMenuItem[], query: string): SlashMenuItem[] {
  const normalized = normalizeSlashSearchQuery(query);
  if (!normalized) return items;

  return items
    .map((item, index) => ({ item, index, score: scoreSlashMenuItem(item, normalized) }))
    .filter((entry) => entry.score !== Number.POSITIVE_INFINITY)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.item);
}

function normalizeSlashSearchQuery(query: string): string {
  return query.trim().replace(/^\/+/, "").toLowerCase();
}

function scoreSlashMenuItem(item: SlashMenuItem, query: string): number {
  const commandFields = [item.id, item.label, ...(item.aliases ?? [])].flatMap(tokenizeSearchText);
  const descriptionFields = tokenizeSearchText(item.description);

  const commandScore = scoreFields(commandFields, query, 0);
  const descriptionScore = scoreFields(descriptionFields, query, 3);
  return Math.min(commandScore, descriptionScore);
}

function scoreFields(fields: string[], query: string, offset: number): number {
  for (const field of fields) {
    if (field === query || `/${field}` === query) return offset;
  }
  for (const field of fields) {
    if (field.startsWith(query) || `/${field}`.startsWith(query)) return offset + 1;
  }
  for (const field of fields) {
    if (field.includes(query) || `/${field}`.includes(query)) return offset + 2;
  }
  return Number.POSITIVE_INFINITY;
}

function tokenizeSearchText(value: string): string[] {
  const normalized = value.toLowerCase();
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  return [normalized, ...tokens];
}
