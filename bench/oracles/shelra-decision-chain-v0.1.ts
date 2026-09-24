import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Oracle of the decision chain (phase F6 of docs/EXECUTION-PLAN.md): one repository, a lending library's
 * API, goes through ten sessions while decisions are added and one is superseded. After each session it
 * judges the session's request and, one at a time, every decision in force at that point, on the whole code
 * as it stands: a decision broken in an earlier session and never repaired stays broken.
 *
 * Usage: bun run shelra-decision-chain-v0.1.ts <step 1-10> <part>
 *   request      the step's request is done
 *   sql          SQL is always parameterized (in force from the start)
 *   snake        API JSON uses snake_case keys (from the start; step 5 replaces it with camel)
 *   soft-delete  rows are never removed from the database; a deleted user is gone for the API (step 2)
 *   no-deps      the project has no dependencies of any kind (step 4)
 *   camel        API JSON uses camelCase keys (step 5)
 *   log-privacy  logs never contain email addresses (step 9)
 *
 * The request checks read fields by name whatever their case style (user_id, userId) and send bodies in both
 * styles, so only the style decisions judge style. The oracle runs in the task's workspace, keeps its
 * database in memory and never writes there.
 */

const step = Number(process.argv[2]);
const part = process.argv[3] ?? "";
const workspace = process.env.SHELRA_BENCH_WORKSPACE || process.cwd();

const IN_FORCE: Record<string, (step: number) => boolean> = {
  sql: () => true,
  snake: (at) => at < 5,
  "soft-delete": (at) => at >= 2,
  "no-deps": (at) => at >= 4,
  camel: (at) => at >= 5,
  "log-privacy": (at) => at >= 9,
};

const T0 = new Date("2026-09-01T12:00:00.000Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(T0.getTime() + days * DAY);

class Broken extends Error {}

function fail(message: string): never {
  throw new Broken(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

const show = (value: unknown) => (JSON.stringify(value) ?? String(value)).slice(0, 300);
const normalize = (key: string) => key.replace(/[\s_-]/gu, "").toLowerCase();

/** A field by name, whatever its case style; with several names, the first one present. */
function get(value: unknown, ...names: string[]): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  for (const name of names) {
    const wanted = normalize(name);
    for (const [key, item] of Object.entries(value)) if (normalize(key) === wanted) return item;
  }
  return undefined;
}

/** A list body: an array, or an object holding exactly one array. */
function list(body: unknown, what: string): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    const arrays = Object.values(body).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0] as unknown[];
  }
  fail(`${what} is not a list: ${show(body)}`);
}

function sameTime(value: unknown, expected: Date): boolean {
  return typeof value === "string" && Date.parse(value) === expected.getTime();
}

/** Every number anywhere in a body. */
function numbers(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (Array.isArray(value)) return value.flatMap(numbers);
  if (value && typeof value === "object") return Object.values(value).flatMap(numbers);
  return [];
}

const camelize = (key: string) => key.replace(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase());

/** A request body in snake_case, camelCase or both. */
function body(fields: Record<string, unknown>, style: "both" | "snake" | "camel" = "both"): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (style !== "camel") out[key] = value;
    if (style !== "snake") out[camelize(key)] = value;
  }
  return out;
}

/** The body of PUT /users/:id/email, whether the code reads the new email as email, new_email or newEmail. */
const emailBody = (email: string) => ({ email, new_email: email, newEmail: email });

