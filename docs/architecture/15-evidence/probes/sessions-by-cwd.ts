import { Database } from "bun:sqlite";
import { homedir } from "node:os";

const db = new Database(`${homedir()}/.shelra/shelra.db`, { readonly: true });
const norm = (p: string) => p.split("\\").join("/").toLowerCase();
const home = norm(homedir());
const sessions = db.query("select id, cwd_at_start as cwd, model, created_at from sessions").all() as Array<{
  id: string;
  cwd: string;
  model: string;
  created_at: string;
}>;
const kind = (cwd: string) => {
  const c = norm(cwd ?? "");
  if (c.includes("/.shelra/bench/runs/")) return "bench-task";
  if (c.includes("/tmp") || c.includes("/temp/") || c.includes("scratch")) return "temp-dir (tests/field reruns/demos)";
  if (c.endsWith("/proyects/shelra") || c.includes("/proyects/shelra/")) return "shelra repo";
  if (c === home) return "home folder";
  return "other project";
};
const groups: Record<string, string[]> = {};
for (const s of sessions) {
  const group = kind(s.cwd);
  groups[group] = [...(groups[group] ?? []), s.id];
}
for (const [k, ids] of Object.entries(groups)) console.log(k.padEnd(40), ids.length);
const others = sessions.filter((s) => kind(s.cwd) === "other project").map((s) => norm(s.cwd).replace(home, "~"));
const counts: Record<string, number> = {};
for (const o of others)
  counts[o.split("/").slice(0, 4).join("/")] = (counts[o.split("/").slice(0, 4).join("/")] ?? 0) + 1;
console.log("other project roots:", JSON.stringify(counts));

const calls = db.query("select session_id, tool_name, args_json from tool_calls").all() as Array<{
  session_id: string;
  tool_name: string;
  args_json: string;
}>;
const msgs = db.query("select session_id, role, message_json from messages").all() as Array<{
  session_id: string;
  role: string;
  message_json: string;
}>;
for (const [k, ids] of Object.entries(groups)) {
  const set = new Set(ids);
  const c = calls.filter((x) => set.has(x.session_id));
  const freq: Record<string, number> = {};
  for (const x of c) freq[x.tool_name] = (freq[x.tool_name] ?? 0) + 1;
  const withTool = (name: string) => new Set(c.filter((x) => x.tool_name === name).map((x) => x.session_id)).size;
  const active = new Set(c.map((x) => x.session_id)).size;
  const m = msgs.filter((x) => set.has(x.session_id));
  const count = (needle: string) => m.filter((x) => x.message_json.includes(needle)).length;
  console.log(`\n== ${k}: sessions ${ids.length}, with tools ${active}, tool calls ${c.length}`);
  console.log(
    "  top tools:",
    Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([n, v]) => `${n}:${v}`)
      .join(" "),
  );
  console.log(
    `  sessions using: plan ${withTool("generate_plan")}, memory_* ${new Set(c.filter((x) => x.tool_name.startsWith("memory_")).map((x) => x.session_id)).size}, task ${withTool("task")}, search_web ${withTool("search_web")}, lsp ${withTool("lsp")}, grep ${withTool("grep")}`,
  );
  console.log(
    `  gate nudges ${count("Completion blocked:")}, requirement audits ${count("audit the request requirement by requirement")}, Not verified saved ${count("[Not verified")}, paused ${count("[Paused")}`,
  );
}
