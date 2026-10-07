import { execFile } from "child_process";
import { basename, resolve } from "path";
import { findGitRoot } from "./git-root.js";

const REFRESH_TTL_MS = 30_000;
const EOL = String.fromCharCode(10);
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".tiff",
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mov",
  ".mkv",
  ".flac",
  ".ogg",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".7z",
  ".rar",
  ".xz",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".o",
  ".a",
  ".pyc",
  ".class",
  ".wasm",
]);

function isBinaryPath(filePath: string): boolean {
  const ext = filePath.lastIndexOf(".");
  if (ext === -1) return false;
  return BINARY_EXTENSIONS.has(filePath.slice(ext).toLowerCase());
}

/**
 * The project's files, listed beside the event loop: this ran `execSync` with a five second ceiling, so typing `@`
 * in a big repository held the whole terminal for as long as git took.
 */
function collectFiles(cwd: string): Promise<string[]> {
  const gitRoot = findGitRoot(cwd);
  const run = (file: string, args: string[], dir: string): Promise<string | null> =>
    new Promise((resolve) => {
      execFile(
        file,
        args,
        { cwd: dir, encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: 5000, windowsHide: true },
        (error, stdout) => resolve(error ? null : String(stdout)),
      );
    });
  const listing = gitRoot
    ? run("git", ["ls-files", "--cached", "--others", "--exclude-standard"], gitRoot)
    : run(
        "find",
        [
          ".",
          "-type",
          "f",
          "-not",
          "-path",
          "*/node_modules/*",
          "-not",
          "-path",
          "*/.git/*",
          "-not",
          "-path",
          "*/dist/*",
        ],
        cwd,
      ).then((raw) => (raw === null ? null : raw.split(EOL).slice(0, 5000).join(EOL)));
  return listing.then((raw) =>
    raw === null
      ? []
      : raw
          .split(EOL)
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !isBinaryPath(l)),
  );
}

function scoreMatch(filePath: string, query: string): number {
  const lowerPath = filePath.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (!lowerPath.includes(lowerQuery)) return -1;

  let score = 0;
  const name = basename(filePath).toLowerCase();

  if (name === lowerQuery) score += 100;
  else if (name.startsWith(lowerQuery)) score += 60;
  else if (name.includes(lowerQuery)) score += 30;

  if (lowerPath.startsWith(lowerQuery)) score += 20;

  const idx = lowerPath.indexOf(lowerQuery);
  score -= idx * 0.1;

  score -= filePath.length * 0.05;

  return score;
}

export class FileIndex {
  private files: string[] = [];
  private cwd: string;
  private baseDir: string;
  private lastRefresh = 0;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.baseDir = findGitRoot(cwd) ?? cwd;
  }

  private refreshing: Promise<void> | null = null;

  /** One listing at a time: a call while one is running waits for it instead of starting another git process. */
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const cwd = this.cwd;
    const run = collectFiles(cwd)
      .then((files) => {
        // The folder changed while git was listing the old one: keep what is there, and list again next time.
        if (cwd !== this.cwd) return;
        this.files = files;
        this.lastRefresh = Date.now();
      })
      .finally(() => {
        if (this.refreshing === run) this.refreshing = null;
      });
    this.refreshing = run;
    return run;
  }

  updateCwd(cwd: string): void {
    if (cwd !== this.cwd) {
      this.cwd = cwd;
      this.baseDir = findGitRoot(cwd) ?? cwd;
      this.lastRefresh = 0;
      // A listing of the old folder may still be running; the next call lists the new one.
      this.refreshing = null;
    }
  }

  private async ensureFresh(): Promise<void> {
    if (Date.now() - this.lastRefresh > REFRESH_TTL_MS) {
      await this.refresh();
    }
  }

  async match(query: string, maxResults = 10): Promise<string[]> {
    await this.ensureFresh();
    if (!query) return this.files.slice(0, maxResults);

    const scored: { path: string; score: number }[] = [];
    for (const f of this.files) {
      const s = scoreMatch(f, query);
      if (s >= 0) scored.push({ path: f, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults).map((s) => s.path);
  }

  get size(): number {
    return this.files.length;
  }

  resolvePath(filePath: string): string {
    return resolve(this.baseDir, filePath);
  }
}
