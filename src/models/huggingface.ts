import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getProductUserDir } from "../product/identity";

export interface HuggingFaceModelSpec {
  /** Stable Shelra identity. The value is never sent to a third-party runtime. */
  id: string;
  displayName: string;
  repoId: string;
  filename: string;
  revision: string;
  quantization: string;
  parameters: number;
  contextWindow: number;
  estimatedMemoryGb: number;
  sha256?: string;
  sizeBytes?: number;
}

export interface HuggingFaceDownloadProgress {
  completed: number;
  total?: number;
  speedBytesPerSecond?: number;
  etaSeconds?: number;
  status: "connecting" | "downloading" | "verifying" | "complete";
}

export interface HuggingFaceDownloadOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: HuggingFaceDownloadProgress) => void;
  modelDirectory?: string;
}

/**
 * Small, reviewed seed catalog. It is a fallback for first-run startup, not
 * a provider model registry: every artifact is resolved from Hugging Face and
 * stored locally. A future catalog refresh can add entries without changing
 * the runtime contract.
 */
export const HUGGING_FACE_MODELS: readonly HuggingFaceModelSpec[] = [
  {
    id: "hf:Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF:Q4_K_M",
    displayName: "Qwen2.5 Coder 1.5B · Q4_K_M",
    repoId: "Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF",
    filename: "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
    revision: "main",
    quantization: "Q4_K_M",
    parameters: 1_500_000_000,
    contextWindow: 32_768,
    estimatedMemoryGb: 2.2,
    sha256: "cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046",
    sizeBytes: 1_117_320_768,
  },
  {
    id: "hf:Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M",
    displayName: "Qwen2.5 Coder 7B · Q4_K_M",
    repoId: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
    filename: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    revision: "main",
    quantization: "Q4_K_M",
    parameters: 7_000_000_000,
    contextWindow: 32_768,
    estimatedMemoryGb: 5.3,
    sha256: "509287f78cb4d4cf6b3843734733b914b2c158e43e22a7f4bf5e963800894d3c",
    sizeBytes: 5_025_000_000,
  },
];

const HF_BASE_URL = "https://huggingface.co";

export function getHuggingFaceModelSpec(id: string): HuggingFaceModelSpec | undefined {
  const normalized = id.trim();
  return HUGGING_FACE_MODELS.find((model) => model.id === normalized);
}

export function huggingFaceResolveUrl(spec: HuggingFaceModelSpec): string {
  const repo = spec.repoId.split("/").map(encodeURIComponent).join("/");
  const filename = spec.filename.split("/").map(encodeURIComponent).join("/");
  return `${HF_BASE_URL}/${repo}/resolve/${encodeURIComponent(spec.revision)}/${filename}?download=true`;
}

export function defaultModelDirectory(): string {
  return path.join(getProductUserDir(), "models");
}

export function modelArtifactPath(spec: HuggingFaceModelSpec, modelDirectory = defaultModelDirectory()): string {
  return path.join(modelDirectory, spec.filename);
}

function contentLength(response: Response, offset: number): number | undefined {
  const range = response.headers.get("content-range")?.match(/\/([0-9]+)/u)?.[1];
  const length = response.headers.get("content-length");
  const total = range ? Number(range) : length ? Number(length) + offset : undefined;
  return total !== undefined && Number.isFinite(total) && total > 0 ? total : undefined;
}

async function existingSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Download cancelled", "AbortError");
}

/**
 * Returns the size of an already-installed artifact, or `undefined` when the
 * file is absent or fails validation. Multi-gigabyte artifacts are never
 * re-hashed here: the recorded size, or a sidecar naming this exact model, is
 * the cheap evidence that the finished file is the one being requested.
 */
async function installedArtifactBytes(spec: HuggingFaceModelSpec, destination: string): Promise<number | undefined> {
  let size: number;
  try {
    size = (await stat(destination)).size;
  } catch {
    return undefined;
  }
  if (size <= 0) return undefined;
  if (spec.sizeBytes !== undefined) return size === spec.sizeBytes ? size : undefined;
  try {
    const sidecar = parseModelSidecar(await readFile(`${destination}.json`, "utf8"));
    if (sidecar?.id === spec.id && sidecar.filename === spec.filename) return size;
  } catch {
    // No readable sidecar: fall through and (re)download.
  }
  return undefined;
}

