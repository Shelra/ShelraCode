// The check of D-0001: every key of every API response is snake_case.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { getUserResponse } = await import(pathToFileURL(resolve(process.cwd(), "src/api.ts")).href);
const problems: string[] = [];
function walk(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) walk(item, `${path}[${index}]`);
  } else if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, item] of Object.entries(value)) {
      if (!/^[a-z][a-z0-9_]*$/u.test(key)) problems.push(`${path}.${key} is not snake_case`);
      walk(item, `${path}.${key}`);
    }
  }
}
for (const id of ["u1", "u2", "u9"]) walk(getUserResponse(id).body, `GET /users/${id}`);
if (problems.length > 0) {
  console.error(`D-0001 broken:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
  process.exit(1);
}
console.log("D-0001 holds: every response key is snake_case");
