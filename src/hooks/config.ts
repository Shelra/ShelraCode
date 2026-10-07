import { join } from "node:path";
import { layerPath, projectRootFor, readLayer, type SettingsLayer } from "../extend/settings";
import { fileSignature } from "../extend/store";
import { type ApprovedHook, approvedHooks, fingerprintOf } from "../extend/trust";
import { getProductUserDir } from "../product/identity";
import { loadUserSettings } from "../utils/settings.js";
import type {
  CommandHook,
  HookCommand,
  HookEvent,
  HookFailurePolicy,
  HookMatcher,
  HookSource,
  HooksConfig,
} from "./types.js";
import { HOOK_EVENTS } from "./types.js";

/**
 * Hooks come from three layers and run only when trusted (docs/architecture/24-EXTENSIONS.md, Hooks):
 *
 *  - user     `~/.shelra/user-settings.json`: the person's own file, trusted as written.
 *  - project  `.shelra/settings.json`: committed to the repository, so a proposal: a malicious repository must not be
 *             able to run a command on a developer's machine.
 *  - local    `.shelra/settings.local.json`: gitignored, but still a file an agent can write, so also a proposal: an
 *             agent must not be able to switch off the hook that is stopping it.
 *
 * A proposal runs only as the approved snapshot the person stored with `shelra hooks approve` (`src/extend/trust.ts`).
 * Hooks of every layer merge: all that match an event run, in a stable order (user, then project, then local; inside a
 * layer, file order), and a hook defined in two layers runs once.
 */

export type HookState = "active" | "pending" | "modified" | "disabled" | "invalid";

export interface ResolvedHook {
  id: string;
  event: HookEvent;
  matcher?: string;
  hook: CommandHook;
  source: HookSource;
  fingerprint: string;
  state: HookState;
  /** Why it is not active, or a note about it. */
  reason?: string;
  failurePolicy: HookFailurePolicy;
  async: boolean;
}

const MAX_TIMEOUT_SECONDS = 600;

/** The user layer's hooks as the settings file has them (the shape other modules and tests read). */
export function loadHooksConfig(): HooksConfig {
  return loadUserSettings().hooks ?? {};
}

export function validateHook(raw: unknown): { hook: CommandHook } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "a hook must be an object" };
  const entry = raw as Record<string, unknown>;
  if (entry.type !== undefined && entry.type !== "command")
    return { error: `hook type "${String(entry.type)}" is not supported; only "command"` };
  if (typeof entry.command !== "string" || !entry.command.trim()) return { error: "a hook needs a command" };
  const timeout = entry.timeout === undefined ? undefined : Number(entry.timeout);
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_TIMEOUT_SECONDS))
    return { error: `timeout must be 1 to ${MAX_TIMEOUT_SECONDS} seconds` };
  if (entry.failurePolicy !== undefined && entry.failurePolicy !== "open" && entry.failurePolicy !== "closed")
    return { error: 'failurePolicy must be "open" or "closed"' };
  if (entry.async === true && entry.failurePolicy === "closed")
    return { error: "an async hook can never block, so it cannot have a closed failure policy" };
  if (entry.args !== undefined && (!Array.isArray(entry.args) || entry.args.some((arg) => typeof arg !== "string")))
    return { error: "args must be a list of text" };
  if (entry.shell !== undefined && entry.shell !== "sh" && entry.shell !== "cmd" && entry.shell !== "powershell")
    return { error: 'shell must be "sh", "cmd" or "powershell"' };
  return {
    hook: {
      type: "command",
      command: entry.command,
      ...(Array.isArray(entry.args) ? { args: entry.args as string[] } : {}),
      ...(entry.shell ? { shell: entry.shell as CommandHook["shell"] } : {}),
      ...(timeout !== undefined ? { timeout } : {}),
      ...(typeof entry.id === "string" && entry.id ? { id: entry.id } : {}),
      ...(typeof entry.description === "string" ? { description: entry.description } : {}),
      ...(entry.enabled === false ? { enabled: false } : {}),
      ...(entry.failurePolicy ? { failurePolicy: entry.failurePolicy as HookFailurePolicy } : {}),
      ...(entry.async === true ? { async: true } : {}),
    },
  };
}

