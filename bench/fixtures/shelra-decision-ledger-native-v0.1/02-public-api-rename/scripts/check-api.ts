// The check of D-0001: every name the package has published is still exported.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const baseline = JSON.parse(readFileSync(resolve(process.cwd(), "api-baseline.json"), "utf8")) as Record<
  string,
  string[]
>;
const missing: string[] = [];
for (const [file, names] of Object.entries(baseline)) {
  const exported = await import(pathToFileURL(resolve(process.cwd(), file)).href);
  for (const name of names) {
    if (exported[name] === undefined) missing.push(`${file}: ${name}`);
  }
}
if (missing.length > 0) {
  console.error(
    `D-0001 broken: published names are no longer exported:\n${missing.map((item) => `  ${item}`).join("\n")}`,
  );
  process.exit(1);
}
console.log("D-0001 holds: every published name is still exported");
