// The check of D-0001: nothing under src/domain imports src/infra, a node: or bun: module, or a package.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const problems: string[] = [];
const specifier = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/gu;
function scan(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (/\.[cm]?[jt]sx?$/u.test(entry.name)) {
      for (const match of readFileSync(path, "utf8").matchAll(specifier)) {
        const name = match[1] ?? "";
        const reachesOut = /(^|\/)infra(\/|$)/u.test(name) || /(^|\/)app(\/|$)/u.test(name) || !name.startsWith(".");
        if (reachesOut) problems.push(`${path.slice(root.length + 1)} imports ${name}`);
      }
    }
  }
}
scan(resolve(root, "src/domain"));
if (problems.length > 0) {
  console.error(`D-0001 broken: the domain reaches outside itself:\n${problems.map((p) => `  ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("D-0001 holds: src/domain imports only src/domain");
