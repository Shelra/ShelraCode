import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMemoryContext, detectStaleness, noteWhenNothingMatches, rankMemories } from "./retrieval";
import { listMemoryRecords, projectMemoryScope, recordMemoryUse, writeMemoryEntry } from "./store";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "shelra-memory-retrieval-"));
  mkdirSync(join(workspace, "src"), { recursive: true });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function seed(): void {
  const scope = projectMemoryScope(workspace);
  writeMemoryEntry(scope, {
    slug: "bun-test-preload",
    title: "Tests need the preload script",
    hook: "bun test needs --preload ./test/setup.ts or fixtures fail",
    type: "testing",
    description: "The test runner requires a preload script",
    body: "Run `bun test --preload ./test/setup.ts`; without it every fixture import fails with ENOENT.",
    source: "observed",
    confidence: 0.9,
    relatedFiles: ["test/setup.ts"],
    tags: ["bun", "tests"],
  });
  writeMemoryEntry(scope, {
    slug: "config-loader-normalizes-host",
    title: "Config loader trims HOST",
    hook: "loadConfig in src/config.ts trims HOST and falls back to 127.0.0.1",
    type: "important-codepaths",
    description: "Where host normalization lives",
    body: "src/config.ts `loadConfig` trims HOST; a blank HOST falls back to the default. Do not duplicate this in callers.",
    source: "inference",
    confidence: 0.7,
    relatedFiles: ["src/config.ts"],
  });
  writeMemoryEntry(scope, {
    slug: "user-prefers-spanish",
    title: "User prefers Spanish replies",
    hook: "Answer in Spanish when the user writes in Spanish",
    type: "preference",
    description: "Language preference",
    body: "The user instructed: answer in Spanish when they write in Spanish. Keep code and identifiers unchanged.",
    source: "human",
    confidence: 1,
  });
}

describe("memory retrieval", () => {
  it("ranks by lexical relevance, path overlap, and provenance", () => {
    seed();
    const records = listMemoryRecords(projectMemoryScope(workspace));
    const ranked = rankMemories(
      records,
      { text: "Fix the failing tests: bun test cannot find fixtures", paths: ["test/setup.ts"] },
      workspace,
    );
    expect(ranked[0]?.record.slug).toBe("bun-test-preload");
    expect(ranked[0]?.relevance).toBeGreaterThan(ranked[1]?.relevance ?? 0);
  });

  it("expands the relevant bodies, keeps the user's rules on, and lists a small store whole", () => {
    seed();
    const records = listMemoryRecords(projectMemoryScope(workspace));
    const context = buildMemoryContext(records, { text: "Change how HOST is parsed in src/config.ts" }, workspace, {
      maxEntries: 1,
    });
    expect(context.text).toContain("PROJECT MEMORY:");
    expect(context.expanded).toEqual(["config-loader-normalizes-host"]);
    expect(context.text).toContain("### Config loader trims HOST");
    // A person's stated preference shares no word with the request and still reaches it (doc 18 R1).
    expect(context.rules).toEqual(["user-prefers-spanish"]);
    expect(context.text).toContain("- Answer in Spanish when the user writes in Spanish");
    expect(context.listed).toEqual(["bun-test-preload"]);
    expect(context.text).toContain("(bun-test-preload.md)");
    expect(context.explain?.find((item) => item.slug === "config-loader-normalizes-host")).toMatchObject({
      tier: "knowledge",
      reasons: expect.arrayContaining([expect.stringContaining("terms: "), "files: src/config.ts"]),
    });
  });

  it("flags an entry as stale when a related file changed after it was confirmed", () => {
    seed();
    const configPath = join(workspace, "src", "config.ts");
    writeFileSync(configPath, "export const x = 1;\n");
    const future = new Date(Date.now() + 60 * 60_000);
    utimesSync(configPath, future, future);
    const records = listMemoryRecords(projectMemoryScope(workspace));
    const config = records.find((record) => record.slug === "config-loader-normalizes-host");
    expect(config && detectStaleness(workspace, config)).toMatchObject({ stale: true });
    const context = buildMemoryContext(records, { text: "src/config.ts loadConfig HOST" }, workspace);
    expect(context.text).toContain("MAY BE STALE");
  });

  it("lists only the most relevant other entries and counts the rest (audit doc 15, M6)", () => {
    const scope = projectMemoryScope(workspace);
    for (let index = 0; index < 20; index += 1) {
      writeMemoryEntry(scope, {
        slug: `note-${index}`,
        title: `Note ${index}`,
        hook: `A saved note number ${index} about an unrelated part of the project`,
        type: "decisions",
        description: "Unrelated note",
        body: `Decision ${index}: this module keeps its own cache and never shares it with other modules.`,
      });
    }
    const context = buildMemoryContext(listMemoryRecords(scope), { text: "fix the cache", paths: [] }, workspace, {
      maxListed: 5,
    });
    expect(context.listed).toHaveLength(5);
    expect(context.text).toContain(`… and ${20 - context.expanded.length - 5} more; memory_list shows them all.`);
    // In a store this size, entries that share nothing with the request are counted, not listed.
    const unrelated = buildMemoryContext(listMemoryRecords(scope), { text: "rename the logo file" }, workspace, {
      maxListed: 5,
    });
    expect(unrelated.expanded).toEqual([]);
    expect(unrelated.listed).toEqual([]);
    expect(unrelated.text).toContain("Other saved entries: none related to this request.");
    expect(unrelated.text).toContain("… and 20 more; memory_list shows them all.");
  });

  it("returns nothing for an empty store", () => {
    expect(buildMemoryContext([], { text: "anything" }, workspace)).toMatchObject({
      text: "",
      expanded: [],
      listed: [],
    });
  });
});