/** True when a `.part` is byte-for-byte the finished artifact. */
async function partialIsCompleteArtifact(spec: HuggingFaceModelSpec, partial: string, size: number): Promise<boolean> {
  if (spec.sizeBytes === undefined || size !== spec.sizeBytes || !spec.sha256) return false;
  return (await hashFile(partial)).toLowerCase() === spec.sha256.toLowerCase();
}

async function finalizeArtifact(spec: HuggingFaceModelSpec, partial: string, destination: string): Promise<number> {
  await rename(partial, destination);
  await writeFile(
    `${destination}.json`,
    JSON.stringify({ ...spec, path: destination, installedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  );
  return (await stat(destination)).size;
}

/**
 * Downloads one immutable HF artifact with Range resume and atomic finalize.
 * A `.part` file is deliberately retained after interruption so a restart can
 * continue from the last verified byte instead of starting over.
 */
export async function downloadHuggingFaceModel(
  spec: HuggingFaceModelSpec,
  options: HuggingFaceDownloadOptions = {},
): Promise<{ path: string; bytes: number; sha256?: string }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const directory = options.modelDirectory ?? defaultModelDirectory();
  await mkdir(directory, { recursive: true });
  const destination = modelArtifactPath(spec, directory);
  const installedBytes = await installedArtifactBytes(spec, destination);
  if (installedBytes !== undefined) {
    options.onProgress?.({ completed: installedBytes, total: spec.sizeBytes ?? installedBytes, status: "complete" });
    return { path: destination, bytes: installedBytes, ...(spec.sha256 ? { sha256: spec.sha256 } : {}) };
  }
  const partial = `${destination}.part`;
  let offset = await existingSize(partial);
  // A partial larger than the artifact can never be a valid prefix; keeping it
  // would make every retry ask for an unsatisfiable range.
  if (spec.sizeBytes !== undefined && offset > spec.sizeBytes) {
    await unlink(partial).catch(() => undefined);
    offset = 0;
  }
  const headers: Record<string, string> = {};
  if (offset > 0) headers.Range = `bytes=${offset}-`;
  options.onProgress?.({ completed: offset, total: spec.sizeBytes, status: "connecting" });
  abortIfNeeded(options.signal);
  let response = await fetchImpl(huggingFaceResolveUrl(spec), { headers, signal: options.signal });
  if (response.status === 416 && offset > 0) {
    // The server rejected the range. Either the partial is already the whole
    // artifact, or it is not a valid prefix — never treat 416 as success
    // without proving the bytes on disk are correct.
    if (await partialIsCompleteArtifact(spec, partial, offset)) {
      options.onProgress?.({ completed: offset, total: spec.sizeBytes, status: "verifying" });
      const bytes = await finalizeArtifact(spec, partial, destination);
      options.onProgress?.({ completed: bytes, total: spec.sizeBytes ?? bytes, status: "complete" });
      return { path: destination, bytes, ...(spec.sha256 ? { sha256: spec.sha256 } : {}) };
    }
    await unlink(partial).catch(() => undefined);
    offset = 0;
    abortIfNeeded(options.signal);
    response = await fetchImpl(huggingFaceResolveUrl(spec), { signal: options.signal });
  }
  if (!response.ok && response.status !== 206) {
    throw new Error(`Hugging Face returned HTTP ${response.status} while downloading ${spec.displayName}.`);
  }
  if (!response.body) throw new Error("Hugging Face returned an empty model body.");

  const resumed = offset > 0 && response.status === 206;
  const start = resumed ? offset : 0;
  const total = contentLength(response, start) ?? spec.sizeBytes;
  const file = await (await import("node:fs/promises")).open(partial, resumed ? "a" : "w");
  const startedAt = Date.now();
  let completed = start;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      abortIfNeeded(options.signal);
      await file.write(chunk);
      completed += chunk.byteLength;
      const elapsed = Math.max(1, Date.now() - startedAt) / 1000;
      const speed = (completed - start) / elapsed;
      options.onProgress?.({
        completed,
        ...(total === undefined ? {} : { total }),
        speedBytesPerSecond: speed > 0 ? speed : undefined,
        etaSeconds: total !== undefined && speed > 0 ? Math.max(0, Math.ceil((total - completed) / speed)) : undefined,
        status: "downloading",
      });
    }
  } finally {
    await file.close();
  }

  options.onProgress?.({ completed, ...(total === undefined ? {} : { total }), status: "verifying" });
  if (spec.sha256) {
    const actual = await hashFile(partial);
    if (actual.toLowerCase() !== spec.sha256.toLowerCase()) {
      await unlink(partial).catch(() => undefined);
      throw new Error("The downloaded model failed its SHA-256 integrity check; the partial artifact was removed.");
    }
  }
  const bytes = await finalizeArtifact(spec, partial, destination);
  options.onProgress?.({ completed: bytes, ...(total === undefined ? {} : { total }), status: "complete" });
  return { path: destination, bytes, ...(spec.sha256 ? { sha256: spec.sha256 } : {}) };
}