export function fingerprintOfHook(event: string, matcher: string | undefined, hook: CommandHook): string {
  return fingerprintOf({
    event,
    ...(matcher ? { matcher } : {}),
    command: hook.command,
    ...(hook.args ? { args: hook.args } : {}),
    ...(hook.shell ? { shell: hook.shell } : {}),
    ...(hook.timeout ? { timeout: hook.timeout } : {}),
    failurePolicy: hook.failurePolicy ?? "open",
    async: hook.async === true,
  });
}

function flatten(
  config: unknown,
  source: HookSource,
  problems: Array<{ source: HookSource; message: string }>,
): ResolvedHook[] {
  const out: ResolvedHook[] = [];
  if (!config || typeof config !== "object") return out;
  for (const [event, matchers] of Object.entries(config as Record<string, unknown>)) {
    if (!(HOOK_EVENTS as readonly string[]).includes(event)) {
      problems.push({ source, message: `unknown hook event "${event}"` });
      continue;
    }
    if (!Array.isArray(matchers)) continue;
    for (const group of matchers as HookMatcher[]) {
      const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
      for (const raw of hooks) {
        const validated = validateHook(raw);
        if ("error" in validated) {
          problems.push({ source, message: `${event}: ${validated.error}` });
          continue;
        }
        const fingerprint = fingerprintOfHook(event, group.matcher, validated.hook);
        out.push({
          id: validated.hook.id ?? `${event.toLowerCase()}-${fingerprint.slice(0, 8)}`,
          event: event as HookEvent,
          ...(group.matcher ? { matcher: group.matcher } : {}),
          hook: validated.hook,
          source,
          fingerprint,
          state: validated.hook.enabled === false ? "disabled" : "active",
          failurePolicy: validated.hook.failurePolicy ?? "open",
          async: validated.hook.async === true,
        });
      }
    }
  }
  return out;
}

function fromApproved(approved: ApprovedHook): ResolvedHook {
  return {
    id: approved.id,
    event: approved.event as HookEvent,
    ...(approved.matcher ? { matcher: approved.matcher } : {}),
    hook: {
      type: "command",
      command: approved.command ?? "",
      ...(approved.args ? { args: approved.args } : {}),
      ...(approved.shell ? { shell: approved.shell as CommandHook["shell"] } : {}),
      ...(approved.timeout ? { timeout: approved.timeout } : {}),
      id: approved.id,
      failurePolicy: approved.failurePolicy,
      ...(approved.async ? { async: true } : {}),
      ...(approved.description ? { description: approved.description } : {}),
    },
    source: approved.layer,
    fingerprint: approved.fingerprint,
    state: "active",
    failurePolicy: approved.failurePolicy,
    async: approved.async,
  };
}

export interface HookResolution {
  hooks: ResolvedHook[];
  problems: Array<{ source: HookSource; message: string }>;
  root: string;
  disabledAll: boolean;
}

/**
 * Every hook that applies to a project, with its state. `active` ones run. A project or local hook not in the approved
 * snapshot is `pending`; one in the snapshot is enforced as approved even if the file changed or lost it (`modified`
 * says the file no longer matches what was approved).
 */
export function resolveHooks(cwd: string): HookResolution {
  const root = projectRootFor(cwd);
  const key = `${root}|${getProductUserDir()}`;
  // Hooks are asked for on every tool call, and calls come in bursts: within a moment of the last check the answer
  // stands (an edit by hand is seen on the next call after that; our own writes invalidate at once).
  const recent = resolutions.get(key);
  if (recent && Date.now() - recent.checkedAt < SIGNATURE_RECHECK_MS) return recent.resolution;
  const signature = [
    userSettingsFile(),
    layerPath("project", root),
    layerPath("local", root),
    join(getProductUserDir(), "trust.json"),
  ]
    .map(fileSignature)
    .join("|");
  const hit = resolutions.get(key);
  if (hit && hit.signature === signature) {
    hit.checkedAt = Date.now();
    return hit.resolution;
  }
  const resolution = buildResolution(root);
  resolutions.set(key, { signature, resolution, checkedAt: Date.now() });
  return resolution;
}

export function invalidateHookCache(): void {
  resolutions.clear();
}

const SIGNATURE_RECHECK_MS = 150;
const resolutions = new Map<string, { signature: string; resolution: HookResolution; checkedAt: number }>();

