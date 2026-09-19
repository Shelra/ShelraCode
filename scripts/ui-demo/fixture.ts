import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { projectMemoryScope, userMemoryScope, writeMemoryEntry } from "../../src/memory/store";

const FILES: Record<string, string> = {
  "package.json": JSON.stringify(
    { name: "acme-api", private: true, type: "module", scripts: { test: "bun test" } },
    null,
    2,
  ),
  "AGENTS.md": `# acme-api

Small session service. Conventions:

- TypeScript strict, no default exports.
- Tests live in \`tests/\` and run with \`bun test\`.
- Never log tokens.
`,
  "src/auth.ts": `export interface Session {
  userId: string;
  token: string;
  expiresAt: number;
  refreshedAt?: number;
}

const REFRESH_WINDOW_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;

export function isExpired(session: Session, now = Date.now()): boolean {
  return session.expiresAt < now;
}

export function needsRefresh(session: Session, now = Date.now()): boolean {
  return session.expiresAt - now < REFRESH_WINDOW_MS;
}

export function refreshSession(session: Session, now = Date.now()): Session {
  if (!needsRefresh(session, now)) return session;
  return { ...session, token: session.token, expiresAt: now + SESSION_TTL_MS, refreshedAt: now };
}
`,
  "src/session-store.ts": `import type { Session } from "./auth";

const sessions = new Map<string, Session>();

export function saveSession(session: Session): void {
  sessions.set(session.userId, session);
}

export function loadSession(userId: string): Session | undefined {
  return sessions.get(userId);
}
`,
  "src/index.ts": `export { isExpired, needsRefresh, refreshSession } from "./auth";
export { loadSession, saveSession } from "./session-store";
`,
  "tests/auth.test.ts": `import { describe, expect, test } from "bun:test";
import { isExpired, needsRefresh, refreshSession } from "../src/auth";

const base = { userId: "u_1", token: "tok_abc", expiresAt: 1_000_000 };

describe("isExpired", () => {
  test("is false before expiry", () => {
    expect(isExpired(base, 999_999)).toBe(false);
  });

  test("is true exactly at expiry", () => {
    expect(isExpired(base, 1_000_000)).toBe(true);
  });
});

describe("needsRefresh", () => {
  test("is true inside the refresh window", () => {
    expect(needsRefresh(base, 800_000)).toBe(true);
  });
});

describe("refreshSession", () => {
  test("returns the same session outside the window", () => {
    expect(refreshSession(base, 100_000)).toBe(base);
  });

  test("rotates the token inside the window", () => {
    const next = refreshSession(base, 900_000);
    expect(next.token).not.toBe(base.token);
    expect(next.expiresAt).toBeGreaterThan(base.expiresAt);
  });
});
`,
};

/** Writes the small demo project the scripted scenarios operate on. */
export function createFixture(dir: string): void {
  for (const [relative, content] of Object.entries(FILES)) {
    const target = join(dir, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
}

/** Seeds real memory entries and a project skill so the knowledge panel has something honest to show. */
export function seedKnowledge(dir: string): void {
  const project = projectMemoryScope(dir);
  writeMemoryEntry(project, {
    slug: "no-default-exports",
    title: "No default exports",
    hook: "Named exports only, everywhere",
    type: "conventions",
    description: "Code style stated in AGENTS.md",
    body: "Use named exports. Default exports make renames and auto-imports unreliable in this codebase.",
    source: "human",
    confidence: 1,
  });
  writeMemoryEntry(project, {
    slug: "tests-run-with-bun",
    title: "Tests run with bun test",
    hook: "bun test is the only test command; vitest is not installed",
    type: "testing",
    description: "How to run and verify tests here",
    body: "Run `bun test` from the repo root. Tests live in tests/ and import from ../src. A run takes about a second.",
    source: "observed",
    confidence: 0.9,
    relatedFiles: ["package.json", "tests/auth.test.ts"],
  });
  writeMemoryEntry(project, {
    slug: "session-ttl-one-hour",
    title: "Sessions live one hour",
    hook: "SESSION_TTL_MS is 60 minutes; the refresh window is 5",
    type: "architecture",
    description: "Session timing constants in src/auth.ts",
    body: "SESSION_TTL_MS = 60 min. REFRESH_WINDOW_MS = 5 min. isExpired and needsRefresh both depend on these.",
    source: "inference",
    confidence: 0.7,
    relatedFiles: ["src/auth.ts"],
  });
  writeMemoryEntry(userMemoryScope(), {
    slug: "answer-concisely",
    title: "Keep answers short",
    hook: "Prefers concise answers with the evidence first",
    type: "preference",
    description: "Standing preference stated by the user",
    body: "Lead with the result and the evidence; skip long preambles.",
    source: "human",
    confidence: 1,
  });
  const skill = join(dir, ".agents", "skills", "release-notes");
  mkdirSync(skill, { recursive: true });
  writeFileSync(
    join(skill, "SKILL.md"),
    [
      "---",
      "name: release-notes",
      "description: Drafts release notes from merged pull requests and git tags, grouped by change type.",
      "---",
      "",
      "Read `git log` since the last tag, group commits by type, and write RELEASE.md.",
      "",
    ].join("\n"),
    "utf8",
  );
}
