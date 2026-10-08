import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ToolSet, tool } from "ai";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  applyPolicy,
  expandToolNames,
  guardTools,
  makePolicy,
  narrowTools,
  toolAllowed,
  WriteCoordinator,
} from "./policy";
import { classifyReadOnlyShell } from "./readonly-shell";

const allowed = (command: string) => classifyReadOnlyShell(command).allowed;

describe("classifyReadOnlyShell: what a read-only agent may run", () => {
  it("allows plain reading, searching, listing and git inspection, alone or piped", () => {
    for (const command of [
      "ls -la",
      "cat package.json",
      "grep -rn TODO src | head -20",
      "rg -n \"foo bar\" src --glob '*.ts'",
      "find . -name '*.ts' -newer package.json",
      "wc -l src/index.ts && head -5 README.md",
      "git status --short",
      "git --no-pager log --oneline -20",
      "git log -5 --format=%H",
      "git diff --no-ext-diff --no-textconv HEAD~1",
      "git show --no-textconv HEAD",
      "git branch --list",
      "git branch -a",
      "git tag --list 'v*'",
      "git config --get user.name",
      "git stash list",
      "git ls-files | wc -l",
      "sed -n '10,20p' src/index.ts",
      "sed -n '/needle/p' notes.txt",
      "cd src && ls",
      "echo hello 2>/dev/null",
      "ls missing 2>&1 | head",
      "Get-ChildItem -Recurse src | Select-String TODO",
      "Get-Content package.json | Measure-Object -Line",
      "ls\nwc -l a.txt",
    ]) {
      expect(classifyReadOnlyShell(command), command).toMatchObject({ allowed: true });
    }
  });

  it("refuses every way of writing a file", () => {
    for (const command of [
      "echo hi > out.txt",
      "echo hi >> out.txt",
      "cat a > b",
      "cat a >b",
      "ls 1>out",
      "ls 2>err.txt",
      "ls &> all.txt",
      "tee out.txt",
      "ls | tee out.txt",
      "sed -i 's/a/b/' file",
      "sed -n 'w out.txt' file",
      "sed -n '1e touch pwned' file",
      "sed 's/a/b/' file",
      "sort -o out.txt in.txt",
      "sort --output=out.txt in.txt",
      "uniq in.txt out.txt",
      "find . -delete",
      "find . -name x -exec rm {} ;",
      "find . -fprint out.txt",
      "touch x",
      "mkdir d",
      "cp a b",
      "mv a b",
      "rm a",
      "del a",
      "Remove-Item a",
      "Set-Content a hi",
      "Out-File a",
      "Get-Content a | Set-Content b",
      "git commit -am x",
      "git add .",
      "git checkout -- .",
      "git reset --hard",
      "git push",
      "git stash",
      "git stash pop",
      "git branch newbranch",
      "git branch -D old",
      "git tag v1",
      "git config user.name x",
      "git remote add o url",
      "git diff --output=out.patch --no-ext-diff --no-textconv",
      "git log --output=x",
    ]) {
      expect(allowed(command), command).toBe(false);
    }
  });

  it("refuses running something else: interpreters, substitution, assignments, background jobs", () => {
    for (const command of [
      'python -c \'open("x","w")\'',
      "node -e 1",
      "bun run x",
      "bash -c 'touch x'",
      "sh -c 'touch x'",
      "powershell -Command x",
      "cat a | sh",
      "cat a | bash",
      "xargs rm",
      "ls | xargs rm",
      "echo $(touch x)",
      "echo `touch x`",
      'echo "$(touch x)"',
      'echo "`touch x`"',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell expansion the classifier must refuse
      "echo ${HOME}",
      "cat <(ls)",
      "FOO=bar ls",
      "GIT_EXTERNAL_DIFF=evil git diff",
      "ls &",
      "sleep 100 &",
      "env touch x",
      "sudo ls",
      "curl http://example.com",
      "wget http://example.com",
      "npm install",
      "make",
      "awk 'BEGIN{system(\"touch x\")}'",
      "git diff",
      "git diff --ext-diff --no-textconv",
      "git show HEAD",
      "git -c core.pager=evil log",
      "git --exec-path=. log",
      "git log -p",
      "rg --pre ./evil x",
      "sort --compress-program=evil x",
      "date -s 2020-01-01",
      "ls; touch x",
      "ls && touch x",
      "ls || touch x",
      "ls\ntouch x",
      "ls | grep a | touch x",
      "& touch x",
      ". ./script.ps1",
      "Get-ChildItem | ForEach-Object { Remove-Item $_ }",
      "Get-ChildItem | Where-Object { $_.Length -gt 1 }",
      "iex 'touch x'",
      "Invoke-Expression 'x'",
    ]) {
      expect(allowed(command), command).toBe(false);
    }
  });

  it("refuses what it cannot read: empty, unclosed, oversized and NUL commands", () => {
    for (const command of ["", "   ", "echo 'unterminated", `ls ${"a".repeat(5000)}`, "ls\0touch x"])
      expect(allowed(command)).toBe(false);
  });

  it("explains a refusal in words the model can act on", () => {
    expect(classifyReadOnlyShell("npm test").reason).toMatch(/not on the read-only list/u);
    expect(classifyReadOnlyShell("echo a > b").reason).toMatch(/redirecting output/u);
    expect(classifyReadOnlyShell("git diff").reason).toMatch(/--no-ext-diff --no-textconv/u);
  });
});

