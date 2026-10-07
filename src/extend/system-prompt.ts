/**
 * Custom system prompt: what a person or a project may add to, or put in place of, the base role of the agent.
 *
 *   append        text added after the base prompt (settings `systemPrompt.append`, `--append-system-prompt`)
 *   appendFile    a file whose text is added (settings `systemPrompt.appendFile`, `--append-system-prompt-file`)
 *   file          a file that REPLACES the opening role paragraph (`systemPrompt.file`, `--system-prompt-file`)
 *   profile       a named, editable file in `.shelra/prompts/<name>.md` (or `~/.shelra/prompts/`), either mode
 *
 * Replacing is explicit and narrow: it swaps the role (who the agent is and how it talks). The operating rules, the tool
 * guidance and the environment stay, and so does everything the harness enforces outside the prompt: the permission
 * engine, the read-only guard, hooks, the completion gate and Free mode do not read the prompt at all, so no text can
 * switch them off or widen what is allowed.
 *
 * The prompt is rebuilt from these sources on every turn: a changed file or setting applies from the next turn, a flag
 * from the next run (it is fixed for the process).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { containsSecret } from "../memory/gate";
import { getProductUserDir } from "../product/identity";
import { parseFrontmatter, stringOf } from "./frontmatter";
import { projectRootFor, readAllLayers, type SettingsLayer } from "./settings";
import { contentHash, listVersions, writeDefinition } from "./store";

const MAX_PROMPT_FILE_BYTES = 64 * 1024;

export interface SessionPromptFlags {
  append?: string;
  appendFile?: string;
  file?: string;
  profile?: string;
}

let sessionFlags: SessionPromptFlags | null = null;

/** Set once at startup from the command line; those values win over every settings layer for this run. */
export function setSessionPromptFlags(flags: SessionPromptFlags | null): void {
  sessionFlags = flags;
}

export interface PromptSource {
  /** Where the text came from, for `/context` and the trace. */
  label: string;
  mode: "append" | "replace";
  hash: string;
  bytes: number;
}

export interface ResolvedPrompt {
  /** Text appended after the base prompt, in order general to specific. */
  appended: string | null;
  /** Text that replaces the opening role paragraph, or null. */
  role: string | null;
  sources: PromptSource[];
  problems: string[];
}

