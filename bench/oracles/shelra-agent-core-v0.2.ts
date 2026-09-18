import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const taskId = process.argv[2];
const workspace = process.env.SHELRA_BENCH_WORKSPACE || process.cwd();
const moduleCacheKey = `?shelra-bench=${Date.now()}`;

function fail(message: string): never {
  throw new Error(`[${taskId || "unknown-task"}] ${message}`);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

/** JSON with object keys sorted at every level: deep equality must not depend on insertion order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : item,
  );
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (canonical(actual) !== canonical(expected)) {
    fail(`${message}. expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

// biome-ignore lint/suspicious/noExplicitAny: module loaded dynamically from the graded workspace
async function loadModule(relativePath: string): Promise<Record<string, any>> {
  const path = resolve(workspace, relativePath);
  // biome-ignore lint/suspicious/noExplicitAny: module loaded dynamically from the graded workspace
  return (await import(pathToFileURL(path).href + moduleCacheKey)) as Record<string, any>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function expectRejects(operation: () => unknown | Promise<unknown>, message: string): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  fail(`${message}: operation resolved`);
}

async function checkInputNormalization(): Promise<void> {
  const { slugify } = await loadModule("src/slug.ts");
  assert(typeof slugify === "function", "slugify export is missing");
  const cases: Array<[string, string]> = [
    ["Hello, World!", "hello-world"],
    ["  Multiple   spaces  ", "multiple-spaces"],
    ["Acme_v2 / beta", "acme-v2-beta"],
    ["--already-valid--", "already-valid"],
    ["a---b", "a-b"],
    ["123 Launch", "123-launch"],
    ["", ""],
    ["   ", ""],
  ];
  for (const [input, expected] of cases) equal(slugify(input), expected, `slugify(${JSON.stringify(input)})`);
}

async function checkConfigPipeline(): Promise<void> {
  const configModule = await loadModule("src/config.ts");
  const appModule = await loadModule("src/app.ts");
  const { loadConfig } = configModule;
  const { serverAddress } = appModule;
  assert(typeof loadConfig === "function", "loadConfig export is missing");
  assert(typeof serverAddress === "function", "serverAddress export is missing");
  equal(loadConfig({}), { host: "127.0.0.1", port: 3000, debug: false, retries: 3 }, "default config");
  equal(
    loadConfig({ HOST: " 0.0.0.0 ", PORT: "8080", DEBUG: " YeS ", RETRIES: "0" }),
    { host: "0.0.0.0", port: 8080, debug: true, retries: 0 },
    "normalized config",
  );
  equal(
    loadConfig({ HOST: " ", PORT: "0", DEBUG: "maybe", RETRIES: "99" }),
    { host: "127.0.0.1", port: 3000, debug: false, retries: 3 },
    "invalid config fallback",
  );
  equal(serverAddress({ HOST: " api.local ", PORT: "443" }), "http://api.local:443", "server address");
}

async function checkTtlCache(): Promise<void> {
  const { TtlCache } = await loadModule("src/cache.ts");
  assert(typeof TtlCache === "function", "TtlCache export is missing");
  let now = 100;
  const cache = new TtlCache(() => now);
  cache.set("key", "value", 25);
  equal(cache.get("key"), "value", "cache value before expiry");
  assert(cache.has("key"), "cache has value before expiry");
  now = 124;
  equal(cache.get("key"), "value", "cache value immediately before expiry");
  now = 125;
  equal(cache.get("key"), undefined, "cache expiry boundary");
  assert(!cache.has("key"), "expired key must not remain in has");
  cache.set("key", "new", 50);
  now = 126;
  equal(cache.get("key"), "new", "overwritten cache value");
  cache.delete("key");
  cache.delete("key");
  assert(!cache.has("key"), "delete must be idempotent");
  cache.set("zero", "gone", 0);
  equal(cache.get("zero"), undefined, "zero TTL must expire immediately");
}

async function checkRetryPolicy(): Promise<void> {
  const { withRetry } = await loadModule("src/retry.ts");
  assert(typeof withRetry === "function", "withRetry export is missing");
  let calls = 0;
  const waits: number[] = [];
  const value = await withRetry(
    async (attempt: number) => {
      calls += 1;
      if (attempt < 3) throw new Error(`transient-${attempt}`);
      return "ok";
    },
    { maxAttempts: 4, baseDelayMs: 10, sleep: async (ms: number) => waits.push(ms) },
  );
  equal(value, "ok", "retry eventual value");
  equal(calls, 3, "retry call count");
  equal(waits, [10, 20], "exponential backoff");

  let finalCalls = 0;
  const finalError = await expectRejects(
    () =>
      withRetry(
        async () => {
          finalCalls += 1;
          throw new Error(`final-${finalCalls}`);
        },
        { maxAttempts: 3, baseDelayMs: 5, sleep: async (ms: number) => waits.push(ms) },
      ),
    "final failure",
  );
  equal(finalCalls, 3, "final failure attempts");
  assert(finalError instanceof Error && finalError.message === "final-3", "last error must be rethrown");

  let abortCalls = 0;
  const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
  await expectRejects(
    () =>
      withRetry(
        async () => {
          abortCalls += 1;
          throw abortError;
        },
        { maxAttempts: 4, sleep: async () => fail("AbortError should not sleep") },
      ),
    "abort failure",
  );
  equal(abortCalls, 1, "AbortError must not retry");
}

async function checkStateMigration(): Promise<void> {
  const { migrateState } = await loadModule("src/state.ts");
  assert(typeof migrateState === "function", "migrateState export is missing");
  const original = {
    version: 1,
    userName: "  Ada Lovelace  ",
    theme: "dark",
    metadata: { source: "fixture", count: 2 },
    untouched: ["keep"],
  };
  const before = JSON.stringify(original);
  const migrated = migrateState(original);
  equal(
    migrated,
    {
      version: 2,
      profile: { name: "Ada Lovelace" },
      preferences: { theme: "dark" },
      metadata: { source: "fixture", count: 2 },
      untouched: ["keep"],
    },
    "v1 migration",
  );
  equal(JSON.stringify(original), before, "migration must not mutate input");
  const v2 = { version: 2, profile: { name: "Grace" }, preferences: { theme: "system" }, extra: { ok: true } };
  const migratedV2 = migrateState(v2);
  equal(migratedV2, v2, "v2 idempotence");
  assert(migratedV2 !== v2 && migratedV2.preferences !== v2.preferences, "v2 result must be a deep clone");
  const invalid = migrateState({ version: 1, userName: "Bob", theme: "neon" });
  equal(invalid.preferences, { theme: "system" }, "invalid theme fallback");
  const error = await expectRejects(() => migrateState({ version: 3 }), "unsupported version");
  assert(error instanceof Error && /unsupported state version/iu.test(error.message), "unsupported version error");
}

async function checkBoundedQueue(): Promise<void> {
  const { runQueue } = await loadModule("src/queue.ts");
  assert(typeof runQueue === "function", "runQueue export is missing");
  let active = 0;
  let peak = 0;
  const results = await runQueue(
    Array.from({ length: 8 }, (_, index) => index),
    async (item: number) => {
      active += 1;
      peak = Math.max(peak, active);
      await delay((8 - (item % 3)) * 2);
      active -= 1;
      if (item === 3) throw new Error("item-3");
      return item * 10;
    },
    { concurrency: 3 },
  );
  assert(peak <= 3, `concurrency exceeded: ${peak}`);
  equal(results.length, 8, "queue result count");
  equal(results[0], { status: "fulfilled", value: 0 }, "ordered result 0");
  equal(results[1], { status: "fulfilled", value: 10 }, "ordered result 1");
  assert(results[3]?.status === "rejected", "failed item must be represented");
  assert(results[3]?.reason instanceof Error && results[3].reason.message === "item-3", "failure reason preserved");
  equal(results[7], { status: "fulfilled", value: 70 }, "ordered result 7");

  const controller = new AbortController();
  let started = 0;
  const cancelled = runQueue(
    Array.from({ length: 6 }, (_, index) => index),
    async () => {
      started += 1;
      await delay(25);
      return true;
    },
    { concurrency: 2, signal: controller.signal },
  );
  setTimeout(() => controller.abort(), 5);
  const cancelledResults = await cancelled;
  assert(started <= 2, `queue started work after cancellation: ${started}`);
  assert(cancelledResults.length === 6, "cancelled queue must settle every item");
}

async function checkRouterIntegration(): Promise<void> {
  const { createApiRouter } = await loadModule("src/api.ts");
  assert(typeof createApiRouter === "function", "createApiRouter export is missing");
  const api = createApiRouter();
  const health = await api.handle(new Request("http://bench.test/health"));
  equal(health.status, 200, "health status");
  equal(await health.json(), { ok: true }, "health body");

  const user = await api.handle(new Request("http://bench.test/users/Ada%20Lovelace?verbose=true"));
  equal(user.status, 200, "user status");
  equal(await user.json(), { id: "Ada Lovelace", verbose: true }, "user body");

  const createLin = () =>
    api.handle(
      new Request("http://bench.test/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Lin" }),
      }),
    );
  const created = await createLin();
  equal(created.status, 201, "create status");
  // The prompt asks for "a deterministic created record", not a particular id: the record must
  // carry the posted name and an id, and the same request must produce the same record.
  const createdBody = (await created.json()) as { id?: unknown; name?: unknown };
  equal(createdBody.name, "Lin", "create body name");
  assert(createdBody.id !== undefined && createdBody.id !== null, "create body must include an id");
  const createdAgain = await (await createLin()).json();
  equal(createdAgain, createdBody, "create body must be deterministic for the same request");

  const missing = await api.handle(new Request("http://bench.test/missing"));
  equal(missing.status, 404, "missing status");
  const wrongMethod = await api.handle(new Request("http://bench.test/users/1", { method: "POST" }));
  equal(wrongMethod.status, 405, "wrong method status");
  equal(wrongMethod.headers.get("allow"), "GET", "allow header");
}

async function checkWorkflowOrchestrator(): Promise<void> {
  const { executeWorkflow } = await loadModule("src/workflow.ts");
  assert(typeof executeWorkflow === "function", "executeWorkflow export is missing");
  let active = 0;
  let peak = 0;
  let retryCalls = 0;
  let dependentCalls = 0;
  const handlers: Record<string, () => Promise<unknown>> = {
    a: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await delay(20);
      active -= 1;
      return "a";
    },
    b: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await delay(5);
      active -= 1;
      return "b";
    },
    retry: async () => {
      retryCalls += 1;
      if (retryCalls === 1) throw new Error("transient");
      return "retry-ok";
    },
    bad: async () => {
      throw new Error("bad");
    },
    dependent: async () => {
      dependentCalls += 1;
      return "must-not-run";
    },
    join: async () => "joined",
  };
  const outcome = await executeWorkflow(
    [
      { id: "a" },
      { id: "b" },
      { id: "retry", attempts: 2 },
      { id: "bad" },
      { id: "dependent", dependsOn: ["bad"] },
      { id: "join", dependsOn: ["a", "b", "retry"] },
    ],
    handlers,
    { concurrency: 3 },
  );
  assert(peak <= 3, `workflow concurrency exceeded: ${peak}`);
  assert(outcome.results.a?.status === "succeeded", "a must succeed");
  assert(outcome.results.b?.status === "succeeded", "b must succeed");
  assert(outcome.results.retry?.status === "succeeded", "retry must eventually succeed");
  assert(outcome.results.bad?.status === "failed", "bad must fail");
  assert(outcome.results.dependent?.status === "skipped", "dependent must be skipped");
  assert(outcome.results.join?.status === "succeeded", "join must succeed");
  equal(retryCalls, 2, "workflow retry count");
  equal(dependentCalls, 0, "skipped dependency must not run");
  assert(
    outcome.events.some(
      (event: { stepId: string; type: string }) => event.stepId === "dependent" && event.type === "skipped",
    ),
    "skip event missing",
  );

  await expectRejects(
    () => executeWorkflow([{ id: "a", dependsOn: ["missing"] }], { a: async () => true }),
    "missing dependency validation",
  );
  await expectRejects(
    () =>
      executeWorkflow(
        [
          { id: "a", dependsOn: ["b"] },
          { id: "b", dependsOn: ["a"] },
        ],
        { a: async () => true, b: async () => true },
      ),
    "cycle validation",
  );

  const controller = new AbortController();
  let cancelledStarted = 0;
  const cancellation = executeWorkflow(
    Array.from({ length: 5 }, (_, index) => ({ id: `step-${index}` })),
    Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [
        `step-${index}`,
        async () => {
          cancelledStarted += 1;
          await delay(20);
          return index;
        },
      ]),
    ),
    { concurrency: 1, signal: controller.signal },
  );
  setTimeout(() => controller.abort(), 5);
  const cancelledOutcome = await cancellation;
  assert(cancelledStarted < 5, "workflow must stop starting queued steps after cancellation");
  assert(cancelledOutcome.status === "cancelled", "workflow cancellation status");
}

async function main(): Promise<void> {
  const checks: Record<string, () => Promise<void>> = {
    "01-input-normalization": checkInputNormalization,
    "02-config-pipeline": checkConfigPipeline,
    "03-ttl-cache": checkTtlCache,
    "04-retry-policy": checkRetryPolicy,
    "05-state-migration": checkStateMigration,
    "06-bounded-queue": checkBoundedQueue,
    "07-router-integration": checkRouterIntegration,
    "08-workflow-orchestrator": checkWorkflowOrchestrator,
  };
  const check = checks[taskId || ""];
  if (!check) fail("unknown task id");
  await check();
  console.log(`oracle passed: ${taskId}`);
}

await main();