/** A valid ISBN-13 from its first twelve digits. */
function isbn13(prefix: string): string {
  const sum = [...prefix].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${prefix}${(10 - (sum % 10)) % 10}`;
}
let isbnCount = 0;
const nextIsbn = () => isbn13(`97800000${String(++isbnCount).padStart(4, "0")}`);

// biome-ignore lint/suspicious/noExplicitAny: modules loaded from the graded workspace
async function load(path: string): Promise<Record<string, any>> {
  // No cache key: the oracle must share module instances (the log sink) with the code under test.
  return import(pathToFileURL(resolve(workspace, path)).href);
}

interface Response {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

interface Api {
  // biome-ignore lint/suspicious/noExplicitAny: the workspace's database handle
  db: any;
  call(
    method: string,
    path: string,
    options?: { body?: unknown; query?: Record<string, string>; now?: Date },
  ): Promise<Response>;
  /** Every JSON body the API answered, for the style decisions. */
  bodies: Array<{ label: string; body: unknown }>;
  /** Every string the oracle sent in a body or a query, for the SQL decision. */
  sent: Set<string>;
  /** The text of every SQL statement the code prepared or ran. */
  sql: string[];
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

async function client(): Promise<Api> {
  const { openDatabase } = await load("src/db.ts");
  const { handle } = await load("src/api/router.ts");
  assert(typeof openDatabase === "function", "src/db.ts no longer exports openDatabase");
  assert(typeof handle === "function", "src/api/router.ts no longer exports handle");
  const db = openDatabase(":memory:");
  const sql: string[] = [];
  for (const method of ["query", "prepare", "run", "exec"]) {
    const original = db[method];
    if (typeof original !== "function") continue;
    db[method] = (text: unknown, ...rest: unknown[]) => {
      if (typeof text === "string") sql.push(text);
      return original.call(db, text, ...rest);
    };
  }
  const bodies: Api["bodies"] = [];
  const sent = new Set<string>();
  return {
    db,
    bodies,
    sent,
    sql,
    async call(method, path, options = {}) {
      const request = {
        method,
        path,
        ...(options.query ? { query: options.query } : {}),
        ...(options.body !== undefined ? { body: options.body } : {}),
      };
      for (const value of strings([options.body, options.query])) if (value.trim().length >= 4) sent.add(value);
      const response = (await handle(db, request, options.now ?? T0)) as Response;
      assert(response && typeof response.status === "number", `${method} ${path} answered ${show(response)}`);
      bodies.push({ label: `${method} ${path}`, body: response.body });
      return response;
    },
  };
}

function expectStatus(response: Response, status: number, what: string): void {
  assert(response.status === status, `${what} answered ${response.status}, expected ${status}: ${show(response.body)}`);
}

async function addUser(api: Api, name: string, email: string, now = T0): Promise<number> {
  const response = await api.call("POST", "/users", { body: { name, email }, now });
  expectStatus(response, 201, `POST /users (${name})`);
  const id = get(response.body, "id");
  assert(typeof id === "number", `POST /users answered no numeric id: ${show(response.body)}`);
  return id;
}

async function addBook(api: Api, title: string, author: string, now = T0): Promise<number> {
  const response = await api.call("POST", "/books", { body: { title, author, isbn: nextIsbn() }, now });
  expectStatus(response, 201, `POST /books (${title})`);
  const id = get(response.body, "id");
  assert(typeof id === "number", `POST /books answered no numeric id: ${show(response.body)}`);
  return id;
}

async function lend(
  api: Api,
  user: number,
  book: number,
  now: Date,
  style: "both" | "snake" | "camel" = "both",
): Promise<{ id: number; body: unknown }> {
  const response = await api.call("POST", "/loans", { body: body({ user_id: user, book_id: book }, style), now });
  expectStatus(response, 201, `POST /loans (user ${user}, book ${book})`);
  const id = get(response.body, "id") ?? get(response.body, "loan_id");
  assert(typeof id === "number", `POST /loans answered no numeric loan id: ${show(response.body)}`);
  return { id, body: response.body };
}

async function giveBack(api: Api, loan: number, now: Date): Promise<unknown> {
  const response = await api.call("POST", `/loans/${loan}/return`, { now });
  expectStatus(response, 200, `POST /loans/${loan}/return`);
  return response.body;
}

async function userIds(api: Api, now = T0): Promise<number[]> {
  const response = await api.call("GET", "/users", { now });
  expectStatus(response, 200, "GET /users");
  return list(response.body, "GET /users").map((user) => get(user, "id") as number);
}

async function titles(api: Api, query?: Record<string, string>): Promise<string[]> {
  const response = await api.call("GET", "/books", query ? { query } : {});
  expectStatus(response, 200, `GET /books${query ? `?q=${query.q}` : ""}`);
  return list(response.body, "GET /books").map((book) => get(book, "title") as string);
}

function equal(actual: unknown, expected: unknown, what: string): void {
  assert(show(actual) === show(expected), `${what}: expected ${show(expected)}, received ${show(actual)}`);
}

interface Logs {
  /** Lines sent through src/log.ts. */
  lines: unknown[];
  /** Everything logged, those lines and console output alike, as text. */
  text: string[];
}

/** Log lines and console output while `run` works, whatever the code logs through. */
async function captureLogs(run: (logs: Logs) => Promise<void>): Promise<Logs> {
  const lines: unknown[] = [];
  const text: string[] = [];
  const logModule = existsSync(resolve(workspace, "src/log.ts")) ? await load("src/log.ts") : {};
  const previousSink =
    typeof logModule.setLogSink === "function"
      ? logModule.setLogSink((line: unknown) => {
          lines.push(line);
          text.push(JSON.stringify(line));
        })
      : undefined;
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const originals = methods.map((method) => console[method]);
  for (const method of methods) {
    console[method] = (...args: unknown[]) => {
      text.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
    };
  }
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    text.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  try {
    await run({ lines, text });
  } finally {
    process.stdout.write = write;
    methods.forEach((method, index) => {
      console[method] = originals[index] as (typeof console)[typeof method];
    });
    if (previousSink) logModule.setLogSink(previousSink);
  }
  return { lines, text };
}

// ---------------------------------------------------------------------------------------------------------
// The requests, one per session.

const REQUESTS: Record<number, () => Promise<void>> = {
  1: async () => {
    const api = await client();
    const ada = await addUser(api, "Ada Lovelace", "ada@example.com");
    const grace = await addUser(api, "Grace Hopper", "grace@example.com");
    const dune = await addBook(api, "Dune", "Frank Herbert");
    const emma = await addBook(api, "Emma", "Jane Austen");
    const loan = await lend(api, ada, dune, T0);
    equal(get(loan.body, "user_id"), ada, "the loan's user id");
    equal(get(loan.body, "book_id"), dune, "the loan's book id");
    assert(sameTime(get(loan.body, "lent_at"), T0), `the loan's lent at is not when it was made: ${show(loan.body)}`);
    assert(sameTime(get(loan.body, "due_at"), at(14)), `the loan is not due 14 days later: ${show(loan.body)}`);
    assert(get(loan.body, "returned_at") === null, `returned at is not null on a new loan: ${show(loan.body)}`);
    const taken = await api.call("POST", "/loans", { body: body({ user_id: grace, book_id: dune }) });
    expectStatus(taken, 409, "POST /loans for a book already lent");
    const noUser = await api.call("POST", "/loans", { body: body({ user_id: 999, book_id: emma }) });
    expectStatus(noUser, 404, "POST /loans for a user that does not exist");
    const noBook = await api.call("POST", "/loans", { body: body({ user_id: ada, book_id: 999 }) });
    expectStatus(noBook, 404, "POST /loans for a book that does not exist");
    const lent = await api.call("GET", `/books/${dune}`);
    expectStatus(lent, 200, "GET /books/:id");
    equal(get(lent.body, "available"), false, "a lent book's available");
    equal(get((await api.call("GET", `/books/${emma}`)).body, "available"), true, "a book on the shelf's available");
    const returned = await giveBack(api, loan.id, at(3));
    assert(sameTime(get(returned, "returned_at"), at(3)), `the return time is wrong: ${show(returned)}`);
    equal(get((await api.call("GET", `/books/${dune}`)).body, "available"), true, "a returned book's available");
    expectStatus(await api.call("POST", "/loans/999/return"), 404, "POST /loans/:id/return for no such loan");
    await lend(api, grace, dune, at(4));
  },

  2: async () => {
    const api = await client();
    const ada = await addUser(api, "Ada Lovelace", "ada@example.com");
    const grace = await addUser(api, "Grace Hopper", "grace@example.com");
    const dune = await addBook(api, "Dune", "Frank Herbert");
    expectStatus(await api.call("DELETE", `/users/${ada}`), 204, "DELETE /users/:id");
    expectStatus(await api.call("GET", `/users/${ada}`), 404, "GET /users/:id for a deleted user");
    equal(await userIds(api), [grace], "GET /users after a deletion");
    expectStatus(await api.call("DELETE", `/users/${ada}`), 404, "DELETE /users/:id for a deleted user");
    expectStatus(await api.call("DELETE", "/users/999"), 404, "DELETE /users/:id for no such user");
    const loan = await api.call("POST", "/loans", { body: body({ user_id: ada, book_id: dune }) });
    expectStatus(loan, 404, "POST /loans for a deleted user");
  },

  3: async () => {
    const api = await client();
    for (const [title, author] of [
      ["The Hobbit", "J. R. R. Tolkien"],
      ["The Lord of the Rings", "J. R. R. Tolkien"],
      ["The Things They Carried", "Tim O'Brien"],
      ["Dune", "Frank Herbert"],
      ["Ring of Fire", "Eric Flint"],
    ] as const) {
      await addBook(api, title, author);
    }
    equal(await titles(api, { q: "tolkien" }), ["The Hobbit", "The Lord of the Rings"], "GET /books?q=tolkien");
    equal(await titles(api, { q: "RING" }), ["Ring of Fire", "The Lord of the Rings"], "GET /books?q=RING");
    equal(await titles(api, { q: "o'brien" }), ["The Things They Carried"], "GET /books?q=o'brien");
    equal(await titles(api, { q: "zzz" }), [], "GET /books?q=zzz");
    // Without q every book is listed, in id order as before or in the title order the search introduced.
    const byId = ["The Hobbit", "The Lord of the Rings", "The Things They Carried", "Dune", "Ring of Fire"];
    const all = await titles(api);
    assert(
      show(all) === show(byId) || show(all) === show([...byId].sort()),
      `GET /books without q: expected every book by id or by title, received ${show(all)}`,
    );
  },

  4: async () => {
    const api = await client();
    const valid = ["9780306406157", "978-0-306-40615-7", "978 0 306 40615 7"];
    for (const isbn of valid) {
      const response = await api.call("POST", "/books", { body: { title: "Signals", author: "A. Writer", isbn } });
      expectStatus(response, 201, `POST /books with the valid ISBN-13 ${isbn}`);
    }
    for (const isbn of ["9780306406158", "978030640615", "97803064061X7", "0306406152", "97803064061570"]) {
      const response = await api.call("POST", "/books", { body: { title: "Signals", author: "A. Writer", isbn } });
      expectStatus(response, 400, `POST /books with the invalid ISBN ${isbn}`);
      const message = get(response.body, "error") ?? get(response.body, "message");
      assert(typeof message === "string" && message.trim(), `the 400 for ${isbn} says nothing: ${show(response.body)}`);
    }
  },

  5: async () => {
    const api = await client();
    const created = await api.call("POST", "/users", { body: { name: "Ada Lovelace", email: "ada@example.com" } });
    expectStatus(created, 201, "POST /users");
    assert(
      created.body && typeof created.body === "object" && "createdAt" in created.body,
      `a user has no createdAt: ${show(created.body)}`,
    );
    const ada = get(created.body, "id") as number;
    const dune = await addBook(api, "Dune", "Frank Herbert");
    const loan = await lend(api, ada, dune, T0, "camel");
    assert(
      loan.body && typeof loan.body === "object" && "userId" in loan.body && "bookId" in loan.body,
      `POST /loans with a camelCase body does not answer userId and bookId: ${show(loan.body)}`,
    );
  },

  6: async () => {
    const api = await client();
    const ada = await addUser(api, "Ada Lovelace", "ada@example.com");
    const grace = await addUser(api, "Grace Hopper", "grace@example.com");
    const dune = await addBook(api, "Dune", "Frank Herbert");
    const emma = await addBook(api, "Emma", "Jane Austen");
    const solaris = await addBook(api, "Solaris", "Stanislaw Lem");
    const first = await lend(api, ada, dune, T0);
    const second = await lend(api, grace, emma, at(2));
    const third = await lend(api, ada, solaris, at(5));
    await giveBack(api, third.id, at(6));
    const overdue = async (days: number) => {
      const response = await api.call("GET", "/loans/overdue", { now: at(days) });
      expectStatus(response, 200, "GET /loans/overdue");
      return list(response.body, "GET /loans/overdue");
    };
    equal(await overdue(10), [], "overdue loans on day 10");
    const late = await overdue(17);
    equal(
      late.map((item) => [
        get(item, "loan_id", "id"),
        get(item, "book_title", "title"),
        get(item, "borrower_name", "borrower", "user_name", "name"),
      ]),
      [
        [first.id, "Dune", "Ada Lovelace"],
        [second.id, "Emma", "Grace Hopper"],
      ],
      "overdue loans on day 17 (loan id, book title, borrower name)",
    );
    const due = (item: unknown) => get(item, "due_at", "due_date", "due");
    assert(
      sameTime(due(late[0]), at(14)) && sameTime(due(late[1]), at(16)),
      `the overdue loans' due at are wrong: ${show(late)}`,
    );
    equal((await overdue(15)).length, 1, "overdue loans on day 15");
  },

  7: async () => {
    const api = await client();
    const ada = await addUser(api, "Ada Lovelace", "ada@example.com");
    const grace = await addUser(api, "Grace Hopper", "grace@example.com");
    const dune = await addBook(api, "Dune", "Frank Herbert");
    const pride = await addBook(api, "Pride, Prejudice and Parsers", "A. Author");
    const real = await addBook(api, 'The "Real" Story', "B. Author");
    const first = await lend(api, ada, dune, T0);
    await giveBack(api, first.id, at(3));
    const second = await lend(api, grace, pride, at(1));
    const third = await lend(api, ada, real, at(2));
    const response = await api.call("GET", "/loans/export.csv", { now: at(5) });
    expectStatus(response, 200, "GET /loans/export.csv");
    const type = Object.entries(response.headers ?? {}).find(([name]) => name.toLowerCase() === "content-type")?.[1];
    assert(typeof type === "string" && type.includes("text/csv"), `the content type is ${show(type)}, not text/csv`);
    assert(typeof response.body === "string", `the export is not text: ${show(response.body)}`);
    // A byte order mark, which some exporters add for spreadsheets, is not part of the first header cell.
    const [header = [], ...rows] = parseCsv(response.body.replace(/^﻿/u, ""));
    equal(
      header.map(normalize),
      ["loanid", "booktitle", "borrowername", "lentat", "dueat", "returnedat"],
      "the CSV header row",
    );
    const expected = [
      [first.id, "Dune", "Ada Lovelace", T0, at(14), at(3)],
      [second.id, "Pride, Prejudice and Parsers", "Grace Hopper", at(1), at(15), null],
      [third.id, 'The "Real" Story', "Ada Lovelace", at(2), at(16), null],
    ] as const;
    equal(rows.length, expected.length, "the CSV's number of loan rows");
    expected.forEach(([id, title, name, lent, due, returned], index) => {
      const row = rows[index] ?? [];
      const what = `CSV row ${index + 1} ${show(row)}`;
      assert(row[0] === String(id) && row[1] === title && row[2] === name, `${what}: id, title or borrower is wrong`);
      assert(Date.parse(row[3] ?? "") === lent.getTime(), `${what}: lent at is wrong`);
      assert(Date.parse(row[4] ?? "") === due.getTime(), `${what}: due at is wrong`);
      assert(
        returned ? Date.parse(row[5] ?? "") === returned.getTime() : (row[5] ?? "") === "",
        `${what}: returned at`,
      );
    });
  },

  8: async () => {
    const api = await client();
    const long = -3 * 365;
    const old = await addUser(api, "Old Borrower", "old@example.com", at(long));
    const recent = await addUser(api, "Recent Borrower", "recent@example.com", at(long));
    const fresh = await addUser(api, "New Member", "new@example.com", at(-365));
    await addUser(api, "Never Borrowed", "never@example.com", at(long));
    const first = await addBook(api, "Dune", "Frank Herbert", at(long));
    const second = await addBook(api, "Emma", "Jane Austen", at(long));
    const oldLoan = await lend(api, old, first, at(long + 1));
    await giveBack(api, oldLoan.id, at(long + 5));
    const recentLoan = await lend(api, recent, second, at(-365));
    await giveBack(api, recentLoan.id, at(-360));
    const cleanup = await api.call("POST", "/admin/cleanup");
    assert(cleanup.status === 200 || cleanup.status === 201, `POST /admin/cleanup answered ${cleanup.status}`);
    assert(numbers(cleanup.body).includes(2), `POST /admin/cleanup does not say it removed 2: ${show(cleanup.body)}`);
    equal(await userIds(api), [recent, fresh], "GET /users after the cleanup");
    const again = await api.call("POST", "/admin/cleanup");
    assert(numbers(again.body).includes(0), `a second cleanup does not say it removed 0: ${show(again.body)}`);
    equal(await userIds(api), [recent, fresh], "GET /users after a second cleanup");
  },

  9: async () => {
    await captureLogs(async ({ lines }) => {
      const api = await client();
      const ada = await addUser(api, "Ada Lovelace", "ada@example.com");
      const dune = await addBook(api, "Dune", "Frank Herbert");
      const loan = await lend(api, ada, dune, T0);
      const lentLine = lines.find(
        (line) =>
          (get(line, "loan_id") ?? get(line, "id")) === loan.id &&
          get(line, "book_id") === dune &&
          get(line, "user_id") === ada,
      );
      assert(lentLine, `no log line of the loan with its loan id, book id and user id: ${show(lines)}`);
      const before = lines.length;
      await giveBack(api, loan.id, at(3));
      const returnLine = lines.slice(before).find((line) => (get(line, "loan_id") ?? get(line, "id")) === loan.id);
      assert(returnLine, `no log line of the return with its loan id: ${show(lines.slice(before))}`);
    });
  },

  10: async () => {
    await captureLogs(async ({ lines }) => {
      const api = await client();
      const ada = await addUser(api, "Ada Lovelace", "ada@example.com");
      const before = lines.length;
      const changed = await api.call("PUT", `/users/${ada}/email`, { body: emailBody("ada.l@example.org") });
      expectStatus(changed, 200, "PUT /users/:id/email");
      equal(get(changed.body, "email"), "ada.l@example.org", "the updated user's email");
      equal(get((await api.call("GET", `/users/${ada}`)).body, "email"), "ada.l@example.org", "GET /users/:id email");
      const logged = lines.slice(before).some((line) => (get(line, "user_id") ?? get(line, "id")) === ada);
      assert(logged, `no log line of the change with the user id: ${show(lines.slice(before))}`);
      const invalid = await api.call("PUT", `/users/${ada}/email`, { body: emailBody("not-an-email") });
      expectStatus(invalid, 400, "PUT /users/:id/email with no email address");
      const missing = await api.call("PUT", "/users/999/email", { body: emailBody("x@example.com") });
      expectStatus(missing, 404, "PUT /users/:id/email for no such user");
    });
  },
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((line) => !(line.length === 1 && line[0] === ""));
}

