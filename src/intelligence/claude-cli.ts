import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import type {
  IntelligenceAvailability,
  IntelligenceProvider,
  IntelligenceRequest,
  IntelligenceResult,
  IntelligenceTier,
  IntelligenceUsage,
} from "./types";

/**
 * Claude intelligence provider backed by the local `claude` CLI.
 *
 * The CLI is driven in single-shot print mode with every built-in tool disabled, so the
 * model can only reason and answer. Shelra's runtime keeps ownership of the filesystem,
 * execution and verification; this provider is a pure question/answer boundary.
 *
 * Cost discipline matters here: the default Claude Code system prompt is enormous, so the
 * request's lean `system` string always replaces it, and user/project settings plus foreign
 * MCP servers are excluded. That is the difference between cents and fractions of a cent
 * per call.
 */

export const DEFAULT_TIMEOUT_MS = 300_000;
export const VERSION_TIMEOUT_MS = 15_000;
export const MAX_ATTEMPTS = 3;
export const RETRY_BASE_DELAY_MS = 1_000;

/** Retained tail of child stderr, enough to diagnose without flooding logs. */
const STDERR_TAIL_LIMIT = 4_000;

/** Inherited Claude Code variables that would otherwise leak a parent session's identity. */
const SCRUBBED_ENV_KEYS = new Set(["CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT", "ANTHROPIC_MODEL"]);
const SCRUBBED_ENV_PREFIXES = ["CLAUDE_CODE_"];

const TIER_DEFAULTS: Record<IntelligenceTier, { alias: string; override: string }> = {
  fast: { alias: "haiku", override: "SHELRA_CLAUDE_MODEL_FAST" },
  balanced: { alias: "sonnet", override: "SHELRA_CLAUDE_MODEL_BALANCED" },
  deep: { alias: "opus", override: "SHELRA_CLAUDE_MODEL_DEEP" },
};

const INSTALL_HINT =
  'Install it with "npm install -g @anthropic-ai/claude-code" (see https://claude.com/claude-code), then run "claude auth login". Set SHELRA_CLAUDE_BIN to point at a non-standard install.';

/**
 * Minimal structural view of a spawned child. Node's `spawn` satisfies it, and tests can
 * substitute a fake without touching the real binary.
 */
export interface IntelligenceChildStream {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}

export interface IntelligenceChildStdin {
  write(chunk: string): unknown;
  end(): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface IntelligenceChildProcess {
  readonly pid?: number | undefined;
  readonly stdout: IntelligenceChildStream | null;
  readonly stderr: IntelligenceChildStream | null;
  readonly stdin: IntelligenceChildStdin | null;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface IntelligenceSpawnOptions {
  cwd?: string | undefined;
  env: NodeJS.ProcessEnv;
  windowsHide: boolean;
  detached: boolean;
}

export type IntelligenceSpawn = (
  command: string,
  args: readonly string[],
  options: IntelligenceSpawnOptions,
) => IntelligenceChildProcess;

export interface ClaudeCliProviderOptions {
  /** Injected process launcher. Defaults to `child_process.spawn`. */
  spawn?: IntelligenceSpawn;
  /** Injected process-tree terminator. Defaults to taskkill/SIGKILL. */
  killTree?: (pid: number) => void;
  /** Injected delay used between retries. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Environment the child inherits from, before scrubbing. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Explicit binary path. Defaults to `SHELRA_CLAUDE_BIN` or `claude` on PATH. */
  binary?: string;
}

/** Raw shape of the CLI's `--output-format json` envelope. Fields are all optional by design. */
interface ClaudeCliEnvelope {
  type?: unknown;
  subtype?: unknown;
  is_error?: unknown;
  result?: unknown;
  structured_output?: unknown;
  num_turns?: unknown;
  duration_ms?: unknown;
  total_cost_usd?: unknown;
  api_error_status?: unknown;
  terminal_reason?: unknown;
  usage?: unknown;
  modelUsage?: unknown;
}

interface RunOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  spawnError?: NodeJS.ErrnoException;
}

interface Attempt<T> {
  result: IntelligenceResult<T>;
  retryable: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** Removes inherited Claude Code session state so the child behaves like a clean top-level run. */
export function scrubClaudeEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (SCRUBBED_ENV_KEYS.has(key)) continue;
    if (SCRUBBED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    scrubbed[key] = value;
  }
  return scrubbed;
}

/** Maps a capability tier onto a CLI model alias, honouring per-tier environment overrides. */
export function resolveModelForTier(tier: IntelligenceTier | undefined, env: NodeJS.ProcessEnv): string {
  const spec = TIER_DEFAULTS[tier ?? "balanced"];
  return env[spec.override]?.trim() || spec.alias;
}

export function resolveClaudeBinary(env: NodeJS.ProcessEnv): string {
  return env.SHELRA_CLAUDE_BIN?.trim() || "claude";
}

/**
 * Builds the argv for a single-shot call. The prompt is deliberately absent: it is streamed
 * over stdin so Windows command-length and quoting rules never come into play.
 */
export function buildClaudeArgs(request: IntelligenceRequest, model: string): string[] {
  const args = ["-p", "--model", model, "--output-format", "json", "--system-prompt", request.system];
  if (request.schema) {
    args.push("--json-schema", JSON.stringify(request.schema));
  }
  args.push(
    "--tools",
    "",
    "--permission-prompts",
    "none",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--setting-sources",
    "",
  );
  if (typeof request.maxBudgetUsd === "number" && Number.isFinite(request.maxBudgetUsd) && request.maxBudgetUsd > 0) {
    args.push("--max-budget-usd", String(request.maxBudgetUsd));
  }
  return args;
}

/**
 * Extracts the result envelope from stdout. The CLI normally prints a single JSON object, but
 * a stray banner line must not cost us an otherwise-successful (already paid for) answer.
 */
export function parseCliJson(stdout: string): ClaudeCliEnvelope | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const direct = record(safeParse(trimmed));
  if (direct) return direct as ClaudeCliEnvelope;
  const lines = trimmed.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = record(safeParse(lines[index]?.trim() ?? ""));
    if (candidate && candidate.type === "result") return candidate as ClaudeCliEnvelope;
  }
  return null;
}

