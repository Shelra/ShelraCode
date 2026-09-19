import type { DemoTurn } from "./scripted-provider";

const FIX_AUTH_TURN_1: DemoTurn = [
  [
    {
      think:
        "The request names token refresh tests. Start by finding where refreshSession and isExpired are defined and how the tests exercise them, then run the suite to see the real failures. ",
    },
    { say: "I'll read the auth module and its tests first, to see what the refresh path is supposed to guarantee." },
    { call: "read_file", input: { path: ".agents/skills/release-notes/SKILL.md" }, ms: 200 },
    { call: "grep", input: { pattern: "refreshSession|isExpired", include: "*.ts" }, ms: 350 },
    { call: "read_file", input: { path: "src/auth.ts" }, ms: 250 },
    { call: "read_file", input: { path: "tests/auth.test.ts" }, ms: 250 },
  ],
  [{ call: "bash", input: { command: "bun test" }, ms: 900 }],
  [
    {
      think:
        "Two tests fail. The first expects now === expiresAt to count as expired, but the code uses a strict comparison. The second expects a new token after refresh, but the code reuses the old one. Both are small changes in src/auth.ts. ",
    },
    {
      say: "Two failures, both from `src/auth.ts`: `isExpired` treats the exact expiry instant as still valid, and `refreshSession` extends the expiry but keeps the old token.",
    },
    {
      call: "generate_plan",
      ms: 500,
      input: {
        title: "Fix session expiry and token rotation",
        summary: "Make expiry inclusive and rotate the token when a session is refreshed.",
        goal: "`bun test` passes and a refreshed session never reuses its old token.",
        requirements: [
          "A session is expired at its exact expiry time",
          "Refreshing inside the window issues a new token",
          "Public API of src/index.ts stays unchanged",
        ],
        acceptanceCriteria: [
          {
            id: "AC1",
            description: "A session is expired at its exact expiry time",
            verification: "bun test tests/auth.test.ts",
          },
          {
            id: "AC2",
            description: "Refreshing inside the window rotates the token",
            verification: "bun test tests/auth.test.ts",
          },
          { id: "AC3", description: "No other test regresses", verification: "bun test" },
        ],
        steps: [
          {
            title: "Make expiry inclusive",
            description: "Change the comparison in isExpired so now === expiresAt counts as expired.",
            filePaths: ["src/auth.ts"],
            satisfies: ["AC1"],
          },
          {
            title: "Rotate the token on refresh",
            description: "Add a token helper and use it in refreshSession.",
            filePaths: ["src/auth.ts", "src/token.ts"],
            satisfies: ["AC2"],
          },
          {
            title: "Run the full suite",
            description: "Confirm all tests pass and nothing else regressed.",
            satisfies: ["AC3"],
          },
        ],
      },
    },
  ],
  [
    { call: "update_plan_step", input: { index: 1, status: "working" }, ms: 80 },
    {
      call: "edit_file",
      input: {
        path: "src/auth.ts",
        old_string: "  return session.expiresAt < now;",
        new_string: "  return session.expiresAt <= now;",
      },
      ms: 500,
    },
    {
      call: "update_plan_step",
      input: { index: 1, status: "complete", evidence: "src/auth.ts: expiry is now inclusive" },
      ms: 80,
    },
  ],
  [
    { call: "update_plan_step", input: { index: 2, status: "working" }, ms: 80 },
    { say: "Rotation needs a fresh, unguessable token, so I'll add a small helper rather than inline it." },
    {
      call: "write_file",
      input: {
        path: "src/token.ts",
        content:
          'import { randomBytes } from "node:crypto";\n\nexport function rotateToken(): string {\n  return `tok_${randomBytes(12).toString("hex")}`;\n}\n',
      },
      ms: 450,
    },
    {
      call: "edit_file",
      input: {
        path: "src/auth.ts",
        old_string: "  return { ...session, token: session.token, expiresAt: now + SESSION_TTL_MS, refreshedAt: now };",
        new_string: "  return { ...session, token: rotateToken(), expiresAt: now + SESSION_TTL_MS, refreshedAt: now };",
      },
      ms: 450,
    },
    {
      call: "edit_file",
      input: {
        path: "src/auth.ts",
        old_string: "export interface Session {",
        new_string: 'import { rotateToken } from "./token";\n\nexport interface Session {',
      },
      ms: 350,
    },
    {
      call: "update_plan_step",
      input: { index: 2, status: "complete", evidence: "src/token.ts added; refreshSession rotates the token" },
      ms: 80,
    },
  ],
  [
    { call: "update_plan_step", input: { index: 3, status: "working" }, ms: 80 },
    { call: "bash", input: { command: "bun test" }, ms: 1100 },
    { call: "update_plan_step", input: { index: 3, status: "complete", evidence: "bun test: all tests pass" }, ms: 80 },
  ],
  [
    {
      say: [
        "Fixed both failures in `src/auth.ts`.",
        "",
        "## What changed",
        "",
        "- `isExpired` now treats `now === expiresAt` as expired (`<` became `<=`).",
        "- `refreshSession` rotates the token through the new `rotateToken()` helper in `src/token.ts`.",
        "",
        "## Verification",
        "",
        "`bun test` passes with the public exports of `src/index.ts` unchanged.",
        "",
        "```ts",
        "export function isExpired(session: Session, now = Date.now()): boolean {",
        "  return session.expiresAt <= now;",
        "}",
        "```",
        "",
        "Next I would add a regression test around the refresh boundary (`expiresAt - now === 5 min`).",
      ].join("\n"),
      pace: 10,
    },
  ],
];