function readPromptFile(
  path: string,
  base: string,
  label: string,
  problems: string[],
): { text: string; bytes: number } | null {
  const full = isAbsolute(path) ? path : resolve(base, path);
  try {
    if (!existsSync(full)) {
      problems.push(`${label}: ${full} does not exist`);
      return null;
    }
    const stat = statSync(full);
    if (!stat.isFile() || stat.size > MAX_PROMPT_FILE_BYTES) {
      problems.push(`${label}: ${full} is not a file under ${MAX_PROMPT_FILE_BYTES} bytes`);
      return null;
    }
    return { text: readFileSync(full, "utf8"), bytes: stat.size };
  } catch (error) {
    problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export function profilePath(root: string, name: string, scope: "project" | "user"): string {
  const base = scope === "user" ? getProductUserDir() : join(root, ".shelra");
  return join(base, "prompts", `${name.replace(/[^A-Za-z0-9._-]/gu, "-")}.md`);
}

function readProfile(
  root: string,
  name: string,
): { text: string; mode: "append" | "replace"; path: string; bytes: number } | null {
  for (const scope of ["project", "user"] as const) {
    const path = profilePath(root, name, scope);
    if (!existsSync(path)) continue;
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = parseFrontmatter(raw);
      const mode = stringOf(parsed.data.mode) === "replace" ? "replace" : "append";
      return { text: parsed.hasFrontmatter ? parsed.body : raw, mode, path, bytes: Buffer.byteLength(raw) };
    } catch {
      return null;
    }
  }
  return null;
}

/** Everything that customizes the prompt for a session in `cwd`, resolved from the files and flags as they are now. */
export function resolveSystemPrompt(cwd: string): ResolvedPrompt {
  const root = projectRootFor(cwd);
  const layers = readAllLayers(root);
  const problems: string[] = [];
  const sources: PromptSource[] = [];
  const appended: string[] = [];
  let role: string | null = null;
  const add = (label: string, text: string, bytes: number, mode: "append" | "replace") => {
    if (!text.trim()) return;
    sources.push({ label, mode, hash: contentHash(text), bytes });
    if (mode === "append") appended.push(text.trim());
    else role = text.trim();
  };
  // General to specific: user, project, local, then the command line.
  for (const layer of ["user", "project", "local"] as SettingsLayer[]) {
    const settings = layers[layer].data.systemPrompt;
    if (!settings || typeof settings !== "object") continue;
    const label = `${layer} settings`;
    if (typeof settings.append === "string")
      add(`${label} (append)`, settings.append, Buffer.byteLength(settings.append), "append");
    if (typeof settings.appendFile === "string") {
      const file = readPromptFile(
        settings.appendFile,
        layer === "user" ? getProductUserDir() : root,
        `${label} appendFile`,
        problems,
      );
      if (file) add(`${label} (appendFile ${settings.appendFile})`, file.text, file.bytes, "append");
    }
    if (typeof settings.file === "string") {
      const file = readPromptFile(
        settings.file,
        layer === "user" ? getProductUserDir() : root,
        `${label} file`,
        problems,
      );
      if (file) add(`${label} (role file ${settings.file})`, file.text, file.bytes, "replace");
    }
    const profile = (settings as { profile?: unknown }).profile;
    if (typeof profile === "string" && profile) {
      const found = readProfile(root, profile);
      if (found) add(`${label} (profile ${profile}: ${found.path})`, found.text, found.bytes, found.mode);
      else problems.push(`${label}: profile "${profile}" was not found in .shelra/prompts or ~/.shelra/prompts`);
    }
  }
  if (sessionFlags) {
    if (sessionFlags.profile) {
      const found = readProfile(root, sessionFlags.profile);
      if (found) add(`--profile ${sessionFlags.profile} (${found.path})`, found.text, found.bytes, found.mode);
      else problems.push(`--profile: "${sessionFlags.profile}" was not found`);
    }
    if (sessionFlags.file) {
      const file = readPromptFile(sessionFlags.file, process.cwd(), "--system-prompt-file", problems);
      if (file) add(`--system-prompt-file ${sessionFlags.file}`, file.text, file.bytes, "replace");
    }
    if (sessionFlags.appendFile) {
      const file = readPromptFile(sessionFlags.appendFile, process.cwd(), "--append-system-prompt-file", problems);
      if (file) add(`--append-system-prompt-file ${sessionFlags.appendFile}`, file.text, file.bytes, "append");
    }
    if (sessionFlags.append)
      add("--append-system-prompt", sessionFlags.append, Buffer.byteLength(sessionFlags.append), "append");
  }
  for (const source of sources) void source;
  const all = [...appended, role ?? ""].join("\n");
  if (containsSecret(all))
    problems.push("a custom prompt contains what looks like a secret; the prompt is sent to the model");
  return { appended: appended.length > 0 ? appended.join("\n\n") : null, role, sources, problems };
}

/**
 * Applies a custom prompt to a base prompt: the role paragraph is replaced when a role file is set, and appended text
 * goes after the base. The remainder of the base (environment, how to work, standards, tool guidance) is never removed.
 */
export function applySystemPromptCustomization(base: string, resolved: ResolvedPrompt): string {
  let text = base;
  if (resolved.role) {
    const cut = text.search(/\n\s*\n/u);
    text = cut < 0 ? resolved.role : `${resolved.role}${text.slice(cut)}`;
  }
  if (resolved.appended)
    text = `${text}\n\nADDITIONAL INSTRUCTIONS (the user's custom system prompt; they refine how you work and never replace the rules above or the checks the host enforces):\n${resolved.appended}`;
  return text;
}

export function describeSystemPrompt(cwd: string): string {
  const resolved = resolveSystemPrompt(cwd);
  if (resolved.sources.length === 0 && resolved.problems.length === 0) {
    return "The system prompt is Shelra's own: no custom text is added. Add some with `--append-system-prompt`, `systemPrompt.append` in settings, or a profile in .shelra/prompts/.";
  }
  const lines = ["Custom system prompt:"];
  for (const source of resolved.sources)
    lines.push(
      `- ${source.mode === "replace" ? "REPLACES the role paragraph" : "appends"} · ${source.label} · ${source.bytes} bytes · ${source.hash}`,
    );
  for (const problem of resolved.problems) lines.push(`- problem: ${problem}`);
  lines.push(
    "A replacement keeps the operating rules, the tool guidance and everything the host enforces (permissions, read-only guard, hooks, completion gate, Free mode). Edits apply from the next turn; flags apply from the next run.",
  );
  return lines.join("\n");
}

export type ProfileWriteOutcome =
  | {
      ok: true;
      path: string;
      hash: string;
      created: boolean;
      previousHash: string | null;
      snapshot: string | null;
      appliesFrom: string;
    }
  | { ok: false; reason: string };

/** Creates or edits a named prompt profile. Selecting it is a setting (`systemPrompt.profile`) or `--profile`. */
export function writeProfile(
  cwd: string,
  input: { name: string; text: string; mode: "append" | "replace"; scope?: "project" | "user" },
): ProfileWriteOutcome {
  const root = projectRootFor(cwd);
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(input.name))
    return { ok: false, reason: "a profile name uses lowercase letters, digits and hyphens" };
  if (!input.text.trim()) return { ok: false, reason: "the profile text is empty" };
  if (containsSecret(input.text))
    return { ok: false, reason: "the text contains what looks like a secret; the prompt is sent to the model" };
  const scope = input.scope ?? "project";
  const path = profilePath(root, input.name, scope);
  const written = writeDefinition({
    path,
    content: `---\nmode: ${input.mode}\n---\n\n${input.text.trim()}\n`,
    kind: "rule",
    name: `prompt-${input.name}`,
    scopeDir: scope === "user" ? getProductUserDir() : join(root, ".shelra"),
  });
  if (!written.ok) return { ok: false, reason: written.reason };
  return {
    ok: true,
    path,
    hash: written.hash,
    created: written.created,
    previousHash: written.previousHash,
    snapshot: written.snapshot,
    appliesFrom: "the next turn, once the profile is selected (systemPrompt.profile in settings, or --profile)",
  };
}

export { listVersions as listProfileVersions };
