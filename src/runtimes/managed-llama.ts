import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import {
  defaultModelDirectory,
  discoverInstalledHuggingFaceModels,
  downloadHuggingFaceModel,
  getHuggingFaceModelSpec,
  type HuggingFaceDownloadProgress,
} from "../models/huggingface";
import type { ProviderAdapter } from "../providers/types";
import {
  detectPreferredRuntimeBackend,
  findManagedLlamaServer,
  managedRuntimeDirectory,
  type RuntimeBackend,
} from "./bootstrap";
import { createLocalProvider } from "./local-provider";
import type { LocalModelCandidate, LocalRuntimeAdapter, LocalRuntimeHealth } from "./types";

const DEFAULT_CONTEXT = 32_768;
// Tool schemas and the bounded host context can already occupy ~9K tokens;
// 16K leaves room for a response while keeping a 4 GiB GTX 1650 stable.
const CUDA_CONTEXT_HEADROOM = 16_384;
// The KV cache is allocated up front and is *not* part of the weights-only
// memory estimate the installer uses, so a spec-sized 32K context can push a
// CPU load into swap or an outright OOM on a machine whose weights fit fine.
// 8192 still covers the bounded host context packet plus a coding turn, and
// SHELRA_CONTEXT raises it on machines with headroom — the same shape as
// SHELRA_GPU_CONTEXT for the CUDA branch.
export const DEFAULT_CPU_CONTEXT_CAP = 8_192;
const SERVER_START_TIMEOUT_MS = 45_000;

// Names whose value is a credential the local engine has no use for. The child
// keeps everything else (PATH, SystemRoot, TEMP, CUDA/GGML/LLAMA tuning vars).
const SECRET_ENV_PATTERN =
  /(?:^|_)API_?KEY|APIKEY|SECRET|(?:^|_)TOKEN(?:$|_)|PASSWORD|PASSWD|MNEMONIC|PRIVATE_KEY|SEED_PHRASE/iu;
const BLOCKED_ENV_NAMES = new Set([
  "SHELRA_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "XAI_API_KEY",
  "HF_TOKEN",
  "HUGGING_FACE_HUB_TOKEN",
  "HUGGINGFACE_TOKEN",
  "CDP_API_KEY_NAME",
  "CDP_API_KEY_PRIVATE_KEY",
  "WALLET_MNEMONIC",
]);

/**
 * Environment handed to the `llama-server` child. It is a denylist: the engine
 * is a third-party native binary, so it receives the machine configuration it
 * needs and none of this process's credentials.
 */
export function llamaServerEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .filter(([name]) => !BLOCKED_ENV_NAMES.has(name.toUpperCase()) && !SECRET_ENV_PATTERN.test(name)),
  );
}

async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a private local port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

/**
 * Context size handed to `llama-server`. Both backends are bounded: the value
 * in the model spec is what the *weights* support, not what this machine can
 * allocate a KV cache for.
 */
export function serverContextSize(
  specContextWindow: number | undefined,
  backend: RuntimeBackend,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const requested = specContextWindow || DEFAULT_CONTEXT;
  const override = backend === "cuda" ? Number(env.SHELRA_GPU_CONTEXT) : Number(env.SHELRA_CONTEXT);
  const cap = override > 0 ? override : backend === "cuda" ? CUDA_CONTEXT_HEADROOM : DEFAULT_CPU_CONTEXT_CAP;
  return Math.min(requested, cap);
}

function modelCandidate(
  installed: Awaited<ReturnType<typeof discoverInstalledHuggingFaceModels>>[number],
  baseURL: string,
  loadedContextWindow?: number,
): LocalModelCandidate {
  return {
    id: installed.spec.id,
    name: installed.spec.displayName,
    runtimeId: "shelra-llama",
    runtimeKind: "managed-llama",
    baseURL,
    // The window the server actually loaded wins over the spec: the spec is an
    // upper bound, the running process is the truth the agent must budget for.
    contextWindow: loadedContextWindow || installed.spec.contextWindow || DEFAULT_CONTEXT,
    tools: true,
    structuredOutput: true,
    reasoning: false,
    loaded: false,
    parameters: installed.spec.parameters || undefined,
    quantization: installed.spec.quantization,
    source: "local",
    capabilityConfidence: "declared",
    supportsVision: false,
    memoryRequiredGb: installed.spec.estimatedMemoryGb,
    capabilityClass: "agent",
  };
}