function safeParse(value: string): unknown {
  if (!value.startsWith("{")) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Normalizes CLI usage into the ledger shape.
 *
 * `usage.input_tokens` only counts uncached input, so `inputTokens` reports the effective total
 * (uncached + cache creation + cache read). The two cache fields stay raw, which keeps the
 * uncached figure recoverable by subtraction.
 */
export function mapUsage(envelope: ClaudeCliEnvelope, elapsedMs: number, fallbackModel: string): IntelligenceUsage {
  const usage = record(envelope.usage);
  const rawInput = numberValue(usage?.input_tokens);
  const cacheCreation = numberValue(usage?.cache_creation_input_tokens);
  const cacheRead = numberValue(usage?.cache_read_input_tokens);
  const outputTokens = numberValue(usage?.output_tokens);
  const effectiveInput =
    rawInput === undefined && cacheCreation === undefined && cacheRead === undefined
      ? undefined
      : (rawInput ?? 0) + (cacheCreation ?? 0) + (cacheRead ?? 0);
  const cost = numberValue(envelope.total_cost_usd);

  return {
    ...(effectiveInput === undefined ? {} : { inputTokens: effectiveInput }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cacheReadDefined(cacheRead) ? { cacheReadTokens: cacheRead } : {}),
    ...(cacheReadDefined(cacheCreation) ? { cacheCreationTokens: cacheCreation } : {}),
    ...(cost === undefined ? {} : { costUsd: cost }),
    costAvailable: cost !== undefined,
    durationMs: numberValue(envelope.duration_ms) ?? elapsedMs,
    ...(numberValue(envelope.num_turns) === undefined ? {} : { turns: numberValue(envelope.num_turns) }),
    model: resolveReportedModel(envelope.modelUsage) ?? fallbackModel,
  };
}

function cacheReadDefined(value: number | undefined): value is number {
  return value !== undefined;
}

function resolveReportedModel(modelUsage: unknown): string | undefined {
  const usage = record(modelUsage);
  if (!usage) return undefined;
  for (const [key, value] of Object.entries(usage)) {
    const entry = record(value);
    const canonical = entry ? stringValue(entry.canonicalModel, "") : "";
    return canonical || key;
  }
  return undefined;
}

const TRANSIENT_PATTERN =
  /rate.?limit|overloaded|too many requests|service unavailable|bad gateway|gateway timeout|\b(429|500|502|503|504|529)\b|econnreset|econnrefused|etimedout|enotfound|eai_again|socket hang up|network error|fetch failed|connection (error|closed)/i;

const PERMANENT_PATTERN =
  /authenticat|unauthorized|forbidden|invalid api key|credit balance|does not conform|schema|invalid_request|budget (exceeded|limit)|not found/i;

/**
 * Decides whether a failure is worth another attempt. Auth, schema and budget failures are
 * deterministic, so retrying them only burns time and money.
 */
export function isTransientFailure(status: number | null | undefined, message: string): boolean {
  if (typeof status === "number") {
    if (status === 408 || status === 409 || status === 429 || status >= 500) return true;
    return false;
  }
  if (PERMANENT_PATTERN.test(message)) return false;
  return TRANSIENT_PATTERN.test(message);
}

function tail(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= STDERR_TAIL_LIMIT) return trimmed;
  return `...${trimmed.slice(-STDERR_TAIL_LIMIT)}`;
}

