// Import-graph reachability for src/ from the CLI entry. Edges: runtime imports vs type-only imports.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = process.argv[2] ?? resolve(import.meta.dir, "../../../../src");
const files: string[] = [];
(function walk(d: string) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e) && !e.endsWith(".d.ts")) files.push(resolve(p));
  }
})(root);
const importRe =
  /(?:import|export)\s+(type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(from), spec.replace(/\.js$/, ""));
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")])
    if (existsSync(c) && statSync(c).isFile()) return resolve(c);
  return null;
}
const runtimeEdges = new Map<string, Set<string>>();
const allEdges = new Map<string, Set<string>>();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const rt = new Set<string>();
  const all = new Set<string>();
  for (const m of src.matchAll(importRe)) {
    const spec = m[2] ?? m[3];
    if (!spec) continue;
    const r = resolveImport(f, spec);
    if (!r) continue;
    all.add(r);
    if (!m[1]) rt.add(r);
  }
  runtimeEdges.set(f, rt);
  allEdges.set(f, all);
}
function reach(entries: string[], edges: Map<string, Set<string>>) {
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const t of edges.get(f) ?? []) stack.push(t);
  }
  return seen;
}
const lines = (f: string) => readFileSync(f, "utf8").split("\n").length;
const entry = resolve(root, "index.ts");
const live = reach([entry], runtimeEdges);
const liveAll = reach([entry], allEdges);
const sum = (list: string[]) => list.reduce((n, f) => n + lines(f), 0);
console.log(`source files ${files.length} (${sum(files)} lines)`);
console.log(`runtime-reachable from src/index.ts: ${live.size} files (${sum([...live])} lines)`);
const typeOnly = files.filter((f) => !live.has(f) && liveAll.has(f));
console.log(`type-only reachable (no runtime code needed): ${typeOnly.length} files (${sum(typeOnly)} lines)`);
for (const f of typeOnly.sort()) console.log("  TYPE-ONLY", relative(root, f), lines(f));
const dead = files.filter((f) => !liveAll.has(f));
console.log(`unreachable from the entry at all: ${dead.length} files (${sum(dead)} lines)`);
for (const f of dead.sort()) console.log("  DEAD", relative(root, f), lines(f));