export interface ManagedLlamaRuntimeOptions {
  runtimeDirectory?: string;
  modelDirectory?: string;
  fetchImpl?: typeof fetch;
  spawnImpl?: typeof spawn;
  signal?: AbortSignal;
  backend?: RuntimeBackend;
}

/**
 * Shelra-owned local inference adapter. It starts only a loopback llama.cpp
 * child process whose binary was installed into ~/.shelra/runtime; no vendor
 * application, service manager, or user-installed endpoint is required.
 */
export class ManagedLlamaRuntime implements LocalRuntimeAdapter {
  readonly id = "shelra-llama";
  readonly kind = "managed-llama" as const;
  private readonly runtimeDirectory: string;
  private readonly modelDirectory: string;
  private readonly fetchImpl: typeof fetch;
  private readonly spawnImpl: typeof spawn;
  private readonly backendOverride?: RuntimeBackend;
  private port?: number;
  private child?: ChildProcess;
  private starting?: Promise<boolean>;
  private activeModelPath?: string;
  /** Context size the running server reported through `/props`, when known. */
  private loadedContextWindow?: number;

  constructor(options: ManagedLlamaRuntimeOptions = {}) {
    this.runtimeDirectory = options.runtimeDirectory ?? managedRuntimeDirectory();
    this.modelDirectory = options.modelDirectory ?? defaultModelDirectory();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.backendOverride = options.backend;
  }

  get baseURL(): string {
    return `http://127.0.0.1:${this.port ?? 0}/v1`;
  }

  private get serverURL(): string {
    return this.baseURL.replace(/\/v1$/u, "");
  }

  private async preferredBackend(): Promise<RuntimeBackend> {
    return this.backendOverride ?? detectPreferredRuntimeBackend();
  }

  private async hasBinary(): Promise<boolean> {
    const backend = await this.preferredBackend();
    const executable = await findManagedLlamaServer(this.runtimeDirectory, process.platform, backend);
    return executable !== undefined;
  }

  private async installedModels() {
    return discoverInstalledHuggingFaceModels(this.modelDirectory);
  }

  /**
   * Polls the loopback health endpoint. `hasExited` lets the caller abandon the
   * wait the moment the child dies (OOM, corrupt GGUF, missing DLL) instead of
   * burning the whole start-up budget on a process that is already gone.
   */
  private async waitForHealth(signal?: AbortSignal, hasExited?: () => boolean): Promise<boolean> {
    const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (signal?.aborted) return false;
      if (hasExited?.()) return false;
      try {
        const response = await this.fetchImpl(`${this.serverURL}/health`, { signal });
        if (response.ok) return true;
      } catch {
        // The server is still loading or has not bound its socket yet.
      }
      if (hasExited?.()) return false;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }

