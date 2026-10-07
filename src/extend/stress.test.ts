import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFrontmatter } from "./frontmatter";
import { listVersions } from "./store";

/**
 * Several real processes writing the same definitions at once (two Shelra sessions in one project, a hook and an agent,
 * a person at the terminal while a model writes). Whatever the interleaving, a definition on disk is always a whole,
 * valid file; nothing is left half written; and a write that could not get its turn says so instead of failing quietly.
 */
const bun = (() => {
  const probe = spawn("bun", ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
  return new Promise<boolean>((resolve) => {
    probe.on("error", () => resolve(false));
    probe.on("close", (code) => resolve(code === 0));
  });
})();

let scratch = "";
let project = "";
let home = "";

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "shelra-stress-"));
  project = join(scratch, "project");
  home = join(scratch, "home");
  mkdirSync(join(project, ".git"), { recursive: true });
  mkdirSync(home, { recursive: true });
});
afterEach(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const WORKER = (repo: string) => `
import { writeSkill } from "${repo}/src/extend/skills";
import { writeAgent } from "${repo}/src/extend/agents";
const id = process.argv[2];
const project = process.argv[3];
const results = { ok: 0, busy: 0, other: [] };
const note = (outcome) => {
  if (outcome.ok) results.ok++;
  else if (/another Shelra session is writing/.test(outcome.reason)) results.busy++;
  else results.other.push(outcome.reason);
};
for (let i = 0; i < 12; i++) {
  note(writeSkill(project, { name: "shared-skill", description: "A skill that several processes rewrite at the same moment, for the stress test.", instructions: "writer " + id + " revision " + i + "\\n" + "line\\n".repeat(200) }));
  note(writeAgent(project, { name: "shared-agent", description: "An agent that several processes rewrite at the same moment, for the stress test.", instructions: "writer " + id + " revision " + i }));
  note(writeSkill(project, { name: "own-" + id, description: "A skill only one process writes, to see that others do not disturb it.", instructions: "mine " + i + "\\n" }));
}
console.log(JSON.stringify(results));
`;

const run = (id: number, repo: string, workerPath: string) =>
  new Promise<{ ok: number; busy: number; other: string[] }>((resolve, reject) => {
    const child = spawn("bun", [workerPath, String(id), project], {
      env: { ...process.env, HOME: home, USERPROFILE: home, SHELRA_DIAGNOSTICS_LOG: "off", SHELRA_TRACE: "off" },
      shell: process.platform === "win32",
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("close", (code) => {
      try {
        resolve(JSON.parse(out.trim().split("\n").at(-1) ?? "{}"));
      } catch {
        reject(new Error(`worker ${id} exited ${code}: ${err.slice(0, 400)} ${out.slice(0, 200)}`));
      }
    });
    void repo;
  });

describe("concurrent writers in separate processes", () => {
  it("leave whole, valid definitions, no temporary files, and account for every write", async () => {
    if (!(await bun)) return;
    const repo = join(__dirname, "..", "..").replace(/\\/gu, "/");
    const workerPath = join(scratch, "worker.ts");
    writeFileSync(workerPath, WORKER(repo));
    const processes = 6;
    const results = await Promise.all(Array.from({ length: processes }, (_, id) => run(id, repo, workerPath)));
    const total = results.reduce((sum, result) => sum + result.ok + result.busy + result.other.length, 0);
    const other = results.flatMap((result) => result.other);
    console.log(
      `stress: ${results.reduce((s, r) => s + r.ok, 0)} writes ok, ${results.reduce((s, r) => s + r.busy, 0)} told to retry, ${other.length} other failures, of ${total}`,
    );
    expect(total).toBe(processes * 12 * 3);
    // A refusal is only ever the explicit "another session is writing" answer or a validation, never a crash.
    expect(other, other.join("\n")).toEqual([]);

    const skills = join(project, ".shelra", "skills");
    const agents = join(project, ".shelra", "agents");
    for (const [file, key] of [
      [join(skills, "shared-skill", "SKILL.md"), "name"],
      [join(agents, "shared-agent.md"), "name"],
      ...Array.from({ length: processes }, (_, id) => [join(skills, `own-${id}`, "SKILL.md"), "name"] as const),
    ] as Array<[string, string]>) {
      expect(existsSync(file), file).toBe(true);
      const parsed = parseFrontmatter(readFileSync(file, "utf8"));
      expect(parsed.hasFrontmatter, file).toBe(true);
      expect(parsed.problems, file).toEqual([]);
      expect(typeof parsed.data[key], file).toBe("string");
    }
    // The shared skill is exactly one writer's complete revision, never a mix of two.
    const body = readFileSync(join(skills, "shared-skill", "SKILL.md"), "utf8");
    expect((body.match(/writer \d+ revision \d+/gu) ?? []).length).toBe(1);
    expect((body.match(/^line$/gmu) ?? []).length).toBe(200);
    // Nothing half written is left behind.
    for (const dir of [join(skills, "shared-skill"), agents]) {
      expect(
        readdirSync(dir).filter((name) => name.endsWith(".tmp")),
        dir,
      ).toEqual([]);
    }
    // Every replaced version of the shared skill was kept, up to the limit.
    expect(listVersions(join(project, ".shelra"), "skill", "shared-skill").length).toBeGreaterThan(0);
  }, 180_000);
});
