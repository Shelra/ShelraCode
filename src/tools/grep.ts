import { stat } from "fs/promises";
import path from "path";
import { ripgrep } from "ripgrep";
import { resolveWorkspacePath, viewBase, type WorkspaceView } from "../security/workspace-guard";
import type { ToolResult } from "../types/index";
import { perfCount } from "../utils/perf-probe";
import { type RipgrepRun, ripgrepOffThread } from "./ripgrep-client";
import { trimRipgrepOutput } from "./ripgrep-output";

const MAX_MATCHES = 100;
const MAX_LINE_LENGTH = 2000;

interface GrepParams {
  pattern: string;
  path?: string;
  include?: string;
}

interface RipgrepMatch {
  type: "match";
  data: {
    path: { text: string };
    lines: { text: string };
    line_number: number;
    absolute_offset: number;
    submatches: Array<{ match: { text: string }; start: number; end: number }>;
  };
}

interface GrepRow {
  file: string;
  line: number;
  text: string;
  mtime: number;
}

function buildArgs(params: GrepParams): string[] {
  const args = ["--json", "--hidden", "--glob=!.git/*", "--no-messages"];

  if (params.include) {
    args.push(`--glob=${params.include}`);
  }

  args.push("--", params.pattern, params.path ?? ".");
  return args;
}

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !/^error:?$/iu.test(line))
      ?.slice(0, 300) ?? ""
  );
}

function cleanEnv(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  delete env.RIPGREP_CONFIG_PATH;
  return env;
}

function cleanPath(file: string): string {
  return path.normalize(file.replace(/^\.[\\/]/, ""));
}

/**
 * The matches of ripgrep's JSON output. The output was already cut to the first MAX_RANKED_MATCHES matches and
 * counted (see `trimRipgrepOutput`), so this parses at most a few thousand lines.
 */
function parseMatches(stdout: string): RipgrepMatch["data"][] {
  const matches: RipgrepMatch["data"][] = [];
  for (const line of stdout.split(String.fromCharCode(10))) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type !== "match") continue;
      matches.push({
        ...parsed.data,
        path: { ...parsed.data.path, text: cleanPath(parsed.data.path.text) },
      });
    } catch {
      // skip malformed lines
    }
  }
  return matches;
}

/** One search: on the worker thread when there is one, else in this process. */
async function search(args: string[], searchCwd: string): Promise<RipgrepRun> {
  const env = cleanEnv();
  const offThread = await ripgrepOffThread(args, env, searchCwd);
  if (offThread) {
    perfCount("grep.offThread");
    return offThread;
  }
  perfCount("grep.inProcess");
  const result = await ripgrep(args, { buffer: true, env, preopens: { ".": searchCwd } });
  const trimmed = trimRipgrepOutput((result.stdout as string | undefined) ?? "");
  return {
    code: result.code ?? 1,
    stdout: trimmed.stdout,
    total: trimmed.total,
    stderr: (result.stderr as string | undefined) ?? "",
  };
}

async function getFileMtimes(files: string[], cwd: string): Promise<Map<string, number>> {
  const times = new Map<string, number>();
  await Promise.all(
    files.map(async (file) => {
      const fullPath = path.isAbsolute(file) ? file : path.join(cwd, file);
      try {
        const info = await stat(fullPath);
        times.set(file, info.mtimeMs);
      } catch {
        // skip inaccessible files
      }
    }),
  );
  return times;
}

export async function executeGrep(params: GrepParams, view: WorkspaceView): Promise<ToolResult> {
  if (!params.pattern) {
    return { success: false, error: "pattern is required" };
  }

  const cwd = viewBase(view);
  // The search stays inside the project like every other file tool: it could read ~/.shelra/auth.json otherwise.
  let searchPath = cwd;
  if (params.path) {
    try {
      searchPath = resolveWorkspacePath(params.path, view).path;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  let searchCwd: string;
  let searchTarget: string | undefined;
  try {
    const info = await stat(searchPath);
    if (info.isDirectory()) {
      searchCwd = searchPath;
    } else {
      searchCwd = path.dirname(searchPath);
      searchTarget = path.relative(searchCwd, searchPath);
    }
  } catch {
    return { success: false, error: `Path not found: ${params.path ?? searchPath}` };
  }

  const args = buildArgs({ ...params, path: searchTarget });

  try {
    const result = await search(args, searchCwd);

    const stdout = result.stdout;
    const code = result.code;

    if (code !== 0 && code !== 1 && code !== 2) {
      const stderr = result.stderr;
      return { success: false, error: stderr.trim() || `ripgrep failed with code ${code}` };
    }

    if (code === 1) {
      return { success: true, output: "No matches found." };
    }

    const matches = parseMatches(stdout);
    const matchCount = result.total;
    if (matches.length === 0) {
      // Exit 2 with nothing found and a message is a pattern ripgrep could not read ("foo(", a lookahead), not an
      // empty result: saying "No matches" sent the model to conclude the code does not exist.
      const reason = code === 2 ? firstLine(result.stderr) : "";
      if (reason) {
        return {
          success: false,
          error: `grep could not run this pattern: ${reason}. ripgrep uses Rust regex syntax (no lookahead or backreferences; escape ( ) [ ] { } . * + ? with a backslash), or use bash with rg -F for a literal.`,
        };
      }
      const msg = code === 2 ? "No matches found.\n(Some paths were inaccessible and skipped)" : "No matches found.";
      return { success: true, output: msg };
    }

    const rebase = (file: string) => path.relative(cwd, path.resolve(searchCwd, file));

    const uniqueFiles = [...new Set(matches.map((m) => rebase(m.path.text)))];
    const mtimes = await getFileMtimes(uniqueFiles, cwd);

    const rows: GrepRow[] = matches.map((m) => {
      const file = rebase(m.path.text);
      return { file, line: m.line_number, text: m.lines.text.replace(/\n$/, ""), mtime: mtimes.get(file) ?? 0 };
    });
    rows.sort((a, b) => b.mtime - a.mtime);

    const total = matchCount;
    const truncated = total > MAX_MATCHES;
    const display = truncated ? rows.slice(0, MAX_MATCHES) : rows;

    const output: string[] = [`Found ${total} matches${truncated ? ` (showing first ${MAX_MATCHES})` : ""}`];

    let currentFile = "";
    for (const row of display) {
      if (currentFile !== row.file) {
        if (currentFile !== "") output.push("");
        currentFile = row.file;
        output.push(`${row.file}:`);
      }
      const text = row.text.length > MAX_LINE_LENGTH ? `${row.text.substring(0, MAX_LINE_LENGTH)}...` : row.text;
      output.push(`  Line ${row.line}: ${text}`);
    }

    if (truncated) {
      output.push("");
      output.push(
        `(Results truncated: showing ${MAX_MATCHES} of ${total} matches. Consider using a more specific path or pattern.)`,
      );
    }

    if (code === 2) {
      output.push("");
      output.push("(Some paths were inaccessible and skipped)");
    }

    return { success: true, output: output.join("\n") };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Grep failed: ${msg}` };
  }
}
