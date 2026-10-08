import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostTurnResult } from "../agent/evidence-core";
import type { BenchmarkTaskExecution } from "../bench/runner";
import type { BenchmarkTaskDefinition } from "../bench/types";

/** Real Bun CLI + SDK + tools + SQLite, in scratch folders, with no live inference or real credentials. */
vi.setConfig({ testTimeout: 120_000 });

const ENTRY = fileURLToPath(new URL("../index.ts", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "shelra-autonomous-cli-"));
let gateway: Server;
let url = "";
let home = "";
let work = "";
let step = 0;
let scenario: "pass" | "fail" | "outside" = "pass";
let sawMention = false;
let sawOracle = false;
let requests = 0;

beforeAll(async () => {
  gateway = createServer((request, response) => {
    let body = "";
    request.on("data", (part) => {
      body += part;
    });
    request.on("end", () => {
      if (request.url?.startsWith("/v1/models")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            data: [{ id: "fixture", context_length: 200_000, pricing: { prompt: "0", completion: "0" } }],
          }),
        );
        return;
      }
      if (request.url !== "/v1/chat/completions") {
        response.writeHead(404);
        response.end();
        return;
      }
      requests += 1;
      const input = JSON.parse(body) as { stream?: boolean; tools?: Array<{ function: { name: string } }> };
      sawMention ||= body.includes("fixture-at-mention");
      sawOracle ||= body.includes("Independent oracle requirement");
      const isTurn = input.tools?.some((tool) => tool.function.name === "write_file") === true;
      const chunk = (delta: object, finish: string | null = null, extra: object = {}) =>
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
      if (!input.stream) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            id: "fixture-summary",
            object: "chat.completion",
            created: 1,
            model: "fixture",
            choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      let call: { name: string; arguments: Record<string, unknown> } | undefined;
      if (isTurn) {
        const current = step++;
        if (current === 0) {
          call = {
            name: "write_file",
            arguments: {
              path: scenario === "outside" ? "../outside.json" : "value.json",
              content: `${JSON.stringify({ answer: scenario === "fail" ? 41 : 42 })}\n`,
            },
          };
        } else if (current === 1) {
          call =
            scenario === "outside"
              ? { name: "report_blocker", arguments: { reason: "The requested path is outside this workspace." } }
              : { name: "bash", arguments: { command: "bun run test", timeout: 30_000 } };
        }
      }
      if (call) {
        response.write(
          chunk({
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `fixture-${step}`,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              },
            ],
          }),
        );
      } else {
        response.write(
          chunk({
            role: "assistant",
            content: isTurn ? "[Checked by Shelra: bun run test passed] The answer is ready." : "{}",
          }),
        );
      }
      response.write(
        chunk({}, call ? "tool_calls" : "stop", {
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
      response.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  gateway.closeAllConnections();
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  home = mkdtempSync(join(root, "home-"));
  work = join(home, "work");
  mkdirSync(work);
  mkdirSync(join(home, ".shelra"));
  writeFileSync(
    join(home, ".shelra", "auth.json"),
    JSON.stringify({
      account: {
        apiUrl: "http://127.0.0.1:9",
        token: `shr_${"A".repeat(43)}`,
        tokenId: "fixture-account",
        email: "fixture@example.com",
        expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
        verifiedAt: new Date().toISOString(),
      },
    }),
  );
  writeFileSync(join(work, "package.json"), JSON.stringify({ scripts: { test: "bun run check.ts" } }));
  writeFileSync(join(work, "value.json"), '{"answer":0}\n');
  writeFileSync(join(work, "requirement.txt"), "fixture-at-mention: the expected answer is 42.\n");
  writeFileSync(
    join(work, "check.ts"),
    'const value = JSON.parse(await Bun.file("value.json").text());\nif (value.answer !== 42) throw new Error("Expected answer 42");\nconsole.log("answer checked");\n',
  );
  step = 0;
  requests = 0;
  scenario = "pass";
  sawMention = false;
  sawOracle = false;
});

function isolatedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(clean)) {
    if (/(?:API_KEY|_TOKEN|_SECRET)$/u.test(name) || /^(?:KEY_|SHELRA_|OMNIROUTE_)/u.test(name)) delete clean[name];
  }
  return {
    ...clean,
    HOME: home,
    USERPROFILE: home,
    SHELRA_API_KEY: "fixture-key",
    SHELRA_BASE_URL: url,
    SHELRA_TRACE: "off",
    SHELRA_AGENT_RUNS: "off",
    SHELRA_DIAGNOSTICS_LOG: "off",
    SHELRA_RESEARCH: "off",
    SHELRA_USER_MEMORY_ROOT: join(home, "user-memory"),
    ...extra,
  };
}

