// The check of D-0001: migrations production has applied are unchanged, and new ones follow them in order.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(process.cwd(), "migrations");
const applied = JSON.parse(readFileSync(resolve(dir, "applied.json"), "utf8")) as Record<string, string>;
const problems: string[] = [];
for (const [file, checksum] of Object.entries(applied)) {
  const path = resolve(dir, file);
  if (!existsSync(path)) {
    problems.push(`${file} was applied in production and has been deleted`);
    continue;
  }
  const content = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
  if (createHash("sha256").update(content).digest("hex") !== checksum) {
    problems.push(`${file} was applied in production and has been edited`);
  }
}
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".sql"))
  .sort();
files.forEach((file, index) => {
  const expected = String(index + 1).padStart(4, "0");
  if (!/^\d{4}_[a-z0-9_]+\.sql$/u.test(file) || !file.startsWith(`${expected}_`)) {
    problems.push(`${file} is out of sequence: migration ${index + 1} should be named ${expected}_<what_it_does>.sql`);
  }
});
if (problems.length > 0) {
  console.error(`D-0001 broken:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
  process.exit(1);
}
console.log("D-0001 holds: applied migrations are unchanged");
