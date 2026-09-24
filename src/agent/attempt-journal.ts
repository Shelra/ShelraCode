/**
 * What each file looked like before the file tools first changed it in each attempt of a turn (audit doc
 * 15, Phase 2.3). An attempt is the work between two evaluations of the task contract: attempt 0 runs
 * until the first evaluation, and each failed evaluation starts the next one. `restore_file` reads the
 * journal when the model asks; nothing here writes a file, and nothing is ever reverted on its own (the
 * owner's decision: report the regression and offer the restore, 2026-09-23).
 */

export type RestorePoint = "before_last_attempt" | "before_turn";

export interface JournalEntry {
  attempt: number;
  previousExisted: boolean;
  previousContent: string | null;
}

export class AttemptJournal {
  private attempt = 0;
  /** Workspace-relative path → the state before its first change in each attempt that changed it, oldest first. */
  private readonly files = new Map<string, JournalEntry[]>();

  /** The attempt the next change belongs to. */
  get current(): number {
    return this.attempt;
  }

  /** A failed evaluation of the contract ends the current attempt. */
  nextAttempt(): void {
    this.attempt += 1;
  }

  /** Called before a file tool changes a file; only the first change in an attempt is kept. */
  record(path: string, previous: { previousExisted: boolean; previousContent: string | null }): void {
    const entries = this.files.get(path) ?? [];
    if (!entries.some((entry) => entry.attempt === this.attempt)) {
      entries.push({ attempt: this.attempt, ...previous });
      this.files.set(path, entries);
    }
  }

  /** The files the file tools changed during one attempt. */
  changedIn(attempt: number): string[] {
    return [...this.files]
      .filter(([, entries]) => entries.some((entry) => entry.attempt === attempt))
      .map(([path]) => path)
      .sort();
  }

  /** Every file the file tools changed this turn, with its state before the turn first changed it. */
  beforeTurn(): Array<[string, JournalEntry]> {
    return [...this.files].flatMap(([path, entries]) =>
      entries[0] ? [[path, entries[0]] as [string, JournalEntry]] : [],
    );
  }

  /**
   * The state a restore returns to: the file before the last evaluated attempt changed it (or before the
   * current one did, when the last attempt left it alone), or before the turn first changed it. Null when
   * the file tools have not changed it since that point.
   */
  before(path: string, to: RestorePoint): JournalEntry | null {
    const from = to === "before_turn" ? 0 : Math.max(0, this.attempt - 1);
    return this.files.get(path)?.find((entry) => entry.attempt >= from) ?? null;
  }
}
