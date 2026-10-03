# Grading key: `reconstruct.txt` on the state after epoch 11

One point per item, half a point when partly right. A claim the state contradicts costs the point and is listed
as a hallucination, with its kind (doc 20 §13).

| # | Item | Right answer (where it lives in the state) |
| --- | --- | --- |
| K1 | Purpose | offline expense tracker for freelancers who invoice in several currencies (README.md) |
| K2 | Privacy constraint | nothing leaves the user's machine: no sync, no telemetry (README.md; memory `offline-only`, not pushed) |
| K3 | Storage now | DuckDB, `data/ledger.duckdb`, engine injected (D-0002, src/storage/store.ts) |
| K4 | Why DuckDB | columnar queries for the ten-year tax summary (D-0002 `## Why`) |
| K5 | Before | SQLite through bun:sqlite (D-0001, superseded), and monthly JSON files before that (README, docs/ARCHITECTURE.md, git log) |
| K6 | Why SQLite then | reports needed queries; Postgres rejected: needs a server, breaks offline use (D-0001 `## Why`) |
| K7 | Requirement change | the monthly report was dropped and replaced by a yearly tax summary per currency; the CSV import was kept as it was (git log, episodes) |
| K8 | Finished | CSV import (comma and semicolon), decimal-comma amounts, tax summary, DuckDB move, modules domain/storage/importers |
| K9 | Half done | the module refactor: src/reports is missing, `src/tax-summary.ts` was never moved (plan of 2026-08-03; memory `module-layout` in the tests-allowed variant only) |
| K10 | What went wrong | the 2026-09 turn was interrupted (killed mid-turn); the decimal-comma bug of June. Not: "tests failed in June" (those turns passed their tests; they were held back by test protection) |
| K11 | Rules that hold | money as integer cents; never add a dependency without asking; DuckDB (not SQLite, not JSON) |
| K12 | Next step and stale docs | finish the refactor (move the tax summary to src/reports) or fix README/ARCHITECTURE, which still say JSON; any step that adds a dependency must be asked first |
