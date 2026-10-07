import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { tool } from "ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { invalidateSettingsCache } from "../extend/settings";
import { approveHooks, invalidateTrustCache, revokeHook } from "../extend/trust";
import { hardenToolSet } from "../toolset/tools";
import { fingerprintOfHook } from "./config";
import { hookEnvironment } from "./executor";
import {
  awaitBackgroundHooks,
  clearHookRunLog,
  executeEventHooks,
  HOOK_DEPTH_ENV,
  invalidateHookCache,
  recentHookRuns,
  resolveHooks,
  setHookIssueListener,
} from "./index";
import type { CommandHook } from "./types";

// Built at runtime so that no secret-shaped literal sits in the repository (push protection flags those).
const FAKE_KEY = ["sk", "or", "v1", "zyxwvutsrqponmlk".repeat(4)].join("-");

let scratch = "";
let project = "";
let home = "";
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, depth: process.env[HOOK_DEPTH_ENV] };

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "shelra-hooks-"));
  project = join(scratch, "project");
  home = join(scratch, "home");
  mkdirSync(join(project, ".git"), { recursive: true });
  mkdirSync(join(home, ".shelra"), { recursive: true });
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env[HOOK_DEPTH_ENV];
  invalidateSettingsCache();
  invalidateTrustCache();
  invalidateHookCache();
  clearHookRunLog();
});
afterEach(() => {
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  if (saved.depth === undefined) delete process.env[HOOK_DEPTH_ENV];
  else process.env[HOOK_DEPTH_ENV] = saved.depth;
  setHookIssueListener(null);
  invalidateHookCache();
  // A killed hook's process can hold its folder for a moment on Windows.
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const script = (name: string, body: string): string => {
  const path = join(scratch, name);
  writeFileSync(path, body);
  return path;
};
const node = (file: string): Pick<CommandHook, "type" | "command" | "args"> => ({
  type: "command",
  command: process.execPath,
  args: [file],
});
const userHooks = (hooks: Record<string, unknown>) => {
  writeFileSync(join(home, ".shelra", "user-settings.json"), JSON.stringify({ hooks }));
  invalidateHookCache();
};
const preInput = (tool_name: string) => ({
  hook_event_name: "PreToolUse" as const,
  tool_name,
  tool_input: { path: "x" },
  cwd: project,
});

describe("scenario G: a pre-tool hook blocks an operation before it happens", () => {
  it("stops the tool at the broker: the side effect never occurs", async () => {
    const victim = join(scratch, "victim.txt");
    const guard = script(
      "guard.js",
      `let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const i=JSON.parse(s);if(i.tool_name==="write_file"){process.stderr.write("writes to this project are frozen");process.exit(2)}});`,
    );
    userHooks({ PreToolUse: [{ matcher: "write_file|edit_file", hooks: [{ ...node(guard), id: "freeze" }] }] });
    const tools = hardenToolSet(
      {
        write_file: tool({
          description: "w",
          inputSchema: z.object({ path: z.string() }),
          execute: async ({ path }) => {
            writeFileSync(path, "written");
            return { success: true };
          },
        }),
        read_file: tool({
          description: "r",
          inputSchema: z.object({ path: z.string() }),
          execute: async () => ({ success: true, output: "read" }),
        }),
      },
      { cwd: () => project },
    );
    const run = (name: "write_file" | "read_file", input: Record<string, unknown>) =>
      (
        tools[name] as unknown as {
          execute: (i: unknown, o: unknown) => Promise<{ success: boolean; output?: string }>;
        }
      ).execute(input, {});
    const blocked = await run("write_file", { path: victim });
    expect(blocked.success).toBe(false);
    expect(blocked.output).toMatch(/Hook blocked.*frozen/u);
    expect(existsSync(victim)).toBe(false);
    expect((await run("read_file", { path: victim })).success).toBe(true);
    const record = recentHookRuns().find((entry) => entry.hookId === "freeze");
    expect(record).toMatchObject({ event: "PreToolUse", effect: "prevented", source: "user", deterministic: true });
  });

  it("honours the JSON decision shape other agents use, and never lets `allow` widen anything", async () => {
    const deny = script(
      "deny.js",
      `process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"not here"}}))`,
    );
    userHooks({ PreToolUse: [{ hooks: [node(deny)] }] });
    const result = await executeEventHooks(preInput("bash"), project);
    expect(result.blocked).toBe(true);
    const allow = script(
      "allow.js",
      `process.stdout.write(JSON.stringify({hookSpecificOutput:{permissionDecision:"allow"}}))`,
    );
    userHooks({ PreToolUse: [{ hooks: [node(allow)] }] });
    expect((await executeEventHooks(preInput("bash"), project)).blocked).toBe(false);
  });

  it("matches by exact name, alternatives and regular expression, and runs every matching hook in a stable order", async () => {
    const log = join(scratch, "order.log");
    const tag = (name: string) =>
      script(`${name}.js`, `require("fs").appendFileSync(${JSON.stringify(log)},${JSON.stringify(name)}+"\\n")`);
    userHooks({
      PreToolUse: [
        { matcher: "bash", hooks: [{ ...node(tag("first")), id: "first" }] },
        { matcher: "edit_file|write_file", hooks: [{ ...node(tag("never")), id: "never" }] },
        { matcher: "^ba.*", hooks: [{ ...node(tag("regex")), id: "regex" }] },
        { hooks: [{ ...node(tag("all")), id: "all" }] },
      ],
    });
    await executeEventHooks(preInput("bash"), project);
    const lines = readFileSync(log, "utf8").trim().split("\n").sort();
    expect(lines).toEqual(["all", "first", "regex"]);
    expect(recentHookRuns().map((entry) => entry.hookId)).toEqual(["first", "regex", "all"]);
  });
});

describe("scenario H: a post hook runs and is recorded without being mistaken for prevention", () => {
  it("records `observed` even when the hook says block, and never blocks anything", async () => {
    const post = script("post.js", `process.stdout.write(JSON.stringify({decision:"block",reason:"too late"}))`);
    userHooks({ PostToolUse: [{ hooks: [{ ...node(post), id: "after" }] }] });
    const result = await executeEventHooks(
      { hook_event_name: "PostToolUse", tool_name: "write_file", tool_input: {}, tool_output: {}, cwd: project },
      project,
    );
    expect(result.blocked).toBe(false);
    expect(result.preventContinuation).toBe(false);
    const record = recentHookRuns().at(-1);
    expect(record).toMatchObject({ event: "PostToolUse", hookId: "after", effect: "observed", outcome: "success" });
    expect(record?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("exit code 2 on an event nothing waits for is an ordinary failure, not a block", async () => {
    const two = script("two.js", `process.stderr.write("nope");process.exit(2)`);
    userHooks({ SessionEnd: [{ hooks: [{ ...node(two), id: "end" }] }] });
    const result = await executeEventHooks({ hook_event_name: "SessionEnd", cwd: project }, project);
    expect(result.blocked).toBe(false);
    expect(recentHookRuns().at(-1)).toMatchObject({ effect: "failed-open" });
  });

  it("an async hook never delays the runtime or blocks, and still gets recorded", async () => {
    const slow = script("slow.js", `setTimeout(()=>process.exit(2),400)`);
    userHooks({ PostToolUse: [{ hooks: [{ ...node(slow), id: "bg", async: true }] }] });
    const start = performance.now();
    const result = await executeEventHooks(
      { hook_event_name: "PostToolUse", tool_name: "bash", tool_input: {}, tool_output: {}, cwd: project },
      project,
    );
    expect(performance.now() - start).toBeLessThan(300);
    expect(result.results).toEqual([]);
    await awaitBackgroundHooks(5_000);
    expect(recentHookRuns().find((entry) => entry.hookId === "bg")).toBeDefined();
  });
});

describe("scenario I: failing, slow and recursive hooks", () => {
  it("a hook that crashes lets the action go on (open) and is reported, and blocks it when its policy is closed", async () => {
    const crash = script("crash.js", `process.stderr.write("boom");process.exit(1)`);
    const issues: string[] = [];
    setHookIssueListener((issue) => issues.push(`${issue.outcome}:${issue.message}`));
    userHooks({ PreToolUse: [{ hooks: [{ ...node(crash), id: "flaky" }] }] });
    const open = await executeEventHooks(preInput("bash"), project);
    expect(open.blocked).toBe(false);
    expect(issues).toEqual(["non_blocking_error:boom"]);
    expect(recentHookRuns().at(-1)).toMatchObject({ effect: "failed-open" });
    userHooks({ PreToolUse: [{ hooks: [{ ...node(crash), id: "mandatory", failurePolicy: "closed" }] }] });
    const closed = await executeEventHooks(preInput("bash"), project);
    expect(closed.blocked).toBe(true);
    expect(closed.blockingErrors[0]?.stderr).toMatch(/closed/u);
    expect(recentHookRuns().at(-1)).toMatchObject({ effect: "failed-closed" });
  });

  it("a missing program and unreadable output fail closed too, and never silently allow", async () => {
    userHooks({
      PreToolUse: [
        {
          hooks: [
            {
              type: "command",
              command: "definitely-not-a-real-program-xyz",
              args: [],
              id: "ghost",
              failurePolicy: "closed",
            },
          ],
        },
      ],
    });
    expect((await executeEventHooks(preInput("bash"), project)).blocked).toBe(true);
    const garbage = script("garbage.js", `process.stdout.write("{not json")`);
    userHooks({ PreToolUse: [{ hooks: [{ ...node(garbage), id: "garbage", failurePolicy: "closed" }] }] });
    expect((await executeEventHooks(preInput("bash"), project)).blocked).toBe(true);
    userHooks({ PreToolUse: [{ hooks: [{ ...node(garbage), id: "garbage-open" }] }] });
    expect((await executeEventHooks(preInput("bash"), project)).blocked).toBe(false);
  });

  it("a slow hook times out on schedule, its whole process tree dies, and nothing is left running", async () => {
    const pidFile = join(scratch, "child.pid");
    const grandchild = script("grandchild.js", `setInterval(()=>{},1000)`);
    const hang = script(
      "hang.js",
      `const {spawn}=require("child_process");const c=spawn(process.execPath,[${JSON.stringify(grandchild)}],{stdio:"ignore"});require("fs").writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000)`,
    );
    userHooks({ PreToolUse: [{ hooks: [{ ...node(hang), id: "hang", timeout: 1 }] }] });
    const start = performance.now();
    const result = await executeEventHooks(preInput("bash"), project);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(3_500);
    expect(result.blocked).toBe(false);
    expect(recentHookRuns().at(-1)).toMatchObject({ timedOut: true, effect: "failed-open" });
    const pid = Number(readFileSync(pidFile, "utf8"));
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const deadline = performance.now() + 5_000;
    while (alive() && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive()).toBe(false);
  });

  it("cancelling (Esc) ends a running hook at once and leaves no process", async () => {
    const pidFile = join(scratch, "cancel.pid");
    const hang = script(
      "hang2.js",
      `require("fs").writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`,
    );
    userHooks({ PreToolUse: [{ hooks: [{ ...node(hang), id: "hang2" }] }] });
    const controller = new AbortController();
    const pending = executeEventHooks(preInput("bash"), project, controller.signal);
    const deadline = performance.now() + 5_000;
    while (!existsSync(pidFile) && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    controller.abort();
    const start = performance.now();
    await pending;
    expect(performance.now() - start).toBeLessThan(1_500);
    const pid = Number(readFileSync(pidFile, "utf8"));
    const end = performance.now() + 5_000;
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    while (alive() && performance.now() < end) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive()).toBe(false);
  });

  it("a hook that starts Shelra cannot trigger hooks of its own (no recursion)", async () => {
    const marker = join(scratch, "ran.txt");
    const touch = script("touch.js", `require("fs").writeFileSync(${JSON.stringify(marker)},"ran")`);
    userHooks({ PreToolUse: [{ hooks: [{ ...node(touch), id: "inner" }] }] });
    process.env[HOOK_DEPTH_ENV] = "1";
    const result = await executeEventHooks(preInput("bash"), project);
    expect(result.results).toEqual([]);
    expect(existsSync(marker)).toBe(false);
    expect(recentHookRuns().at(-1)).toMatchObject({ effect: "skipped", outcome: "skipped" });
    // And every hook is told it is inside one.
    delete process.env[HOOK_DEPTH_ENV];
    const echo = script(
      "depth.js",
      `require("fs").writeFileSync(${JSON.stringify(marker)},process.env.${HOOK_DEPTH_ENV})`,
    );
    userHooks({ PreToolUse: [{ hooks: [{ ...node(echo), id: "depth" }] }] });
    await executeEventHooks(preInput("bash"), project);
    expect(readFileSync(marker, "utf8")).toBe("1");
  });

  it("cuts runaway output and masks secrets in the run log", async () => {
    const flood = script(
      "flood.js",
      `process.stdout.write("x".repeat(2_000_000));process.stderr.write("token ${FAKE_KEY} leaked");process.exit(1)`,
    );
    userHooks({ PostToolUse: [{ hooks: [{ ...node(flood), id: "flood" }] }] });
    await executeEventHooks(
      { hook_event_name: "PostToolUse", tool_name: "bash", tool_input: {}, tool_output: {}, cwd: project },
      project,
    );
    const record = recentHookRuns().at(-1);
    expect(record?.truncated).toBe(true);
    expect(record?.reason).not.toMatch(/sk-or-v1-0123/u);
  });

  it("runs a shell-form command too", async () => {
    userHooks({ PreToolUse: [{ hooks: [{ type: "command", command: "echo hi", id: "shell" }] }] });
    const result = await executeEventHooks(preInput("bash"), project);
    expect(result.results[0]?.outcome).toBe("success");
  });
});

describe("trust: a repository's hooks are proposals, and the approved snapshot cannot be edited away", () => {
  const hookDef = (file: string, id = "proj-guard") => ({ ...node(file), id, failurePolicy: "closed" as const });
  const writeProject = (hooks: Record<string, unknown>, name = "settings.json") => {
    mkdirSync(join(project, ".shelra"), { recursive: true });
    writeFileSync(join(project, ".shelra", name), JSON.stringify({ hooks }));
    invalidateSettingsCache();
    invalidateHookCache();
  };

  it("does not run a project hook until the person approves it", async () => {
    const marker = join(scratch, "project-hook.txt");
    const write = script("p.js", `require("fs").writeFileSync(${JSON.stringify(marker)},"ran")`);
    writeProject({ PreToolUse: [{ hooks: [hookDef(write)] }] });
    expect(resolveHooks(project).hooks[0]).toMatchObject({ state: "pending", source: "project" });
    await executeEventHooks(preInput("bash"), project);
    expect(existsSync(marker)).toBe(false);
    const def = resolveHooks(project).hooks[0];
    if (!def) throw new Error("missing");
    approveHooks(project, [
      {
        id: def.id,
        fingerprint: def.fingerprint,
        event: def.event,
        command: def.hook.command,
        args: def.hook.args,
        failurePolicy: def.failurePolicy,
        async: false,
        layer: "project",
      },
    ]);
    invalidateHookCache();
    await executeEventHooks(preInput("bash"), project);
    expect(readFileSync(marker, "utf8")).toBe("ran");
  });

  it("keeps enforcing the approved hook when an agent edits it or deletes it from the file", async () => {
    const block = script("block.js", `process.stderr.write("blocked by project policy");process.exit(2)`);
    writeProject({ PreToolUse: [{ hooks: [hookDef(block)] }] });
    const original = resolveHooks(project).hooks[0];
    if (!original) throw new Error("missing");
    approveHooks(project, [
      {
        id: original.id,
        fingerprint: original.fingerprint,
        event: original.event,
        command: original.hook.command,
        args: original.hook.args,
        failurePolicy: original.failurePolicy,
        async: false,
        layer: "project",
      },
    ]);
    invalidateHookCache();
    expect((await executeEventHooks(preInput("bash"), project)).blocked).toBe(true);
    // The agent rewrites the hook to be harmless...
    const harmless = script("harmless.js", `process.exit(0)`);
    writeProject({ PreToolUse: [{ hooks: [hookDef(harmless)] }] });
    expect((await executeEventHooks(preInput("bash"), project)).blocked).toBe(true);
    const states = resolveHooks(project).hooks.map((hook) => `${hook.id}:${hook.state}`);
    expect(states).toContain("proj-guard:modified");
    // ...or empties the file.
    writeProject({});
    expect((await executeEventHooks(preInput("bash"), project)).blocked).toBe(true);
    // Only the person removes it.
    expect(revokeHook(project, "proj-guard")).toBe(1);
    invalidateHookCache();
    expect((await executeEventHooks(preInput("bash"), project)).blocked).toBe(false);
  });

  it("keeps enforcing an approved fail-closed hook when an agent marks it disabled in the file", async () => {
    const block = script("block2.js", `process.stderr.write("blocked by project policy");process.exit(2)`);
    writeProject({ PreToolUse: [{ hooks: [hookDef(block)] }] });
    const original = resolveHooks(project).hooks[0];
    if (!original) throw new Error("missing");
    approveHooks(project, [
      {
        id: original.id,
        fingerprint: original.fingerprint,
        event: original.event,
        command: original.hook.command,
        args: original.hook.args,
        failurePolicy: "closed",
        async: false,
        layer: "project",
      },
    ]);
    writeProject({ PreToolUse: [{ hooks: [{ ...hookDef(block), enabled: false }] }] });
    expect((await executeEventHooks(preInput("bash"), project)).blocked).toBe(true);
    expect(resolveHooks(project).hooks.map((hook) => hook.state)).toEqual(["modified"]);
  });

  it("shows it when resolving hooks fails, instead of silently running none", async () => {
    const result = await executeEventHooks(preInput("bash"), undefined as unknown as string);
    expect(result.blocked).toBe(false);
    const failure = recentHookRuns().find((entry) => entry.hookId === "hooks");
    expect(failure).toMatchObject({ effect: "failed-open", outcome: "non_blocking_error" });
    expect(failure?.reason).toMatch(/could not be resolved/);
  });

  it("does not hand the account token or provider keys to a hook defined in the repository", () => {
    const saved = {
      token: process.env.SHELRA_TOKEN,
      key: process.env.OPENROUTER_API_KEY,
      gh: process.env.GITHUB_TOKEN,
    };
    process.env.SHELRA_TOKEN = "shr_fake";
    process.env.OPENROUTER_API_KEY = "fake-key";
    process.env.GITHUB_TOKEN = "fake-gh";
    try {
      for (const source of ["project", "local"] as const) {
        const env = hookEnvironment(source);
        expect(env.SHELRA_TOKEN, source).toBeUndefined();
        expect(env.OPENROUTER_API_KEY, source).toBeUndefined();
        expect(env.GITHUB_TOKEN, source).toBeUndefined();
        expect(env.PATH ?? env.Path).toBeDefined();
      }
      // The person's own hooks keep their environment.
      expect(hookEnvironment("user").OPENROUTER_API_KEY).toBe("fake-key");
    } finally {
      for (const [name, value] of [
        ["SHELRA_TOKEN", saved.token],
        ["OPENROUTER_API_KEY", saved.key],
        ["GITHUB_TOKEN", saved.gh],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("a local settings file is a proposal too, and a hook turned off in the file is not run", async () => {
    const marker = join(scratch, "local.txt");
    const write = script("l.js", `require("fs").writeFileSync(${JSON.stringify(marker)},"ran")`);
    writeProject({ PreToolUse: [{ hooks: [{ ...node(write), id: "local-hook" }] }] }, "settings.local.json");
    await executeEventHooks(preInput("bash"), project);
    expect(existsSync(marker)).toBe(false);
    expect(resolveHooks(project).hooks[0]).toMatchObject({ source: "local", state: "pending" });
    writeProject({ PreToolUse: [{ hooks: [{ ...node(write), id: "off", enabled: false }] }] }, "settings.local.json");
    expect(resolveHooks(project).hooks[0]?.state).toBe("disabled");
  });

  it("runs a hook defined in two layers once, and reports malformed definitions instead of ignoring them silently", () => {
    const same = { ...node(script("same.js", "")), id: "dup" };
    userHooks({
      PreToolUse: [
        { hooks: [same] },
        {
          hooks: [
            { type: "http", url: "x" },
            { command: "x", timeout: 99999 },
          ],
        },
      ],
      NotAnEvent: [],
    });
    const resolution = resolveHooks(project);
    expect(resolution.hooks).toHaveLength(1);
    expect(resolution.problems.map((problem) => problem.message).join(" | ")).toMatch(
      /not supported.*timeout must be.*unknown hook event/su,
    );
    expect(fingerprintOfHook("PreToolUse", undefined, { type: "command", command: "x" })).toBe(
      fingerprintOfHook("PreToolUse", undefined, { type: "command", command: "x" }),
    );
  });
});