describe("tool policy", () => {
  const fake = (
    name: string,
    run: (input: Record<string, unknown>) => unknown = () => ({ success: true, output: "ran" }),
  ) =>
    tool({
      description: name,
      inputSchema: z.object({}).passthrough(),
      execute: async (input) => run(input as Record<string, unknown>),
    });
  const everything = (): ToolSet => ({
    read_file: fake("read_file"),
    grep: fake("grep"),
    bash: fake("bash"),
    write_file: fake("write_file"),
    edit_file: fake("edit_file"),
    delete_file: fake("delete_file"),
    memory_write: fake("memory_write"),
    memory_read: fake("memory_read"),
    task: fake("task"),
    process_stop: fake("process_stop"),
    mcp_github__create_issue: fake("mcp"),
    computer_click: fake("computer_click"),
    paid_request: fake("paid_request"),
    skill: fake("skill"),
    extensions: fake("extensions"),
    extension_write: fake("extension_write"),
  });

  it("removes everything but reading from a read-only run, including external and unknown tools", () => {
    const narrowed = narrowTools(everything(), makePolicy({ owner: "reviewer", readOnly: true }));
    expect(Object.keys(narrowed).sort()).toEqual(["bash", "extensions", "grep", "memory_read", "read_file", "skill"]);
  });

  it("a read-only agent file cannot get a write tool by listing it", () => {
    const narrowed = narrowTools(
      everything(),
      makePolicy({ owner: "sneaky", readOnly: true, tools: ["write", "shell", "read", "mcp_github__create_issue"] }),
    );
    expect(Object.keys(narrowed)).not.toContain("write_file");
    expect(Object.keys(narrowed)).not.toContain("edit_file");
    expect(Object.keys(narrowed)).not.toContain("mcp_github__create_issue");
    expect(Object.keys(narrowed)).toContain("bash");
  });

  it("honours an allowlist and a denylist for a normal agent, and never adds a tool", () => {
    const policy = makePolicy({
      owner: "qa",
      readOnly: false,
      tools: ["read", "bash"],
      disallowedTools: ["delete_file"],
    });
    const names = Object.keys(narrowTools(everything(), policy)).sort();
    expect(names).toEqual(["bash", "extensions", "grep", "read_file", "skill"]);
    expect(toolAllowed(makePolicy({ owner: "x", readOnly: false, tools: ["ghost_tool"] }), "ghost_tool")).toBe(true);
    // Listing a tool that was never in the run's set adds nothing: narrowing only filters what exists.
    expect(
      Object.keys(
        narrowTools(
          { read_file: fake("r") },
          makePolicy({ owner: "x", readOnly: false, tools: ["write_file", "read_file"] }),
        ),
      ),
    ).toEqual(["read_file"]);
  });

  it("scenario E: even if a mutating tool is injected into a read-only run, the guard refuses it before it runs", async () => {
    let ran = 0;
    const tools: ToolSet = {
      write_file: fake("write_file", () => {
        ran++;
        return { success: true };
      }),
      bash: fake("bash", () => {
        ran++;
        return { success: true, output: "ran" };
      }),
      mcp_x__do: fake("mcp", () => {
        ran++;
        return { success: true };
      }),
    };
    const policy = makePolicy({ owner: "auditor", readOnly: true });
    const guarded = guardTools(tools, policy, { cwd: () => process.cwd() });
    const call = async (name: string, input: Record<string, unknown>) =>
      (
        guarded[name] as unknown as {
          execute: (i: unknown, o: unknown) => Promise<{ success: boolean; output?: string }>;
        }
      ).execute(input, {});
    expect((await call("write_file", { path: "x", content: "y" })).success).toBe(false);
    expect((await call("mcp_x__do", {})).success).toBe(false);
    expect((await call("bash", { command: "echo hi > pwned.txt" })).success).toBe(false);
    expect((await call("bash", { command: "ls", background: true })).success).toBe(false);
    expect(ran).toBe(0);
    expect((await call("bash", { command: "ls -la" })).success).toBe(true);
    expect(ran).toBe(1);
  });

  it("scenario E, end to end on disk: a read-only run leaves the workspace byte-for-byte unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "shelra-ro-"));
    try {
      writeFileSync(join(dir, "keep.txt"), "original");
      const { spawnSync } = await import("node:child_process");
      const executed: string[] = [];
      const realBash = tool({
        description: "bash",
        inputSchema: z.object({ command: z.string(), background: z.boolean().optional() }),
        execute: async ({ command }) => {
          executed.push(command);
          const shell = process.platform === "win32" ? "powershell.exe" : "sh";
          const args =
            process.platform === "win32" ? ["-NoProfile", "-NonInteractive", "-Command", command] : ["-c", command];
          const result = spawnSync(shell, args, { cwd: dir, encoding: "utf8" });
          return { success: result.status === 0, output: `${result.stdout}${result.stderr}` };
        },
      });
      const guarded = applyPolicy({ bash: realBash }, makePolicy({ owner: "ro", readOnly: true }), { cwd: () => dir });
      const run = (command: string) =>
        (
          guarded.bash as unknown as {
            execute: (i: unknown, o: unknown) => Promise<{ success: boolean; output?: string }>;
          }
        ).execute({ command }, {});
      for (const attack of [
        "echo pwned > made.txt",
        "echo pwned >> keep.txt",
        "cat keep.txt > copy.txt",
        "touch made2.txt",
        "rm keep.txt",
        "sed -i 's/original/changed/' keep.txt",
        "ls | tee made3.txt",
        "printf x | sort -o made4.txt",
        "find . -name keep.txt -delete",
        "mkdir made5",
        "cp keep.txt made6.txt",
        "mv keep.txt gone.txt",
        "ls && touch made7.txt",
        "ls; touch made8.txt",
        "echo $(touch made9.txt)",
        "node -e \"require('fs').writeFileSync('made10.txt','x')\"",
      ]) {
        expect((await run(attack)).success, attack).toBe(false);
      }
      expect(executed).toEqual([]);
      expect(readFileSync(join(dir, "keep.txt"), "utf8")).toBe("original");
      for (const made of [
        "made.txt",
        "copy.txt",
        "made2.txt",
        "made3.txt",
        "made4.txt",
        "made5",
        "made6.txt",
        "gone.txt",
        "made7.txt",
        "made8.txt",
        "made9.txt",
        "made10.txt",
      ]) {
        expect(existsSync(join(dir, made)), made).toBe(false);
      }
      const positive = await run("cat keep.txt");
      expect(positive.success).toBe(true);
      expect(positive.output).toContain("original");
      expect(executed).toEqual(["cat keep.txt"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("expands groups and reports names it does not understand", () => {
    expect(expandToolNames(["read", "web"]).tools.has("grep")).toBe(true);
    expect(expandToolNames(["Bash(rm *)", "grep"]).unknown).toEqual(["Bash(rm *)"]);
  });
});

describe("WriteCoordinator: two agents never overwrite the same file silently", () => {
  it("lets the first agent hold a file and refuses the second, the main agent, and releases at the end", async () => {
    const coordinator = new WriteCoordinator();
    const written: string[] = [];
    const base: ToolSet = {
      write_file: tool({
        description: "w",
        inputSchema: z.object({ path: z.string(), content: z.string() }),
        execute: async ({ path, content }) => {
          written.push(`${path}=${content}`);
          return { success: true };
        },
      }),
    };
    const a = guardTools(base, makePolicy({ owner: "agent-a", readOnly: false }), {
      cwd: () => "/w",
      coordinator,
      leaseOwner: "agent-a",
    });
    const b = guardTools(base, makePolicy({ owner: "agent-b", readOnly: false }), {
      cwd: () => "/w",
      coordinator,
      leaseOwner: "agent-b",
    });
    const main = guardTools(base, null, { cwd: () => "/w", coordinator, leaseOwner: null });
    const call = (set: ToolSet, input: Record<string, unknown>) =>
      (
        set.write_file as unknown as {
          execute: (i: unknown, o: unknown) => Promise<{ success: boolean; output?: string }>;
        }
      ).execute(input, {});
    expect((await call(a, { path: "src/x.ts", content: "A" })).success).toBe(true);
    expect((await call(a, { path: "src/x.ts", content: "A2" })).success).toBe(true);
    const refused = await call(b, { path: "./src/x.ts", content: "B" });
    expect(refused.success).toBe(false);
    expect(refused.output).toMatch(/agent-a/u);
    expect((await call(main, { path: "src/x.ts", content: "M" })).success).toBe(false);
    expect((await call(b, { path: "src/y.ts", content: "B" })).success).toBe(true);
    expect(coordinator.release("agent-a")).toBe(1);
    expect((await call(b, { path: "src/x.ts", content: "B" })).success).toBe(true);
    expect(written).toEqual(["src/x.ts=A", "src/x.ts=A2", "src/y.ts=B", "src/x.ts=B"]);
  });

  it("serializes truly parallel writers to one file", async () => {
    const coordinator = new WriteCoordinator();
    let counter = 0;
    const base: ToolSet = {
      write_file: tool({
        description: "w",
        inputSchema: z.object({ path: z.string() }),
        execute: async () => ({ success: true, n: ++counter }),
      }),
    };
    const sets = ["a", "b", "c", "d"].map((owner) =>
      guardTools(base, makePolicy({ owner, readOnly: false }), { cwd: () => "/w", coordinator, leaseOwner: owner }),
    );
    const results = await Promise.all(
      sets.map((set) =>
        (set.write_file as unknown as { execute: (i: unknown, o: unknown) => Promise<{ success: boolean }> }).execute(
          { path: "same.ts" },
          {},
        ),
      ),
    );
    expect(results.filter((result) => result.success)).toHaveLength(1);
    mkdirSync(tmpdir(), { recursive: true });
  });
});

afterEach(() => undefined);
