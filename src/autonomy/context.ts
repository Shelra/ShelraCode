import { type Dirent, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import type { CriterionResult, Objective, Task } from "./types";

/**
 * The context engine.
 *
 * Intelligence calls get a targeted working set, not the repository. Everything here is
 * deterministic — directory walks, extension filters, size caps — because deciding *what*
 * to show a model is a mechanical problem, and paying a model to do it would be exactly
 * the inefficiency the runtime exists to remove.
 */

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "out",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".shelra",
  ".cache",
  "coverage",
  ".turbo",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".toml",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
  ".svelte",
  ".vue",
  ".astro",
  ".sh",
  ".sql",
]);

export interface RepoFile {
  path: string;
  size: number;
}

export interface WorkspaceSnapshot {
  root: string;
  files: RepoFile[];
  truncated: boolean;
  manifests: Record<string, string>;
}

/** Bounded recursive listing. Depth and count caps keep this fast on large repos. */
export function scanWorkspace(root: string, maxFiles = 400, maxDepth = 6): WorkspaceSnapshot {
  const files: RepoFile[] = [];
  let truncated = false;

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || files.length >= maxFiles) return;
    let entries: Dirent<string>[];
    try {
      // Bun's Node declarations choose the Buffer overload for ReturnType<typeof readdirSync>
      // even though an explicitly UTF-8 directory read returns string-named Dirents.
      entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" }) as Dirent<string>[];
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      if (entry.name.startsWith(".") && entry.name !== ".env.example") {
        if (entry.isDirectory()) continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        try {
          const st = statSync(full);
          files.push({ path: relative(root, full).split(sep).join("/"), size: st.size });
        } catch {
          // Unreadable entry; skip.
        }
      }
    }
  };

  walk(root, 0);

  const manifests: Record<string, string> = {};
  for (const name of ["package.json", "pyproject.toml", "go.mod", "Cargo.toml", "requirements.txt"]) {
    const p = join(root, name);
    if (existsSync(p)) {
      try {
        manifests[name] = readFileSync(p, "utf8").slice(0, 4000);
      } catch {
        // Skip unreadable manifest.
      }
    }
  }

  return { root, files, truncated, manifests };
}

export function renderTree(snapshot: WorkspaceSnapshot, limit = 200): string {
  if (snapshot.files.length === 0) return "(empty workspace)";
  const shown = snapshot.files.slice(0, limit);
  const lines = shown.map((f) => `  ${f.path}`);
  if (snapshot.files.length > limit || snapshot.truncated) {
    lines.push(`  … and ${snapshot.files.length - shown.length} more files`);
  }
  return lines.join("\n");
}

export function readFileSafe(root: string, relPath: string, maxBytes = 24_000): string | null {
  const full = join(root, relPath);
  if (!existsSync(full)) return null;
  try {
    if (statSync(full).size > maxBytes * 4) return null;
    const text = readFileSync(full, "utf8");
    return text.length > maxBytes ? `${text.slice(0, maxBytes)}\n… (truncated)` : text;
  } catch {
    return null;
  }
}

/**
 * Score files by how likely they are to matter to the current work.
 *
 * Signals are cheap and blunt on purpose: filename token overlap with the task text, plus
 * a bonus for files a previous step already touched. This is a relevance heuristic, not a
 * semantic index — no embedding store earns its complexity until measurement says it does.
 */
export function selectRelevantFiles(
  snapshot: WorkspaceSnapshot,
  focusText: string,
  recentlyChanged: string[],
  limit = 12,
): string[] {
  const tokens = focusText
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((t) => t.length > 2);
  const recent = new Set(recentlyChanged);

  const scored = snapshot.files
    .filter((f) => TEXT_EXTENSIONS.has(extname(f.path).toLowerCase()))
    .map((f) => {
      const lower = f.path.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (lower.includes(token)) score += 3;
      }
      if (recent.has(f.path)) score += 8;
      // Entry points are disproportionately useful context.
      if (/(^|\/)(index|main|app|server)\.[a-z]+$/u.test(lower)) score += 2;
      if (lower.endsWith("index.html")) score += 3;
      if (f.size > 120_000) score -= 5;
      return { path: f.path, score };
    })
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked = scored.slice(0, limit).map((f) => f.path);
  for (const path of recentlyChanged) {
    if (!picked.includes(path) && snapshot.files.some((f) => f.path === path)) picked.push(path);
  }
  return picked.slice(0, limit + 4);
}

