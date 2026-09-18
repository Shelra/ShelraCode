import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Oracle for the cross-session memory suite. Phase A ("learn") proves the agent discovered the
 * undocumented codegen step; phase B ("recall") proves a schema change was followed by regeneration —
 * the generated module carries a hash of schema/model.json, so a hand-edited generated file fails.
 */

const taskId = process.argv[2] ?? "";
const workspace = process.env.SHELRA_BENCH_WORKSPACE || process.cwd();
const moduleCacheKey = `?shelra-bench=${Date.now()}`;

function fail(message: string): never {
  throw new Error(`[${taskId || "unknown-task"}] ${message}`);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

// biome-ignore lint/suspicious/noExplicitAny: module loaded dynamically from the graded workspace
async function loadModule(relativePath: string): Promise<Record<string, any>> {
  const path = resolve(workspace, relativePath);
  if (!existsSync(path)) fail(`${relativePath} is missing`);
  // biome-ignore lint/suspicious/noExplicitAny: module loaded dynamically from the graded workspace
  return (await import(pathToFileURL(path).href + moduleCacheKey)) as Record<string, any>;
}

function currentSchemaHash(): string {
  return createHash("sha256")
    .update(readFileSync(resolve(workspace, "schema", "model.json"), "utf8"))
    .digest("hex");
}

async function checkLearn(): Promise<void> {
  const schema = await loadModule("src/generated/schema.ts");
  assert(
    schema.SCHEMA_HASH === currentSchemaHash(),
    "generated schema does not match schema/model.json (run the generator)",
  );
  assert(
    JSON.stringify(schema.USER_FIELDS) === JSON.stringify(["id", "name", "createdAt"]),
    "USER_FIELDS changed unexpectedly",
  );
  const { formatUser } = await loadModule("src/user.ts");
  assert(typeof formatUser === "function", "formatUser export is missing");
  const output = formatUser({ id: "u1", name: "Ada", createdAt: "2026-01-01" });
  assert(output === "id=u1; name=Ada; createdAt=2026-01-01", `formatUser output was ${JSON.stringify(output)}`);
}

async function checkRecall(): Promise<void> {
  const model = JSON.parse(readFileSync(resolve(workspace, "schema", "model.json"), "utf8")) as {
    User?: Record<string, string>;
  };
  const fields = Object.keys(model.User ?? {});
  assert(
    fields.at(-1) === "email" && model.User?.email === "string",
    "schema/model.json must gain a trailing string field `email`",
  );
  const schema = await loadModule("src/generated/schema.ts");
  assert(
    schema.SCHEMA_HASH === currentSchemaHash(),
    "generated schema is stale: it does not match the edited schema/model.json (regenerate it)",
  );
  assert(
    JSON.stringify(schema.USER_FIELDS) === JSON.stringify(["id", "name", "createdAt", "email"]),
    "USER_FIELDS must include email last",
  );
  const { formatUser } = await loadModule("src/user.ts");
  const output = formatUser({ id: "u1", name: "Ada", createdAt: "2026-01-01", email: "ada@example.com" });
  assert(
    output === "id=u1; name=Ada; createdAt=2026-01-01; email=ada@example.com",
    `formatUser output was ${JSON.stringify(output)}`,
  );
}

function currentCatalogHash(): string {
  return createHash("sha256")
    .update(readFileSync(resolve(workspace, "locales", "en.json"), "utf8"))
    .digest("hex");
}

/** Second trap, same shape (a derived module that goes stale silently), different domain. */
async function checkLearnI18n(): Promise<void> {
  const generated = await loadModule("src/generated/messages.ts");
  assert(
    generated.CATALOG_HASH === currentCatalogHash(),
    "generated messages do not match locales/en.json (run the generator)",
  );
  const { t } = await loadModule("src/i18n.ts");
  assert(typeof t === "function", "t export is missing");
  assert(
    t("greeting", { name: "Ada" }) === "Hello, Ada!",
    `t(greeting) was ${JSON.stringify(t("greeting", { name: "Ada" }))}`,
  );
  assert(t("checkout.title") === "Checkout", "t(checkout.title) must read the catalog");
  assert(t("not.a.key") === "not.a.key", "t must return the key when the message is missing");
}

async function checkRecallI18n(): Promise<void> {
  const catalog = JSON.parse(readFileSync(resolve(workspace, "locales", "en.json"), "utf8")) as Record<string, string>;
  assert(catalog["checkout.total"] === "Total: {amount}", "locales/en.json must gain checkout.total = Total: {amount}");
  const generated = await loadModule("src/generated/messages.ts");
  assert(
    generated.CATALOG_HASH === currentCatalogHash(),
    "generated messages are stale: they do not match the edited locales/en.json (regenerate them)",
  );
  assert(generated.MESSAGES?.["checkout.total"] === "Total: {amount}", "MESSAGES must include checkout.total");
  const { t } = await loadModule("src/i18n.ts");
  assert(
    t("checkout.total", { amount: "5" }) === "Total: 5",
    "t(checkout.total) must render from the regenerated catalog",
  );
  const { renderTotal } = await loadModule("src/checkout.ts");
  assert(typeof renderTotal === "function", "renderTotal export is missing");
  assert(renderTotal("5") === "Total: 5", `renderTotal output was ${JSON.stringify(renderTotal("5"))}`);
}

async function main(): Promise<void> {
  switch (taskId) {
    case "a-learn":
      await checkLearn();
      break;
    case "b-recall-with-memory":
    case "b-recall-without-memory":
      await checkRecall();
      break;
    case "c-learn":
      await checkLearnI18n();
      break;
    case "d-recall-with-memory":
    case "d-recall-without-memory":
      await checkRecallI18n();
      break;
    default:
      fail(`unknown task id ${JSON.stringify(taskId)}`);
  }
  console.log(`[${taskId}] oracle passed`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
