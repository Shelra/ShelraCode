/**
 * Managing hooks: list, propose, edit, test, approve, remove. The split of who may do what is the point of this file:
 *
 *  - A model (through the `extension_write` tool) may *propose* a hook: it is written to the project's settings as
 *    pending, and does nothing until the person approves it. It may change or remove a hook that is still pending.
 *  - It may never change, disable or remove a hook that is approved, a user-level hook, or the approved snapshot of one:
 *    those are the person's controls, and a hook that is stopping a turn cannot be switched off by that turn.
 *  - Approving and removing approved hooks are the person's actions (`/hooks`, `shelra hooks`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fingerprintOfHook, invalidateHookCache, type ResolvedHook, resolveHooks, validateHook } from "../hooks/config";
import { execCommandHook } from "../hooks/executor";
import {
  BLOCKABLE_EVENTS,
  type CommandHook,
  HOOK_EVENTS,
  type HookEvent,
  type HookInput,
  isHookEvent,
  SHELRA_OWN_EVENTS,
} from "../hooks/types";
import { redactSecrets } from "../memory/gate";
import { ensureGitignored } from "./instructions";
import { invalidateSettingsCache, layerPath, projectRootFor, type SettingsLayer } from "./settings";
import { contentHash, writeDefinition } from "./store";
import { approveHooks, invalidateTrustCache, revokeHook } from "./trust";

export interface HookProposal {
  event: string;
  matcher?: string;
  command: string;
  args?: string[];
  shell?: "sh" | "cmd" | "powershell";
  timeout?: number;
  id?: string;
  description?: string;
  failurePolicy?: "open" | "closed";
  async?: boolean;
}

export type HookAdminOutcome =
  | {
      ok: true;
      id: string;
      fingerprint: string;
      layer: SettingsLayer;
      path: string;
      hash: string;
      previousHash: string | null;
      snapshot: string | null;
      state: "pending" | "active";
      notes: string[];
      needsApproval?: string;
    }
  | { ok: false; reason: string; conflict?: boolean };

type SettingsJson = {
  hooks?: Record<string, Array<{ matcher?: string; hooks: Array<Record<string, unknown>> }>>;
} & Record<string, unknown>;

function readSettingsFile(path: string): { json: SettingsJson; text: string | null } | { error: string } {
  if (!existsSync(path)) return { json: {}, text: null };
  const text = readFileSync(path, "utf8");
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return { error: `${path} is not a JSON object` };
    return { json: parsed as SettingsJson, text };
  } catch (error) {
    return {
      error: `${path} is not valid JSON (${error instanceof Error ? error.message : String(error)}); fix it before adding hooks`,
    };
  }
}

function scopeDirOf(root: string): string {
  return join(root, ".shelra");
}

function toHook(proposal: HookProposal): Record<string, unknown> {
  return {
    type: "command",
    command: proposal.command,
    ...(proposal.args ? { args: proposal.args } : {}),
    ...(proposal.shell ? { shell: proposal.shell } : {}),
    ...(proposal.timeout ? { timeout: proposal.timeout } : {}),
    ...(proposal.id ? { id: proposal.id } : {}),
    ...(proposal.description ? { description: proposal.description } : {}),
    ...(proposal.failurePolicy ? { failurePolicy: proposal.failurePolicy } : {}),
    ...(proposal.async ? { async: true } : {}),
  };
}

function behaviorNotes(event: HookEvent, hook: CommandHook): string[] {
  const notes: string[] = [];
  if (BLOCKABLE_EVENTS.has(event))
    notes.push(
      `${event} runs before the action and the runtime waits for it: exit code 2 or {"decision":"block"} prevents the action.`,
    );
  else
    notes.push(
      `${event} cannot prevent anything: it runs around something the runtime does not wait to decide, so it only observes (it is recorded as "observed", never "prevented").`,
    );
  if (hook.async) notes.push("It runs without being waited for, so its result never changes what happens.");
  if ((hook.failurePolicy ?? "open") === "closed" && BLOCKABLE_EVENTS.has(event))
    notes.push("If it times out, crashes or prints unreadable output, the action is blocked (closed policy).");
  else if (BLOCKABLE_EVENTS.has(event))
    notes.push(
      "If it times out or crashes, the action goes on and the failure is reported (open policy). Set failurePolicy closed to block instead.",
    );
  if (SHELRA_OWN_EVENTS.has(event)) notes.push(`${event} is a Shelra event; other agents do not fire it.`);
  return notes;
}

/** Writes a hook to the project's settings as a proposal. It runs only after the person approves it. */
export function proposeHook(
  cwd: string,
  proposal: HookProposal,
  options: { layer?: "project" | "local"; replaceId?: string; expectedHash?: string } = {},
): HookAdminOutcome {
  const root = projectRootFor(cwd);
  const layer = options.layer ?? "project";
  if (!isHookEvent(proposal.event))
    return { ok: false, reason: `unknown event "${proposal.event}". Events: ${HOOK_EVENTS.join(", ")}` };
  const event = proposal.event;
  const validated = validateHook(toHook(proposal));
  if ("error" in validated) return { ok: false, reason: validated.error };
  const path = layerPath(layer, root);
  const read = readSettingsFile(path);
  if ("error" in read) return { ok: false, reason: read.error };
  const hooks = { ...(read.json.hooks ?? {}) };
  const fingerprint = fingerprintOfHook(event, proposal.matcher, validated.hook);
  const id = validated.hook.id ?? `${event.toLowerCase()}-${fingerprint.slice(0, 8)}`;
  const resolution = resolveHooks(cwd);
  if (options.replaceId) {
    const target = resolution.hooks.find((hook) => hook.id === options.replaceId && hook.source === layer);
    if (!target) return { ok: false, reason: `no hook "${options.replaceId}" in the ${layer} settings` };
    if (target.state !== "pending")
      return {
        ok: false,
        reason: `hook "${options.replaceId}" is ${target.state}: only the person can change an approved hook (\`shelra hooks remove ${options.replaceId}\`, then propose the new one)`,
      };
    for (const [name, groups] of Object.entries(hooks)) {
      hooks[name] = groups
        .map((group) => ({
          ...group,
          hooks: group.hooks.filter(
            (entry) =>
              (entry.id ??
                `${name.toLowerCase()}-${fingerprintOfHook(name, group.matcher, { type: "command", command: String(entry.command), ...(entry.args ? { args: entry.args as string[] } : {}), ...(entry.timeout ? { timeout: Number(entry.timeout) } : {}), failurePolicy: (entry.failurePolicy as "open" | "closed" | undefined) ?? "open", async: entry.async === true }).slice(0, 8)}`) !==
              options.replaceId,
          ),
        }))
        .filter((group) => group.hooks.length > 0);
    }
  } else if (resolution.hooks.some((hook) => hook.fingerprint === fingerprint)) {
    return {
      ok: false,
      reason: `an identical hook already exists ("${resolution.hooks.find((hook) => hook.fingerprint === fingerprint)?.id}")`,
    };
  }
  if (resolution.hooks.some((hook) => hook.id === id && hook.fingerprint !== fingerprint && !options.replaceId))
    return { ok: false, reason: `a hook named "${id}" already exists; choose another id` };
  const groups = hooks[event] ?? [];
  hooks[event] = groups;
  const group = groups.find((entry) => (entry.matcher ?? "") === (proposal.matcher ?? ""));
  const entry = { ...toHook(proposal), id };
  if (group) group.hooks.push(entry);
  else groups.push({ ...(proposal.matcher ? { matcher: proposal.matcher } : {}), hooks: [entry] });
  const next = { ...read.json, hooks };
  const written = writeDefinition({
    path,
    content: `${JSON.stringify(next, null, 2)}\n`,
    kind: "hook",
    name: layer === "local" ? "settings.local" : "settings",
    scopeDir: scopeDirOf(root),
    ...(options.expectedHash
      ? { expectedHash: options.expectedHash }
      : read.text !== null
        ? { expectedHash: contentHash(read.text) }
        : {}),
  });
  if (!written.ok) return { ok: false, reason: written.reason, conflict: written.conflict };
  // The local file is the person's own: it must not be committed.
  if (layer === "local") ensureGitignored(root, ".shelra/settings.local.json");
  invalidateSettingsCache();
  invalidateHookCache();
  const state = resolveHooks(cwd).hooks.find((hook) => hook.id === id)?.state === "active" ? "active" : "pending";
  return {
    ok: true,
    id,
    fingerprint,
    layer,
    path,
    hash: written.hash,
    previousHash: written.previousHash,
    snapshot: written.snapshot,
    state,
    notes: behaviorNotes(event, validated.hook),
    ...(state === "pending"
      ? {
          needsApproval: `It is written but inert. The person approves it with \`shelra hooks approve ${id}\` (or /hooks); until then nothing runs.`,
        }
      : {}),
  };
}