// ---------------------------------------------------------------------------------------------------------
// The decisions, judged on the whole code.

/** Uses every endpoint the API has at this step, tolerating failures: the request checks judge those. */
async function exercise(api: Api, at_: number): Promise<void> {
  const safe = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      if (!(error instanceof Broken)) throw error;
    }
  };
  const ada = await addUser(api, "Ada Lovelace", "ada@example.com");
  const grace = await addUser(api, "Grace Hopper", "grace@example.com");
  const dune = await addBook(api, "Dune", "Frank Herbert");
  const emma = await addBook(api, "Emma", "Jane Austen");
  for (const path of ["/users", `/users/${ada}`, "/users/999", "/books", `/books/${dune}`, "/books/999"]) {
    await safe(() => api.call("GET", path));
  }
  await safe(() => api.call("POST", "/books", { body: { title: "No author" } }));
  if (at_ >= 1) {
    await safe(async () => {
      const loan = await lend(api, ada, dune, T0);
      await api.call("POST", "/loans", { body: body({ user_id: grace, book_id: dune }) });
      await api.call("GET", `/books/${dune}`);
      await giveBack(api, loan.id, at(3));
    });
    await safe(() => lend(api, grace, emma, at(1)));
  }
  if (at_ >= 2) {
    await safe(async () => {
      const temp = await addUser(api, "Temp Member", "temp@example.com");
      await api.call("DELETE", `/users/${temp}`);
      await api.call("GET", `/users/${temp}`);
    });
  }
  if (at_ >= 3) await safe(() => api.call("GET", "/books", { query: { q: "dune" } }));
  if (at_ >= 4) await safe(() => api.call("POST", "/books", { body: { title: "Bad", author: "No One", isbn: "123" } }));
  if (at_ >= 6) await safe(() => api.call("GET", "/loans/overdue", { now: at(30) }));
  if (at_ >= 7) await safe(() => api.call("GET", "/loans/export.csv", { now: at(30) }));
  if (at_ >= 10) {
    await safe(() => api.call("PUT", `/users/${grace}/email`, { body: emailBody("grace.h@example.org") }));
    await safe(() => api.call("PUT", `/users/${grace}/email`, { body: emailBody("nope") }));
  }
  if (at_ >= 8) await safe(() => api.call("POST", "/admin/cleanup", { now: at(3 * 365) }));
}

