import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The real CLI, as a person runs it, in a scratch home and a scratch folder (so no real key, setting or `.env` is
 * read), against a fake OmniRoute. Slow by nature, so each case spawns once and asserts on what the person would see.
 */

// Each case starts the real CLI, which takes seconds on a loaded machine; a late child must not outlive its case.
vi.setConfig({ testTimeout: 150_000 });

const ENTRY = fileURLToPath(new URL("../index.ts", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "shelra-cli-"));
let home = "";
let work = "";
let fake: Server;
let url = "";
const chatModels: string[] = [];
let served: { provider: string; model: string; cost?: string } = { provider: "opencode-free", model: "big-pickle" };

beforeAll(async () => {
  fake = createServer((request, response) => {
    let body = "";
    request.on("data", (part) => {
      body += part;
    });
    request.on("end", () => {
      if (request.url?.startsWith("/v1/models")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            data: [
              { id: "auto", owned_by: "omniroute" },
              { id: "auto/coding:free", owned_by: "omniroute" },
              { id: "opencode-free/big-pickle", owned_by: "opencode-free", context_length: 200_000 },
              { id: "openai/gpt-5", owned_by: "openai", pricing: { prompt: "0.00000125", completion: "0.00001" } },
            ],
          }),
        );
        return;
      }
      if (request.url === "/v1/chat/completions") {
        chatModels.push((JSON.parse(body) as { model: string }).model);
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "x-omniroute-provider": served.provider,
          "x-omniroute-model": served.model,
          ...(served.cost ? { "x-omniroute-response-cost": served.cost } : {}),
        });
        const chunk = (delta: Record<string, unknown>, finish: string | null = null, extra: object = {}) =>
          `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 1, model: "x", choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`;
        response.write(chunk({ role: "assistant", content: "Hello from the fake gateway." }));
        response.write(chunk({}, "stop", { usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } }));
        response.write("data: [DONE]\n\n");
        response.end();
        return;
      }
      response.writeHead(404);
      response.end();
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
});