export interface InstalledHuggingFaceModel {
  spec: HuggingFaceModelSpec;
  path: string;
}

function parseModelSidecar(raw: string): Partial<HuggingFaceModelSpec> | undefined {
  // Accept UTF-8 BOMs produced by some Windows editors and the literal
  // ``\\n`` suffix left by older setup scripts. New downloads are written
  // without either artifact, but tolerant reads keep an otherwise valid local
  // model from being downgraded to anonymous metadata.
  const normalized = raw
    .replace(/^\uFEFF/u, "")
    .replace(/\\n\s*$/u, "")
    .trim();
  try {
    return JSON.parse(normalized) as Partial<HuggingFaceModelSpec>;
  } catch {
    return undefined;
  }
}

/** Reads only Shelra sidecars and GGUF filenames; no model content is executed. */
export async function discoverInstalledHuggingFaceModels(
  modelDirectory = defaultModelDirectory(),
): Promise<InstalledHuggingFaceModel[]> {
  const { readdir } = await import("node:fs/promises");
  let entries: string[];
  try {
    entries = await readdir(modelDirectory);
  } catch {
    return [];
  }
  const installed: InstalledHuggingFaceModel[] = [];
  for (const entry of entries.filter((name) => name.toLowerCase().endsWith(".gguf"))) {
    const filePath = path.join(modelDirectory, entry);
    let spec: HuggingFaceModelSpec | undefined;
    let sidecarInvalid = false;
    try {
      const sidecar = parseModelSidecar(await readFile(`${filePath}.json`, "utf8"));
      if (
        sidecar &&
        typeof sidecar.id === "string" &&
        typeof sidecar.repoId === "string" &&
        typeof sidecar.filename === "string"
      ) {
        spec = sidecar as HuggingFaceModelSpec;
      } else {
        sidecarInvalid = true;
      }
    } catch {
      // Older/manual GGUF files remain discoverable with conservative metadata.
    }
    if (!spec) {
      // A catalogued filename identifies the model even when its sidecar is
      // missing or corrupt, so a readable artifact is never downgraded to an
      // anonymous `local:` identity that would then be persisted as the
      // default model.
      const catalogued = HUGGING_FACE_MODELS.find((model) => model.filename.toLowerCase() === entry.toLowerCase());
      if (catalogued) {
        if (sidecarInvalid) {
          console.warn(
            `Ignoring an unreadable metadata sidecar for ${entry}; using the catalog entry ${catalogued.id} instead.`,
          );
        }
        spec = catalogued;
      } else if (sidecarInvalid) {
        console.warn(`The metadata sidecar for ${entry} could not be parsed; falling back to filename-only metadata.`);
      }
    }
    if (!spec) {
      spec = {
        id: `local:${entry}`,
        displayName: entry.replace(/\.gguf$/iu, ""),
        repoId: "local",
        filename: entry,
        revision: "local",
        quantization: "unknown",
        parameters: 0,
        contextWindow: 32_768,
        estimatedMemoryGb: Math.max(1, ((await stat(filePath)).size / 1024 ** 3) * 1.12),
      };
    }
    installed.push({ spec, path: filePath });
  }
  return installed;
}

export function formatDownloadSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "size unknown";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

export function formatDownloadSpeed(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return "calculating speed";
  return `${formatDownloadSize(bytes)}/s`;
}
