import { failureSignature } from "../contract/failures";
import { errorLine } from "../memory/recovery";
import type { HostStopReason, HostStopStep } from "../providers/types";
import { isVerificationCommand } from "./verification-evidence";

/**
 * Work that goes in circles, watched across a turn's rounds (audit gap #3). Seen live 2026-09-25: in one turn
 * src/tracks/castle.ts flipped between the same two versions 6 times, an edit every 3 minutes, and `npm run build`
 * failed 17 times on the same TS1005 while four files took 16-18 edits each. Neither the repeat nor the stall detector
 * (src/providers/stream.ts) matched, since every edit was a new call and changing a file is work.
 */

/** Times a file may go back to the same earlier version before the round is stopped. */
export const FLIPS_TO_STOP = 2;
/** Runs in a row a check may fail the same way, with files changed between them, before the round is stopped. */
export const SAME_FAILURES_TO_STOP = 4;

export interface CircleStop {
  reason: Extract<HostStopReason, "oscillating" | "plateau">;
  /** What went in circles, said as a fact: it completes "Shelra stopped your last round because …". */
  detail: string;
}

type Call = NonNullable<HostStopStep["toolCalls"]>[number];
type Result = NonNullable<HostStopStep["toolResults"]>[number];

/** Whitespace does not make a version: the whitespace-tolerant edit matches either way. */
const squash = (text: string) => text.replace(/\s+/gu, " ").trim();

function clip(text: string, max = 70): string {
  const line = squash(text);
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function outputOf(result: Result | undefined): unknown {
  return result?.output ?? result?.result;
}

function succeeded(result: Result | undefined): boolean {
  const output = outputOf(result);
  return !(output && typeof output === "object" && (output as { success?: unknown }).success === false);
}

function textOf(result: Result | undefined): string {
  const output = outputOf(result);
  if (typeof output === "string") return output;
  const { error, output: text } = (output ?? {}) as { error?: unknown; output?: unknown };
  return [error, text].filter((part): part is string => typeof part === "string").join("\n");
}

/**
 * One detector per turn; `round()` gives the watcher for each round's steps, which starts from that round's first step
 * and shares what the turn has seen. A watcher reports a file that went back to the same earlier version
 * `FLIPS_TO_STOP` times (A→B→A→B), or a check that failed the same way `SAME_FAILURES_TO_STOP` runs in a row with files
 * changed between them. A single undo, or a debug line added and removed, is not a circle; changing the approach is not
 * either, since a new version or a new failure starts the count again. After a stop the count starts over, so the model
 * has room to take the other way it is asked for.
 */
export function createCircleDetector(): { round(): (steps: ReadonlyArray<HostStopStep>) => CircleStop | null } {
  /** Per file: the versions write_file left it in, and the edits made to it. */
  const writes = new Map<string, string[]>();
  const edits = new Map<string, Array<{ from: string; to: string }>>();
  /** Per file and pair of versions: how many times the file went back to one of them. */
  const flips = new Map<string, number>();
  /** Per check command: its latest failure and how many runs in a row failed that way. */
  const failures = new Map<string, { signature: string; runs: number; changedSince: boolean }>();

  const observeChange = (call: Call, input: Record<string, unknown>): CircleStop | null => {
    const file = String(input.path).replace(/\\/gu, "/").replace(/^\.\//u, "");
    for (const failure of failures.values()) failure.changedSince = true;
    let pair: [string, string] | null = null;
    if (call.toolName === "write_file" && typeof input.content === "string") {
      const versions = writes.get(file) ?? [];
      const version = squash(input.content);
      const previous = versions.at(-1);
      if (previous !== undefined && previous !== version && versions.slice(0, -1).includes(version))
        pair = [previous, version];
      versions.push(version);
      writes.set(file, versions.slice(-20));
    } else if (typeof input.old_string === "string" && typeof input.new_string === "string") {
      const from = squash(input.old_string);
      const to = squash(input.new_string);
      if (from === to) return null;
      const done = edits.get(file) ?? [];
      if (done.some((edit) => edit.from === to && edit.to === from)) pair = [from, to];
      done.push({ from, to });
      edits.set(file, done.slice(-40));
    }
    if (!pair) return null;
    const [a, b] = [...pair].sort();
    const key = JSON.stringify([file, a, b]);
    const count = (flips.get(key) ?? 0) + 1;
    if (count < FLIPS_TO_STOP) {
      flips.set(key, count);
      return null;
    }
    flips.delete(key);
    const shown = call.toolName === "write_file" ? "" : ` ("${clip(pair[0])}" and "${clip(pair[1])}")`;
    return {
      reason: "oscillating",
      detail: `your edits to ${file} went back and forth between the same two versions${shown}: ${count} of them undid the edit before`,
    };
  };

  const observeCheck = (command: string, result: Result | undefined): CircleStop | null => {
    const key = squash(command);
    if (succeeded(result)) {
      failures.delete(key);
      return null;
    }
    const output = textOf(result);
    const signature = failureSignature(output);
    const last = failures.get(key);
    const runs = last && last.signature === signature ? (last.changedSince ? last.runs + 1 : last.runs) : 1;
    if (runs < SAME_FAILURES_TO_STOP) {
      failures.set(key, { signature, runs, changedSince: false });
      return null;
    }
    failures.delete(key);
    return {
      reason: "plateau",
      detail: `\`${clip(command, 120)}\` failed the same way ${runs} runs in a row while you changed files between them (${clip(errorLine(output), 160)})`,
    };
  };

  const observe = (call: Call, result: Result | undefined): CircleStop | null => {
    const input = (call.input ?? {}) as Record<string, unknown>;
    if ((call.toolName === "edit_file" || call.toolName === "write_file") && typeof input.path === "string") {
      return succeeded(result) ? observeChange(call, input) : null;
    }
    if (call.toolName === "bash" && typeof input.command === "string" && isVerificationCommand(input.command)) {
      return observeCheck(input.command, result);
    }
    return null;
  };

  return {
    round() {
      let scanned = 0;
      return (steps) => {
        let stop: CircleStop | null = null;
        for (; scanned < steps.length; scanned += 1) {
          const step = steps[scanned];
          (step?.toolCalls ?? []).forEach((call, index) => {
            const result =
              (call.toolCallId && step?.toolResults?.find((item) => item.toolCallId === call.toolCallId)) ||
              step?.toolResults?.[index];
            stop = observe(call, result) ?? stop;
          });
        }
        return stop;
      };
    },
  };
}
