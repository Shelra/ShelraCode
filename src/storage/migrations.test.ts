import { describe, expect, it } from "vitest";
import type { SQLiteDatabase, SQLiteStatement } from "./db";
import { applyMigrations } from "./migrations";

describe("applyMigrations", () => {
  it("repairs missing recap columns when the database version is already current", () => {
    const db = new FakeDatabase(3, ["id", "workspace_id", "title", "model"]);

    applyMigrations(db);

    expect(db.sessionColumns).toEqual(
      new Set(["id", "workspace_id", "title", "model", "recap_text", "recap_model", "recap_updated_at"]),
    );
  });
});

class FakeDatabase implements SQLiteDatabase {
  readonly sessionColumns: Set<string>;
  readonly benchmarkRunColumns = new Set([
    "resolved_task_count",
    "resolved_rate",
    "failure_type",
    "leaderboard_eligible",
  ]);
  readonly benchmarkTaskColumns = new Set(["task_definition_json", "failure_type"]);

  constructor(
    private version: number,
    sessionColumns: string[],
  ) {
    this.sessionColumns = new Set(sessionColumns);
  }

  exec(sql: string): void {
    const match = sql.match(/ALTER TABLE (sessions|benchmark_runs|benchmark_task_results) ADD COLUMN ([a-z_]+) /);
    if (match?.[1]) {
      const columns =
        match[1] === "sessions"
          ? this.sessionColumns
          : match[1] === "benchmark_runs"
            ? this.benchmarkRunColumns
            : this.benchmarkTaskColumns;
      columns.add(match[2]!);
    }
  }

  prepare(sql: string): SQLiteStatement {
    if (sql === "PRAGMA table_info(sessions)") {
      return new FakeStatement(() => [...this.sessionColumns].map((name) => ({ name })));
    }
    if (sql === "PRAGMA table_info(benchmark_runs)") {
      return new FakeStatement(() => [...this.benchmarkRunColumns].map((name) => ({ name })));
    }
    if (sql === "PRAGMA table_info(benchmark_task_results)") {
      return new FakeStatement(() => [...this.benchmarkTaskColumns].map((name) => ({ name })));
    }

    throw new Error(`Unexpected SQL: ${sql}`);
  }

  pragma(query: string, options?: { simple?: boolean }): unknown {
    if (query === "user_version" && options?.simple) {
      return this.version;
    }

    const match = query.match(/^user_version = (\d+)$/);
    if (match?.[1]) {
      this.version = Number(match[1]);
      return undefined;
    }

    throw new Error(`Unexpected pragma: ${query}`);
  }

  transaction<T>(fn: () => T): () => T {
    return fn;
  }

  close(): void {}
}

class FakeStatement implements SQLiteStatement {
  constructor(private readonly allFn: () => unknown[]) {}

  run(): unknown {
    throw new Error("Unexpected run");
  }

  get(): unknown {
    throw new Error("Unexpected get");
  }

  all(): unknown[] {
    return this.allFn();
  }
}