/** Removes a hook that is still pending from the project's settings. Approved hooks are never touched here. */
export function removePendingHook(cwd: string, id: string, layer: "project" | "local" = "project"): HookAdminOutcome {
  const root = projectRootFor(cwd);
  const target = resolveHooks(cwd).hooks.find((hook) => hook.id === id && hook.source === layer);
  if (!target) return { ok: false, reason: `no hook "${id}" in the ${layer} settings` };
  if (target.state !== "pending" && target.state !== "disabled")
    return {
      ok: false,
      reason: `hook "${id}" is ${target.state}: only the person can remove an approved hook (\`shelra hooks remove ${id}\`)`,
    };
  const path = layerPath(layer, root);
  const read = readSettingsFile(path);
  if ("error" in read) return { ok: false, reason: read.error };
  const hooks = { ...(read.json.hooks ?? {}) };
  for (const [name, groups] of Object.entries(hooks)) {
    hooks[name] = groups
      .map((group) => ({
        ...group,
        hooks: group.hooks.filter((entry) => {
          const fingerprint = fingerprintOfHook(name, group.matcher, {
            type: "command",
            command: String(entry.command),
            ...(entry.args ? { args: entry.args as string[] } : {}),
            ...(entry.timeout ? { timeout: Number(entry.timeout) } : {}),
            failurePolicy: (entry.failurePolicy as "open" | "closed" | undefined) ?? "open",
            async: entry.async === true,
          });
          return fingerprint !== target.fingerprint;
        }),
      }))
      .filter((group) => group.hooks.length > 0);
    if (hooks[name]?.length === 0) delete hooks[name];
  }
  const written = writeDefinition({
    path,
    content: `${JSON.stringify({ ...read.json, hooks }, null, 2)}\n`,
    kind: "hook",
    name: layer === "local" ? "settings.local" : "settings",
    scopeDir: scopeDirOf(root),
    ...(read.text !== null ? { expectedHash: contentHash(read.text) } : {}),
  });
  if (!written.ok) return { ok: false, reason: written.reason, conflict: written.conflict };
  invalidateSettingsCache();
  invalidateHookCache();
  return {
    ok: true,
    id,
    fingerprint: target.fingerprint,
    layer,
    path,
    hash: written.hash,
    previousHash: written.previousHash,
    snapshot: written.snapshot,
    state: "pending",
    notes: ["removed from the settings file; its previous version is kept in .shelra/history"],
  };
}

