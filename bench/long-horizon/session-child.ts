/** The child process of `session.ts`: reads a session spec and runs it through the real agent. */
import { readFileSync } from "node:fs";
import { runSession, type SessionSpec } from "./session";

const specFile = process.argv[2];
if (!specFile) {
  console.error("usage: bun run session-child.ts <spec.json>");
  process.exit(2);
}
await runSession(JSON.parse(readFileSync(specFile, "utf8")) as SessionSpec);
