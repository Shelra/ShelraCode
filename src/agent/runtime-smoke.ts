import { existsSync, readFileSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { join } from "node:path";
import { observePage } from "../exec/browser";
import { ProcessManager } from "../exec/process";
import { startStaticServer, stopStaticServer } from "../exec/static-server";
import type { BrowserObservation } from "../exec/types";
import { pageProblems } from "./local-urls";
import { splitShellCommands } from "./verification-evidence";

/**
 * The app a turn changed, opened by the host (audit gap #1). Seen live 2026-09-25: a new 3D racing game ended its
 * first turn "Verified by running the application and observing the 3D scene" while its page answered 500 and loaded
 * `../src/index.ts`, a TypeScript file no browser runs; the person found a blank page and a 404 two turns later. Nothing
 * in the turn had ever loaded the page. The host now serves the app the way the person would open it, loads it in a
 * headless browser, presses the keys and clicks the button a person starting it would, and holds what it sees against
 * the turn: an uncaught error, a request the app's own server fails, or a screen of one color.
 */

/** Files whose change can change what a web app shows. */
const WEB_FILE_RE = /(?:\.(?:html?|css|scss|sass|less|[cm]?[jt]sx?|vue|svelte|astro)|(?:^|[\\/])package\.json)$/iu;

/** Whether a turn that changed these files changed something a web app shows. */
export function changesWebFiles(paths: readonly string[]): boolean {
  return paths.some((path) => WEB_FILE_RE.test(path));
}

export type WebTarget =
  /** Files a static server shows as they are: a plain site, or a static server the project's script runs. */
  | { kind: "static"; dir: string; how: string }
  /** A Vite dev server, started on a free port with the script's own arguments. */
  | { kind: "vite"; args: string[]; how: string }
  /** A dev server Shelra does not start yet; the app is only opened when the session runs it. */
  | { kind: "unsupported"; how: string };

/** Static file servers: the host serves the same folder itself, with no process and no port of the person's. */
const STATIC_SERVERS = new Set(["http-server", "serve", "live-server", "lite-server", "sirv"]);
/** Their flags that take a value, so the value is not read as the folder. */
const VALUE_FLAGS = new Set(["-p", "--port", "-a", "--address", "-l", "--listen", "-P", "--proxy", "--host", "-c"]);
/** Dev servers that compile the app: its source files are not what a browser runs. */
const BUNDLERS =
  /\b(?:vite|next|react-scripts|webpack(?:-dev-server)?|parcel|astro|nuxi?|wds|web-dev-server|es-dev-server|vue-cli-service|remix|gatsby|snowpack|rsbuild|rspack|ng)\b/u;
/** The scripts a person runs to see the app, in the order they are tried. */
const RUN_SCRIPTS = ["dev", "start", "serve", "preview"];
/** Folders a plain site's index.html is looked for in, in order. */
const SITE_FOLDERS = [".", "public", "www", "dist", "src"];

function scriptsOf(workspace: string): Record<string, string> {
  try {
    const manifest = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")) as { scripts?: unknown };
    const scripts = manifest.scripts && typeof manifest.scripts === "object" ? manifest.scripts : {};
    return Object.fromEntries(
      Object.entries(scripts as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

/** A command's program and arguments, past environment assignments and the runners that only launch it. */
function programOf(tokens: readonly string[]): { program: string; args: string[] } {
  let rest = tokens.filter((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(token));
  for (let depth = 0; depth < 3; depth += 1) {
    const head = (rest[0] ?? "").toLowerCase();
    if (head === "npx" || head === "bunx" || head === "cross-env" || head === "pnpx") rest = rest.slice(1);
    else if ((head === "npm" || head === "pnpm" || head === "yarn") && rest[1] === "exec") rest = rest.slice(2);
    else break;
    // `npx -y http-server`, `npm exec -- vite`
    while (rest[0]?.startsWith("-")) rest = rest.slice(1);
  }
  const program = (rest[0] ?? "")
    .replace(/\\/gu, "/")
    .split("/")
    .pop()
    ?.toLowerCase()
    .replace(/\.(?:cmd|exe)$/u, "");
  return { program: program ?? "", args: rest.slice(1) };
}

/** The folder a static server's arguments name, or the project folder. */
function folderArgument(args: readonly string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;
    if (VALUE_FLAGS.has(arg)) index += 1;
    else if (!arg.startsWith("-")) return arg;
  }
  return ".";
}

/**
 * How the app in `workspace` is opened: the first run script (`dev`, `start`, `serve`, `preview`) that runs a static
 * server or Vite, else an index.html in the project or its public, www, dist or src folder. A project that builds with a
 * bundler is never served from its source, which only its dev server can run; null when there is no app to open.
 */
export function findWebTarget(workspace: string): WebTarget | null {
  const scripts = scriptsOf(workspace);
  for (const name of RUN_SCRIPTS) {
    const script = scripts[name];
    if (!script) continue;
    // The server is the last command of a chain like `tsc && vite`.
    const { program, args } = programOf(splitShellCommands(script).at(-1) ?? []);
    const how = `\`npm run ${name}\` (${script})`;
    if (STATIC_SERVERS.has(program)) {
      const dir = join(workspace, folderArgument(args));
      if (existsSync(dir)) return { kind: "static", dir, how };
    }
    if (program === "vite" && !["build", "optimize"].includes(args[0] ?? "")) return { kind: "vite", args, how };
    if (BUNDLERS.test(program)) return { kind: "unsupported", how };
  }
  if (Object.values(scripts).some((script) => BUNDLERS.test(script))) {
    return { kind: "unsupported", how: "a project built by a bundler, with no dev script Shelra can start" };
  }
  for (const folder of SITE_FOLDERS) {
    if (existsSync(join(workspace, folder, "index.html"))) {
      return { kind: "static", dir: join(workspace, folder), how: `${folder === "." ? "" : `${folder}/`}index.html` };
    }
  }
  return null;
}

export interface SmokeResult {
  /** `unavailable`: the app could not be opened (nothing to start it with, no browser); it says nothing either way. */
  status: "passed" | "failed" | "unavailable";
  url?: string;
  /** How the app was reached, for the person: "the session's server", "`npm run dev` (vite)". */
  how: string;
  /** What did not work, one finding each. */
  problems: string[];
  /** Why the app could not be opened or observed. */
  note?: string;
}

type Observe = (url: string) => Promise<BrowserObservation>;

const observeApp: Observe = (url) =>
  observePage(url, {
    viewport: { width: 1280, height: 720 },
    assertions: [],
    timeoutMs: 30_000,
    waitUntil: "load",
    settleMs: 1_500,
    interact: true,
    measureBlank: true,
  });

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "gu");

/** Text without terminal colors: Vite prints its URL's port in bold, which splits the URL. */
export function withoutAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** The page to open on a server: the one the answer names on that server, else its root. */
function pageOn(base: string, answerUrls: readonly string[]): string {
  const origin = new URL(base).origin.replace("//localhost", "//127.0.0.1");
  const named = answerUrls.find((url) => new URL(url).origin.replace("//localhost", "//127.0.0.1") === origin);
  return named ?? base;
}

function judge(url: string, how: string, observation: BrowserObservation): SmokeResult {
  if (!observation.ok && observation.error && observation.pageErrors.length === 0) {
    const error = observation.error.replace(/\s+/gu, " ").slice(0, 200);
    // A browser that is not installed, or cannot start, observed nothing.
    if (/Executable doesn't exist|Cannot find module|browserType\.launch|playwright/iu.test(error)) {
      return { status: "unavailable", url, how, problems: [], note: `no headless browser: ${error}` };
    }
    return { status: "failed", url, how, problems: [`the page did not load: ${error}`] };
  }
  const problems = pageProblems(observation);
  if (observation.status !== undefined && observation.status >= 400) {
    problems.unshift(`the page answered HTTP ${observation.status}`);
  }
  if (observation.distinctColors === 1 && problems.length === 0) {
    problems.push("the screen is blank: one color everywhere after the page loaded and keys were pressed");
  }
  return { status: problems.length > 0 ? "failed" : "passed", url, how, problems };
}

/**
 * Opens the app and judges it. A server the session runs is used as it is and left running; otherwise the host starts
 * what it needs and stops it afterwards. Never throws: what could not be done is an `unavailable` result.
 */
export async function runSmokeCheck(input: {
  workspace: string;
  target: WebTarget;
  /** Local URLs the session's background processes printed: the app as the model runs it. */
  sessionUrls: readonly string[];
  /** Local URLs the answer names, to open the page it points at. */
  answerUrls: readonly string[];
  signal?: AbortSignal;
  observe?: Observe;
}): Promise<SmokeResult> {
  const observe = input.observe ?? observeApp;
  // The session's server, when it is clear which one serves the app: the one whose page the answer names, or the only
  // one. A session running an API next to its front end would otherwise have its API opened as the app.
  const origin = (url: string) => new URL(url).origin.replace("//localhost", "//127.0.0.1");
  const origins = new Set(input.sessionUrls.map(origin));
  const running =
    input.sessionUrls.find((url) => input.answerUrls.some((named) => origin(named) === origin(url))) ??
    (origins.size === 1 ? input.sessionUrls[0] : undefined);
  if (running) {
    const url = pageOn(running, input.answerUrls);
    return judge(url, "the server this session runs", await observe(url));
  }
  const { target } = input;
  if (target.kind === "unsupported") {
    return { status: "unavailable", how: target.how, problems: [], note: `Shelra does not start ${target.how} yet` };
  }
  if (target.kind === "static") {
    let server: Awaited<ReturnType<typeof startStaticServer>> | null = null;
    try {
      server = await startStaticServer(target.dir);
      const url = `${server.url}/`;
      return judge(url, `${target.how}, served as static files`, await observe(url));
    } catch (error) {
      return { status: "unavailable", how: target.how, problems: [], note: String(error).slice(0, 200) };
    } finally {
      if (server) await stopStaticServer(server.id).catch(() => undefined);
    }
  }
  const bin = join(input.workspace, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
  if (!existsSync(bin)) {
    return { status: "unavailable", how: target.how, problems: [], note: "vite is not installed (npm install)" };
  }
  const manager = new ProcessManager();
  let started: Awaited<ReturnType<ProcessManager["start"]>> | null = null;
  try {
    const port = await freePort();
    const args = target.args.filter((arg, index, all) => {
      const previous = all[index - 1];
      if (/^(?:--open|-o|--strictPort)$/u.test(arg) || /^--(?:open|port|host)=/u.test(arg)) return false;
      if (/^(?:--port|--host)$/u.test(arg)) return false;
      return !(previous !== undefined && /^(?:--port|--host)$/u.test(previous));
    });
    started = await manager.start({
      command: ["npx", "vite", ...args, "--port", String(port), "--strictPort", "--host", "127.0.0.1"].join(" "),
      cwd: input.workspace,
      port,
      env: { BROWSER: "none", PORT: String(port) },
      readyTimeoutMs: 60_000,
      signal: input.signal,
    });
    const url = `http://127.0.0.1:${port}/`;
    return judge(url, `${target.how} on port ${port}`, await observe(url));
  } catch (error) {
    const reason = String(error instanceof Error ? error.message : error).slice(0, 300);
    // The dev server exiting on its own is the app failing to start; not getting ready in time says nothing.
    return /did not become ready|cancelled/iu.test(reason)
      ? { status: "unavailable", how: target.how, problems: [], note: reason }
      : { status: "failed", how: target.how, problems: [`the dev server did not start: ${reason}`] };
  } finally {
    if (started) await manager.stop(started.id).catch(() => undefined);
  }
}

/** How a result reads in a note or verdict. */
export function describeSmoke(result: SmokeResult): string {
  const where = result.url ? `${result.url} (${result.how})` : result.how;
  if (result.status === "passed") return `the app at ${where} loaded in a headless browser with no errors`;
  if (result.status === "unavailable") return `Shelra could not open the app (${where}): ${result.note ?? "unknown"}`;
  return `the app at ${where} does not work in a headless browser: ${result.problems.join("; ")}`;
}

/** What the model hears when the app does not work. */
export function smokeRepairRequest(result: SmokeResult): string {
  return [
    `Completion blocked: after your last change Shelra opened the app at ${result.url ?? "its page"} (${result.how}) in a headless browser, pressed Enter, Space and ArrowUp and clicked the first button, and it does not work:`,
    ...result.problems.map((problem) => `- ${problem}`),
    "Find the cause (the errors above; the server's output with process_logs; a build or type check), fix it, and do not say the app works until it loads without errors.",
  ].join("\n");
}
