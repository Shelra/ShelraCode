import type { TelegramSettings } from "../../utils/settings";
import { getApiKey, getBaseURL, resolveTelegramAudioInputSettings } from "../../utils/settings";
import { RemoteSttEngine, type RemoteSttTranscriptionResult } from "./remote-stt";

export interface AudioTranscriptionInput {
  audioPath: string;
  fileName?: string;
  mimeType?: string;
}

export type AudioTranscriptionResult = RemoteSttTranscriptionResult;

export interface AudioTranscriptionEngine {
  transcribe(input: AudioTranscriptionInput): Promise<AudioTranscriptionResult>;
}

export function createTelegramAudioInputEngine(
  telegramSettings: TelegramSettings | undefined,
): AudioTranscriptionEngine {
  const resolved = resolveTelegramAudioInputSettings(telegramSettings);
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      "Speech-to-text requires an API key. Set SHELRA_API_KEY or configure apiKey in ~/.shelra/user-settings.json.",
    );
  }

  return new RemoteSttEngine({
    apiKey,
    baseURL: getBaseURL(),
    language: resolved.language,
  });
}
