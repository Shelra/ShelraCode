/** Local-only operation profiling; generated fixtures contain no project or user data. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createMCPClient } from "@ai-sdk/mcp";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildMcpToolSet } from "../src/mcp/runtime";
import { readFile } from "../src/tools/file";

const root = mkdtempSync(join(tmpdir(), "shelra-operation-audit-"));
const trials: Array<Record<string, unknown>> = [];
try {
  const server = join(root, "server.cjs");
  writeFileSync(
    server,
    `
let ready=false, buffer="", queued=[];
function reply(m) { if(m.id===undefined) return;
 const result=m.method==="initialize"?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:"audit",version:"1"}}:{tools:[]};
 process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:m.id,result})+"\\n"); }
process.stdin.setEncoding("utf8");
process.stdin.on("data",text=>{buffer+=text; let i; while((i=buffer.indexOf("\\n"))>=0) {const m=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);if(ready)reply(m);else queued.push(m);}});
process.stdin.on("end",()=>process.exit(0));
process.stderr.write("x".repeat(2*1024*1024),()=>{ready=true;for(const m of queued)reply(m);queued=[];});
`,
    "utf8",
  );
  for (let repeat = 0; repeat < 3; repeat++) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [server], stderr: "pipe" });
    const start = performance.now();
    const connecting = createMCPClient({ transport });
    let timer: ReturnType<typeof setTimeout>;
    const connected = await Promise.race([
      connecting.then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 500);
      }),
    ]);
    clearTimeout(timer!);
    trials.push({
      probe: "mcp-undrained-stderr",
      repeat,
      connected,
      durationMs: performance.now() - start,
      stderrBytes: 2 * 1024 * 1024,
    });
    await transport.close();
    void connecting.then(
      (client) => client.close(),
      () => {},
    );
    const afterStart = performance.now();
    const bundle = await buildMcpToolSet(
      [
        {
          id: "fixture",
          label: "Fixture",
          transport: "stdio",
          enabled: true,
          command: process.execPath,
          args: [server],
        },
      ],
      { timeoutMs: 500 },
    );
    trials.push({
      probe: "mcp-drained-stderr",
      repeat,
      connected: bundle.errors.length === 0,
      durationMs: performance.now() - afterStart,
      errors: bundle.errors,
    });
    await bundle.close();
  }
  const large = join(root, "large.txt");
  writeFileSync(large, "x\n".repeat(16 * 1024 * 1024), "utf8");
  for (let repeat = 0; repeat < 3; repeat++) {
    const before = process.memoryUsage();
    const started = performance.now();
    const tick = new Promise<number>((resolve) => setTimeout(() => resolve(performance.now() - started), 0));
    const result = readFile("large.txt", root, 1, 1);
    const elapsedMs = performance.now() - started;
    trials.push({
      probe: "single-line-read-of-32MiB-file",
      repeat,
      durationMs: elapsedMs,
      eventLoopDelayMs: await tick,
      outputChars: result.output.length,
      success: result.success,
      rssDeltaBytes: process.memoryUsage().rss - before.rss,
      heapDeltaBytes: process.memoryUsage().heapUsed - before.heapUsed,
    });
  }
} finally {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
mkdirSync("bench/history/system-audit", { recursive: true });
const result = {
  method:
    "k=3; real local MCP child writes 2MiB stderr before initialize response; original undrained transport policy recreated alongside fixed product. Synchronous one-line file read measured separately. No provider calls.",
  trials,
};
writeFileSync("bench/history/system-audit/operations.json", `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
