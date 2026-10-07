/**
 * The record of every delegated agent run: who ran, for which task, with which tools, skills and limits, what state it
 * ended in and what it changed. It is what `/agents` shows, what the orchestrator reads to check a result, and what lets a
 * cancelled or interrupted run be picked up without repeating what it already did: its changed files are listed, and a
 * run that was still `running` when its process is gone reads as `interrupted`.
 *
 * Writes are asynchronous and ordered per run, so recording a run never stalls the turn.
 */
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, join, resolve } from "node:path";
import { redactSecrets } from "../memory/gate";
import { getProductUserDir } from "../product/identity";
import { recordSwallowedError } from "../utils/diagnostics";

export type RunStatus = "running" | "completed" | "failed" | "cancelled" | "interrupted";

export interface AgentRunRecord {
  id: string;
  /** The session (and so the main task) that started it. */
  parentSession: string | null;
  agent: string;
  /** Which definition ran: its file and content version when it started. */
  definition: { source: string; hash: string } | null;
  description: string;
  /** The delegated brief, cut. */
  prompt: string;
  skills: string[];
  tools: string[];
  readOnly: boolean;
  model: string;
  limits: { maxSteps: number; timeoutMinutes: number | null };
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  /** Files the run changed, as the host saw the tool results. */
  filesChanged: string[];
  /** Checks the run itself ran successfully. */
  evidence: string[];
  resultExcerpt?: string;
  error?: string;
  pid: number;
  notes: string[];
}

/**
 * `SHELRA_AGENT_RUNS=off` keeps the records out of the person's folder, the way `SHELRA_TRACE=off` and
 * `SHELRA_DIAGNOSTICS_LOG=off` do: a test that runs a delegated agent must not leave runs in the real home.
 */
function recording(): boolean {
  return process.env.SHELRA_AGENT_RUNS !== "off";
}

const PROMPT_CLIP = 600;
const RESULT_CLIP = 1200;
const KEEP_RUNS = 200;

function projectId(root: string): string {
  const base =
    basename(resolve(root))
      .replace(/[^A-Za-z0-9._-]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "project";
  return `${base}-${createHash("sha1").update(resolve(root)).digest("hex").slice(0, 10)}`;
}

function runsDirectory(root: string): string {
  return join(getProductUserDir(), "agent-runs", projectId(root));
}

const queues = new Map<string, Promise<void>>();

function enqueue(id: string, task: () => Promise<void>): Promise<void> {
  const previous = queues.get(id) ?? Promise.resolve();
  const next = previous.then(task).catch((error) => recordSwallowedError("extend.runs.write", error));
  queues.set(id, next);
  void next.finally(() => {
    if (queues.get(id) === next) queues.delete(id);
  });
  return next;
}

async function write(root: string, record: AgentRunRecord): Promise<void> {
  if (!recording()) return;
  const dir = runsDirectory(root);
  await fs.mkdir(dir, { recursive: true });
  const file = join(dir, `${record.id}.json`);
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(record, null, 2), "utf8");
  await fs.rename(temporary, file);
}

export function newRunId(agent: string): string {
  return `${agent.replace(/[^a-z0-9-]/gu, "").slice(0, 24) || "agent"}-${randomUUID().slice(0, 8)}`;
}

/** What a run record keeps of a prompt or result: secrets masked first (the file lives in the home folder), then cut. */
function clipMasked(text: string, max: number): string {
  const clean = redactSecrets(text);
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function startRun(
  root: string,
  input: Omit<AgentRunRecord, "status" | "startedAt" | "filesChanged" | "evidence" | "pid" | "prompt" | "notes"> & {
    prompt: string;
    notes?: string[];
  },
): AgentRunRecord {
  const record: AgentRunRecord = {
    ...input,
    prompt: clipMasked(input.prompt, PROMPT_CLIP),
    status: "running",
    startedAt: new Date().toISOString(),
    filesChanged: [],
    evidence: [],
    pid: process.pid,
    notes: input.notes ?? [],
  };
  void enqueue(record.id, () => write(root, record));
  return record;
}

export function finishRun(
  root: string,
  record: AgentRunRecord,
  outcome: {
    status: Exclude<RunStatus, "running">;
    filesChanged?: string[];
    evidence?: string[];
    result?: string;
    error?: string;
  },
): AgentRunRecord {
  const ended = new Date();
  const finished: AgentRunRecord = {
    ...record,
    status: outcome.status,
    endedAt: ended.toISOString(),
    durationMs: ended.getTime() - new Date(record.startedAt).getTime(),
    filesChanged: [...new Set(outcome.filesChanged ?? record.filesChanged)],
    evidence: (outcome.evidence ?? record.evidence).map((line) => clipMasked(line, RESULT_CLIP)),
    ...(outcome.result ? { resultExcerpt: clipMasked(outcome.result, RESULT_CLIP) } : {}),
    ...(outcome.error ? { error: clipMasked(outcome.error, RESULT_CLIP) } : {}),
  };
  void enqueue(record.id, () => write(root, finished));
  return finished;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function listRuns(root: string, limit = 20): Promise<AgentRunRecord[]> {
  const dir = runsDirectory(root);
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((file) => file.endsWith(".json"));
  } catch {
    return [];
  }
  const records: AgentRunRecord[] = [];
  for (const file of files) {
    try {
      const record = JSON.parse(await fs.readFile(join(dir, file), "utf8")) as AgentRunRecord;
      // A run recorded as running whose process is gone did not finish: it was interrupted.
      if (record.status === "running" && record.pid !== process.pid && !alive(record.pid))
        record.status = "interrupted";
      records.push(record);
    } catch {
      /* a record that cannot be read is skipped */
    }
  }
  records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  // Keep the directory bounded: forget the oldest finished runs.
  if (records.length > KEEP_RUNS) {
    for (const old of records.slice(KEEP_RUNS))
      await fs.rm(join(dir, `${old.id}.json`), { force: true }).catch(() => undefined);
  }
  return records.slice(0, limit);
}

export async function flushRuns(): Promise<void> {
  await Promise.all([...queues.values()]);
}

/** One line per run for the orchestrator and `/agents`. */
export function describeRun(record: AgentRunRecord): string {
  const files =
    record.filesChanged.length > 0
      ? `; changed ${record.filesChanged.slice(0, 6).join(", ")}${record.filesChanged.length > 6 ? ` and ${record.filesChanged.length - 6} more` : ""}`
      : "";
  const state =
    record.status === "interrupted" || record.status === "cancelled"
      ? `${record.status} (the files above were already changed: do not redo them)`
      : record.status;
  return `${record.id} · ${record.agent} · ${state} · ${record.model}${record.durationMs !== undefined ? ` · ${Math.round(record.durationMs / 1000)}s` : ""}${files} — ${record.description}`;
}