function defaultKillTree(pid: number): void {
  if (process.platform === "win32") {
    // Node's kill() only signals the direct child; the CLI's helpers survive it.
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try {
    // Children are spawned detached on POSIX, so the negated pid is their own group.
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process already exited; nothing left to reap.
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultSpawn(command: string, args: readonly string[], options: IntelligenceSpawnOptions) {
  return nodeSpawn(command, args, options);
}

function failure(error: string, usage: IntelligenceUsage, text = ""): IntelligenceResult<never> {
  return { ok: false, text, usage, error };
}

function emptyUsage(elapsedMs: number, model: string): IntelligenceUsage {
  return { costAvailable: false, durationMs: elapsedMs, model };
}

export class ClaudeCliProvider implements IntelligenceProvider {
  readonly id = "claude-cli";

  private readonly spawn: IntelligenceSpawn;
  private readonly killTree: (pid: number) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly env: NodeJS.ProcessEnv;
  private readonly binary: string;
  private availabilityPromise?: Promise<IntelligenceAvailability>;

  constructor(options: ClaudeCliProviderOptions = {}) {
    this.spawn = options.spawn ?? defaultSpawn;
    this.killTree = options.killTree ?? defaultKillTree;
    this.sleep = options.sleep ?? defaultSleep;
    this.env = options.env ?? process.env;
    this.binary = options.binary ?? resolveClaudeBinary(this.env);
  }

  /** True when an API key should carry the auth instead of the subscription login. */
  get usesApiKey(): boolean {
    return this.env.SHELRA_INTELLIGENCE?.trim() === "api" && Boolean(this.env.ANTHROPIC_API_KEY?.trim());
  }

  async checkAvailability(): Promise<IntelligenceAvailability> {
    this.availabilityPromise ??= this.probeAvailability();
    return this.availabilityPromise;
  }

  async complete<T = unknown>(request: IntelligenceRequest): Promise<IntelligenceResult<T>> {
    const model = resolveModelForTier(request.tier, this.env);
    const args = buildClaudeArgs(request, model);
    const timeoutMs = request.timeoutMs && request.timeoutMs > 0 ? request.timeoutMs : DEFAULT_TIMEOUT_MS;

    let last: IntelligenceResult<T> = failure("Intelligence request was never dispatched.", emptyUsage(0, model));
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (request.signal?.aborted) {
        return failure("Intelligence request aborted before dispatch.", emptyUsage(0, model));
      }
      const outcome = await this.attempt<T>(args, request, timeoutMs, model);
      last = outcome.result;
      if (outcome.result.ok || !outcome.retryable) return outcome.result;
      if (attempt < MAX_ATTEMPTS) {
        await this.sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }
    return last;
  }

  private async attempt<T>(
    args: readonly string[],
    request: IntelligenceRequest,
    timeoutMs: number,
    model: string,
  ): Promise<Attempt<T>> {
    const started = Date.now();
    const run = await this.run(args, request.prompt, timeoutMs, request.cwd, request.signal);
    const elapsed = Date.now() - started;

    if (run.spawnError) {
      const missing = run.spawnError.code === "ENOENT";
      const detail = missing
        ? `The "${this.binary}" CLI was not found. ${INSTALL_HINT}`
        : `Failed to launch "${this.binary}": ${run.spawnError.message}`;
      return { result: failure(detail, emptyUsage(elapsed, model)), retryable: false };
    }
    if (run.aborted) {
      return { result: failure("Intelligence request aborted.", emptyUsage(elapsed, model)), retryable: false };
    }
    if (run.timedOut) {
      const detail = `Intelligence request timed out after ${timeoutMs}ms.${suffix(run.stderr)}`;
      return { result: failure(detail, emptyUsage(elapsed, model)), retryable: false };
    }

    const envelope = parseCliJson(run.stdout);
    if (!envelope) {
      const detail = `Could not parse claude CLI output (exit ${run.code ?? "unknown"}).${suffix(run.stderr)}`;
      return { result: failure(detail, emptyUsage(elapsed, model)), retryable: false };
    }

    const usage = mapUsage(envelope, elapsed, model);
    const text = stringValue(envelope.result, "");
    const status = numberValue(envelope.api_error_status) ?? null;

    if (envelope.is_error === true || run.code !== 0) {
      const detail = [
        text || `claude CLI exited with code ${run.code ?? "unknown"}`,
        statusNote(status),
        suffix(run.stderr),
      ]
        .filter(Boolean)
        .join("");
      return { result: failure(detail, usage, text), retryable: isTransientFailure(status, `${text} ${run.stderr}`) };
    }

    if (request.schema) {
      const data = envelope.structured_output;
      if (data === undefined || data === null) {
        const detail = `claude CLI returned no structured output for a schema-constrained request.${suffix(run.stderr)}`;
        return { result: failure(detail, usage, text), retryable: false };
      }
      return { result: { ok: true, data: data as T, text, usage }, retryable: false };
    }

    return { result: { ok: true, text, usage }, retryable: false };
  }

  private run(
    args: readonly string[],
    prompt: string,
    timeoutMs: number,
    cwd: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<RunOutcome> {
    return new Promise<RunOutcome>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let aborted = false;
      let settled = false;

      let child: IntelligenceChildProcess;
      try {
        child = this.spawn(this.binary, args, {
          cwd,
          env: scrubClaudeEnv(this.env),
          windowsHide: true,
          detached: process.platform !== "win32",
        });
      } catch (error) {
        resolve({
          code: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          aborted: false,
          spawnError: error as NodeJS.ErrnoException,
        });
        return;
      }

      const terminate = () => {
        if (typeof child.pid === "number") this.killTree(child.pid);
        else child.kill();
      };

      const timer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeoutMs);

      const onAbort = () => {
        aborted = true;
        terminate();
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const settle = (outcome: RunOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(outcome);
      };

      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        settle({ code: null, stdout, stderr, timedOut, aborted, spawnError: error as NodeJS.ErrnoException });
      });
      child.on("close", (code) => {
        settle({ code, stdout, stderr, timedOut, aborted });
      });

      // A closed stdin (the CLI exiting early) must not crash the host process.
      child.stdin?.on("error", () => {});
      child.stdin?.write(prompt);
      child.stdin?.end();
    });
  }

  private async probeAvailability(): Promise<IntelligenceAvailability> {
    const version = await this.run(["--version"], "", VERSION_TIMEOUT_MS, undefined, undefined);
    if (version.spawnError) {
      const missing = version.spawnError.code === "ENOENT";
      return {
        available: false,
        detail: missing
          ? `The "${this.binary}" CLI was not found on PATH. ${INSTALL_HINT}`
          : `Could not launch "${this.binary}": ${version.spawnError.message}. ${INSTALL_HINT}`,
      };
    }
    if (version.timedOut) {
      return { available: false, detail: `"${this.binary} --version" timed out after ${VERSION_TIMEOUT_MS}ms.` };
    }
    if (version.code !== 0) {
      return {
        available: false,
        detail: `"${this.binary} --version" exited with code ${version.code ?? "unknown"}.${suffix(version.stderr)}`,
      };
    }

    const label = version.stdout.trim().split(/\r?\n/)[0] ?? "unknown version";
    if (this.usesApiKey) {
      return { available: true, detail: `claude CLI ${label}; authenticating with ANTHROPIC_API_KEY.` };
    }

    const auth = await this.run(["auth", "status"], "", VERSION_TIMEOUT_MS, undefined, undefined);
    const status = record(safeParse(auth.stdout.trim()));
    if (auth.code !== 0 || status?.loggedIn !== true) {
      if (this.env.ANTHROPIC_API_KEY?.trim()) {
        return { available: true, detail: `claude CLI ${label}; not logged in, falling back to ANTHROPIC_API_KEY.` };
      }
      return {
        available: false,
        detail: `claude CLI ${label} is installed but not authenticated. Run "claude auth login", or set ANTHROPIC_API_KEY.`,
      };
    }

    const method = stringValue(status.authMethod, "unknown");
    const plan = stringValue(status.subscriptionType, "");
    return {
      available: true,
      detail: `claude CLI ${label}; authenticated via ${method}${plan ? ` (${plan})` : ""}.`,
    };
  }
}

function statusNote(status: number | null): string {
  return status === null ? "" : ` (api_error_status ${status})`;
}

function suffix(stderr: string): string {
  const trimmed = tail(stderr);
  return trimmed ? ` stderr: ${trimmed}` : "";
}