const FIX_AUTH_TURN_2: DemoTurn = [
  [
    { say: "Adding a boundary test for the refresh window." },
    {
      call: "edit_file",
      input: {
        path: "tests/auth.test.ts",
        old_string: '  test("is true inside the refresh window", () => {',
        new_string: '  test("is false exactly one window before expiry", () => {',
      },
      ms: 400,
    },
  ],
  [
    {
      say: "That edit did not match — the file does not contain that test. Reading the test file to place it correctly.",
    },
    { call: "read_file", input: { path: "tests/auth.test.ts", start_line: 14, end_line: 24 }, ms: 250 },
  ],
  [
    {
      call: "edit_file",
      input: {
        path: "tests/auth.test.ts",
        old_string:
          '  test("is true inside the refresh window", () => {\n    expect(needsRefresh(base, 800_000)).toBe(true);\n  });',
        new_string:
          '  test("is true inside the refresh window", () => {\n    expect(needsRefresh(base, 800_000)).toBe(true);\n  });\n\n  test("is false when a full window remains", () => {\n    expect(needsRefresh(base, 700_000)).toBe(false);\n  });',
      },
      ms: 450,
    },
    { call: "bash", input: { command: "bun test" }, ms: 900 },
  ],
  [{ say: "Added `is false when a full window remains`; the suite is green." }],
];

const ERRORS: DemoTurn[] = [
  [
    [
      { say: "Let me look at the config loader." },
      { call: "read_file", input: { path: "src/config.ts" }, ms: 300 },
      {
        call: "edit_file",
        input: { path: "src/auth.ts", old_string: "this string does not exist", new_string: "x" },
        ms: 400,
      },
      { call: "bash", input: { command: "bun test tests/missing.test.ts" }, ms: 600 },
    ],
    [
      { say: "Trying the next route…" },
      { wait: 500 },
      { fail: "429 Too Many Requests — free-models-per-min limit reached for qwen/qwen3-coder:free" },
    ],
  ],
];