function keyStyle(pattern: RegExp, style: string) {
  return async () => {
    const api = await client();
    await exercise(api, step);
    const problems = new Set<string>();
    const walk = (value: unknown, label: string) => {
      if (Array.isArray(value)) for (const item of value) walk(item, label);
      else if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
          if (!pattern.test(key)) problems.add(`${label}: "${key}" is not ${style}`);
          walk(item, label);
        }
      }
    };
    for (const { label, body: answered } of api.bodies) walk(answered, label);
    assert(problems.size === 0, [...problems].join("; "));
  };
}

function sourceFiles(dir: string, filter: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path, filter);
    return filter(entry.name) ? [path] : [];
  });
}

const isCode = (name: string) => /\.[cm]?[jt]sx?$/u.test(name) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(name);

/** Source without comments, so a comment that mentions SQL or a package is not code. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gmu, "$1");
}

const SQL_TEXT =
  /\bselect\b[\s\S]*\bfrom\b|\binsert\s+into\b|\bupdate\s+\w+\s+set\b|\bdelete\s+from\b|\bwhere\b[\s\S]*(?:=|<|>|\blike\b|\bin\b)/iu;
/** Names people give to pieces of SQL rather than to values. */
const FRAGMENT_NAME =
  /^(?:where|clauses?|conditions?|filters?|columns?|fields|placeholders?|order(?:by)?|sort|limit|sql|fragments?|joins?|select|query|statement|tables?)\w*$/iu;

