import { resolve } from "node:path";
import { compileContextPacket } from "../../../../src/context/compiler";

const prompts = [
  "Fix the completion gate so it re-verifies after later edits in src/agent/agent.ts",
  "The memory retrieval ranks stale entries too high; fix it and add a test",
  "why does the login page crash?",
];
for (const p of prompts) {
  const packet = compileContextPacket(resolve(import.meta.dir, "../../../.."), p);
  console.log("PROMPT:", p);
  console.log(
    " classification:",
    packet.classification.kind,
    "| truncated:",
    packet.truncated,
    "| files:",
    packet.files.length,
  );
  console.log(" files:", packet.files.slice(0, 30).join(", "));
  console.log(" appendix chars:", packet.promptAppendix.length);
}
