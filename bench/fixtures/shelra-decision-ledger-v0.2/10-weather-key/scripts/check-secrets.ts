// The check of D-0001: no API key sits in a file that could be committed (anything but .env).
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const secret = /\b(?:wk|sk|pk)_live_[A-Za-z0-9]{8,}\b/u;
const skip = new Set([".env", ".git", "node_modules"]);
const problems: string[] = [];
function scan(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name) || entry.name.startsWith(".env.")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (secret.test(readFileSync(path, "utf8"))) problems.push(`${path.slice(root.length + 1)} holds an API key`);
  }
}
scan(resolve(root));
if (problems.length > 0) {
  console.error(`D-0001 broken:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
  process.exit(1);
}
console.log("D-0001 holds: no secret in a committable file");