// --- The person's actions ---------------------------------------------------------------------------------------

/** Approves pending project and local hooks (all, or by id). Only a person calls this: no model tool reaches it. */
export function approvePendingHooks(cwd: string, ids?: string[]): ResolvedHook[] {
  const root = projectRootFor(cwd);
  const pending = resolveHooks(cwd).hooks.filter(
    (hook) =>
      hook.state === "pending" &&
      (hook.source === "project" || hook.source === "local") &&
      (!ids || ids.includes(hook.id)),
  );
  if (pending.length === 0) return [];
  approveHooks(
    root,
    pending.map((hook) => ({
      id: hook.id,
      fingerprint: hook.fingerprint,
      event: hook.event,
      ...(hook.matcher ? { matcher: hook.matcher } : {}),
      command: hook.hook.command,
      ...(hook.hook.args ? { args: hook.hook.args } : {}),
      ...(hook.hook.shell ? { shell: hook.hook.shell } : {}),
      ...(hook.hook.timeout ? { timeout: hook.hook.timeout } : {}),
      failurePolicy: hook.failurePolicy,
      async: hook.async,
      ...(hook.hook.description ? { description: hook.hook.description } : {}),
      layer: hook.source as "project" | "local",
    })),
  );
  invalidateTrustCache();
  invalidateHookCache();
  return pending;
}

export function removeApprovedHook(cwd: string, idOrFingerprint: string): number {
  const removed = revokeHook(projectRootFor(cwd), idOrFingerprint);
  invalidateHookCache();
  return removed;
}

// --- Inspecting and testing -------------------------------------------------------------------------------------

export function describeHooks(cwd: string): string {
  const resolution = resolveHooks(cwd);
  if (resolution.hooks.length === 0 && resolution.problems.length === 0) {
    return "No hooks are defined. Hooks run a command on an event (before or after a tool, when a turn ends, …). Ask Shelra to create one, or add it to ~/.shelra/user-settings.json (yours) or .shelra/settings.json (the project's; it runs only after you approve it).";
  }
  const lines = [`Hooks (${resolution.hooks.length}):`];
  for (const hook of resolution.hooks) {
    const blockable = BLOCKABLE_EVENTS.has(hook.event);
    const kind = blockable ? (hook.async ? "observes (async)" : "can prevent") : "observes only";
    lines.push(
      `- ${hook.id} [${hook.state}] ${hook.event}${hook.matcher ? `:${hook.matcher}` : ""} · ${hook.source} · ${kind} · policy ${hook.failurePolicy} · timeout ${hook.hook.timeout ?? 30}s`,
    );
    lines.push(
      `    ${redactSecrets(hook.hook.command).slice(0, 160)}${hook.hook.args ? ` ${redactSecrets(hook.hook.args.join(" ")).slice(0, 80)}` : ""}`,
    );
    if (hook.reason) lines.push(`    ${hook.reason}`);
  }
  for (const problem of resolution.problems) lines.push(`- problem (${problem.source}): ${problem.message}`);
  lines.push(
    "",
    "Hooks are scripts run by the host on a fixed event: whether one fires and what it returns is deterministic, not a model's judgment.",
  );
  return lines.join("\n");
}

