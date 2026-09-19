import { readFile } from "fs/promises";
import path from "path";

export interface RemoteSttEngineConfig {
  apiKey: string;
  baseURL?: string;
  language?: string;
}

export interface RemoteSttTranscriptionInput {
  audioPath: string;
  fileName?: string;
  mimeType?: string;
}

export interface RemoteSttWord {
  text: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: number;
}

export interface RemoteSttTranscriptionResult {
  text: string;
  engine: "remote-stt";
  language: string;
  duration: number;
  words?: RemoteSttWord[];
}

export class RemoteSttEngine {
  constructor(private readonly config: RemoteSttEngineConfig) {
    if (!config.apiKey?.trim()) {
      throw new Error(
        "Speech-to-text requires an API key. Set SHELRA_API_KEY or configure apiKey in ~/.shelra/user-settings.json.",
      );
    }
  }

  async transcribe(input: RemoteSttTranscriptionInput): Promise<RemoteSttTranscriptionResult> {
    const bytes = await readFile(input.audioPath);
    const fileName = input.fileName || path.basename(input.audioPath);
    const mimeType = input.mimeType || inferMimeTypeFromFileName(fileName);
    const baseURL = normalizeBaseURL(this.config.baseURL);
    const language = this.config.language?.trim();

    const form = new FormData();
    const uint8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    form.append("file", new Blob([uint8], { type: mimeType }), fileName);
    if (language) {
      form.append("language", language);
      form.append("format", "true");
    }

    const response = await fetch(`${baseURL}/stt`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: form,
    });

    if (!response.ok) {
      const body = await safeReadText(response);
      const detail = body.trim() || response.statusText || `HTTP ${response.status}`;
      throw new Error(`Speech-to-text request failed (${response.status}): ${detail}`);
    }

    const payload = (await response.json()) as {
      text?: string;
      language?: string;
      duration?: number;
      words?: RemoteSttWord[];
    };

    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) {
      throw new Error("Speech-to-text returned an empty transcript.");
    }

    return {
      text,
      engine: "remote-stt",
      language: typeof payload.language === "string" ? payload.language : "",
      duration: typeof payload.duration === "number" ? payload.duration : 0,
      words: Array.isArray(payload.words) ? payload.words : undefined,
    };
  }
}

export function inferMimeTypeFromFileName(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".ogg":
      return "audio/ogg";
    case ".opus":
      return "audio/opus";
    case ".flac":
      return "audio/flac";
    case ".aac":
      return "audio/aac";
    case ".m4a":
      return "audio/mp4";
    case ".mp4":
      return "audio/mp4";
    case ".mkv":
      return "audio/x-matroska";
    default:
      return "application/octet-stream";
  }
}

function normalizeBaseURL(baseURL?: string): string {
  const value = baseURL?.trim() || process.env.SHELRA_BASE_URL?.trim();
  if (!value) {
    throw new Error("Speech-to-text provider base URL required. Set SHELRA_BASE_URL or pass baseURL explicitly.");
  }
  return value.replace(/\/+$/, "");
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