describe("memory v2 retrieval (doc 18 §4.3)", () => {
  function write(slug: string, fields: Partial<Parameters<typeof writeMemoryEntry>[1]> = {}): void {
    writeMemoryEntry(projectMemoryScope(workspace), {
      slug,
      title: slug,
      hook: slug,
      type: "conventions",
      description: slug,
      body: slug,
      source: "inference",
      confidence: 0.7,
      ...fields,
    });
  }

  it("reads a short follow-up together with the request before it (R2)", () => {
    write("login-flaky-test", {
      title: "The login test is flaky",
      hook: "tests/login.spec.ts fails one run in five on a race with the session cookie",
      body: "Await `page.waitForResponse('/api/session')` before asserting; the cookie arrives after the redirect.",
    });
    const records = listMemoryRecords(projectMemoryScope(workspace));
    const alone = buildMemoryContext(records, { text: "sí, hazlo" }, workspace);
    expect(alone.expanded).toEqual([]);
    const followUp = buildMemoryContext(
      records,
      { text: "sí, hazlo", previous: "fix the flaky login test" },
      workspace,
    );
    expect(followUp.expanded).toEqual(["login-flaky-test"]);
  });

  it("lets a short new request find its own memory, not the previous request's (review round 2)", () => {
    write("login-session-cookie", {
      title: "Login bug: the session cookie",
      hook: "login fails when the session cookie is set after the redirect",
      body: "Set the session cookie before redirecting in src/auth/login.ts.",
    });
    write("stripe-webhook-signature", {
      title: "Stripe webhook signatures",
      hook: "the stripe webhook handler must verify signatures with the raw body",
      body: "Read the raw body before JSON parsing, then call stripe.webhooks.constructEvent.",
    });
    const context = buildMemoryContext(
      listMemoryRecords(projectMemoryScope(workspace)),
      {
        text: "fix the login bug",
        previous: "update the stripe webhook handler to verify signatures with the raw body",
      },
      workspace,
    );
    expect(context.expanded).toEqual(["login-session-cookie"]);
  });

  it("matches a Spanish request with an English memory (R3)", () => {
    write("config-tests-preload", {
      title: "Config tests need the preload script",
      hook: "the configuration tests fail unless bun test runs with --preload ./test/setup.ts",
      body: "Run `bun test --preload ./test/setup.ts`; without it the fixtures are missing.",
    });
    write("deploy-fly", { title: "Deploys go to Fly.io", hook: "deployments run with fly deploy from main" });
    const context = buildMemoryContext(
      listMemoryRecords(projectMemoryScope(workspace)),
      { text: "las pruebas de configuración fallan otra vez" },
      workspace,
    );
    expect(context.expanded[0]).toBe("config-tests-preload");
    expect(context.expanded).not.toContain("deploy-fly");
  });

  it("shows a long entry clipped rather than dropping it (R6)", () => {
    write("release-procedure", {
      title: "Release procedure",
      hook: "how a release is cut: version bump, changelog, tag, publish",
      type: "procedure",
      body: ["Release steps:", ...Array.from({ length: 100 }, () => "- a careful step that must not be skipped")].join(
        "\n",
      ),
    });
    const context = buildMemoryContext(
      listMemoryRecords(projectMemoryScope(workspace)),
      { text: "cut a release" },
      workspace,
    );
    expect(context.expanded).toEqual(["release-procedure"]);
    expect(context.text).toContain("(clipped; memory_read release-procedure for the rest)");
    expect(context.text.length).toBeLessThan(4_500);
  });

  it("never shows a superseded fact as current (R7)", () => {
    write("auth-firebase", { title: "Auth uses Firebase", hook: "login goes through Firebase Auth" });
    write("auth-supabase", { title: "Auth uses Supabase", hook: "login goes through Supabase Auth" });
    const records = listMemoryRecords(projectMemoryScope(workspace)).map((record) =>
      record.slug === "auth-firebase"
        ? {
            ...record,
            entry: {
              ...record.entry,
              frontmatter: {
                ...record.entry.frontmatter,
                metadata: { ...record.entry.frontmatter.metadata, status: "superseded" as const },
              },
            },
          }
        : record,
    );
    const context = buildMemoryContext(records, { text: "why does the firebase login fail" }, workspace);
    expect(context.expanded).not.toContain("auth-firebase");
    expect(context.listed).not.toContain("auth-firebase");
  });

  it("says how sure memory is, and says so when it knows nothing about a request (metamemory)", () => {
    write("deploy-fly", {
      title: "Deploys go to Fly.io",
      hook: "deployments run with fly deploy from main",
      body: "Run `fly deploy` from main; the release command runs the migrations.",
    });
    const scope = projectMemoryScope(workspace);
    recordMemoryUse(scope, ["deploy-fly"]);
    const firm = buildMemoryContext(listMemoryRecords(scope), { text: "how do we deploy to fly" }, workspace);
    expect(firm.text).toMatch(/### Deploys go to Fly\.io \(deploy-fly; conventions; inference 70%; firm\)/u);
    const later = buildMemoryContext(
      listMemoryRecords(scope),
      { text: "how do we deploy to fly", now: Date.now() + 400 * 24 * 60 * 60_000 },
      workspace,
    );
    expect(later.text).toContain("inference 70%; fading");
    const unrelated = noteWhenNothingMatches(
      buildMemoryContext(listMemoryRecords(scope), { text: "write a haiku about autumn" }, workspace),
    );
    expect(unrelated.text).toContain("Nothing saved matches this request closely");
    expect(noteWhenNothingMatches(firm).text).not.toContain("Nothing saved matches");
  });

  it("gives only the user's own project reminders, on a specific cue (review round 3)", () => {
    const scope = projectMemoryScope(workspace);
    const reminder = (slug: string, source: "human" | "inference", tags: string[]) =>
      writeMemoryEntry(scope, {
        slug,
        title: slug,
        hook: `Remind the user: ${slug}`,
        type: "reminder",
        description: "Reminder",
        body: `${slug}. When: later.`,
        source,
        tags: ["reminder", ...tags],
      });
    reminder("rotate-keys", "human", ["cue:auth"]);
    reminder("model-wrote-this", "inference", []);
    const records = listMemoryRecords(scope);
    const unrelated = buildMemoryContext(records, { text: "fix the module resolution error in vite" }, workspace);
    expect(unrelated.reminders).toEqual([]);
    expect(unrelated.text).not.toContain("model-wrote-this");
    const cued = buildMemoryContext(records, { text: "the auth module rejects expired tokens" }, workspace);
    expect(cued.reminders).toEqual(["rotate-keys"]);
    // A user-wide reminder is never given: no project could cross it off.
    const userWide = { ...records.find((record) => record.slug === "rotate-keys"), origin: "user" as const };
    expect(buildMemoryContext([userWide as (typeof records)[number]], { text: "auth" }, workspace).reminders).toEqual(
      [],
    );
  });

  it("gives a rare word more weight than one every entry shares", () => {
    for (let index = 0; index < 12; index += 1) {
      write(`test-note-${index}`, { hook: `test note ${index} about the test suite`, body: "test test" });
    }
    write("stripe-webhook-test", {
      title: "Stripe webhook test",
      hook: "the stripe webhook test needs STRIPE_WEBHOOK_SECRET set to whsec_test",
      body: "Set STRIPE_WEBHOOK_SECRET=whsec_test before running it.",
    });
    const ranked = rankMemories(
      listMemoryRecords(projectMemoryScope(workspace)),
      { text: "the stripe test fails" },
      workspace,
    );
    expect(ranked[0]?.record.slug).toBe("stripe-webhook-test");
  });
});