function userSettingsFile(): string {
  return join(getProductUserDir(), "user-settings.json");
}

function buildResolution(root: string): HookResolution {
  const problems: HookResolution["problems"] = [];
  const hooks: ResolvedHook[] = [];
  const user = loadUserSettings();
  hooks.push(...flatten(user.hooks, "user", problems));
  const approved = approvedHooks(root);
  const approvedByFingerprint = new Map(approved.map((hook) => [hook.fingerprint, hook]));
  const seen = new Set<string>();
  const disabledAll = (user as { disableAllHooks?: boolean }).disableAllHooks === true;
  for (const layer of ["project", "local"] as const satisfies readonly SettingsLayer[]) {
    const read = readLayer(layer, root);
    // Only the person's own user settings can switch every hook off: these files are ones an agent can write.
    for (const proposed of flatten(read.data.hooks, layer, problems)) {
      seen.add(proposed.fingerprint);
      const snapshot = approvedByFingerprint.get(proposed.fingerprint);
      if (proposed.state === "disabled") {
        // A file an agent can write must not switch an approved hook off (it may be a fail-closed guard): the approved
        // snapshot keeps running, and only removing it, as the person, stops it.
        hooks.push(
          snapshot
            ? {
                ...fromApproved(snapshot),
                state: "modified",
                reason: `the settings file marks it disabled, but the version you approved still runs. Remove it with \`shelra hooks remove ${snapshot.id}\``,
              }
            : proposed,
        );
        continue;
      }
      hooks.push(
        snapshot
          ? { ...proposed, state: "active" }
          : {
              ...proposed,
              state: "pending",
              reason:
                "defined in a repository file; it will not run until you approve it (`shelra hooks approve` or /hooks)",
            },
      );
    }
  }
  for (const snapshot of approved) {
    if (seen.has(snapshot.fingerprint)) continue;
    hooks.push({
      ...fromApproved(snapshot),
      state: "modified",
      reason: `approved earlier, but the settings file no longer defines it as approved; the approved version still runs. Remove it with \`shelra hooks remove ${snapshot.id}\``,
    });
  }
  // Defined in two layers: run once, the first (user before project before local).
  const unique = new Map<string, ResolvedHook>();
  for (const hook of hooks) {
    const existing = unique.get(hook.fingerprint);
    if (!existing || (existing.state !== "active" && hook.state === "active")) unique.set(hook.fingerprint, hook);
  }
  return { hooks: [...unique.values()], problems, root, disabledAll };
}

export function matchesPattern(matcher: string | undefined, matchValue: string | undefined): boolean {
  if (!matcher || matcher === "*") return true;
  if (!matchValue) return false;
  if (/^[\w|,.:-]+$/u.test(matcher)) {
    return matcher
      .split(/[|,]/u)
      .map((part) => part.trim().toLowerCase())
      .includes(matchValue.toLowerCase());
  }
  if (matcher.length > 200) return false;
  try {
    return new RegExp(matcher, "u").test(matchValue);
  } catch {
    return false;
  }
}

/**
 * The hooks that fire for an event, in their stable order: the active ones, and the approved snapshots whose file has
 * since been edited or emptied (`modified`), which keep running exactly as approved.
 */
export function activeHooksFor(resolution: HookResolution, event: HookEvent, matchValue?: string): ResolvedHook[] {
  if (resolution.disabledAll) return [];
  return resolution.hooks.filter(
    (hook) =>
      (hook.state === "active" || hook.state === "modified") &&
      hook.event === event &&
      matchesPattern(hook.matcher, matchValue),
  );
}

/**
 * Hooks of a user-layer config that match an event (the older entry point, kept for callers and tests that hold a
 * `HooksConfig`). Matching is the same as at run time: `*`, alternatives with `|`, or a regular expression.
 */
export function getMatchingHooks(config: HooksConfig, event: HookEvent, matchValue?: string): HookCommand[] {
  const matchers = config[event];
  if (!matchers || matchers.length === 0) return [];
  const matched: HookCommand[] = [];
  for (const entry of matchers) {
    if (matchesPattern(entry.matcher, matchValue)) matched.push(...entry.hooks);
  }
  return matched;
}