export function renderFileContext(root: string, paths: string[], maxTotalBytes = 60_000): string {
  const parts: string[] = [];
  let used = 0;
  for (const path of paths) {
    if (used >= maxTotalBytes) break;
    const content = readFileSafe(root, path, Math.min(20_000, maxTotalBytes - used));
    if (content === null) continue;
    used += content.length;
    parts.push(`--- ${path} ---\n${content}`);
  }
  return parts.length > 0 ? parts.join("\n\n") : "(no files read)";
}

/** The failure evidence a diagnosis call needs, and nothing else. */
export function renderFailureContext(objective: Objective, failures: CriterionResult[]): string {
  const lines: string[] = [];
  lines.push("FAILING ACCEPTANCE CRITERIA:");
  for (const f of failures) {
    lines.push(`- [${f.id}] ${f.description}\n  observed: ${f.detail}`);
  }

  const recentActions = objective.actions.slice(-8).filter((a) => a.command || a.browser);
  if (recentActions.length > 0) {
    lines.push("\nRECENT EXECUTION EVIDENCE:");
    for (const action of recentActions) {
      if (action.command) {
        const c = action.command;
        lines.push(
          `$ ${c.command}\n  exit=${c.exitCode ?? "none"} state=${c.state}` +
            (c.stderr.trim() ? `\n  stderr: ${c.stderr.trim().slice(-1200)}` : "") +
            (!c.stderr.trim() && c.stdout.trim() ? `\n  stdout: ${c.stdout.trim().slice(-800)}` : ""),
        );
      }
      if (action.browser) {
        const b = action.browser;
        if (b.consoleErrors.length || b.pageErrors.length || b.failedRequests.length) {
          lines.push(
            `browser ${b.url}:` +
              (b.pageErrors.length ? `\n  page errors: ${b.pageErrors.slice(0, 5).join(" | ")}` : "") +
              (b.consoleErrors.length ? `\n  console errors: ${b.consoleErrors.slice(0, 5).join(" | ")}` : "") +
              (b.failedRequests.length ? `\n  failed requests: ${b.failedRequests.slice(0, 5).join(" | ")}` : ""),
          );
        }
      }
    }
  }

  // Telling the model what has already been tried is what stops it re-proposing a dead fix.
  if (objective.repairs.length > 0) {
    lines.push("\nREPAIRS ALREADY ATTEMPTED (do not repeat these):");
    for (const r of objective.repairs) {
      lines.push(
        `- attempt ${r.attempt}: ${r.strategy} (cause believed: ${r.diagnosis}) -> ${r.resolved ? "resolved" : "did not resolve"}`,
      );
    }
  }

  return lines.join("\n");
}

export function renderTaskContext(objective: Objective, task: Task, snapshot: WorkspaceSnapshot): string {
  const changed = objective.actions.filter((a) => a.fileChange?.changed).map((a) => a.fileChange?.path ?? "");
  const relevant = selectRelevantFiles(snapshot, `${task.description} ${objective.request}`, changed);
  const sections: string[] = [];
  sections.push(`WORKSPACE: ${objective.workspace}`);
  sections.push(`FILES:\n${renderTree(snapshot)}`);
  if (Object.keys(snapshot.manifests).length > 0) {
    sections.push(
      `MANIFESTS:\n${Object.entries(snapshot.manifests)
        .map(([k, v]) => `--- ${k} ---\n${v}`)
        .join("\n")}`,
    );
  }
  if (relevant.length > 0) {
    sections.push(`RELEVANT FILE CONTENTS:\n${renderFileContext(objective.workspace, relevant)}`);
  }
  return sections.join("\n\n");
}