interface CliEvent {
  type: string;
  sessionID?: string;
  result?: HostTurnResult | null;
  text?: string;
  toolCall?: { function: { name: string } };
  toolResult?: { success: boolean; output?: string };
}

function cli(args: string[], extra: Record<string, string> = {}): Promise<{ code: number; events: CliEvent[] }> {
  return new Promise((resolve, reject) => {
    execFile(
      "bun",
      ["run", ENTRY, "--format", "json", "--model", "fixture", ...args],
      { cwd: work, env: isolatedEnv(extra), timeout: 90_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
        try {
          const events = stdout.trim()
            ? (stdout
                .trim()
                .split(/\r?\n/u)
                .map((line) => JSON.parse(line)) as CliEvent[])
            : [];
          if (!events.some((event) => event.type === "model_selected")) {
            reject(new Error(`CLI failed before its turn: ${stderr}\n${stdout}`));
            return;
          }
          resolve({ code, events });
        } catch (parseError) {
          reject(new Error(`Invalid CLI JSON: ${String(parseError)}\n${stderr}\n${stdout}`));
        }
      },
    );
  });
}

function checkpoints(): Array<{ file_path: string; previous_content: string; session_id: string }> {
  const output = execFileSync(
    "bun",
    [
      "-e",
      'import { Database } from "bun:sqlite"; const db = new Database(process.argv[1], {readonly:true}); console.log(JSON.stringify(db.query("SELECT file_path, previous_content, session_id FROM checkpoints ORDER BY id").all())); db.close();',
      join(home, ".shelra", "shelra.db"),
    ],
    { env: isolatedEnv(), windowsHide: true, encoding: "utf8" },
  );
  return JSON.parse(output);
}

const prompt = "Set the answer in value.json to 42 and verify with bun run test. Read @requirement.txt";

