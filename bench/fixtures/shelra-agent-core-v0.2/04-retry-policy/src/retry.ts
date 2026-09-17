export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  _options: RetryOptions = {},
): Promise<T> {
  return operation(1);
}
