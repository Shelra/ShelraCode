/**
 * Field cases: real problems people brought to Shelra, recorded so each can be re-run and set
 * against another agent's result on the same problem. A benchmark suite measures the harness on
 * fixed tasks; a field case is evidence that Shelra resolves the problems people actually have.
 * The records live in `bench/field/cases/`; `scripts/field-case.ts` extracts, re-runs and renders them.
 */

/** One Shelra attempt at a case: the original session or a later re-run. */
export interface FieldRun {
  date: string;
  /** The harness commit the run used, when known. */
  commit?: string;
  model: string;
  cost: "free" | "paid" | "local";
  session?: string;
  /** Seconds the attempt took: to the first answer for a saved session, the whole headless run for a re-run. */
  seconds?: number;
  /** True when `seconds` comes from saved session timestamps rather than step events. */
  secondsApprox?: boolean;
  toolCalls?: number;
  /** Rounds the completion gate added because the turn changed files without verifying them. */
  gateLoops?: number;
  /** Judged by a person, never inferred from the transcript. */
  solved?: boolean;
  attemptsToSolve?: number;
  result: string;
}

export interface FieldCase {
  id: string;
  date: string;
  title: string;
  /** Where the task ran (OS, working directory kind), without names or paths. */
  setting: string;
  /** The request as the user wrote it, so it can be re-run. */
  prompt: string;
  shelra: FieldRun;
  /** The other agent the user tried on the same problem. */
  reference?: { agent: string; solved: boolean; attemptsToSolve?: number; notes?: string };
  /** Harness fixes the case led to. */
  fixes?: Array<{ commit: string; what: string }>;
  reruns?: FieldRun[];
}

export interface StoredMessage {
  seq: number;
  role: string;
  text: string;
  createdAt: string;
}

export interface StoredToolCall {
  messageSeq: number;
}

export interface TurnSummary {
  prompt: string;
  promptSeq: number;
  /** When the first answer was saved; a round is saved as soon as it completes. */
  firstAnswerAt?: string;
  firstAnswer: string;
  /** When the turn's last answer was saved, after any completion-gate rounds. */
  answeredAt: string;
  toolCalls: number;
  /** Tool calls made before the first answer, ahead of any completion-gate rounds. */
  toolCallsBeforeFirstAnswer: number;
  gateLoops: number;
}

/** Messages the harness adds inside a turn; they are not the user's own requests. */
const HARNESS_MESSAGE_RE =
  /^(Completion blocked:|The connection to the model was interrupted|Your previous reply was empty|Requirement audit)/u;
const GATE_MESSAGE_RE = /^Completion blocked:/u;

/** Splits a session's saved messages into the user's turns; harness nudges count inside their turn. */
export function summarizeTurns(
  messages: readonly StoredMessage[],
  toolCalls: readonly StoredToolCall[],
): TurnSummary[] {
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);
  const prompts = ordered.filter((message) => message.role === "user" && !HARNESS_MESSAGE_RE.test(message.text.trim()));
  return prompts.map((prompt, index) => {
    const end = prompts[index + 1]?.seq ?? Number.POSITIVE_INFINITY;
    const inTurn = ordered.filter((message) => message.seq >= prompt.seq && message.seq < end);
    const answers = inTurn.filter((message) => message.role === "assistant" && message.text.trim() !== "");
    const first = answers[0];
    const calls = toolCalls.filter((call) => call.messageSeq >= prompt.seq && call.messageSeq < end);
    return {
      prompt: prompt.text,
      promptSeq: prompt.seq,
      firstAnswerAt: first?.createdAt,
      firstAnswer: first?.text ?? "",
      answeredAt: answers.at(-1)?.createdAt ?? prompt.createdAt,
      toolCalls: calls.length,
      toolCallsBeforeFirstAnswer: first ? calls.filter((call) => call.messageSeq < first.seq).length : calls.length,
      gateLoops: inTurn.filter((message) => message.role === "user" && GATE_MESSAGE_RE.test(message.text.trim()))
        .length,
    };
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Removes what identifies the user's machine before a record is committed to the public
 * repository: the home folder in either slash style, the user name and the machine name.
 */
export function redact(text: string, identity: { home: string; user: string; host: string }): string {
  let out = text;
  const home = identity.home.replace(/[\\/]+$/u, "");
  if (home) {
    const pattern = home
      .split(/[\\/]+/u)
      .map(escapeRegExp)
      .join("[\\\\/]+");
    out = out.replace(new RegExp(pattern, "giu"), "~");
  }
  for (const [value, placeholder] of [
    [identity.host, "<host>"],
    [identity.user, "<user>"],
  ] as const) {
    if (value.length >= 3) out = out.replace(new RegExp(`\\b${escapeRegExp(value)}\\b`, "giu"), placeholder);
  }
  return out;
}

function formatSeconds(run: FieldRun): string {
  if (run.seconds === undefined) return "";
  const text = run.seconds < 90 ? `${Math.round(run.seconds)} s` : `${(run.seconds / 60).toFixed(1)} min`;
  return run.secondsApprox ? `~${text}` : text;
}

function modelLabel(run: FieldRun): string {
  const name = run.model.replace(/^openrouter\//u, "");
  return `${name} (${run.cost})`;
}

const yesNo = (value: boolean | undefined) => (value === undefined ? "?" : value ? "yes" : "no");
const cell = (value: string | number | undefined) => String(value ?? "").replaceAll("|", "\\|");

/** The scoreboard, as Markdown, from every case: first attempts, then re-runs of the same prompt. */
export function renderScoreboard(cases: readonly FieldCase[]): string {
  const sorted = [...cases].sort((a, b) => a.id.localeCompare(b.id));
  const lines = [
    "# Field cases",
    "",
    "Real problems brought to Shelra, set against another agent on the same problem. Generated by",
    "`bun run scripts/field-case.ts board --write` from `cases/`; edit the case files, not this page.",
    "",
    "| Case | Date | Shelra model | Solved | Tries | First answer | Tool calls | Gate loops | Compared with | Its tries |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const item of sorted) {
    const run = item.shelra;
    lines.push(
      `| [${cell(item.id)}](cases/${item.id}.json) ${cell(item.title)} | ${item.date} | ${cell(modelLabel(run))} | ${yesNo(run.solved)} | ${cell(run.attemptsToSolve)} | ${formatSeconds(run)} | ${cell(run.toolCalls)} | ${cell(run.gateLoops)} | ${cell(item.reference?.agent)} | ${cell(item.reference?.attemptsToSolve)} |`,
    );
  }
  const reruns = sorted.flatMap((item) => (item.reruns ?? []).map((run) => ({ id: item.id, run })));
  if (reruns.length > 0) {
    lines.push(
      "",
      "## Re-runs",
      "",
      "The same prompt on a later harness, headless in a temporary folder; the time is the whole run.",
      "",
      "| Case | Date | Commit | Model | Run time | Tool calls | Gate loops | Result |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const { id, run } of reruns) {
      lines.push(
        `| ${cell(id)} | ${run.date} | ${cell(run.commit)} | ${cell(modelLabel(run))} | ${formatSeconds(run)} | ${cell(run.toolCalls)} | ${cell(run.gateLoops)} | ${cell(run.result)} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
