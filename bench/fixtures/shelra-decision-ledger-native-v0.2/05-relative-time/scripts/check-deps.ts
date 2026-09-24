// The check of D-0001: package.json declares only the allowed dependencies, and src imports no package.
import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, resolve } from "node:path";

const root = process.cwd();
const problems: string[] = [];
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as Record<string, unknown>;
const allowed = JSON.parse(readFileSync(resolve(root, "deps-allowlist.json"), "utf8")) as Record<string, string[]>;
for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
  const declared = Object.keys((manifest[field] as Record<string, string> | undefined) ?? {});
  const extra = declared.filter((name) => !(allowed[field] ?? []).includes(name));
  if (extra.length > 0) problems.push(`package.json ${field} adds ${extra.join(", ")}`);
}
const specifier = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/gu;
/** Node's own modules are no dependency, with or without the `node:` prefix. */
const builtin = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
function scan(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (/\.[cm]?[jt]sx?$/u.test(entry.name)) {
      for (const match of readFileSync(path, "utf8").matchAll(specifier)) {
        const name = match[1] ?? "";
        if (!name.startsWith(".") && !name.startsWith("bun:") && name !== "bun" && !builtin.has(name)) {
          problems.push(`${path.slice(root.length + 1)} imports the package ${name}`);
        }
      }
    }
  }
}
scan(resolve(root, "src"));
if (problems.length > 0) {
  console.error(`D-0001 broken:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
  process.exit(1);
}
console.log("D-0001 holds: no new dependencies");