function sampleInput(event: HookEvent, hook: ResolvedHook, cwd: string): HookInput {
  const tool = hook.matcher?.split("|")[0]?.replace(/[^A-Za-z0-9_]/gu, "") || "bash";
  switch (event) {
    case "PreToolUse":
      return { hook_event_name: event, tool_name: tool, tool_input: { command: "echo hook-test" }, cwd };
    case "PostToolUse":
      return {
        hook_event_name: event,
        tool_name: tool,
        tool_input: { command: "echo hook-test" },
        tool_output: { success: true, output: "hook-test" },
        cwd,
      };
    case "PostToolUseFailure":
      return { hook_event_name: event, tool_name: tool, tool_input: {}, error: "hook-test", cwd };
    case "UserPromptSubmit":
      return { hook_event_name: event, user_prompt: "hook test", cwd };
    case "SessionStart":
      return { hook_event_name: event, source: "startup", cwd };
    case "SubagentStart":
    case "SubagentStop":
    case "TaskCreated":
    case "TaskCompleted":
      return {
        hook_event_name: event,
        agent_type: "hook-test",
        description: "hook test",
        success: true,
        cwd,
      } as HookInput;
    case "PreCompact":
    case "PostCompact":
      return { hook_event_name: event, trigger: "manual", cwd };
    case "Notification":
      return { hook_event_name: event, message: "hook test", cwd };
    case "InstructionsLoaded":
      return { hook_event_name: event, files_loaded: 1, cwd };
    case "CwdChanged":
      return { hook_event_name: event, old_cwd: cwd, new_cwd: cwd, cwd };
    case "SkillActivated":
      return {
        hook_event_name: event,
        skill_name: "hook-test",
        skill_hash: "000000000000",
        invoker: "user",
        reason: "test",
        cwd,
      };
    case "ExtensionChanged":
      return { hook_event_name: event, kind: "skill", name: "hook-test", action: "test", path: "", hash: "", cwd };
    case "StopFailure":
      return { hook_event_name: event, error: "hook-test", cwd };
    default:
      return { hook_event_name: event, cwd } as HookInput;
  }
}

export interface HookTestReport {
  ok: boolean;
  hookId?: string;
  reason?: string;
  event?: string;
  outcome?: string;
  exitCode?: number | null;
  durationMs?: number;
  wouldPrevent?: boolean;
  effect?: string;
  stderr?: string;
  stdout?: unknown;
  note?: string;
}

/**
 * Runs one hook once on a sample input, so its behavior is seen and not guessed. A hook the person has not approved is
 * run only if this session wrote it (`createdHere`): running an unreviewed hook from a repository would be running its
 * code on the person's say-so of nobody.
 */
export async function testHook(
  cwd: string,
  id: string,
  options: { createdHere?: ReadonlySet<string>; signal?: AbortSignal } = {},
): Promise<HookTestReport> {
  const resolution = resolveHooks(cwd);
  const hook = resolution.hooks.find((entry) => entry.id === id);
  if (!hook)
    return {
      ok: false,
      reason: `no hook "${id}". Known: ${resolution.hooks.map((entry) => entry.id).join(", ") || "none"}`,
    };
  const runnable = hook.state === "active" || hook.state === "modified" || options.createdHere?.has(hook.fingerprint);
  if (!runnable)
    return {
      ok: false,
      hookId: id,
      reason: `hook "${id}" is ${hook.state}: it comes from a repository file and has not been approved, so Shelra will not run its command. Review it, then \`shelra hooks approve ${id}\`.`,
    };
  const blockable = BLOCKABLE_EVENTS.has(hook.event);
  const input = sampleInput(hook.event, hook, cwd);
  const result = await execCommandHook(hook.hook, input, cwd, options.signal, {
    hookId: hook.id,
    source: hook.source,
    blockable,
    failurePolicy: hook.failurePolicy,
    projectDir: resolution.root,
  });
  const prevented =
    result.outcome === "blocking" ||
    result.output?.decision === "block" ||
    result.output?.permissionDecision === "deny";
  return {
    ok: true,
    hookId: hook.id,
    event: hook.event,
    outcome: result.outcome,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    wouldPrevent: blockable && prevented,
    effect: !blockable
      ? "observed"
      : prevented
        ? "prevented"
        : result.outcome === "non_blocking_error"
          ? "failed-open"
          : "allowed",
    ...(result.stderr ? { stderr: redactSecrets(result.stderr).slice(0, 400) } : {}),
    ...(result.output ? { stdout: result.output } : {}),
    note: blockable
      ? "This event waits for the hook: a block here prevents the real action."
      : "This event does not wait for the hook: whatever it returns, it cannot prevent the action.",
  };
}