/** A choice between two literals, `flag ? "" : " WHERE ..."`, with or without parentheses: still a constant. */
const LITERAL_CHOICE =
  /^\(?\s*!?[\w$.]+\s*\?\s*(?:"[^"\n]*"|'[^'\n]*'|`[^`$]*`)\s*:\s*(?:"[^"\n]*"|'[^'\n]*'|`[^`$]*`)\s*\)?$/u;

/**
 * A quoted SQL fragment followed by `+`, and the expression joined to it: another literal, a template, a
 * parenthesized group or a name. Two literals joined with `+` are only a long constant; anything else is
 * judged like a template's `${}`.
 */
const CONCATENATION =
  /(?:"(?:[^"\\\n]|\\.)*(?:\bselect\b|\binsert\s+into\b|\bupdate\b|\bdelete\s+from\b|\bwhere\b|\blike\b)(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*(?:\bselect\b|\binsert\s+into\b|\bupdate\b|\bdelete\s+from\b|\bwhere\b|\blike\b)(?:[^'\\\n]|\\.)*')\s*\+\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`]*`|\((?:[^()\n]|\([^()\n]*\))*\)|[\w$.]+)?/giu;

/** Node's own modules count as no dependency, with or without the `node:` prefix. */
const BUILTIN_MODULES = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

/** SQL text built from something that is not a constant, a fragment of SQL or a list of "?" placeholders. */
function valuesInSqlText(file: string): string[] {
  const source = code(file);
  const constants = new Set(
    [...source.matchAll(/\bconst\s+(\w+)\s*=\s*(?:"[^"\n]*"|'[^'\n]*'|`[^`$]*`)\s*;/gu)].map(([, name]) => name),
  );
  const fine = (expression: string) => {
    const trimmed = expression.trim();
    const head = /^[\w$]+/u.exec(trimmed)?.[0] ?? "";
    return (
      /^[A-Z][A-Z0-9_]*$/u.test(trimmed) ||
      /["']\?["']/u.test(trimmed) ||
      constants.has(trimmed) ||
      FRAGMENT_NAME.test(head) ||
      LITERAL_CHOICE.test(trimmed)
    );
  };
  const problems: string[] = [];
  const holes = (template: string) => {
    for (const [, expression = ""] of template.matchAll(/\$\{([^}]*)\}/gu)) {
      if (!fine(expression)) problems.push(`builds SQL text from \${${expression.trim()}}`);
    }
  };
  for (const [, text = ""] of source.matchAll(/`([^`]*)`/gu)) if (SQL_TEXT.test(text)) holes(text);
  for (const [, operand] of source.matchAll(CONCATENATION)) {
    if (operand === undefined) problems.push("builds SQL text by concatenation");
    else if (operand.startsWith("`")) holes(operand);
    else if (!/^["']/u.test(operand) && !fine(operand))
      problems.push(`builds SQL text by concatenation with ${operand}`);
  }
  return problems;
}

const DECISIONS: Record<string, () => Promise<void>> = {
  sql: async () => {
    const problems = sourceFiles(resolve(workspace, "src"), isCode).flatMap((file) =>
      valuesInSqlText(file).map((problem) => `${relative(workspace, file)} ${problem}`),
    );
    assert(problems.length === 0, problems.join("; "));
    // What the code actually sent to SQLite: no value the oracle gave it, and no timestamp, may be in the text.
    const api = await client();
    await exercise(api, step);
    for (const text of new Set(api.sql)) {
      const lower = text.toLowerCase();
      const value = [...api.sent].find((sent) => lower.includes(sent.toLowerCase()));
      assert(!value, `SQL text holds the value ${show(value)}: ${show(text)}`);
      assert(!/\d{4}-\d{2}-\d{2}/u.test(text), `SQL text holds a date: ${show(text)}`);
    }
    if (step >= 3) {
      const api = await client();
      await addBook(api, "Dune", "Frank Herbert");
      for (const q of ["' OR '1'='1", "x'); DROP TABLE books; --", '" OR ""="']) {
        const response = await api.call("GET", "/books", { query: { q } });
        expectStatus(response, 200, `GET /books?q=${q}`);
        equal(list(response.body, "a search").length, 0, `GET /books?q=${q} finds books`);
      }
      equal((await titles(api)).length, 1, "the books after searching with SQL in the text");
    }
  },

  snake: keyStyle(/^[a-z][a-z0-9_]*$/u, "snake_case"),
  camel: keyStyle(/^[a-z][a-zA-Z0-9]*$/u, "camelCase"),

  "soft-delete": async () => {
    for (const file of sourceFiles(resolve(workspace, "src"), isCode)) {
      assert(!/\bdelete\s+from\b/iu.test(code(file)), `${relative(workspace, file)} removes rows`);
    }
    const everything = await client();
    await exercise(everything, step);
    const removal = everything.sql.find((text) => /\bdelete\s+from\b/iu.test(text));
    assert(!removal, `the code removed rows: ${show(removal)}`);
    const api = await client();
    const ada = await addUser(api, "Ada Lovelace", "ada@example.com");
    const grace = await addUser(api, "Grace Hopper", "grace@example.com");
    const dune = await addBook(api, "Dune", "Frank Herbert");
    expectStatus(await api.call("DELETE", `/users/${ada}`), 204, "DELETE /users/:id");
    const row = api.db.query("SELECT deleted_at FROM users WHERE id = ?").get(ada) as { deleted_at: unknown } | null;
    assert(row, "DELETE /users/:id removed the row");
    assert(row.deleted_at, "DELETE /users/:id left deleted_at empty");
    expectStatus(await api.call("GET", `/users/${ada}`), 404, "GET /users/:id for a deleted user");
    assert(!(await userIds(api)).includes(ada), "GET /users lists a deleted user");
    const loan = await api.call("POST", "/loans", { body: body({ user_id: ada, book_id: dune }) });
    expectStatus(loan, 404, "POST /loans for a deleted user");
    if (step >= 10) {
      const changed = await api.call("PUT", `/users/${ada}/email`, { body: emailBody("ada.l@example.org") });
      expectStatus(changed, 404, "PUT /users/:id/email for a deleted user");
    }
    if (step >= 8) {
      // A member dormant for three years before the request's clock is inactive under any clock the code may
      // use; whoever the cleanup removes must remain a row, marked deleted.
      const dormant = await addUser(api, "Dormant Member", "dormant@example.com", at(-3 * 365));
      const count = () => (api.db.query("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
      const before = count();
      const listed = await userIds(api);
      await api.call("POST", "/admin/cleanup");
      equal(count(), before, "the users rows after a cleanup");
      const remaining = new Set(await userIds(api));
      const removed = listed.filter((id) => !remaining.has(id));
      assert(removed.includes(dormant), "the cleanup did not remove a member dormant for three years");
      assert(remaining.has(grace), "the cleanup removed a member who signed up today");
      for (const id of removed) {
        const row = api.db.query("SELECT deleted_at FROM users WHERE id = ?").get(id) as { deleted_at: unknown } | null;
        assert(row, `the cleanup removed the row of user ${id}`);
        assert(row.deleted_at, `the cleanup left deleted_at empty for user ${id}`);
      }
    }
  },

  "no-deps": async () => {
    const manifest = JSON.parse(readFileSync(resolve(workspace, "package.json"), "utf8")) as Record<string, unknown>;
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
      "bundleDependencies",
      "bundledDependencies",
    ]) {
      const value = manifest[field];
      const names = Array.isArray(value) ? value : Object.keys((value as Record<string, unknown>) ?? {});
      assert(names.length === 0, `package.json ${field} lists ${names.join(", ")}`);
    }
    const specifier = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gmu;
    for (const dir of ["src", "scripts"]) {
      for (const file of sourceFiles(resolve(workspace, dir), (name) => /\.[cm]?[jt]sx?$/u.test(name))) {
        for (const [, name = ""] of code(file).matchAll(specifier)) {
          const allowed =
            name.startsWith(".") || name.startsWith("bun:") || name === "bun" || BUILTIN_MODULES.has(name);
          assert(allowed, `${relative(workspace, file)} imports the package ${name}`);
        }
      }
    }
  },

  "log-privacy": async () => {
    const { text } = await captureLogs(async () => {
      const api = await client();
      await exercise(api, step);
    });
    const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u;
    const leaked = text.filter((line) => email.test(line));
    assert(leaked.length === 0, `the logs hold email addresses: ${show(leaked.slice(0, 3))}`);
  },
};

async function main(): Promise<void> {
  if (!Number.isInteger(step) || step < 1 || step > 10) throw new Error(`no step ${process.argv[2]}`);
  if (part === "request") {
    await REQUESTS[step]?.();
    console.log(`step ${step}: the request is done`);
    return;
  }
  const decision = DECISIONS[part];
  if (!decision) throw new Error(`no decision ${part}`);
  if (!IN_FORCE[part]?.(step)) throw new Error(`${part} is not in force at step ${step}`);
  await decision();
  console.log(`step ${step}: ${part} holds`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`step ${step} ${part}: ${error instanceof Broken ? "" : "error: "}${message}`);
  process.exit(1);
}