describe("autonomous execution uses the protected product turn", () => {
  it.each([
    false,
    true,
  ])("executes real tools and persists a pre-mutation checkpoint (autonomous=%s)", async (autonomous) => {
    const run = await cli([...(autonomous ? ["--autonomous"] : []), "-p", prompt]);
    expect(run.code).toBe(0);
    expect(JSON.parse(readFileSync(join(work, "value.json"), "utf8"))).toEqual({ answer: 42 });
    expect(sawMention).toBe(true);
    const tools = run.events.filter((event) => event.type === "tool_use");
    expect(tools.some((event) => event.toolCall?.function.name === "bash" && event.toolResult?.success)).toBe(true);
    expect(checkpoints()).toContainEqual({
      file_path: "value.json",
      previous_content: '{"answer":0}\n',
      session_id: run.events.find((event) => event.type === "model_selected")?.sessionID,
    });
    const hostEvents = run.events.filter((event) => event.type === "host_result");
    expect(hostEvents).toHaveLength(autonomous ? 1 : 0);
    if (autonomous) {
      expect(hostEvents[0].result?.status).toBe("verified");
      expect(hostEvents[0].result?.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ command: "bun run test", passed: true, fresh: true, cwd: work }),
        ]),
      );
    }
  });

  it.each([
    false,
    true,
  ])("uses the host outcome for autonomous exit while preserving ordinary headless exit (autonomous=%s)", async (autonomous) => {
    scenario = "fail";
    const run = await cli([...(autonomous ? ["--autonomous"] : []), "-p", prompt]);
    expect(run.code).toBe(autonomous ? 1 : 0);
    expect(run.events.some((event) => event.text?.includes("[Checked by Shelra: bun run test passed]"))).toBe(true);
    const hostEvents = run.events.filter((event) => event.type === "host_result");
    expect(hostEvents).toHaveLength(autonomous ? 1 : 0);
    if (autonomous) {
      const result = hostEvents[0].result;
      expect(result?.status).toBe("unverified");
      expect(result?.verified).toBe(false);
      expect(result?.checks.some((check) => !check.passed && check.detail.includes("Expected answer 42"))).toBe(true);
    }
  });

  it("inherits the real workspace path guard and reports a blocker", async () => {
    scenario = "outside";
    const run = await cli(["--autonomous", "-p", "Write the answer requested by the fixture."]);
    expect(run.code).toBe(1);
    expect(existsSync(join(home, "outside.json"))).toBe(false);
    expect(
      run.events.some(
        (event) =>
          event.type === "tool_use" &&
          event.toolResult?.success === false &&
          event.toolResult.output?.includes("outside the workspace"),
      ),
    ).toBe(true);
    expect(run.events.find((event) => event.type === "host_result")?.result?.status).toBe("blocked");
  });

  it("uses an explicitly selected provider with a positional objective and the saved session", async () => {
    const initial = await cli(["-p", prompt]);
    const session = initial.events.find((event) => event.type === "model_selected")?.sessionID;
    expect(session).toBeTruthy();
    writeFileSync(join(work, "value.json"), '{"answer":0}\n');
    writeFileSync(
      join(home, ".shelra", "user-settings.json"),
      JSON.stringify({ freeAccess: { freeModels: { omniroute: ["fixture"] } } }),
    );
    step = 0;
    requests = 0;
    const resumed = await cli(["--autonomous", "--provider", "omniroute", "--session", session as string, prompt], {
      OMNIROUTE_BASE_URL: url,
      OMNIROUTE_API_KEY: "fixture-omni-key",
    });
    expect(resumed.code).toBe(0);
    expect(requests).toBeGreaterThan(0);
    expect(resumed.events.find((event) => event.type === "model_selected")?.sessionID).toBe(session);
    expect(resumed.events.find((event) => event.type === "host_result")?.result?.status).toBe("verified");
  });

  it.each([
    true,
    false,
  ])("grades the alias with an external oracle independently of the host verdict (oracle pass=%s)", async (oraclePass) => {
    const adapter = new URL("../bench/shelra-executor.ts", import.meta.url).href;
    const provider = new URL("../runtimes/local-provider.ts", import.meta.url).href;
    const task: BenchmarkTaskDefinition = {
      id: "alias-fixture",
      category: "coding",
      difficulty: "easy",
      workspace: work,
      prompt: "Set the answer in value.json to 42 and verify with bun run test.",
      acceptanceCriteria: [
        {
          id: "oracle",
          description: "Independent oracle requirement",
          check: { kind: "file_contains", path: "value.json", pattern: oraclePass ? "42" : "43" },
        },
      ],
    };
    const script = `
      import { createShelraBenchmarkExecutor } from ${JSON.stringify(adapter)};
      import { createOpenAICompatibleProvider } from ${JSON.stringify(provider)};
      const executor = createShelraBenchmarkExecutor({
        provider: createOpenAICompatibleProvider("fixture-key", ${JSON.stringify(url)}, "fixture"),
        modelId: "fixture", taskTimeoutMs: 60000,
      });
      const result = await executor.executeTask(${JSON.stringify(task)}, { emit() {} });
      console.log(JSON.stringify(result));
    `;
    const execution = await new Promise<BenchmarkTaskExecution>((resolve, reject) => {
      execFile(
        "bun",
        ["-e", script],
        { cwd: work, env: isolatedEnv(), windowsHide: true, timeout: 90_000 },
        (error, stdout, stderr) => {
          if (error) reject(new Error(`${error.message}\n${stderr}`));
          else resolve(JSON.parse(stdout));
        },
      );
    });
    expect(execution.finalResult?.harness).toBe("agent-chat");
    expect(sawOracle).toBe(false);
    expect(execution.finalResult?.verified).toBe(oraclePass);
    expect(execution.finalResult?.hostResult).toEqual(expect.objectContaining({ status: "verified", verified: true }));
    expect(execution.status).toBe(oraclePass ? "passed" : "failed");
    expect(execution.behavior?.falseCompletion).toBe(!oraclePass);
    expect(checkpoints()).toContainEqual(
      expect.objectContaining({ file_path: "value.json", previous_content: '{"answer":0}\n' }),
    );
  });
});