const MARKDOWN: DemoTurn[] = [
  [
    [
      {
        say: [
          "# Session lifecycle",
          "",
          "A session moves through **three** states. Refresh only applies to the `active` one.",
          "",
          "| State | Meaning | Transition |",
          "| --- | --- | --- |",
          "| `active` | Token is valid | refresh inside the 5 min window |",
          "| `expiring` | Inside the refresh window | rotate token |",
          "| `expired` | `now >= expiresAt` | re-authenticate |",
          "",
          "1. Read the session from the store",
          "2. Call `needsRefresh(session)`",
          "3. Persist the rotated session",
          "",
          "```ts",
          "const session = loadSession(userId);",
          "if (session && needsRefresh(session)) saveSession(refreshSession(session));",
          "```",
          "",
          "> Tokens are never logged; see AGENTS.md.",
          "",
          "See [the auth module](src/auth.ts) for details.",
        ].join("\n"),
        pace: 6,
      },
    ],
  ],
];

const PLAN_QUESTIONS: DemoTurn[] = [
  [
    [
      { say: "Before I touch anything I need two decisions." },
      {
        call: "generate_plan",
        ms: 400,
        input: {
          title: "Add session persistence",
          summary: "Persist sessions across restarts.",
          goal: "Sessions survive a process restart.",
          acceptanceCriteria: [
            { id: "AC1", description: "A saved session is loadable after restart", verification: "bun test" },
          ],
          steps: [
            {
              title: "Choose storage",
              description: "Pick a backend",
              filePaths: ["src/session-store.ts"],
              satisfies: ["AC1"],
            },
            { title: "Wire it in", description: "Replace the in-memory Map", satisfies: ["AC1"] },
          ],
          questions: [
            {
              id: "storage",
              header: "Storage",
              question: "Where should sessions be persisted?",
              type: "select",
              options: [
                { id: "sqlite", label: "SQLite file (bun:sqlite)" },
                { id: "json", label: "JSON file on disk" },
                { id: "redis", label: "Redis" },
              ],
            },
            { id: "ttl", header: "TTL", question: "How long should a persisted session live?", type: "text" },
          ],
        },
      },
    ],
  ],
];

const RICH: DemoTurn[] = [
  [
    [
      {
        say: [
          "# Session refresh",
          "",
          "The **refresh window** is *five minutes* long and lives in `src/auth.ts`. When a session is inside that window, `refreshSession` rotates the token; outside it the same session is returned untouched. See [the design note](https://example.com/design/sessions) for the reasoning.",
          "",
          "## What changed",
          "",
          "- `isExpired` now treats **now === expiresAt** as expired, which fixes the boundary case that `tests/auth.test.ts` was checking for and that used to fail silently in production",
          "  - the comparison is inclusive, so a session is invalid at the exact millisecond it expires",
          "  - `needsRefresh` is unchanged and still uses the five minute window",
          "- `refreshSession` rotates the token through the new `rotateToken()` helper",
          "",
          "## Steps to verify",
          "",
          "1. Run `bun test` and confirm **5 pass**",
          "2. Call `needsRefresh(session)` at the boundary and check that it returns `true`, then confirm the token changed after `refreshSession`",
          "3. Persist the rotated session with `saveSession`",
          "",
          "> Tokens are never logged; see AGENTS.md for the rule that applies everywhere in this codebase.",
          "",
          "---",
          "",
          "| State | Meaning | Next |",
          "| --- | --- | --- |",
          "| active | Token is valid | refresh inside the window |",
          "| expired | `now >= expiresAt` | re-authenticate |",
          "",
          "### Code",
          "",
          "```ts",
          "export function isExpired(session: Session, now = Date.now()): boolean {",
          "  return session.expiresAt <= now; // inclusive",
          "}",
          "```",
          "",
          "Add a regression test around the boundary next.",
        ].join("\n"),
        pace: 4,
      },
    ],
  ],
];

export const SCENARIOS: Record<string, DemoTurn[]> = {
  "fix-auth": [FIX_AUTH_TURN_1, FIX_AUTH_TURN_2],
  errors: ERRORS,
  markdown: MARKDOWN,
  rich: RICH,
  "plan-questions": PLAN_QUESTIONS,
};