  /**
   * Reads the context size the server actually loaded. llama-server reports it
   * as a top-level `n_ctx` in recent builds and under
   * `default_generation_settings.n_ctx` in older ones; anything else (an old
   * build, a proxy, a transport failure) leaves the caller on the spec value.
   */
  private async readLoadedContextWindow(signal?: AbortSignal): Promise<number | undefined> {
    try {
      const response = await this.fetchImpl(`${this.serverURL}/props`, { signal });
      if (!response.ok) return undefined;
      const body: unknown = await response.json();
      if (!body || typeof body !== "object") return undefined;
      const props = body as { n_ctx?: unknown; default_generation_settings?: unknown };
      const nested = props.default_generation_settings;
      const candidates = [
        props.n_ctx,
        nested && typeof nested === "object" ? (nested as { n_ctx?: unknown }).n_ctx : undefined,
      ];
      for (const value of candidates) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /** One-shot liveness check against a server that is expected to be up. */
  private async pingHealth(signal?: AbortSignal): Promise<boolean> {
    try {
      return (await this.fetchImpl(`${this.serverURL}/health`, { signal })).ok;
    } catch {
      return false;
    }
  }

  /** True when a live child is serving exactly the requested model. */
  private async isServingModel(modelId: string): Promise<boolean> {
    if (!this.child || this.child.killed || this.port === undefined || !this.activeModelPath) return false;
    const installed = await this.installedModels();
    return installed.some((model) => model.path === this.activeModelPath && model.spec.id === modelId);
  }

  private async ensureServer(signal?: AbortSignal, requestedModelId?: string): Promise<boolean> {
    const pending = this.starting;
    if (pending) {
      const started = await pending;
      // A concurrent start may have loaded a different model; only reuse it
      // when it satisfies this request.
      if (!started || !requestedModelId || (await this.isServingModel(requestedModelId))) return started;
    }
    const task = (async () => {
      const backend = await this.preferredBackend();
      const installedModels = await this.installedModels();
      // Never silently substitute another model for the one that was asked for:
      // the caller persists and displays the id it requested.
      const selected = requestedModelId
        ? installedModels.find((model) => model.spec.id === requestedModelId)
        : (installedModels.find((model) => model.path === this.activeModelPath) ?? installedModels[0]);
      if (!selected) return false;
      if (this.child && !this.child.killed && this.port !== undefined && this.activeModelPath === selected.path) {
        const running = this.child;
        const alive = await this.waitForHealth(signal, () => this.child !== running);
        if (alive && this.loadedContextWindow === undefined) {
          this.loadedContextWindow = await this.readLoadedContextWindow(signal);
        }
        return alive;
      }
      if (this.child && !this.child.killed) await this.stopChild();
      const executable = await findManagedLlamaServer(this.runtimeDirectory, process.platform, backend);
      const installed = (await this.installedModels()).find((model) => model.path === selected.path) ?? selected;
      if (!executable || !installed) return false;
      this.port = await freeLoopbackPort();
      const args = [
        "-m",
        installed.path,
        "--host",
        "127.0.0.1",
        "--port",
        String(this.port),
        "--ctx-size",
        String(serverContextSize(installed.spec.contextWindow, backend)),
        "--jinja",
      ];
      if (backend === "cuda") {
        // Keep the model on the NVIDIA device selected by llama.cpp. The
        // 1.5B/4-bit default fits comfortably in the GTX 1650's 4 GiB while
        // leaving headroom for KV cache and the desktop compositor.
        args.push("--device", "CUDA0", "--gpu-layers", "all", "--split-mode", "none", "--main-gpu", "0");
      }
      let child: ChildProcess;
      try {
        child = this.spawnImpl(executable, args, {
          windowsHide: true,
          stdio: "ignore",
          env: llamaServerEnvironment(),
        });
      } catch {
        this.port = undefined;
        this.child = undefined;
        return false;
      }
      this.child = child;
      let exited = false;
      child.once("exit", () => {
        exited = true;
        if (this.child !== child) return;
        this.port = undefined;
        this.child = undefined;
        this.activeModelPath = undefined;
        this.loadedContextWindow = undefined;
      });
      // The child reference is captured locally: the `exit` handler above can
      // clear `this.child` at any moment while the health poll is running.
      this.loadedContextWindow = undefined;
      const healthy = await this.waitForHealth(signal, () => exited);
      if (!healthy) {
        if (this.child === child) {
          await this.stopChild();
        } else {
          this.port = undefined;
          this.activeModelPath = undefined;
        }
        return false;
      }
      this.activeModelPath = installed.path;
      // Ask the server what it actually loaded: `--ctx-size` is a request, and
      // llama.cpp can settle on a smaller window than the one asked for.
      this.loadedContextWindow = await this.readLoadedContextWindow(signal);
      return true;
    })();
    // Failures are reported as `false`, never as a thrown error: callers such
    // as the startup orchestrator depend on a recoverable result so they can
    // fall back to a smaller model instead of surfacing a raw crash.
    const guarded = task.catch(() => false);
    this.starting = guarded;
    try {
      return await guarded;
    } finally {
      if (this.starting === guarded) this.starting = undefined;
    }
  }

  /**
   * Detection is a filesystem question only. Enumerating runtimes must never
   * load a model: inference is started by `prepareModel`, on the serve path.
   */
  async detect(_signal?: AbortSignal): Promise<boolean> {
    return this.hasBinary();
  }

  /**
   * Without a model id this reports whether the runtime can serve — and
   * verifies liveness only when a child is already running, so discovery stays
   * free of side effects. With a model id it asserts that this exact model is
   * the one being served, starting or swapping the server when needed.
   */
  async health(signal?: AbortSignal, modelId?: string): Promise<LocalRuntimeHealth> {
    const started = Date.now();
    const models = await this.installedModels();
    if (models.length === 0) return { healthy: false, reason: "The managed runtime has no installed model." };

    if (modelId === undefined) {
      if (!(await this.hasBinary())) {
        return {
          healthy: false,
          latencyMs: Date.now() - started,
          reason: "The managed llama.cpp engine is not installed yet.",
        };
      }
      if (!this.child || this.child.killed || this.port === undefined) {
        return { healthy: true, latencyMs: Date.now() - started };
      }
      const live = await this.pingHealth(signal);
      return live
        ? { healthy: true, latencyMs: Date.now() - started }
        : {
            healthy: false,
            latencyMs: Date.now() - started,
            reason: "The managed llama.cpp runtime stopped responding.",
          };
    }

    if (!models.some((model) => model.spec.id === modelId)) {
      return {
        healthy: false,
        latencyMs: Date.now() - started,
        reason: `${modelId} is not installed for the managed runtime.`,
      };
    }
    if (!(await this.ensureServer(signal, modelId))) {
      return {
        healthy: false,
        latencyMs: Date.now() - started,
        reason: "The managed llama.cpp runtime could not start.",
      };
    }
    if (!(await this.isServingModel(modelId))) {
      return {
        healthy: false,
        latencyMs: Date.now() - started,
        reason: `The managed llama.cpp runtime is not serving ${modelId}.`,
      };
    }
    return { healthy: true, latencyMs: Date.now() - started };
  }

  async listModels(_signal?: AbortSignal): Promise<LocalModelCandidate[]> {
    if (!(await this.hasBinary())) return [];
    const models = await this.installedModels();
    return models.map((model) => modelCandidate(model, this.baseURL, this.loadedContextWindow));
  }

  async installModel(request: {
    modelId: string;
    signal?: AbortSignal;
    onProgress?: (progress: {
      completed?: number;
      total?: number;
      status?: string;
      speedBytesPerSecond?: number;
      etaSeconds?: number;
    }) => void;
  }): Promise<{ success: boolean; reason?: string }> {
    const spec = getHuggingFaceModelSpec(request.modelId);
    if (!spec) return { success: false, reason: "That Hugging Face model is not in Shelra's reviewed local catalog." };
    try {
      await downloadHuggingFaceModel(spec, {
        signal: request.signal,
        onProgress: (progress: HuggingFaceDownloadProgress) => request.onProgress?.(progress),
        modelDirectory: this.modelDirectory,
      });
      return { success: true };
    } catch (error) {
      return { success: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  provider(model: LocalModelCandidate): ProviderAdapter {
    return createLocalProvider({
      ...model,
      baseURL: this.baseURL,
      runtimeId: this.id,
      runtimeKind: this.kind,
      // Compaction budgets downstream are only correct if this is the window the
      // running server loaded, not the one the catalog advertises.
      contextWindow: this.loadedContextWindow || model.contextWindow,
    });
  }

  async isReady(): Promise<boolean> {
    return (await this.health()).healthy;
  }

  async prepareModel(modelId: string, signal?: AbortSignal): Promise<boolean> {
    return this.ensureServer(signal, modelId);
  }

  async dispose(): Promise<void> {
    const pending = this.starting;
    if (pending) await pending.catch(() => false);
    await this.stopChild();
  }

  private async stopChild(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.port = undefined;
    this.activeModelPath = undefined;
    this.loadedContextWindow = undefined;
    if (!child || child.killed) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        // Windows child_process.kill() can report success while a native
        // llama-server process is still alive. Force the process tree down so
        // headless invocations never leave a runtime resident in the user
        // session. Unix runtimes receive a SIGKILL fallback for the same
        // bounded-cleanup guarantee.
        if (child.pid && process.platform === "win32") {
          spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
        } else if (child.pid) {
          child.kill("SIGKILL");
        }
        finish();
      }, 2_000);
      child.once("exit", finish);
      child.once("close", finish);
      child.kill();
    });
  }

  async hasInstalledBinary(): Promise<boolean> {
    try {
      const backend = await this.preferredBackend();
      await access((await findManagedLlamaServer(this.runtimeDirectory, process.platform, backend)) ?? "");
      return true;
    } catch {
      return false;
    }
  }

  async hasRuntimeBinary(): Promise<boolean> {
    return this.hasInstalledBinary();
  }
}
