import { fileURLToPath } from "node:url";
import type { ModelMessage } from "ai";
import { existsSync, readFileSync, statSync } from "fs";
import { extname, isAbsolute, resolve } from "path";

export interface VisionInputLimits {
  /** One budget shared by all images, including response bodies. */
  timeoutMs?: number;
  maxImageBytes?: number;
}

export async function buildVisionUserMessages(
  prompt: string,
  cwd: string,
  abortSignal?: AbortSignal,
  limits: VisionInputLimits = {},
): Promise<ModelMessage[]> {
  const imageSources = extractImageSourcesFromPrompt(prompt);
  if (imageSources.length === 0) {
    return [{ role: "user", content: prompt }];
  }

  const content: Array<{ type: "file"; data: string; mediaType: string } | { type: "text"; text: string }> = [];
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new Error("image preparation deadline exceeded")),
    limits.timeoutMs ?? 10_000,
  );
  const signal = abortSignal ? AbortSignal.any([abortSignal, deadline.signal]) : deadline.signal;
  const maxBytes = limits.maxImageBytes ?? 10 * 1024 * 1024;
  try {
    for (const source of imageSources) {
      abortSignal?.throwIfAborted();
      try {
        signal.throwIfAborted();
        const resolved = await resolveVisionImageSource(source, cwd, signal, maxBytes);
        // SDK-supported base64 survives SQLite's JSON transcript; Buffer/Uint8Array become invalid plain objects.
        content.push({
          type: "file",
          data: Buffer.from(resolved.data).toString("base64"),
          mediaType: resolved.mediaType,
        });
      } catch (error) {
        abortSignal?.throwIfAborted();
        const reason = signal.aborted
          ? "preparation deadline exceeded"
          : error instanceof Error
            ? error.message
            : "image could not be loaded";
        content.push({
          type: "text",
          text: `[Image unavailable: ${reason}. Do not claim to have inspected this image.]`,
        });
      }
    }
  } finally {
    clearTimeout(timer);
  }

  if (content.length === 0) {
    return [{ role: "user", content: prompt }];
  }

  content.push({ type: "text", text: prompt });
  return [{ role: "user", content }];
}

function extractImageSourcesFromPrompt(prompt: string): string[] {
  // Include POSIX paths, Windows drive paths, file URLs and escaped spaces.
  const matches = prompt.match(/((?:file:\/\/|https?:\/\/|[A-Za-z]:[\\/]|\/)[^\n]*?\.(?:png|jpe?g))/gi) ?? [];
  const seen = new Set<string>();
  const sources: string[] = [];

  for (const match of matches) {
    const normalized = normalizeImageSourceText(match);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    sources.push(normalized);
  }

  return sources;
}

async function resolveVisionImageSource(
  source: string,
  cwd: string,
  abortSignal?: AbortSignal,
  maxBytes = 10 * 1024 * 1024,
): Promise<{ data: Uint8Array; mediaType: string }> {
  if (isHttpUrl(source)) {
    const response = await fetch(source, { signal: abortSignal });
    if (!response.ok) {
      throw new Error(`Source image download failed: ${response.status} ${response.statusText}`);
    }
    if (Number(response.headers.get("content-length")) > maxBytes) {
      // Do not await cancellation: a remote source can fail to acknowledge it.
      void response.body?.cancel().catch(() => {});
      throw new Error(`image exceeds ${maxBytes} bytes`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("image response has no body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    abortSignal?.addEventListener("abort", cancel, { once: true });
    try {
      while (true) {
        abortSignal?.throwIfAborted();
        const next = await reader.read();
        abortSignal?.throwIfAborted();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > maxBytes) {
          cancel();
          throw new Error(`image exceeds ${maxBytes} bytes`);
        }
        chunks.push(next.value);
      }
    } finally {
      abortSignal?.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      data,
      mediaType: response.headers.get("content-type") || guessImageMediaType(source),
    };
  }

  const localPath = source.startsWith("file://") ? decodeFileUrl(source) : resolveLocalImagePath(source, cwd);
  if (!existsSync(localPath)) {
    throw new Error("source image not found");
  }
  if (statSync(localPath).size > maxBytes) throw new Error(`image exceeds ${maxBytes} bytes`);

  return {
    data: readFileSync(localPath),
    mediaType: guessImageMediaType(localPath),
  };
}

function normalizeImageSourceText(value: string): string {
  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\([ "'()[\]{}])/g, "$1");
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function decodeFileUrl(value: string): string {
  try {
    return fileURLToPath(value);
  } catch {
    return value;
  }
}

function resolveLocalImagePath(source: string, cwd: string): string {
  return isAbsolute(source) ? source : resolve(cwd, source);
}

function guessImageMediaType(pathLike: string): string {
  switch (extname(pathLike).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    default:
      return "image/png";
  }
}
