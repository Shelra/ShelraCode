import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { classifyReadOnlyShell } from "./readonly-shell";

/**
 * A differential test: the classifier says "this only reads", so run it in a real shell, in a real repository, and
 * look at the disk. Every command the classifier allows must leave the whole folder (and a sibling folder it can reach)
 * byte-for-byte as it was. The commands are generated from the allowed programs, their flags (including the ones that
 * write when misused), and the separators and quotes an adversarial model would try, so the classifier is judged on
 * the effect of what it lets through, not on a list of cases somebody thought of.
 */
const sh = spawnSync("sh", ["-c", "echo ok"], { encoding: "utf8" });
const hasSh = sh.status === 0 && sh.stdout.trim() === "ok";

let scratch = "";
let project = "";
let sibling = "";

function snapshot(...roots: string[]): string {
  const hash = createHash("sha256");
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const stat = statSync(full);
      hash.update(`${full}|${stat.isDirectory() ? "d" : stat.size}|`);
      if (stat.isDirectory()) walk(full);
      else hash.update(readFileSync(full));
    }
  };
  for (const root of roots) walk(root);
  return hash.digest("hex");
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "shelra-diff-"));
  project = join(scratch, "project");
  sibling = join(scratch, "sibling");
  mkdirSync(join(project, "src"), { recursive: true });
  mkdirSync(sibling, { recursive: true });
  writeFileSync(join(project, "a.txt"), "alpha\nbeta\ngamma\n");
  writeFileSync(join(project, "b.txt"), "one\ntwo\n");
  writeFileSync(join(project, "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(join(project, "package.json"), '{"name":"demo","version":"1.0.0"}\n');
  writeFileSync(join(sibling, "keep.txt"), "do not touch\n");
  const git = (...args: string[]) => spawnSync("git", args, { cwd: project, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("add", ".");
  git("commit", "-q", "-m", "first");
  writeFileSync(join(project, "a.txt"), "alpha\nbeta\ngamma\ndelta\n");
});
afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const PROGRAMS = [
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "find",
  "sort",
  "uniq",
  "sed",
  "git",
  "tree",
  "diff",
  "cut",
  "tr",
  "jq",
  "echo",
  "du",
  "stat",
  "file",
  "date",
  "hostname",
  "env",
  "tee",
  "cp",
  "mv",
  "rm",
  "touch",
  "mkdir",
  "node",
  "sh",
];
const ARGS = [
  "",
  "a.txt",
  "b.txt a.txt",
  "-n",
  "-l a.txt",
  "-r alpha .",
  "-o out.txt a.txt",
  "--output=out.txt a.txt",
  "a.txt out.txt",
  "-i s/a/b/ a.txt",
  "-n '1p' a.txt",
  "-n '/a/p' a.txt",
  ". -name '*.txt'",
  ". -delete",
  ". -name a.txt -exec rm {} ;",
  ". -fprint found.txt",
  "status",
  "log --oneline",
  "diff --no-ext-diff --no-textconv",
  "diff",
  "show HEAD",
  "branch newbranch",
  "tag v1",
  "checkout .",
  "stash",
  "config user.name x",
  "reset --hard",
  "add .",
  "commit -am x",
  "clean -fd",
  "-c core.pager=touch log",
  "--output=x log",
  "-e 1",
  "-f a.txt",
  ".",
  "-la",
  "-R .",
  "/dev/null",
  "../sibling/keep.txt",
  "-s 2020-01-01",
  "x",
  "-p . x",
  "--pre touch alpha .",
  "-o ../sibling/new.txt a.txt",
];
const GLUE = [
  "",
  " ; ",
  " && ",
  " || ",
  " | ",
  " > out.txt ",
  " >> a.txt ",
  " 2>/dev/null ",
  " 2>&1 ",
  " > ../sibling/new.txt ",
  " `touch x` ",
  " $(touch y) ",
  " <(ls) ",
  " & ",
  "\n",
  " {a,b} ",
  " (touch z) ",
  " 'x' ",
  ' "x" ',
];

function mulberry(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe.skipIf(!hasSh)("read-only classifier vs a real shell", () => {
  it("every generated command it allows leaves the disk exactly as it was", () => {
    const random = mulberry(20261007);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    let allowed = 0;
    let refused = 0;
    const damaged: string[] = [];
    const executed: string[] = [];
    for (let index = 0; index < 1500; index++) {
      const parts = 1 + Math.floor(random() * 3);
      let command = "";
      for (let part = 0; part < parts; part++)
        command += `${part > 0 ? pick(GLUE) : ""}${pick(PROGRAMS)} ${pick(ARGS)}`;
      const verdict = classifyReadOnlyShell(command);
      if (!verdict.allowed) {
        refused++;
        continue;
      }
      allowed++;
      const before = snapshot(project, sibling);
      spawnSync("sh", ["-c", command], { cwd: project, encoding: "utf8", timeout: 10_000, input: "" });
      const after = snapshot(project, sibling);
      executed.push(command);
      if (before !== after) {
        damaged.push(command);
        // Put the folders back so one failure does not hide the next.
        spawnSync("git", ["checkout", "-q", "--", "."], { cwd: project });
      }
    }
    console.log(
      `differential: ${allowed} allowed and executed, ${refused} refused, ${damaged.length} changed the disk`,
    );
    expect(allowed).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(100);
    expect(damaged, damaged.join("\n")).toEqual([]);
    // The generator did reach the programs that matter.
    expect(executed.some((command) => command.startsWith("git"))).toBe(true);
    expect(executed.some((command) => command.includes("sed"))).toBe(true);
  }, 240_000);
});