afterAll(async () => {
  fake.closeAllConnections();
  await new Promise<void>((resolve) => fake.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  home = mkdtempSync(join(root, "home-"));
  work = join(home, "work");
  mkdirSync(work);
  // The account is required: this machine is signed in, and confirmed a minute ago, so no service is contacted.
  mkdirSync(join(home, ".shelra"), { recursive: true });
  writeFileSync(
    join(home, ".shelra", "auth.json"),
    JSON.stringify({
      account: {
        apiUrl: "http://127.0.0.1:9",
        token: `shr_${"A".repeat(43)}`,
        tokenId: "tok-test",
        email: "tester@example.com",
        expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
        verifiedAt: new Date().toISOString(),
      },
    }),
  );
  chatModels.length = 0;
  served = { provider: "opencode-free", model: "big-pickle" };
});

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function cli(args: string[], env: Record<string, string> = {}, timeout = 90_000): Promise<CliResult> {
  const clean: NodeJS.ProcessEnv = { ...process.env };
  for (const name of [
    "OPENROUTER_API_KEY",
    "KEY_OPENROUTER",
    "GROQ_API_KEY",
    "KEY_GROQ",
    "GEMINI_API_KEY",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "OMNIROUTE_BASE_URL",
    "OMNIROUTE_API_KEY",
    "SHELRA_BASE_URL",
    "SHELRA_API_KEY",
    "SHELRA_MODEL_POLICY",
  ]) {
    delete clean[name];
  }
  return new Promise((resolve) => {
    execFile(
      "bun",
      ["run", ENTRY, ...args],
      {
        cwd: work,
        env: { ...clean, HOME: home, USERPROFILE: home, SHELRA_TRACE: "off", ...env },
        timeout,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : error
              ? 1
              : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

const settings = () =>
  JSON.parse(readFileSync(join(home, ".shelra", "user-settings.json"), "utf8")) as Record<string, unknown>;

describe("shelra providers and auth", () => {
  it("says what is configured and how to configure the rest", async () => {
    const result = await cli(["providers", "--json"]);
    expect(result.code).toBe(0);
    const { providers } = JSON.parse(result.stdout) as {
      providers: Array<{ providerId: string; status: string; note: string }>;
    };
    expect(providers.map((row) => row.providerId)).toEqual(["openrouter", "groq", "gemini", "cloudflare", "omniroute"]);
    expect(providers.every((row) => row.status === "not set up")).toBe(true);
    expect(providers.find((row) => row.providerId === "omniroute")?.note).toContain("OMNIROUTE_BASE_URL");
  });

  it("stores OmniRoute's address in settings and its key in the credential store, never in settings", async () => {
    const saved = await cli(["auth", "omniroute", "--url", url, "omni-secret-key"]);
    expect(saved.code).toBe(0);
    expect(saved.stdout).toContain(`${url}/v1`);
    expect(saved.stdout).not.toContain("omni-secret-key");
    expect(settings()).toMatchObject({ omniroute: { baseUrl: `${url}/v1` } });
    expect(JSON.stringify(settings())).not.toContain("omni-secret-key");
    const auth = JSON.parse(readFileSync(join(home, ".shelra", "auth.json"), "utf8")) as {
      providers: { omniroute: { apiKey: string } };
    };
    expect(auth.providers.omniroute.apiKey).toBe("omni-secret-key");

    const removed = await cli(["auth", "remove", "omniroute"]);
    expect(removed.code).toBe(0);
    expect(settings().omniroute).toBeUndefined();
  });

  it("refuses an address that is not http(s), an empty command and a provider that does not exist", async () => {
    expect((await cli(["auth", "omniroute", "--url", "localhost:20128"])).code).toBe(1);
    expect((await cli(["auth", "omniroute"])).code).toBe(1);
    const unknown = await cli(["auth", "remove", "nope"]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('Unknown provider "nope"');
    const declared = await cli(["providers", "allow-free", "nope"]);
    expect(declared.code).toBe(1);
    expect(declared.stderr).toContain("Unknown provider");
  });

  it("declares what only the user knows, and refuses a declaration that would vouch for everything", async () => {
    expect((await cli(["providers", "allow-free", "omniroute"])).code).toBe(1);
    const wild = await cli(["providers", "allow-free", "omniroute", "*"]);
    expect(wild.code).toBe(1);
    expect(wild.stderr).toContain("too many models");
    const ok = await cli(["providers", "allow-free", "omniroute", "opencode-free/*"]);
    expect(ok.code).toBe(0);
    expect(settings()).toMatchObject({ freeAccess: { freeModels: { omniroute: ["opencode-free/*"] } } });
    const plan = await cli(["providers", "allow-free", "groq"]);
    expect(plan.code).toBe(0);
    expect(settings()).toMatchObject({ freeAccess: { freePlanProviders: ["groq"] } });
    expect((await cli(["providers", "deny-free", "groq"])).code).toBe(0);
    expect(settings()).toMatchObject({ freeAccess: { freePlanProviders: [] } });
  });
});

describe("shelra -p (headless)", () => {
  it("says how to configure a provider when there is none", async () => {
    const result = await cli(["-p", "say hi"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("needs a model provider");
    expect(result.stderr).toContain("OmniRoute");
  });

  it("rejects a provider that does not exist", async () => {
    const result = await cli(["-p", "hi", "--provider", "nope"]);
    expect(result.code).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('Unknown provider "nope"');
  });

  it("sends nothing in Free mode when no model is proven free, and pauses at once", async () => {
    const started = Date.now();
    const result = await cli(["-p", "say hi", "--model-policy", "free"], { OMNIROUTE_BASE_URL: url });
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(result.stdout).toContain("Paused");
    expect(result.stdout).toContain("Free mode uses free models only");
    expect(chatModels).toEqual([]);
  });

  it("runs Free mode on the model the user vouched for, never on an alias or a paid model", async () => {
    expect(
      (await cli(["providers", "allow-free", "omniroute", "opencode-free/*"], { OMNIROUTE_BASE_URL: url })).code,
    ).toBe(0);
    const result = await cli(["-p", "say hi", "--model-policy", "free"], { OMNIROUTE_BASE_URL: url });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Hello from the fake gateway.");
    expect(result.stdout + result.stderr).toContain("Auto Free");
    expect(chatModels.length).toBeGreaterThan(0);
    for (const model of chatModels) expect(model).toBe("opencode-free/big-pickle");
  });

  it("refuses a pinned paid model in Free mode, and runs it in Mixed on the provider it names", async () => {
    const free = await cli(["-p", "hi", "-m", "omniroute/openai/gpt-5", "--model-policy", "free"], {
      OMNIROUTE_BASE_URL: url,
    });
    expect(free.code).toBe(1);
    expect(free.stderr).toMatch(/Free mode uses free models only|is paid/u);
    expect(chatModels).toEqual([]);

    served = { provider: "openai", model: "gpt-5" };
    const mixed = await cli(["-p", "hi", "-m", "omniroute/openai/gpt-5", "--model-policy", "mixed"], {
      OMNIROUTE_BASE_URL: url,
    });
    expect(mixed.code).toBe(0);
    expect(mixed.stdout).toContain("Hello from the fake gateway.");
    expect(chatModels[0]).toBe("openai/gpt-5");
  });

  it("stays responsive and reports it when OmniRoute is offline", async () => {
    const started = Date.now();
    const result = await cli(["-p", "say hi", "--model-policy", "free"], { OMNIROUTE_BASE_URL: "http://127.0.0.1:9" });
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(result.stdout).toContain("Paused");
    expect(chatModels).toEqual([]);
  });

  it("takes Free mode's saved mode and a saved default model from settings", async () => {
    await cli(["auth", "omniroute", "--url", url]);
    await cli(["providers", "allow-free", "omniroute", "opencode-free/*"]);
    const used = await cli(["models", "use", "omniroute/openai/gpt-5"]);
    expect(used.code).toBe(0);
    expect(settings()).toMatchObject({ defaultModel: "omniroute/openai/gpt-5" });
    // Free is automatic: the saved Mixed pick does not leak into it.
    const result = await cli(["-p", "say hi", "--model-policy", "free"]);
    expect(result.code).toBe(0);
    for (const model of chatModels) expect(model).toBe("opencode-free/big-pickle");
  });
});
