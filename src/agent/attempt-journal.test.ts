import { describe, expect, it } from "vitest";
import { AttemptJournal } from "./attempt-journal";

const state = (content: string | null) => ({ previousExisted: content !== null, previousContent: content });

describe("attempt journal", () => {
  it("keeps the state before the first change of each attempt", () => {
    const journal = new AttemptJournal();
    journal.record("src/a.ts", state("v0"));
    journal.record("src/a.ts", state("v0-edited"));
    journal.nextAttempt();
    journal.record("src/a.ts", state("v1"));
    journal.record("src/new.ts", state(null));

    expect(journal.current).toBe(1);
    expect(journal.changedIn(0)).toEqual(["src/a.ts"]);
    expect(journal.changedIn(1)).toEqual(["src/a.ts", "src/new.ts"]);
    expect(journal.before("src/a.ts", "before_turn")).toMatchObject({ attempt: 0, previousContent: "v0" });
  });

  it("restores to before the last evaluated attempt, which the current attempt may have changed further", () => {
    const journal = new AttemptJournal();
    journal.record("src/a.ts", state("v0"));
    journal.nextAttempt(); // attempt 0 evaluated and failed
    journal.record("src/a.ts", state("v1"));
    journal.nextAttempt(); // attempt 1 evaluated and failed: it is the last attempt now
    journal.record("src/a.ts", state("v2"));

    expect(journal.before("src/a.ts", "before_last_attempt")).toMatchObject({ attempt: 1, previousContent: "v1" });
    expect(journal.before("src/a.ts", "before_turn")).toMatchObject({ attempt: 0, previousContent: "v0" });
  });

  it("falls back to the current attempt when the last one left the file alone, and knows a file it never saw", () => {
    const journal = new AttemptJournal();
    journal.record("src/a.ts", state("v0"));
    journal.nextAttempt();
    journal.nextAttempt();
    journal.record("src/b.ts", state("b-before"));

    // src/a.ts was changed only in attempt 0: nothing changed it since before the last attempt.
    expect(journal.before("src/a.ts", "before_last_attempt")).toBeNull();
    expect(journal.before("src/b.ts", "before_last_attempt")).toMatchObject({ previousContent: "b-before" });
    expect(journal.before("src/never.ts", "before_turn")).toBeNull();
  });

  it("before the first evaluation, the last attempt is the turn so far", () => {
    const journal = new AttemptJournal();
    journal.record("src/created.ts", state(null));
    expect(journal.before("src/created.ts", "before_last_attempt")).toMatchObject({
      attempt: 0,
      previousExisted: false,
    });
  });
});
