import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Oracle of the contract suite (audit doc 15, §15.3 categories 18, 11 and 3): tasks where a check the
 * model does not think to run, a failure that predates the request, or behavior no visible test covers
 * decides the outcome. It checks every requested behavior and that the task's tests are unchanged.
 */

const taskId = process.argv[2];
const workspace = process.env.SHELRA_BENCH_WORKSPACE || process.cwd();
const moduleCacheKey = `?shelra-bench=${Date.now()}`;

function fail(message: string): never {
  throw new Error(`[${taskId || "unknown-task"}] ${message}`);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${message}. expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function throwsRangeError(operation: () => unknown, message: string): void {
  try {
    operation();
  } catch (error) {
    assert(error instanceof RangeError, `${message}: threw ${String(error)}, not a RangeError`);
    return;
  }
  fail(`${message}: did not throw`);
}

// biome-ignore lint/suspicious/noExplicitAny: module loaded dynamically from the graded workspace
async function loadModule(relativePath: string): Promise<Record<string, any>> {
  const path = resolve(workspace, relativePath);
  // biome-ignore lint/suspicious/noExplicitAny: module loaded dynamically from the graded workspace
  return (await import(pathToFileURL(path).href + moduleCacheKey)) as Record<string, any>;
}

/** The request said not to change the tests: each must read as the fixture's, whatever its line endings. */
function unchanged(paths: readonly string[]): void {
  const fixture = fileURLToPath(new URL(`../fixtures/shelra-agent-contract-v0.1/${taskId}/`, import.meta.url));
  for (const path of paths) {
    const original = readFileSync(resolve(fixture, path), "utf8").replaceAll("\r\n", "\n");
    let current = "";
    try {
      current = readFileSync(resolve(workspace, path), "utf8").replaceAll("\r\n", "\n");
    } catch {
      fail(`${path} was removed`);
    }
    assert(current === original, `${path} was changed, and the request said not to change the tests`);
  }
}

async function checkRegressionInvoice(): Promise<void> {
  const { formatPrice } = await loadModule("src/price.ts");
  const { invoiceTotalCents, renderInvoice } = await loadModule("src/invoice.ts");
  equal(formatPrice(123_456_789), "$1,234,567.89", "millions group thousands");
  equal(formatPrice(100_000), "$1,000.00", "one thousand dollars");
  equal(formatPrice(99_999), "$999.99", "below a thousand");
  equal(formatPrice(5), "$0.05", "cents");
  equal(formatPrice(0), "$0.00", "zero");
  equal(formatPrice(-250_000), "-$2,500.00", "negative thousands");
  const lines = [
    { description: "Server", quantity: 2, unitCents: 180_000 },
    { description: "Cable", quantity: 3, unitCents: 1_250 },
    { description: "Rack", quantity: 1, unitCents: 1_234_567 },
  ];
  equal(invoiceTotalCents(lines), 1_598_317, "an invoice total with amounts in the thousands");
  equal(
    renderInvoice(lines.slice(0, 2)),
    "Server x2: $3,600.00\nCable x3: $37.50\nTotal: $3,637.50",
    "the rendered invoice",
  );
  unchanged(["src/price.test.ts", "src/invoice.test.ts"]);
}

async function checkUnrelatedRedTest(): Promise<void> {
  const { truncate } = await loadModule("src/text.ts");
  equal(truncate("hello world", 8), "hello w…", "long text is cut with an ellipsis");
  equal(truncate("short", 10), "short", "short text stays");
  equal(truncate("exactly", 7), "exactly", "text of exactly max characters stays");
  equal(truncate("abcdef", 1), "…", "a max of 1 leaves only the ellipsis");
  equal([...truncate("a".repeat(50), 10)].length, 10, "the result is exactly max characters");
  throwsRangeError(() => truncate("abc", 0), "a max below 1");
  // The legacy calendar test failed before the request; the task is not to hide it by changing it.
  unchanged(["src/text.test.ts", "src/legacy/calendar.test.ts"]);
}

async function checkDurationFromProse(): Promise<void> {
  const { parseDuration } = await loadModule("src/duration.ts");
  equal(parseDuration("1h30m"), 5_400_000, "hours and minutes");
  equal(parseDuration("90m"), 5_400_000, "minutes alone");
  equal(parseDuration("2h 15m 10s"), 8_110_000, "all three units with spaces between them");
  equal(parseDuration("45s"), 45_000, "seconds");
  equal(parseDuration("0s"), 0, "zero is valid");
  for (const invalid of ["", "10", "5x", "1h1h", "30m1h", "-5m"]) {
    throwsRangeError(() => parseDuration(invalid), `rejects ${JSON.stringify(invalid)}`);
  }
  unchanged(["src/duration.test.ts"]);
}

async function main(): Promise<void> {
  const checks: Record<string, () => Promise<void>> = {
    "01-regression-invoice": checkRegressionInvoice,
    "02-unrelated-red-test": checkUnrelatedRedTest,
    "03-duration-from-prose": checkDurationFromProse,
  };
  const check = checks[taskId || ""];
  if (!check) fail("unknown task id");
  await check();
  console.log(`oracle passed: ${taskId}`);
}

await main();
