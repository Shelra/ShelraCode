import { closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";

/** Human topics are self-indexing; MEMORY.md is only their bounded projection. */
export const HUMAN_TOPIC_LIMIT = 5_000;
export const HUMAN_TOPIC_MAX_BYTES = 32 * 1024;
const TOPIC_NAME = /^[a-z][a-z0-9-]{0,63}\.md$/u;

export function humanTopicDirectory(memoryDirectory: string): string {
  return join(memoryDirectory, "human");
}

function checkDirectory(directory: string): void {
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Human memory directory is not a regular directory.");
}

export function readHumanTopic(memoryDirectory: string, file: string): string {
  if (!TOPIC_NAME.test(file)) throw new Error("Invalid human topic name.");
  const directory = humanTopicDirectory(memoryDirectory);
  checkDirectory(directory);
  const path = join(directory, file);
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > HUMAN_TOPIC_MAX_BYTES)
    throw new Error("Human topic is not a bounded, independent regular file.");
  const fd = openSync(path, "r");
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size)
      throw new Error("Human topic changed before reading.");
    const bytes = Buffer.alloc(before.size);
    let read = 0;
    while (read < bytes.length) {
      const count = readSync(fd, bytes, read, bytes.length - read, read);
      if (count === 0) throw new Error("Human topic was truncated while reading.");
      read += count;
    }
    const after = fstatSync(fd);
    const named = lstatSync(path);
    if (
      after.mtimeMs !== before.mtimeMs ||
      after.size !== before.size ||
      named.ino !== before.ino ||
      named.dev !== before.dev
    )
      throw new Error("Human topic changed while reading.");
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    closeSync(fd);
  }
}

export function listHumanTopics(memoryDirectory: string): {
  topics: Array<{ file: string; raw: string }>;
  complete: boolean;
  warnings: string[];
} {
  const directory = humanTopicDirectory(memoryDirectory);
  const topics: Array<{ file: string; raw: string }> = [];
  const warnings: string[] = [];
  try {
    try {
      checkDirectory(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { topics, complete: true, warnings };
      throw error;
    }
    const names = readdirSync(directory)
      .filter((name) => TOPIC_NAME.test(name))
      .sort();
    if (names.length > HUMAN_TOPIC_LIMIT)
      warnings.push(`Human memory read budget: ${HUMAN_TOPIC_LIMIT}/${names.length} topics.`);
    for (const file of names.slice(0, HUMAN_TOPIC_LIMIT)) {
      try {
        topics.push({ file, raw: readHumanTopic(memoryDirectory, file) });
      } catch (error) {
        warnings.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
  }
  return { topics, complete: warnings.length === 0, warnings };
}

/** The caller holds the scope's write lock. The topic rename is the commit point. */
export function prepareHumanTopic(memoryDirectory: string, file: string, bytes: number): string {
  if (!TOPIC_NAME.test(file)) throw new Error("Invalid human topic name.");
  if (bytes > HUMAN_TOPIC_MAX_BYTES) throw new Error(`Human topic exceeds ${HUMAN_TOPIC_MAX_BYTES} bytes; not saved.`);
  const directory = humanTopicDirectory(memoryDirectory);
  mkdirSync(directory, { recursive: true });
  checkDirectory(directory);
  const path = join(directory, file);
  if (existsSync(path)) {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
      throw new Error("Human topic destination is not an independent regular file.");
  } else if (readdirSync(directory).filter((name) => TOPIC_NAME.test(name)).length >= HUMAN_TOPIC_LIMIT) {
    throw new Error(`Human topic capacity is ${HUMAN_TOPIC_LIMIT}; not saved.`);
  }
  return path;
}
