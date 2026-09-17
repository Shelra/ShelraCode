export type QueueResult<T> = { status: "fulfilled"; value: T } | { status: "rejected"; reason: unknown };

export interface QueueOptions {
  concurrency?: number;
  signal?: AbortSignal;
}

export async function runQueue<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  _options: QueueOptions = {},
): Promise<Array<QueueResult<R>>> {
  return Promise.all(
    items.map(async (item, index) => {
      try {
        return { status: "fulfilled", value: await worker(item, index) };
      } catch (reason) {
        return { status: "rejected", reason };
      }
    }),
  );
}
